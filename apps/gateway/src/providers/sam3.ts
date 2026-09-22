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

/** 通过官方 Gradio SDK 调用已核验的 SAM3 Space；只接受网关配置的地址。 */
export async function segmentWithSam3(input: { jpeg: Blob; textQuery: string; confidenceThreshold: number; spaceUrl: string; token?: string; timeoutMs: number }) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), input.timeoutMs);
  let client: Client | undefined;
  try {
    client = await Client.connect(input.spaceUrl, input.token?.startsWith('hf_') ? { token: input.token as `hf_${string}` } : undefined);
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
    client = await Client.connect(input.spaceUrl, input.token?.startsWith('hf_') ? { token: input.token as `hf_${string}` } : undefined);
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
