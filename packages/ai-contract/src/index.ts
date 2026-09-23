import { EditStateSchema, PlanPayloadSchema, RENDERER_VERSION, SCHEMA_VERSION } from '@photo-copilot/domain';
import { z } from 'zod';

export const PreviewSchema = z.object({ mime: z.literal('image/jpeg'), width: z.number().int().positive().max(1024), height: z.number().int().positive().max(1024), base64: z.string().min(1) }).strict();
export const MaskRefSchema = z.object({ assetId: z.uuid(), version: z.number().int().positive() }).strict();
export const SegmentIntentSchema = z.object({
  status: z.enum(['ready', 'clarify']), message: z.string().max(300), reuseRegionIds: z.array(z.uuid()).max(4),
  queries: z.array(z.object({ labelZh: z.string().trim().min(1).max(40), textQuery: z.string().trim().min(1).max(80) }).strict()).max(3),
}).strict();
export const SegmentIntentRequestSchema = z.object({
  requestId: z.uuid(), imageId: z.uuid(), sourceVersion: z.number().int().positive(), baseRevision: z.number().int().nonnegative(), instruction: z.string().trim().min(1).max(1000), originalPreview: PreviewSchema,
  regions: z.array(z.object({ id: z.uuid(), label: z.string().max(40) }).strict()).max(4), selectedRegionId: z.uuid().nullable(),
}).strict();
export const SegmentIntentResponseSchema = z.object({
  requestId: z.uuid(), imageId: z.uuid(), sourceVersion: z.number().int().positive(), baseRevision: z.number().int().nonnegative(), model: z.string(), intent: SegmentIntentSchema,
}).strict();
export const SegmentPointSchema = z.object({ x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1), label: z.union([z.literal(0), z.literal(1)]) }).strict();
export const SegmentTextPromptSchema = z.object({ kind: z.literal('text'), textQuery: z.string().trim().min(1).max(80), confidenceThreshold: z.number().finite().min(0).max(1) }).strict();
export const SegmentPointPromptSchema = z.object({ kind: z.literal('point'), points: z.array(SegmentPointSchema).min(1).max(16) }).strict();
export const SegmentPromptSchema = z.discriminatedUnion('kind', [SegmentTextPromptSchema, SegmentPointPromptSchema]);
export const SegmentRequestSchema = z.object({
  requestId: z.uuid(), imageId: z.uuid(), sourceVersion: z.number().int().positive(), baseRevision: z.number().int().nonnegative(), preview: PreviewSchema, prompt: SegmentPromptSchema,
}).strict();
export const SegmentResponseSchema = z.object({
  status: z.enum(['ok', 'empty']), requestId: z.uuid(), imageId: z.uuid(), sourceVersion: z.number().int().positive(), baseRevision: z.number().int().nonnegative(), provider: z.enum(['hf-gradio', 'modelscope-gradio']), adapterVersion: z.string(),
  inputWidth: z.number().int().positive(), inputHeight: z.number().int().positive(), annotations: z.array(z.object({ index: z.number().int().nonnegative(), label: z.string().max(160), maskUrl: z.string().url(), score: z.null() }).strict()).max(32), durationMs: z.number().int().nonnegative(),
}).strict();
export type SegmentIntent = z.infer<typeof SegmentIntentSchema>;
export type SegmentRequest = z.infer<typeof SegmentRequestSchema>;
export type SegmentResponse = z.infer<typeof SegmentResponseSchema>;
export const PlanRequestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION), requestId: z.uuid(), imageId: z.uuid(), sourceVersion: z.number().int().positive(), baseRevision: z.number().int().nonnegative(), mode: z.enum(['auto', 'followup']),
  instruction: z.string().max(1000), state: EditStateSchema, allowComposition: z.boolean(), originalPreview: PreviewSchema, currentPreview: PreviewSchema, referencePreview: PreviewSchema.optional(),
  context: z.array(z.object({ instruction: z.string().max(250), appliedSummary: z.string().max(250) }).strict()).max(6),
}).strict().superRefine((request, ctx) => {
  if (request.mode === 'followup' && !request.instruction.trim()) ctx.addIssue({ code: 'custom', message: '追问需要输入文字' });
  if (request.imageId !== request.state.imageId || request.sourceVersion !== request.state.sourceVersion || request.baseRevision !== request.state.revision) ctx.addIssue({ code: 'custom', message: '请求身份与编辑状态不一致' });
  if (request.originalPreview.width !== request.currentPreview.width || request.originalPreview.height !== request.currentPreview.height) ctx.addIssue({ code: 'custom', message: '两张分析图尺寸必须一致' });
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;
export const PlanResponseSchema = z.object({ requestId: z.uuid(), imageId: z.uuid(), baseRevision: z.number().int().nonnegative(), planId: z.uuid(), model: z.string(), promptVersion: z.literal('pc-planner-2'), rendererVersion: z.literal(RENDERER_VERSION), payload: PlanPayloadSchema, usage: z.object({ inputTokens: z.number().int().nullable(), outputTokens: z.number().int().nullable(), cachedInputTokens: z.number().int().nullable(), attempts: z.number().int().positive(), durationMs: z.number().int().nonnegative() }).strict() }).strict();

export const planPayloadJsonSchema = z.toJSONSchema(PlanPayloadSchema, { target: 'draft-2020-12' }) as Record<string, unknown>;
