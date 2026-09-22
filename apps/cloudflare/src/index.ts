import { DurableObject } from 'cloudflare:workers';
import { z } from '../node_modules/zod/index.js';
import { Client, handle_file } from '@gradio/client';
import { EditStateSchema, PlanPayloadSchema, RENDERER_VERSION, SCHEMA_VERSION, validatePlan } from '../../../packages/domain/src/index';

interface Env {
  AI_SDK?: 'openai' | 'anthropic';
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  SESSION_SECRET: string;
  ALLOWED_ORIGIN?: string;
  DAILY_AI_ATTEMPT_LIMIT?: string;
  DAILY_AI_ATTEMPT_LIMIT_PER_SESSION?: string;
  SAM_PROVIDER?: 'hf-gradio';
  SAM_SPACE_URL?: string;
  SAM_HF_TOKEN?: string;
  SAM_TIMEOUT_MS?: string;
  SAM_POINT_SEGMENTATION?: string;
  SAM_POINT_ENDPOINT?: string;
  AI_QUOTA: DurableObjectNamespace;
  ASSETS: Fetcher;
}

type Session = { attempts: number; day: string; requestIds: Record<string, number> };
const PreviewSchema = z.object({ mime: z.literal('image/jpeg'), width: z.number().int().positive().max(1024), height: z.number().int().positive().max(1024), base64: z.string().min(1) }).strict();
const SegmentPromptSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('text'), textQuery: z.string().trim().min(1).max(80), confidenceThreshold: z.number().finite().min(0).max(1) }).strict(), z.object({ kind: z.literal('point'), points: z.array(z.object({ x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1), label: z.union([z.literal(0), z.literal(1)]) }).strict()).min(1).max(16) }).strict()]);
const SegmentRequestSchema = z.object({ requestId: z.uuid(), imageId: z.uuid(), sourceVersion: z.number().int().positive(), baseRevision: z.number().int().nonnegative(), preview: PreviewSchema, prompt: SegmentPromptSchema }).strict();
const SamOutputSchema = z.object({ image: z.object({ url: z.string().url() }).passthrough(), annotations: z.array(z.object({ image: z.object({ url: z.string().url() }).passthrough(), label: z.string() }).passthrough()) }).passthrough();
const SamPointOutputSchema = z.object({ inputWidth: z.number().int().positive(), inputHeight: z.number().int().positive(), encoding: z.enum(['gray8', 'rgba-alpha']), mask: z.object({ url: z.string().url() }).passthrough() }).passthrough();
const PlanRequestSchema = z.object({ schemaVersion: z.literal(SCHEMA_VERSION), requestId: z.uuid(), imageId: z.uuid(), sourceVersion: z.number().int().positive(), baseRevision: z.number().int().nonnegative(), mode: z.enum(['auto', 'followup']), instruction: z.string().max(1000), state: EditStateSchema, allowComposition: z.boolean(), originalPreview: PreviewSchema, currentPreview: PreviewSchema, referencePreview: PreviewSchema.optional(), context: z.array(z.object({ instruction: z.string().max(250), appliedSummary: z.string().max(250) }).strict()).max(6) }).strict().superRefine((value, ctx) => { if (value.sourceVersion !== value.state.sourceVersion || value.baseRevision !== value.state.revision || value.imageId !== value.state.imageId) ctx.addIssue({ code: 'custom', message: '请求身份与编辑状态不一致' }); });
const today = () => new Date().toISOString().slice(0, 10);
const error = (code: string, message: string, retryAfterSeconds: number | null = null) => ({ code, message, retryAfterSeconds });
const response = (body: unknown, status = 200, headers?: HeadersInit) => Response.json(body, { status, headers });

/** Cloudflare 与 Vercel 使用相同字段，便于用 requestId 对照两边的运行时日志。 */
function writeLog(level: 'info' | 'error', event: string, fields: Record<string, unknown>) {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), service: 'photo-copilot', event, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}

/** 仅提取可诊断字段，避免把密钥、Cookie、请求图片或完整请求头写入日志。 */
function errorLogDetails(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) };
  const details: Record<string, unknown> = { name: error.name, message: error.message, stack: error.stack };
  const record = error as Error & Record<string, unknown>;
  const source = record.cause instanceof Error ? record.cause : error;
  if (source instanceof Error && source !== error) details.cause = { name: source.name, message: source.message, stack: source.stack };
  if (typeof source === 'object' && source !== null) {
    for (const key of ['status', 'code', 'type', 'request_id', 'requestId', 'requestID']) {
      const value = (source as Record<string, unknown>)[key];
      if (typeof value === 'string' || typeof value === 'number') details[key] = value;
    }
  }
  return details;
}

async function signature(value: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sessionFor(request: Request, env: Env) {
  const raw = request.headers.get('cookie')?.match(/(?:^|;\s*)pc_session=([^;]+)/)?.[1];
  if (raw) {
    const dot = raw.lastIndexOf('.');
    if (dot > 0 && raw.slice(dot + 1) === await signature(raw.slice(0, dot), env.SESSION_SECRET)) return { id: raw.slice(0, dot), cookie: undefined };
  }
  const id = crypto.randomUUID();
  const cookie = `pc_session=${id}.${await signature(id, env.SESSION_SECRET)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`;
  return { id, cookie };
}

function allowed(request: Request, env: Env) {
  const origin = request.headers.get('origin');
  const origins = env.ALLOWED_ORIGIN?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
  return Boolean(origin && (origins.length ? origins.includes(origin) : origin === new URL(request.url).origin));
}

function jpegBytes(base64: string, preview: z.infer<typeof PreviewSchema>) {
  const binary = atob(base64);
  if (binary.length > 512 * 1024) throw new Error('分析图片超过大小限制');
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('分析图片必须是 JPEG');
  return new Blob([bytes], { type: preview.mime });
}

/** Cloudflare Worker 与 Node 网关共用官方 Gradio SDK；只调用部署配置的 SAM3 Space。 */
async function segmentWithSam(env: Env, jpeg: Blob, prompt: z.infer<typeof SegmentPromptSchema>, inputWidth: number, inputHeight: number) {
  const spaceUrl = env.SAM_SPACE_URL || 'https://prithivmlmods-sam3-demo.hf.space';
  const timeoutMs = Math.min(Number(env.SAM_TIMEOUT_MS ?? 75_000), 75_000);
  let client: Client | undefined;
  try {
    client = await Client.connect(spaceUrl, env.SAM_HF_TOKEN?.startsWith('hf_') ? { token: env.SAM_HF_TOKEN as `hf_${string}` } : undefined);
    if (prompt.kind === 'point' && env.SAM_POINT_SEGMENTATION !== 'true') throw new Error('POINT_SEGMENTATION_UNAVAILABLE');
    const request = prompt.kind === 'text'
      ? client.predict('/run_image_segmentation', { source_img: handle_file(jpeg), text_query: prompt.textQuery, conf_thresh: prompt.confidenceThreshold })
      : client.predict(env.SAM_POINT_ENDPOINT || '/segment_points', { image: handle_file(jpeg), points: prompt.points.map((point) => ({ x: Math.min(inputWidth - 1, Math.floor(point.x * inputWidth)), y: Math.min(inputHeight - 1, Math.floor(point.y * inputHeight)), label: point.label })) });
    const output = await Promise.race([
      request,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('SAM_TIMEOUT')), timeoutMs)),
    ]);
    const raw = Array.isArray(output.data) ? output.data[0] : undefined;
    const parsed = prompt.kind === 'text' ? SamOutputSchema.safeParse(raw) : SamPointOutputSchema.safeParse(raw);
    if (!parsed.success) throw new Error('SAM_OUTPUT_INVALID');
    const allowedHost = new URL(spaceUrl).host;
    const annotations = prompt.kind === 'text' ? parsed.data.annotations : [{ image: parsed.data.mask, label: '选区 1' }];
    for (const annotation of annotations) if (new URL(annotation.image.url).host !== allowedHost) throw new Error('SAM_OUTPUT_INVALID');
    return annotations;
  } finally { client?.close(); }
}

export class AiQuota extends DurableObject {
  async fetch(request: Request) {
    const input = await request.json() as { action: 'read' | 'reserve' | 'delete'; sessionId: string; requestId?: string; limit: number; perSessionLimit: number };
    const date = today();
    const sessionKey = `session:${input.sessionId}`;
    const session = (await this.ctx.storage.get<Session>(sessionKey)) ?? { attempts: 0, day: date, requestIds: {} };
    const global = (await this.ctx.storage.get<{ attempts: number; day: string }>('global')) ?? { attempts: 0, day: date };
    if (input.action === 'delete') { await this.ctx.storage.delete(sessionKey); return response({ deleted: true }); }
    if (session.day !== date) Object.assign(session, { attempts: 0, day: date, requestIds: {} });
    if (global.day !== date) Object.assign(global, { attempts: 0, day: date });
    if (input.action === 'reserve') {
      const previous = input.requestId ? session.requestIds[input.requestId] : undefined;
      if (previous && Date.now() - previous < 600000) return response(error('REQUEST_DUPLICATE', '操作已提交'), 409);
      if (session.attempts >= input.perSessionLimit || global.attempts >= input.limit) return response(error('QUOTA_EXHAUSTED', '今日 AI 额度已用完', 86400), 429);
      session.attempts++; global.attempts++;
      if (input.requestId) session.requestIds[input.requestId] = Date.now();
      await this.ctx.storage.put(sessionKey, session); await this.ctx.storage.put('global', global);
    }
    return response({ remainingAttempts: Math.max(0, input.perSessionLimit - session.attempts), resetAt: `${date}T24:00:00.000Z` });
  }
}

async function quota(env: Env, input: object) {
  return env.AI_QUOTA.get(env.AI_QUOTA.idFromName('global')).fetch('https://quota.internal', { method: 'POST', body: JSON.stringify(input) });
}

function removeUnauthorizedComposition(payload: z.infer<typeof PlanPayloadSchema>, allowComposition: boolean) {
  if (allowComposition || payload.status !== 'plan' || !payload.changes?.transform) return payload;
  const changes = { ...payload.changes, transform: null };
  const reasons = payload.reasons.filter((reason) => reason.target !== 'transform');
  const hasEditableChange = changes.globalAssignments.length > 0 || changes.regionUpserts.length > 0 || changes.regionDeletes.length > 0;
  if (hasEditableChange) return { ...payload, changes, reasons };
  return { ...payload, status: 'clarify' as const, message: '当前没有授权 AI 调整构图，因此未生成可应用的调色修改。', changes: null, reasons: [], limitations: [...payload.limitations, '构图调整已忽略。'].slice(0, 3) };
}

/** 将 Anthropic 兼容接口偶发返回的空字符串数组修正为真正的空数组。 */
function normalizeEmptyArray(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (value === '') return [];
  if (typeof value === 'string' && value.trimStart().startsWith('[')) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* 其他错误交给 Zod 严格拒绝。 */ }
  }
  return value;
}

function normalizeModelPayload(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const payload = { ...(raw as Record<string, unknown>) };
  const changes = payload.changes;
  if (typeof changes !== 'object' || changes === null || Array.isArray(changes)) return payload;
  const normalizedChanges = { ...(changes as Record<string, unknown>) };
  normalizedChanges.globalAssignments = normalizeEmptyArray(normalizedChanges.globalAssignments);
  normalizedChanges.regionDeletes = normalizeEmptyArray(normalizedChanges.regionDeletes);
  normalizedChanges.regionUpserts = normalizeEmptyArray(normalizedChanges.regionUpserts);
  if (Array.isArray(normalizedChanges.regionUpserts)) {
    normalizedChanges.regionUpserts = normalizedChanges.regionUpserts.map((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return item;
      return { ...(item as Record<string, unknown>), brushDabs: normalizeEmptyArray((item as Record<string, unknown>).brushDabs) };
    });
  }
  payload.changes = normalizedChanges;
  return payload;
}

const stripMarkdownFences = (value: string) => value.replace(/^```(?:json)?\s*\n/i, '').replace(/\n```\s*$/, '').trim();
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

async function requestPlanFromProvider(
  env: Env,
  request: ReturnType<typeof PlanRequestSchema.parse>,
  requestId: string,
  instructions: string,
  userText: string,
  attempt: number,
) {
  const anthropic = env.AI_SDK === 'anthropic';
  const base = (env.AI_BASE_URL || (anthropic ? 'https://api.anthropic.com' : 'https://api.openai.com/v1')).replace(/\/$/, '');
  const startedAt = Date.now();
  const provider = anthropic
    ? await fetch(`${base.endsWith('/v1') ? base : `${base}/v1`}/messages`, { method: 'POST', headers: { 'x-api-key': env.AI_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: env.AI_MODEL || 'claude-3-5-sonnet-latest', max_tokens: 6000, system: `${instructions} 只输出 JSON，不要使用 Markdown。`, messages: [{ role: 'user', content: [{ type: 'text', text: userText }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: request.originalPreview.base64 } }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: request.currentPreview.base64 } }, ...(request.referencePreview ? [{ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: request.referencePreview.base64 } }] : [])] }] }) })
    : await fetch(`${base}/responses`, { method: 'POST', headers: { authorization: `Bearer ${env.AI_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: env.AI_MODEL || 'gpt-4o-mini', store: false, max_output_tokens: 6000, instructions, input: [{ role: 'user', content: [{ type: 'input_text', text: userText }, { type: 'input_image', image_url: `data:image/jpeg;base64,${request.originalPreview.base64}`, detail: 'high' }, { type: 'input_image', image_url: `data:image/jpeg;base64,${request.currentPreview.base64}`, detail: 'high' }, ...(request.referencePreview ? [{ type: 'input_image', image_url: `data:image/jpeg;base64,${request.referencePreview.base64}`, detail: 'high' }] : [])] }], text: { format: { type: 'json_object' } } }) });
  const providerResponse = await provider.text();
  let body: Record<string, any>;
  try {
    body = JSON.parse(providerResponse) as Record<string, any>;
  } catch (cause) {
    writeLog('error', 'ai.provider.invalid_response', {
      requestId,
      attempt,
      provider: anthropic ? 'anthropic' : 'openai',
      model: env.AI_MODEL,
      status: provider.status,
      durationMs: Date.now() - startedAt,
      providerResponse,
      error: errorLogDetails(cause),
    });
    throw new Error(`AI 返回了无法解析的响应，HTTP ${provider.status}`);
  }
  const raw = anthropic ? body.content?.find((item: Record<string, unknown>) => item.type === 'text')?.text : body.output_text;
  if (!provider.ok || !raw || (!anthropic && body.status !== 'completed')) {
    writeLog('error', 'ai.provider.failed', {
      requestId,
      attempt,
      provider: anthropic ? 'anthropic' : 'openai',
      model: env.AI_MODEL,
      status: provider.status,
      durationMs: Date.now() - startedAt,
      providerResponse,
    });
    throw new Error(`AI 请求失败 ${provider.status}`);
  }
  writeLog('info', 'ai.provider.response', {
    requestId,
    attempt,
    provider: anthropic ? 'anthropic' : 'openai',
    model: String(body.model),
    status: provider.status,
    durationMs: Date.now() - startedAt,
    usage: body.usage ?? {},
    modelOutput: raw,
  });
  return { raw, model: String(body.model), usage: body.usage ?? {}, durationMs: Date.now() - startedAt };
}

async function plan(env: Env, request: ReturnType<typeof PlanRequestSchema.parse>, requestId: string) {
  const instructions = '你是照片编辑规划器。输出 JSON。status 为 plan、clarify 或 unsupported。plan 必须有 changes。全局参数只能使用 exposureEV、contrast、highlights、shadows、whites、blacks、clarity、dehaze、denoiseLuma、denoiseChroma、warmth、tint、vibrance、saturation。exposureEV 范围 -2 到 2；dehaze、denoiseLuma、denoiseChroma 为 0 到 100 的整数；其余范围 -100 到 100。value 为绝对值。去雾减轻可见雾气，降噪减弱颗粒并可能平滑纹理；初次自动建议保持保守。每项修改必须有 reasons。构图未授权时 transform 为 null。所有数组字段（包括 regionDeletes、brushDabs）即使为空也必须返回 []，禁止返回空字符串。只要存在任意变更，reasons 必须为每个变更目标给出对应解释。图片顺序：第一张原始照片，第二张当前编辑效果，存在第三张时是参考图；仅参考其色彩、明暗、对比与整体氛围，应用到第二张照片，不可复制主体、物体或构图。';
  const initial = JSON.stringify({ ...request, originalPreview: { ...request.originalPreview, base64: 'omitted' }, currentPreview: { ...request.currentPreview, base64: 'omitted' }, ...(request.referencePreview ? { referencePreview: { ...request.referencePreview, base64: 'omitted' } } : {}) });
  let userText = initial;
  let totalUsage: Record<string, unknown> = {};
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const output = await requestPlanFromProvider(env, request, requestId, instructions, userText, attempt);
    totalUsage = { ...totalUsage, ...output.usage };
    try {
      const payload = removeUnauthorizedComposition(PlanPayloadSchema.parse(normalizeModelPayload(JSON.parse(stripMarkdownFences(output.raw)))), request.allowComposition);
      validatePlan(request.state, payload, request.allowComposition);
      return { payload, model: output.model, usage: totalUsage, attempts: attempt };
    } catch (cause) {
      lastError = cause;
      writeLog('error', 'ai.plan.attempt_failed', {
        requestId,
        provider: env.AI_SDK === 'anthropic' ? 'anthropic' : 'openai',
        model: output.model,
        attempt,
        durationMs: output.durationMs,
        modelOutput: output.raw,
        error: errorLogDetails(cause),
      });
      if (attempt === 2) break;
      userText = `${initial}\n\n[修复请求] 你之前的输出未通过校验。请只修正下面原输出中指出的问题，保留其他有效内容。\n[上次输出]\n${output.raw}\n[校验错误]\n${errorMessage(cause)}\n请重新输出完整 JSON。`;
    }
  }
  throw lastError;
}

export default { async fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
  if (!env.SESSION_SECRET) return response(error('CONFIG_INVALID', 'SESSION_SECRET 未配置'), 503);
  const session = await sessionFor(request, env);
  const limits = { limit: Number(env.DAILY_AI_ATTEMPT_LIMIT ?? 300), perSessionLimit: Number(env.DAILY_AI_ATTEMPT_LIMIT_PER_SESSION ?? 30) };
  if (request.method === 'GET' && url.pathname === '/api/session') {
    const stored = await quota(env, { action: 'read', sessionId: session.id, ...limits });
    return response({ authenticated: true, ...await stored.json() }, 200, session.cookie ? { 'set-cookie': session.cookie } : undefined);
  }
  if (request.method === 'GET' && url.pathname === '/api/segment-capabilities') return response({ pointSegmentation: env.SAM_POINT_SEGMENTATION === 'true' }, 200, { 'cache-control': 'no-store' });
  if (request.method === 'POST' && url.pathname === '/api/segment') {
    if (!allowed(request, env)) return response(error('ORIGIN_DENIED', '当前来源无法使用服务'), 403);
    let parsed; let jpeg: Blob;
    try { parsed = SegmentRequestSchema.parse(await request.json()); jpeg = jpegBytes(parsed.preview.base64, parsed.preview); } catch (cause) {
      writeLog('error', 'sam.segment.request_invalid', { error: errorLogDetails(cause) });
      return response(error('SEGMENT_REQUEST_INVALID', '分割图片或概念不符合要求'), 400);
    }
    const reserved = await quota(env, { action: 'reserve', sessionId: session.id, requestId: parsed.requestId, ...limits });
    if (!reserved.ok) return response({ ...await reserved.json() as object, requestId: parsed.requestId }, reserved.status, session.cookie ? { 'set-cookie': session.cookie } : undefined);
    const started = Date.now();
    try {
      const annotations = await segmentWithSam(env, jpeg, parsed.prompt, parsed.preview.width, parsed.preview.height);
      return response({ status: annotations.length ? 'ok' : 'empty', requestId: parsed.requestId, imageId: parsed.imageId, sourceVersion: parsed.sourceVersion, baseRevision: parsed.baseRevision, provider: 'hf-gradio', adapterVersion: 'gradio-js-2.7.0', inputWidth: parsed.preview.width, inputHeight: parsed.preview.height, annotations: annotations.map((item, index) => ({ index, label: item.label, maskUrl: item.image.url, score: null })), durationMs: Date.now() - started }, 200, { 'cache-control': 'no-store', ...(session.cookie ? { 'set-cookie': session.cookie } : {}) });
    } catch (cause) {
      const message = cause instanceof Error && cause.message === 'POINT_SEGMENTATION_UNAVAILABLE' ? '当前 SAM3 提供方未开放点选蒙版接口' : cause instanceof Error && cause.message === 'SAM_TIMEOUT' ? 'SAM3 分割等待超时，请重新请求' : 'SAM3 服务暂时不可用，请稍后再试';
      const code = cause instanceof Error && cause.message === 'POINT_SEGMENTATION_UNAVAILABLE' ? 'POINT_SEGMENTATION_UNAVAILABLE' : cause instanceof Error && cause.message === 'SAM_TIMEOUT' ? 'SAM_TIMEOUT' : 'SAM_PROVIDER_ERROR';
      writeLog('error', 'sam.segment.failed', { requestId: parsed.requestId, imageId: parsed.imageId, code, error: errorLogDetails(cause) });
      return response({ ...error(code, message), requestId: parsed.requestId }, code === 'SAM_TIMEOUT' ? 504 : 502, session.cookie ? { 'set-cookie': session.cookie } : undefined);
    }
  }
  if (request.method === 'POST' && url.pathname === '/api/plan') {
    if (!allowed(request, env)) {
      writeLog('error', 'ai.plan.origin_denied', { origin: request.headers.get('origin') });
      return response(error('ORIGIN_DENIED', '当前来源无法使用服务'), 403);
    }
    if (!env.AI_API_KEY) {
      writeLog('error', 'ai.plan.configuration_missing', { missing: 'AI_API_KEY' });
      return response(error('AI_UNAVAILABLE', 'AI 服务暂不可用，本地编辑仍可继续'), 503);
    }
    let parsed; try { parsed = PlanRequestSchema.parse(await request.json()); } catch (cause) {
      writeLog('error', 'ai.plan.request_invalid', { error: errorLogDetails(cause) });
      return response(error('REQUEST_INVALID', '请求内容不符合编辑协议'), 400);
    }
    const reserved = await quota(env, { action: 'reserve', sessionId: session.id, requestId: parsed.requestId, ...limits });
    if (!reserved.ok) {
      const quotaError = await reserved.json() as Record<string, unknown>;
      writeLog('error', 'ai.plan.quota_rejected', {
        requestId: parsed.requestId,
        status: reserved.status,
        quotaError,
      });
      return response({ ...quotaError, requestId: parsed.requestId }, reserved.status, session.cookie ? { 'set-cookie': session.cookie } : undefined);
    }
    const started = Date.now();
    writeLog('info', 'ai.plan.started', {
      requestId: parsed.requestId,
      imageId: parsed.imageId,
      baseRevision: parsed.baseRevision,
      mode: parsed.mode,
      provider: env.AI_SDK === 'anthropic' ? 'anthropic' : 'openai',
      model: env.AI_MODEL,
      allowComposition: parsed.allowComposition,
      hasReferenceImage: Boolean(parsed.referencePreview),
      previewDimensions: {
        original: [parsed.originalPreview.width, parsed.originalPreview.height],
        current: [parsed.currentPreview.width, parsed.currentPreview.height],
        ...(parsed.referencePreview ? { reference: [parsed.referencePreview.width, parsed.referencePreview.height] } : {}),
      },
    });
    try {
      const output = await plan(env, parsed, parsed.requestId);
      writeLog('info', 'ai.plan.completed', {
        requestId: parsed.requestId,
        imageId: parsed.imageId,
        provider: env.AI_SDK === 'anthropic' ? 'anthropic' : 'openai',
        model: output.model,
        durationMs: Date.now() - started,
        attempts: output.attempts,
        usage: output.usage,
        planOutput: output.payload,
      });
      return response({ requestId: parsed.requestId, imageId: parsed.imageId, baseRevision: parsed.baseRevision, planId: crypto.randomUUID(), model: output.model, promptVersion: 'pc-planner-2', rendererVersion: RENDERER_VERSION, payload: output.payload, usage: { inputTokens: output.usage.input_tokens ?? null, outputTokens: output.usage.output_tokens ?? null, cachedInputTokens: output.usage.input_tokens_details?.cached_tokens ?? null, attempts: output.attempts, durationMs: Date.now() - started } }, 200, { 'cache-control': 'no-store', ...(session.cookie ? { 'set-cookie': session.cookie } : {}) });
    } catch (cause) {
      writeLog('error', 'ai.plan.failed', {
        requestId: parsed.requestId,
        imageId: parsed.imageId,
        provider: env.AI_SDK === 'anthropic' ? 'anthropic' : 'openai',
        model: env.AI_MODEL,
        durationMs: Date.now() - started,
        error: errorLogDetails(cause),
      });
      return response({
        ...error('PROVIDER_ERROR', '模型服务暂时不可用，可稍后重新请求'),
        requestId: parsed.requestId,
      }, 502);
    }
  }
  return response(error('NOT_FOUND', '接口不存在'), 404);
} };
