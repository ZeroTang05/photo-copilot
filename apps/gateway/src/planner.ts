import type { EditState, PlanPayload } from '@photo-copilot/domain';
import { PlanPayloadSchema, validatePlan } from '@photo-copilot/domain';
import type { Provider, ProviderCallInput, ProviderCallResult, PlannerSuccess } from './providers/index.js';

const stripMarkdownFences = (s: string) => s.replace(/^```(?:json)?\s*\n/i, '').replace(/\n```\s*$/, '').trim();

interface PlannerOptions {
  state: EditState;
  allowComposition: boolean;
  log: { warn: (payload: Record<string, unknown>, msg: string) => void };
}

const errorMessage = (err: unknown) => err instanceof Error ? err.message : 'unknown';

// Defensive normalization: weaker models occasionally omit empty array
// fields or smuggle them in as JSON-encoded strings. Coerce to [] before
// Zod parse so missing/malformed arrays don't break the contract.
const coerceArrayField = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* fall through */ }
  }
  return [];
};

const normalizePayload = (raw: unknown): unknown => {
  if (typeof raw !== 'object' || raw === null) return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  const changes = obj.changes;
  if (changes && typeof changes === 'object' && !Array.isArray(changes)) {
    const c = { ...(changes as Record<string, unknown>) };
    c.globalAssignments = coerceArrayField(c.globalAssignments);
    c.regionUpserts = coerceArrayField(c.regionUpserts);
    c.regionDeletes = coerceArrayField(c.regionDeletes);
    obj.changes = c;
  }
  return obj;
};

const parseResult = (result: ProviderCallResult): PlanPayload => {
  const raw = result.structuredInput !== undefined
    ? result.structuredInput
    : JSON.parse(stripMarkdownFences(result.rawText));
  return PlanPayloadSchema.parse(normalizePayload(raw));
};

/** 未授予构图权限时保留可用的调色建议，并移除 AI 偶发返回的构图字段。 */
const removeUnauthorizedComposition = (payload: PlanPayload, allowComposition: boolean): PlanPayload => {
  if (allowComposition || payload.status !== 'plan' || !payload.changes?.transform) return payload;
  const changes = { ...payload.changes, transform: null };
  const reasons = payload.reasons.filter((reason) => reason.target !== 'transform');
  const hasEditableChange = changes.globalAssignments.length > 0 || changes.regionUpserts.length > 0 || changes.regionDeletes.length > 0;
  if (hasEditableChange) return { ...payload, changes, reasons };
  return {
    ...payload,
    status: 'clarify',
    message: '当前没有授权 AI 调整构图，因此未生成可应用的调色修改。',
    changes: null,
    reasons: [],
    limitations: [...payload.limitations, '构图调整已忽略。'].slice(0, 3),
  };
};

const buildRepairText = (userText: string, error: unknown): string =>
  `${userText}\n\n[修复请求] 你之前的提交未通过校验,错误信息:\n${errorMessage(error)}\n请重新调用 submit_edit_plan 工具,严格匹配 input_schema。`;

// One bounded repair attempt, per docs/AI-WORKFLOW.md:
// "业务规则失败允许一次修复调用,输入原计划和具名错误,不额外生成新图片。"
export async function planWithRepair(
  provider: Provider,
  input: ProviderCallInput,
  options: PlannerOptions,
): Promise<PlannerSuccess> {
  let result = await provider.call(input);
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const payload = removeUnauthorizedComposition(parseResult(result), options.allowComposition);
      validatePlan(options.state, payload, options.allowComposition);
      return { payload, result };
    } catch (err) {
      lastError = err;
      options.log.warn({
        err: errorMessage(err),
        provider: provider.name,
        attempt,
        snippet: result.rawText.slice(0, 200),
      }, 'planner attempt failed');
      if (attempt === 1) break;
      result = await provider.call({ ...input, userText: buildRepairText(input.userText, err) });
    }
  }

  throw lastError;
}
