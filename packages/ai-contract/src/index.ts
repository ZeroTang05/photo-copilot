import { EditStateSchema, PlanPayloadSchema, RENDERER_VERSION, SCHEMA_VERSION } from '@photo-copilot/domain';
import { z } from 'zod';

export const PreviewSchema = z.object({ mime: z.literal('image/jpeg'), width: z.number().int().positive().max(1024), height: z.number().int().positive().max(1024), base64: z.string().min(1) }).strict();
export const PlanRequestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION), requestId: z.uuid(), imageId: z.uuid(), baseRevision: z.number().int().nonnegative(), mode: z.enum(['auto', 'followup']),
  instruction: z.string().max(1000), state: EditStateSchema, allowComposition: z.boolean(), originalPreview: PreviewSchema, currentPreview: PreviewSchema, referencePreview: PreviewSchema.optional(),
  context: z.array(z.object({ instruction: z.string().max(250), appliedSummary: z.string().max(250) }).strict()).max(6),
}).strict().superRefine((request, ctx) => {
  if (request.mode === 'followup' && !request.instruction.trim()) ctx.addIssue({ code: 'custom', message: '追问需要输入文字' });
  if (request.imageId !== request.state.imageId || request.baseRevision !== request.state.revision) ctx.addIssue({ code: 'custom', message: '请求身份与编辑状态不一致' });
  if (request.originalPreview.width !== request.currentPreview.width || request.originalPreview.height !== request.currentPreview.height) ctx.addIssue({ code: 'custom', message: '两张分析图尺寸必须一致' });
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;
export const PlanResponseSchema = z.object({ requestId: z.uuid(), imageId: z.uuid(), baseRevision: z.number().int().nonnegative(), planId: z.uuid(), model: z.string(), promptVersion: z.literal('pc-planner-1'), rendererVersion: z.literal(RENDERER_VERSION), payload: PlanPayloadSchema, usage: z.object({ inputTokens: z.number().int().nullable(), outputTokens: z.number().int().nullable(), cachedInputTokens: z.number().int().nullable(), attempts: z.number().int().positive(), durationMs: z.number().int().nonnegative() }).strict() }).strict();

export const planPayloadJsonSchema = z.toJSONSchema(PlanPayloadSchema, { target: 'draft-2020-12' }) as Record<string, unknown>;
