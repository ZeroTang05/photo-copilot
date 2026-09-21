import { describe, expect, it } from 'vitest';
import { applyChanges, ChangeSetSchema, createInitialState, DomainError, globalKeys, RegionSchema } from '../src/index.ts';

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

  it('为既有椭圆区域补充内部径向模式', () => {
    const region = RegionSchema.parse({
      id: '8c7955ce-5f1e-4c37-b927-9460e7791c30', label: '天空', enabled: true,
      centerX: .5, centerY: .5, radiusX: .2, radiusY: .2, feather: .35,
      adjustments: { exposureEV: -.5, highlights: -20, saturation: 0 },
    });
    expect(region.mode).toBe('inside');
  });

  it('允许一个计划覆盖全部十一项全局调色参数', () => {
    const changes = ChangeSetSchema.parse({
      globalAssignments: globalKeys.map((parameter) => ({ parameter, value: parameter === 'exposureEV' ? .2 : 1 })),
      transform: null,
      regionUpserts: [],
      regionDeletes: [],
    });
    expect(changes.globalAssignments).toHaveLength(11);
  });
});
