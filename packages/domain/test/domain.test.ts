import { describe, expect, it } from 'vitest';
import { applyChanges, createInitialState, DomainError } from '../src/index.ts';

describe('领域事务', () => {
  it('以绝对值更新参数且保留未涉及字段', () => {
    const state = createInitialState('8c7955ce-5f1e-4c37-b927-9460e7791c30', 1600, 900);
    state.global.warmth = 20;
    const next = applyChanges(state, { globalAssignments: [{ parameter: 'exposureEV', value: .45 }], transform: null, regionUpserts: [], regionDeletes: [] });
    expect(next.global.exposureEV).toBe(.45);
    expect(next.global.warmth).toBe(20);
  });
  it('拒绝未授权构图变更', () => {
    const state = createInitialState('8c7955ce-5f1e-4c37-b927-9460e7791c30', 1600, 900);
    expect(() => applyChanges(state, { globalAssignments: [], transform: { ...state.transform, angleDeg: 1 }, regionUpserts: [], regionDeletes: [] }, false)).toThrow(DomainError);
  });
});
