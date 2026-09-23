import { EditStateSchema, globalKeys, PlanPayloadSchema, RENDERER_VERSION, SCHEMA_VERSION } from '@photo-copilot/domain';
import { z } from 'zod';
export { validateJpegPreview } from './preview-image.js';

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

/** 所有阶段共享的身份快照；任一编辑输入变化都会使旧工作流结果过期。 */
export const WorkflowSnapshotSchema = z.object({
  workflowId: z.uuid(),
  imageId: z.uuid(),
  sourceVersion: z.number().int().positive(),
  baseRevision: z.number().int().nonnegative(),
  rendererVersion: z.literal(RENDERER_VERSION),
  capabilityVersion: z.string().trim().min(1).max(120),
  maskSnapshotId: z.string().trim().min(1).max(2_000),
  referenceVersion: z.number().int().positive().nullable(),
  instruction: z.string().trim().min(1).max(1_000),
  selectedTargetId: z.uuid().nullable(),
  locks: z.object({
    globalParameters: z.array(z.enum(globalKeys)).max(globalKeys.length),
    regionIds: z.array(z.uuid()).max(4),
    composition: z.boolean(),
  }).strict(),
}).strict();

export const WorkflowRouteSchema = z.enum(['quick', 'natural', 'local', 'reference', 'style', 'restoration', 'analyze']);
export const WorkflowScopeSchema = z.enum(['global', 'selected', 'mixed']);
export const WorkflowStageSchema = z.enum(['route', 'brief', 'planner', 'review', 'corrector']);
export const RouteDecisionSchema = z.object({
  status: z.enum(['ready', 'clarify', 'unsupported']),
  route: WorkflowRouteSchema,
  scope: WorkflowScopeSchema,
  question: z.string().max(120).nullable(),
  constraints: z.array(z.string().trim().min(1).max(120)).max(8),
}).strict().superRefine((value, ctx) => {
  if (value.status === 'ready' && value.question !== null) ctx.addIssue({ code: 'custom', message: 'ready 路由不能包含问题' });
  if (value.status !== 'ready' && value.question === null) ctx.addIssue({ code: 'custom', message: '澄清或不支持路由必须说明原因' });
});

const ObservationSchema = z.object({
  targetId: z.uuid().nullable(),
  aspect: z.enum(['light', 'color', 'detail', 'atmosphere']),
  finding: z.string().trim().min(1).max(120),
  evidenceImageIds: z.array(z.string().trim().min(1).max(120)).max(3),
  certainty: z.enum(['clear', 'uncertain']),
}).strict();
const PrioritySchema = z.object({
  targetId: z.uuid().nullable(),
  intent: z.string().trim().min(1).max(100),
  strength: z.enum(['subtle', 'moderate', 'strong']),
  successCriterion: z.string().trim().min(1).max(120),
}).strict();
const SegmentQuerySchema = z.object({
  labelZh: z.string().trim().min(1).max(40),
  textQuery: z.string().trim().min(1).max(80),
  reuseRegionId: z.uuid().nullable(),
}).strict();
export const SceneProfileSchema = z.object({
  subjects: z.array(z.enum(['person', 'landscape', 'architecture', 'food_product', 'animal', 'other'])).min(1).max(2),
  lighting: z.array(z.enum(['night', 'backlit', 'mixed_light', 'flat_hazy'])).max(2),
  primarySubject: z.enum(['person', 'landscape', 'architecture', 'food_product', 'animal', 'other']),
  subjectEvidence: z.string().trim().min(1).max(100),
  lightingEvidence: z.string().trim().max(100).nullable(),
  targetIds: z.array(z.uuid()).max(4),
}).strict().superRefine((value, ctx) => {
  if (value.subjects[0] !== value.primarySubject) ctx.addIssue({ code: 'custom', message: '首个主体必须是主要主体' });
  if (value.lighting.length === 0 && value.lightingEvidence !== null) ctx.addIssue({ code: 'custom', message: '没有光线标签时不应提供光线依据' });
});
export const EditBriefSchema = z.object({
  status: z.enum(['ready', 'clarify', 'unsupported']),
  goal: z.string().trim().max(160),
  observations: z.array(ObservationSchema).max(5),
  preserve: z.array(z.string().trim().min(1).max(120)).max(5),
  priorities: z.array(PrioritySchema).max(3),
  segmentQueries: z.array(SegmentQuerySchema).max(3),
  sceneProfile: SceneProfileSchema,
  uncertainties: z.array(z.string().trim().min(1).max(120)).max(3),
  message: z.string().trim().min(1).max(200),
}).strict();

const ReviewCheckSchema = z.object({
  criterion: z.enum(['goal', 'preservation', 'artifacts', 'scope']),
  result: z.enum(['pass', 'fail', 'unknown']),
  evidenceImageIds: z.array(z.string().trim().min(1).max(120)).max(3),
  finding: z.string().trim().min(1).max(120),
}).strict();
const ReviewIssueSchema = z.object({
  issueId: z.string().trim().min(1).max(80),
  targetId: z.uuid().nullable(),
  severity: z.enum(['minor', 'major']),
  finding: z.string().trim().min(1).max(120),
  allowedParameterNames: z.array(z.enum(globalKeys)).max(globalKeys.length),
  desiredDirection: z.string().trim().min(1).max(100),
}).strict();
export const ReviewReportSchema = z.object({
  verdict: z.enum(['pass', 'revise', 'uncertain', 'reject']),
  checks: z.array(ReviewCheckSchema).max(4),
  issues: z.array(ReviewIssueSchema).max(3),
  summary: z.string().trim().min(1).max(160),
}).strict();

export type WorkflowSnapshot = z.infer<typeof WorkflowSnapshotSchema>;
export type RouteDecision = z.infer<typeof RouteDecisionSchema>;
export type EditBrief = z.infer<typeof EditBriefSchema>;
export type ReviewReport = z.infer<typeof ReviewReportSchema>;
export type SceneProfile = z.infer<typeof SceneProfileSchema>;

/** 阶段请求只携带所需图片；每张图有显式角色，像素留在独立字段。 */
export const WorkflowImageSchema = z.object({
  id: z.string().trim().min(1).max(80),
  role: z.enum(['original', 'current', 'reference', 'candidate', 'maskAtlas', 'detailBefore', 'detailAfter']),
  preview: PreviewSchema,
}).strict();
export type WorkflowImage = z.infer<typeof WorkflowImageSchema>;
const StageBaseSchema = z.object({
  requestId: z.uuid(),
  workflow: WorkflowSnapshotSchema,
  route: WorkflowRouteSchema,
  attempt: z.number().int().min(1).max(8),
  state: EditStateSchema,
  images: z.array(WorkflowImageSchema).max(8),
}).strict();
export const RouteRequestSchema = StageBaseSchema.extend({
  uiMode: z.enum(['auto', 'followup']),
}).strict();
export const BriefRequestSchema = StageBaseSchema.extend({
  selection: z.array(z.object({ id: z.uuid(), label: z.string().max(40), shape: z.enum(['ellipse', 'linear', 'brush', 'raster']) }).strict()).max(4),
}).strict();
export const ReviewRequestSchema = StageBaseSchema.extend({
  brief: EditBriefSchema,
  candidate: PlanPayloadSchema,
  reviewAttempt: z.number().int().min(1).max(2),
}).strict();
export type RouteRequest = z.infer<typeof RouteRequestSchema>;
export type BriefRequest = z.infer<typeof BriefRequestSchema>;
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;

export const WorkflowStageResponseSchema = <T extends z.ZodType>(payload: T) => z.object({
  requestId: z.uuid(), workflowId: z.uuid(), model: z.string(), promptVersion: z.string(), payload,
  usage: z.object({ inputTokens: z.number().int().nullable(), outputTokens: z.number().int().nullable(), cachedInputTokens: z.number().int().nullable(), durationMs: z.number().int().nonnegative() }).strict(),
}).strict();

export const PlanRequestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION), requestId: z.uuid(), imageId: z.uuid(), sourceVersion: z.number().int().positive(), baseRevision: z.number().int().nonnegative(), mode: z.enum(['auto', 'followup']),
  workflow: WorkflowSnapshotSchema, stage: z.enum(['planner', 'corrector']), route: WorkflowRouteSchema,
  brief: EditBriefSchema.optional(), review: ReviewReportSchema.optional(), candidate: PlanPayloadSchema.optional(), candidatePreview: PreviewSchema.optional(),
  instruction: z.string().max(1000), state: EditStateSchema, allowComposition: z.boolean(), originalPreview: PreviewSchema, currentPreview: PreviewSchema, referencePreview: PreviewSchema.optional(),
  context: z.array(z.object({ instruction: z.string().max(250), appliedSummary: z.string().max(250) }).strict()).max(6),
}).strict().superRefine((request, ctx) => {
  if (request.mode === 'followup' && !request.instruction.trim()) ctx.addIssue({ code: 'custom', message: '追问需要输入文字' });
  if (request.imageId !== request.state.imageId || request.sourceVersion !== request.state.sourceVersion || request.baseRevision !== request.state.revision) ctx.addIssue({ code: 'custom', message: '请求身份与编辑状态不一致' });
  if (request.workflow.imageId !== request.imageId || request.workflow.sourceVersion !== request.sourceVersion || request.workflow.baseRevision !== request.baseRevision || request.workflow.rendererVersion !== request.state.rendererVersion || request.workflow.instruction !== request.instruction) ctx.addIssue({ code: 'custom', message: '工作流快照与规划请求不一致' });
  if (request.workflow.selectedTargetId && !request.state.regions.some((region) => region.id === request.workflow.selectedTargetId)) ctx.addIssue({ code: 'custom', message: '选中区域不在当前编辑状态中' });
  if (request.route === 'local' && !request.workflow.selectedTargetId) ctx.addIssue({ code: 'custom', message: '局部路线需要选中真实区域' });
  if (request.stage === 'corrector' && (!request.brief || !request.review || !request.candidate || !request.candidatePreview)) ctx.addIssue({ code: 'custom', message: '定向修正需要诊断、候选和检查结果' });
  if (request.originalPreview.width !== request.currentPreview.width || request.originalPreview.height !== request.currentPreview.height) ctx.addIssue({ code: 'custom', message: '两张分析图尺寸必须一致' });
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;
export const PlanResponseSchema = z.object({ requestId: z.uuid(), workflowId: z.uuid(), imageId: z.uuid(), baseRevision: z.number().int().nonnegative(), planId: z.uuid(), model: z.string(), promptVersion: z.string().min(1).max(120), rendererVersion: z.literal(RENDERER_VERSION), payload: PlanPayloadSchema, usage: z.object({ inputTokens: z.number().int().nullable(), outputTokens: z.number().int().nullable(), cachedInputTokens: z.number().int().nullable(), attempts: z.number().int().positive(), durationMs: z.number().int().nonnegative() }).strict() }).strict();

export const planPayloadJsonSchema = z.toJSONSchema(PlanPayloadSchema, { target: 'draft-2020-12' }) as Record<string, unknown>;
