import { buildStagePrompt, promptVersions, selectSceneModules, type PromptStage, type WorkflowRoute } from '@photo-copilot/ai-prompts';
import { errorLogDetails, PROVIDER_TIMEOUT_MS, type Provider, type ProviderCallResult } from './providers/index.js';
import { z } from 'zod';

type StageImage = { id: string; role: string; preview: { base64: string; width: number; height: number; mime: string } };
type StageLog = { info: (fields: Record<string, unknown>, message: string) => void; error: (fields: Record<string, unknown>, message: string) => void };

/** 图片只记角色、尺寸和内容哈希；日志中不会存储照片 base64。 */
export async function imageManifest(images: StageImage[]) {
  return Promise.all(images.map(async ({ id, role, preview }) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(preview.base64));
    return { id, role, width: preview.width, height: preview.height, mime: preview.mime, sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') };
  }));
}

/** 每次模型调用都写准备、发出、收到、校验或报错日志，方便按 workflowId 追踪。 */
export async function runWorkflowStage<T extends z.ZodType>(input: {
  provider: Provider;
  log: StageLog;
  requestId: string;
  workflowId: string;
  capabilityVersion: string;
  stage: Exclude<PromptStage, 'schemaRepair'>;
  route: WorkflowRoute;
  attempt: number;
  schema: T;
  stageInput: Record<string, unknown>;
  images: StageImage[];
  sceneProfile?: Parameters<typeof selectSceneModules>[0];
  deadlineAt: number;
}): Promise<{ payload: z.infer<T>; result: ProviderCallResult; durationMs: number }> {
  const started = Date.now();
  const outputSchema = z.toJSONSchema(input.schema, { target: 'draft-2020-12' }) as Record<string, unknown>;
  const userText = JSON.stringify(input.stageInput);
  const instructions = buildStagePrompt({ stage: input.stage, route: input.route, outputSchema: JSON.stringify(outputSchema), stageInput: userText, sceneProfile: input.sceneProfile });
  const images = await imageManifest(input.images);
  const modules = input.sceneProfile ? selectSceneModules(input.sceneProfile).map((item) => item.id) : [];
  const fields = { requestId: input.requestId, workflowId: input.workflowId, stage: input.stage, route: input.route, attempt: input.attempt, promptVersion: promptVersions[input.stage], capabilityVersion: input.capabilityVersion, provider: input.provider.name, images, modules };
  input.log.info({ event: 'workflow.input', summary: '输入', ...fields, input: input.stageInput }, `[${input.stage.toUpperCase()} 输入] 已整理阶段数据`);
  input.log.info({ event: 'workflow.request', summary: '发送', ...fields, prompt: instructions, input: input.stageInput, outputSchema }, `[${input.stage.toUpperCase()} 发送] 正在调用大模型`);
  try {
    const timeoutMs = Math.min(PROVIDER_TIMEOUT_MS, input.deadlineAt - Date.now());
    if (timeoutMs < 1000) throw new Error('工作流已超出本次请求时限');
    const result = await input.provider.call({ instructions, userText, images: input.images.map((image) => ({ id: image.id, role: image.role, base64: image.preview.base64 })), outputSchema, toolName: `submit_${input.stage}`, maxOutputTokens: { router: 600, brief: 1600, planner: 3000, reviewer: 1400, corrector: 3000 }[input.stage] }, timeoutMs);
    input.log.info({ event: 'workflow.output.raw', summary: '原始输出', ...fields, model: result.model, usage: result.usage, rawOutput: result.rawText, durationMs: Date.now() - started }, `[${input.stage.toUpperCase()} 输出] 已收到大模型结果`);
    const raw = result.structuredInput ?? JSON.parse(result.rawText.replace(/^```(?:json)?\s*\n/i, '').replace(/\n```\s*$/, '').trim());
    const payload = input.schema.parse(raw) as z.infer<T>;
    input.log.info({ event: 'workflow.output.validated', summary: '校验通过', ...fields, model: result.model, normalizedOutput: payload, durationMs: Date.now() - started }, `[${input.stage.toUpperCase()} 完成] 输出已通过结构校验`);
    return { payload, result, durationMs: Date.now() - started };
  } catch (error) {
    input.log.error({ event: 'workflow.error', summary: '阶段失败', ...fields, prompt: instructions, input: input.stageInput, error: errorLogDetails(error), durationMs: Date.now() - started }, `[${input.stage.toUpperCase()} 失败] 查看错误详情`);
    throw error;
  }
}
