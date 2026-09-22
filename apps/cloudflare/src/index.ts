import { DurableObject } from 'cloudflare:workers';
import { z } from '../node_modules/zod/index.js';
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
  AI_QUOTA: DurableObjectNamespace;
  ASSETS: Fetcher;
}

type Session = { attempts: number; day: string; requestIds: Record<string, number> };
const PreviewSchema = z.object({ mime: z.literal('image/jpeg'), width: z.number().int().positive().max(1024), height: z.number().int().positive().max(1024), base64: z.string().min(1) }).strict();
const PlanRequestSchema = z.object({ schemaVersion: z.literal(SCHEMA_VERSION), requestId: z.uuid(), imageId: z.uuid(), baseRevision: z.number().int().nonnegative(), mode: z.enum(['auto', 'followup']), instruction: z.string().max(1000), state: EditStateSchema, allowComposition: z.boolean(), originalPreview: PreviewSchema, currentPreview: PreviewSchema, referencePreview: PreviewSchema.optional(), context: z.array(z.object({ instruction: z.string().max(250), appliedSummary: z.string().max(250) }).strict()).max(6) }).strict();
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

async function plan(env: Env, request: ReturnType<typeof PlanRequestSchema.parse>, requestId: string) {
  const compact = JSON.stringify({ ...request, originalPreview: { ...request.originalPreview, base64: 'omitted' }, currentPreview: { ...request.currentPreview, base64: 'omitted' }, ...(request.referencePreview ? { referencePreview: { ...request.referencePreview, base64: 'omitted' } } : {}) });
  const instructions = '你是照片编辑规划器。输出 JSON。status 为 plan、clarify 或 unsupported。plan 必须有 changes。全局参数只能使用 exposureEV、contrast、highlights、shadows、whites、blacks、clarity、warmth、tint、vibrance、saturation。exposureEV 范围 -2 到 2，其余范围 -100 到 100。value 为绝对值。每项修改必须有 reasons。构图未授权时 transform 为 null。图片顺序：第一张原始照片，第二张当前编辑效果，存在第三张时是参考图；仅参考其色彩、明暗、对比与整体氛围，应用到第二张照片，不可复制主体、物体或构图。';
  const anthropic = env.AI_SDK === 'anthropic';
  const base = (env.AI_BASE_URL || (anthropic ? 'https://api.anthropic.com' : 'https://api.openai.com/v1')).replace(/\/$/, '');
  const startedAt = Date.now();
  const provider = anthropic
    ? await fetch(`${base.endsWith('/v1') ? base : `${base}/v1`}/messages`, { method: 'POST', headers: { 'x-api-key': env.AI_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: env.AI_MODEL || 'claude-3-5-sonnet-latest', max_tokens: 6000, system: `${instructions} 只输出 JSON，不要使用 Markdown。`, messages: [{ role: 'user', content: [{ type: 'text', text: compact }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: request.originalPreview.base64 } }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: request.currentPreview.base64 } }, ...(request.referencePreview ? [{ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: request.referencePreview.base64 } }] : [])] }] }) })
    : await fetch(`${base}/responses`, { method: 'POST', headers: { authorization: `Bearer ${env.AI_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: env.AI_MODEL || 'gpt-4o-mini', store: false, max_output_tokens: 6000, instructions, input: [{ role: 'user', content: [{ type: 'input_text', text: compact }, { type: 'input_image', image_url: `data:image/jpeg;base64,${request.originalPreview.base64}`, detail: 'high' }, { type: 'input_image', image_url: `data:image/jpeg;base64,${request.currentPreview.base64}`, detail: 'high' }, ...(request.referencePreview ? [{ type: 'input_image', image_url: `data:image/jpeg;base64,${request.referencePreview.base64}`, detail: 'high' }] : [])] }], text: { format: { type: 'json_object' } } }) });
  const providerResponse = await provider.text();
  let body: Record<string, any>;
  try {
    body = JSON.parse(providerResponse) as Record<string, any>;
  } catch (cause) {
    writeLog('error', 'ai.provider.invalid_response', {
      requestId,
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
    provider: anthropic ? 'anthropic' : 'openai',
    model: String(body.model),
    status: provider.status,
    durationMs: Date.now() - startedAt,
    usage: body.usage ?? {},
    modelOutput: raw,
  });
  let payload: z.infer<typeof PlanPayloadSchema>;
  try {
    payload = removeUnauthorizedComposition(PlanPayloadSchema.parse(JSON.parse(String(raw).replace(/^```(?:json)?\s*\n/i, '').replace(/\n```\s*$/, ''))), request.allowComposition);
    validatePlan(request.state, payload, request.allowComposition);
  } catch (cause) {
    writeLog('error', 'ai.plan.validation_failed', {
      requestId,
      provider: anthropic ? 'anthropic' : 'openai',
      model: String(body.model),
      durationMs: Date.now() - startedAt,
      modelOutput: raw,
      error: errorLogDetails(cause),
    });
    throw cause;
  }
  return { payload, model: String(body.model), usage: body.usage ?? {} };
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
        usage: output.usage,
        planOutput: output.payload,
      });
      return response({ requestId: parsed.requestId, imageId: parsed.imageId, baseRevision: parsed.baseRevision, planId: crypto.randomUUID(), model: output.model, promptVersion: 'pc-planner-1', rendererVersion: RENDERER_VERSION, payload: output.payload, usage: { inputTokens: output.usage.input_tokens ?? null, outputTokens: output.usage.output_tokens ?? null, cachedInputTokens: output.usage.input_tokens_details?.cached_tokens ?? null, attempts: 1, durationMs: Date.now() - started } }, 200, { 'cache-control': 'no-store', ...(session.cookie ? { 'set-cookie': session.cookie } : {}) });
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
