import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;
export const RENDERER_VERSION = 'pc-render-1' as const;
export const globalKeys = ['exposureEV', 'contrast', 'highlights', 'shadows', 'warmth', 'tint', 'saturation'] as const;
export type GlobalKey = (typeof globalKeys)[number];

const finite = (min: number, max: number) => z.number().finite().min(min).max(max);
export const GlobalSchema = z.object({
  exposureEV: finite(-2, 2), contrast: finite(-100, 100), highlights: finite(-100, 100), shadows: finite(-100, 100),
  warmth: finite(-100, 100), tint: finite(-100, 100), saturation: finite(-100, 100),
}).strict();
export const LocalAdjustmentsSchema = z.object({ exposureEV: finite(-2, 2), highlights: finite(-100, 100), saturation: finite(-100, 100) }).strict();
export const CropSchema = z.object({ x: finite(0, 1), y: finite(0, 1), width: finite(0.000001, 1), height: finite(0.000001, 1) }).strict()
  .refine((crop) => crop.x + crop.width <= 1.00000001 && crop.y + crop.height <= 1.00000001, '裁切超出旋转画布');
export const TransformSchema = z.object({
  angleDeg: finite(-10, 10), crop: CropSchema, aspectLock: z.enum(['free', 'original', 'square', 'portrait4x5', 'landscape3x2', 'wide16x9']),
}).strict();
export const RegionSchema = z.object({
  id: z.uuid(), label: z.string().trim().min(1).max(40), enabled: z.boolean(), centerX: finite(0, 1), centerY: finite(0, 1),
  radiusX: finite(.01, 1), radiusY: finite(.01, 1), feather: finite(.05, 1), adjustments: LocalAdjustmentsSchema,
}).strict();
export const EditStateSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION), rendererVersion: z.literal(RENDERER_VERSION), imageId: z.uuid(), revision: z.number().int().nonnegative(),
  sourceWidth: z.number().int().positive(), sourceHeight: z.number().int().positive(), global: GlobalSchema, transform: TransformSchema,
  regions: z.array(RegionSchema).max(4),
}).strict();
export type EditState = z.infer<typeof EditStateSchema>;
export type Region = z.infer<typeof RegionSchema>;
export type Transform = z.infer<typeof TransformSchema>;

export const defaultGlobal = (): z.infer<typeof GlobalSchema> => ({ exposureEV: 0, contrast: 0, highlights: 0, shadows: 0, warmth: 0, tint: 0, saturation: 0 });
export const createInitialState = (imageId: string, width: number, height: number): EditState => EditStateSchema.parse({
  schemaVersion: SCHEMA_VERSION, rendererVersion: RENDERER_VERSION, imageId, revision: 0, sourceWidth: width, sourceHeight: height,
  global: defaultGlobal(), transform: { angleDeg: 0, crop: { x: 0, y: 0, width: 1, height: 1 }, aspectLock: 'original' }, regions: [],
});

const assignmentSchema = z.object({ parameter: z.enum(globalKeys), value: z.number().finite() }).strict();
export const ChangeSetSchema = z.object({
  globalAssignments: z.array(assignmentSchema).max(7), transform: TransformSchema.nullable(), regionUpserts: z.array(RegionSchema).max(4), regionDeletes: z.array(z.uuid()).max(4),
}).strict();
export const ReasonSchema = z.object({ target: z.string().min(1).max(80), observation: z.string().max(160), intent: z.string().max(160) }).strict();
export const PlanPayloadSchema = z.object({
  status: z.enum(['plan', 'clarify', 'unsupported']), observations: z.array(z.string().max(160)).max(3), message: z.string().max(300),
  changes: ChangeSetSchema.nullable(), reasons: z.array(ReasonSchema).max(16), limitations: z.array(z.string().max(160)).max(3),
}).strict().superRefine((payload, ctx) => {
  if (payload.status === 'plan' && !payload.changes) ctx.addIssue({ code: 'custom', message: '计划必须包含变更集' });
  if (payload.status !== 'plan' && (payload.changes || payload.reasons.length)) ctx.addIssue({ code: 'custom', message: '非计划响应不能携带变更' });
});
export type ChangeSet = z.infer<typeof ChangeSetSchema>;
export type PlanPayload = z.infer<typeof PlanPayloadSchema>;

export class DomainError extends Error {}
export const roundValue = (key: GlobalKey, value: number) => Math.round(value / (key === 'exposureEV' ? .01 : 1)) * (key === 'exposureEV' ? .01 : 1);
export function applyChanges(state: EditState, changes: ChangeSet, allowComposition = true): EditState {
  const duplicate = new Set<string>();
  const global = { ...state.global };
  for (const assignment of changes.globalAssignments) {
    if (duplicate.has(assignment.parameter)) throw new DomainError('全局参数重复赋值');
    duplicate.add(assignment.parameter);
    global[assignment.parameter] = roundValue(assignment.parameter, assignment.value);
  }
  if (changes.transform && !allowComposition) throw new DomainError('当前建议未获构图权限');
  const deleted = new Set(changes.regionDeletes);
  if (deleted.size !== changes.regionDeletes.length) throw new DomainError('区域删除重复');
  const existing = new Map(state.regions.map((region) => [region.id, region]));
  for (const id of deleted) if (!existing.has(id)) throw new DomainError('删除的区域不存在');
  for (const region of changes.regionUpserts) {
    if (deleted.has(region.id)) throw new DomainError('区域不能同时更新和删除');
    existing.set(region.id, region);
  }
  const regions = [...existing.values()].filter((region) => !deleted.has(region.id));
  if (regions.length > 4) throw new DomainError('局部区域最多四个');
  const next = { ...state, global, transform: changes.transform ?? state.transform, regions };
  return EditStateSchema.parse(next);
}
export function validatePlan(state: EditState, payload: PlanPayload, allowComposition: boolean): void {
  PlanPayloadSchema.parse(payload);
  if (payload.status !== 'plan' || !payload.changes) return;
  const next = applyChanges(state, payload.changes, allowComposition);
  const targets = new Set<string>();
  for (const assignment of payload.changes.globalAssignments) targets.add(`global.${assignment.parameter}`);
  if (payload.changes.transform) targets.add('transform');
  for (const region of payload.changes.regionUpserts) targets.add(`region.${region.id}`);
  for (const id of payload.changes.regionDeletes) targets.add(`region.${id}`);
  for (const target of targets) if (!payload.reasons.some((reason) => reason.target === target)) throw new DomainError(`缺少 ${target} 的解释`);
  if (JSON.stringify(state) === JSON.stringify(next) && payload.reasons.length) throw new DomainError('无变化计划不能有解释');
}
export function changedSummary(before: EditState, after: EditState): string {
  const changes = globalKeys.filter((key) => before.global[key] !== after.global[key]).map((key) => `${key} ${before.global[key]}→${after.global[key]}`);
  return changes.length ? changes.join('，') : '已更新构图或局部区域';
}
