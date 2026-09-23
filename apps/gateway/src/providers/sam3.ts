import { Client, handle_file } from '@gradio/client';
import { z } from 'zod';

const SamOutputSchema = z.object({
  image: z.object({ url: z.string().url(), path: z.string() }).passthrough(),
  annotations: z.array(z.object({ image: z.object({ url: z.string().url(), path: z.string() }).passthrough(), label: z.string() }).passthrough()),
}).passthrough();
const SamPointOutputSchema = z.object({
  inputWidth: z.number().int().positive(), inputHeight: z.number().int().positive(), encoding: z.enum(['gray8', 'rgba-alpha']),
  mask: z.object({ url: z.string().url(), path: z.string().optional() }).passthrough(), score: z.number().finite().nullable().optional(),
}).passthrough();

export class SamProviderError extends Error {
  constructor(readonly code: 'SAM_QUOTA_EXHAUSTED' | 'SAM_UNAVAILABLE' | 'SAM_TIMEOUT' | 'SAM_PROVIDER_ERROR' | 'SAM_OUTPUT_INVALID', message: string, readonly cause?: unknown) {
    super(message); this.name = 'SamProviderError';
  }
}

function classifySamError(error: unknown): SamProviderError {
  if (error instanceof SamProviderError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const text = message.toLowerCase();
  if (text.includes('quota') || text.includes('gpu') || text.includes('rate limit')) return new SamProviderError('SAM_QUOTA_EXHAUSTED', 'SAM3 当前配额已用完，请稍后再试', error);
  if (text.includes('timeout') || text.includes('aborted')) return new SamProviderError('SAM_TIMEOUT', 'SAM3 分割等待超时，请重新请求', error);
  if (text.includes('sleep') || text.includes('unavailable') || text.includes('503')) return new SamProviderError('SAM_UNAVAILABLE', 'SAM3 服务暂时不可用，请稍后再试', error);
  return new SamProviderError('SAM_PROVIDER_ERROR', 'SAM3 服务处理失败，请稍后再试', error);
}

/**
 * SAM_HF_TOKEN 令牌池。环境变量写成 "hf_aaa,hf_bbb"（英文逗号分隔）即可
 * 配置多个令牌；留空时保持匿名连接。池里维护一个"当前令牌"指针：
 * 额度用尽时指针移到下一个令牌重试，指针会停在最近可用的令牌上，
 * 后续请求直接从它开始。指针是进程内状态，重启后从第一个令牌重来。
 */
export class SamTokenPool {
  private readonly tokens: `hf_${string}`[];
  private index = 0;

  constructor(raw: string | undefined) {
    const entries = (raw ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
    const invalidIndex = entries.findIndex((entry) => !entry.startsWith('hf_'));
    if (invalidIndex >= 0) throw new Error(`SAM_HF_TOKEN 第 ${invalidIndex + 1} 个条目不是 hf_ 开头的令牌`);
    this.tokens = entries as `hf_${string}`[];
  }

  /** 池内令牌总数；0 表示匿名连接。 */
  get size() { return this.tokens.length; }

  /** 当前应使用的令牌；池为空时返回 undefined（匿名连接）。 */
  current() { return this.tokens[this.index]; }

  /** 移动到下一个令牌并返回新下标，只用于日志。 */
  rotate() { this.index = (this.index + 1) % this.tokens.length; return this.index; }
}

/**
 * 逐个令牌执行 SAM 调用：Hugging Face 对当前令牌报额度受限
 * （SAM_QUOTA_EXHAUSTED，即 quota / rate limit / GPU 超限）时切换到下一个
 * 令牌重试，每个令牌只试一次，全部用尽才把错误抛给调用方。
 * 池为空（匿名）或只有一个令牌时，行为与单令牌版本完全一致。
 */
export async function runWithSamTokens<T>(pool: SamTokenPool, run: (token: `hf_${string}` | undefined) => Promise<T>, onRotate?: (nextIndex: number, poolSize: number) => void): Promise<T> {
  const attempts = Math.max(pool.size, 1);
  for (let attempt = 0; ; attempt++) {
    try {
      return await run(pool.current());
    } catch (error) {
      if (!(error instanceof SamProviderError) || error.code !== 'SAM_QUOTA_EXHAUSTED' || attempt + 1 >= attempts) throw error;
      onRotate?.(pool.rotate(), pool.size);
    }
  }
}

/**
 * 连接 Gradio 应用并处理 ModelScope 的特殊性：api-inference 域名返回的
 * config.root 指向浏览器域名 ms.show（拒绝 SDK token 直连），需要改回
 * api 地址并重新拉取接口信息，后续上传/推理/文件下载才会全部走 api 域名。
 * Hugging Face Space 的 config.root 与连接地址同源，不做任何改动。
 */
async function connectGradio(spaceUrl: string, token?: string) {
  const client = await Client.connect(spaceUrl, token ? { token: token as `hf_${string}` } : undefined);
  const config = client.config;
  if (config?.root && new URL(config.root).origin !== new URL(spaceUrl).origin) {
    config.root = spaceUrl.replace(/\/+$/, '');
    config.connect_heartbeat = false;
    client.api_info = await client.view_api();
  }
  return client;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/**
 * 兜底端点的蒙版文件下载需要认证，浏览器拿不到；由网关代下载并内嵌为
 * data URL 返回。浏览器端最多采用前 8 个选区，因此也只下载前 8 个蒙版。
 * 只从配置的兜底地址取文件路径，不会访问提供方返回的其他主机。
 */
export async function inlineFallbackMasks(annotations: Array<{ image: { url: string }; label: string }>, fallbackUrl: string, token: string, timeoutMs: number) {
  return Promise.all(annotations.slice(0, 8).map(async (item, index) => {
    const providerUrl = new URL(item.image.url);
    const response = await fetch(new URL(providerUrl.pathname + providerUrl.search, fallbackUrl), {
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new SamProviderError('SAM_PROVIDER_ERROR', `兜底端点蒙版下载失败 HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.subarray(0, 4).equals(PNG_SIGNATURE)) throw new SamProviderError('SAM_OUTPUT_INVALID', '兜底端点返回的蒙版不是 PNG 文件');
    return { index, label: item.label, maskUrl: `data:image/png;base64,${bytes.toString('base64')}` };
  }));
}

/** 通过官方 Gradio SDK 调用已核验的 SAM3 Space；只接受网关配置的地址。 */
export async function segmentWithSam3(input: { jpeg: Blob; textQuery: string; confidenceThreshold: number; spaceUrl: string; token?: string; timeoutMs: number }) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), input.timeoutMs);
  let client: Client | undefined;
  try {
    client = await connectGradio(input.spaceUrl, input.token);
    const predicted = client.predict('/run_image_segmentation', {
      source_img: handle_file(input.jpeg), text_query: input.textQuery, conf_thresh: input.confidenceThreshold,
    });
    const result = await Promise.race([
      predicted,
      new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new SamProviderError('SAM_TIMEOUT', 'SAM3 分割等待超时')))),
    ]);
    const raw = Array.isArray(result.data) ? result.data[0] : undefined;
    const parsed = SamOutputSchema.safeParse(raw);
    if (!parsed.success) throw new SamProviderError('SAM_OUTPUT_INVALID', 'SAM3 返回的数据格式不符合接口约定', parsed.error);
    return parsed.data;
  } catch (error) {
    throw classifySamError(error);
  } finally {
    clearTimeout(deadline);
    client?.close();
  }
}

/**
 * 点选端点是提供方待实现的显式契约。坐标先由浏览器归一化，再在此处换算为输入像素，
 * 这样网页缩放、裁切和旋转不会泄漏到上游接口。
 */
export async function segmentPointsWithSam3(input: { jpeg: Blob; endpoint: string; points: Array<{ x: number; y: number; label: 0 | 1 }>; inputWidth: number; inputHeight: number; spaceUrl: string; token?: string; timeoutMs: number }) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), input.timeoutMs);
  let client: Client | undefined;
  try {
    client = await connectGradio(input.spaceUrl, input.token);
    const points = input.points.map((point) => ({ x: Math.min(input.inputWidth - 1, Math.floor(point.x * input.inputWidth)), y: Math.min(input.inputHeight - 1, Math.floor(point.y * input.inputHeight)), label: point.label }));
    const predicted = client.predict(input.endpoint, { image: handle_file(input.jpeg), points });
    const result = await Promise.race([
      predicted,
      new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new SamProviderError('SAM_TIMEOUT', 'SAM3 点选等待超时')))),
    ]);
    const raw = Array.isArray(result.data) ? result.data[0] : undefined;
    const parsed = SamPointOutputSchema.safeParse(raw);
    if (!parsed.success) throw new SamProviderError('SAM_OUTPUT_INVALID', 'SAM3 点选端点未返回独立原始蒙版', parsed.error);
    if (parsed.data.inputWidth !== input.inputWidth || parsed.data.inputHeight !== input.inputHeight) throw new SamProviderError('SAM_OUTPUT_INVALID', 'SAM3 点选蒙版尺寸与输入不一致');
    return { annotations: [{ image: parsed.data.mask, label: '选区 1' }] };
  } catch (error) {
    throw classifySamError(error);
  } finally {
    clearTimeout(deadline);
    client?.close();
  }
}
