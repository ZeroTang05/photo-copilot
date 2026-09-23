import type { SceneProfile } from '@photo-copilot/ai-contract';

/** 模块 ID 和正文来自 docs/AI-COLOR-SCENE-MODULES.md；选择顺序由诊断输出决定。 */
const subjects = {
  person: '优先观察人物面部和身体的明暗可读性、肤色与现场光源的关系、人物与背景的分离程度。保留不同肤色的固有差异、场景暖冷光和衣物真实色彩。提亮时检查额头与浅色衣服是否过亮；降噪时检查眼睛、头发、皮肤与衣服纹理。多人画面用明确选区 ID 决定目标。',
  landscape: '观察天空与地面的亮度关系、远近层次、水与植被的颜色和主体可读性。保留天气、时间与空气透视。检查天空灰块、云层、植被和水面过饱和。太阳、雪地和水面反光已丢失的细节不能声称恢复。',
  architecture: '观察建筑立面、窗户、天空及阴影层次，保留材质和人工灯光真实颜色。检查白墙偏色、窗外与室内灯层次、建筑边缘过渡。未经构图授权不改变画幅；当前工具无法透视校正。',
  food_product: '观察主体固有颜色、表面质感、反光与背景干扰。保留商品真实色彩与品牌色，检查白盘、包装、金属或玻璃高光。颜色真实性重要时使用保守建议。',
  animal: '观察眼部可读性、毛发或羽毛细节、主体与背景分离。保留毛色与现场光线。降噪时检查细毛、胡须与羽毛边缘；缩略图看不清时标记不确定。',
} as const;

const lighting = {
  night: '保留夜晚暗部基调和灯光颜色，检查主体可读性。提亮阴影时关注颗粒与颜色杂点。灯牌、车灯和窗口可保持明亮。降噪前看真实像素局部图，区分噪点、雨雪、细节和有意颗粒。',
  backlit: '关注主体与高亮背景亮度差、轮廓光和发光氛围。全局提亮可能使背景更亮。检查边缘过渡和发丝，保留太阳与窗户的光源亮度。',
  mixed_light: '识别暖灯、窗光、霓虹等并存关系。全局色温和色调只能整体作用；保留主光氛围。局部偏色且缺少局部白平衡能力时说明边界。',
  flat_hazy: '判断低反差源于天气、雾气、逆光还是既有风格。增强层次时保留近远关系。去雾后检查天空、植被与边缘；用户要求柔和时保留空气感。',
} as const;

export function selectSceneModules(profile: SceneProfile) {
  const selected = [
    ...profile.subjects.filter((tag): tag is keyof typeof subjects => tag !== 'other').slice(0, 2).map((tag) => ({ id: `subject.${tag}-v1`, text: subjects[tag] })),
    ...profile.lighting.slice(0, 2).map((tag) => ({ id: `lighting.${tag}-v1`, text: lighting[tag] })),
  ];
  return selected;
}
