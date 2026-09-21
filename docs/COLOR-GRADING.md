# 调色板块设计参考

> 这份文档调研三款业界主流调色工具(Adobe Lightroom Classic、Phase One Capture One、Blackmagic DaVinci Resolve),基于三者的共识与差异,落地为本项目调色板块的设计依据。
>
> 调研时间 2026-09,本项目 rendererVersion 仍为 `pc-render-1`。
> 调研来源见文末"参考资料"。文中的范围、默认值,均来自官方文档;标 "未公开" 的项目是官方文档未给出,我们按业界通行值落地并在代码注释中标注。

---

## 1. 业界三款工具的对比骨架

| | Adobe Lightroom Classic | Capture One Pro | DaVinci Resolve (Color 页) |
|---|---|---|---|
| 顶级组织 | 一个 Develop 面板里按顺序排多个**子面板** | 多个**并列 Tab**(Exposure/Color/Details/Lens/Composition/Adjustments) | 一个 Color 页里**多个 Palette**(Wheels/Curves/Qualifier/Window) |
| 调色范围语义 | 阴影/高光(两点)+ 中间过渡(曲线) | 阴影/中间调/高光(三段) | Lift/Gamma/Gain(三段,源自胶转磁) |
| 核心调色工具 | Color Grading(Shadow/Midtone/Highlight 三轮) | Color Balance(同上) | Primaries Wheels(同上,Lift/Gamma/Gain 命名) |
| 颜色选择工具 | Color Mixer(HSL,8 色 × 3) | Color Editor(30 色 × 3,Basic/Advanced) | Qualifier(HSL 取色器)+ Color Warper |
| 局部调整 | 蒙版 + 渐变滤镜 + 径向滤镜 + 调整画笔 | 图层 + 多种蒙版 | Power Window(线性/椭圆/曲线/多边形)+ 渐变 |
| 调色模板 | Preset / Snapshot / Profile | Style / Preset / Recipe | Node Tree / PowerGrade |

### 三者形成的行业共识

1. **Tone 拆为 Exposure + 区域调节(高光/阴影)+ 端点(白/黑)**。Lightroom 把 Exposure 放在 Basic,高光/阴影/白/黑也都在 Basic;Capture One 把曝光 + HDR(Highlight/Shadow/White/Black)放在 Exposure tab。两者本质是同一套语义,**用滑杆调区域、用端点定映射**。
2. **饱和度与"自然饱和度(Vibrance)"是分开的两件事**。Lightroom 是两个滑杆,Vibrance 非线性保护已饱和色和肤色;Capture One 把两者合并成一个"智能 Saturation";DaVinci 有 Saturation 也有 Color Boost。三者都认同"应有一个非线性的安全饱和度滑杆"。
3. **"电影感"必须有分区调色(阴影/中间调/高光)**。所有三款工具都有三段色轮;Lightroom 还提供 Blending(过渡硬度)、Balance(分割线)。一个单 Tint 滑杆做不到电影感,因为无法独立染色阴影与高光。
4. **清晰的语义 > 准确的机制**。DaVinci 保留 Lift/Gamma/Gain 是因为它面向视频行业(Lift 是胶转磁时代的术语),Lightroom/Capture One 改用 Shadows/Midtones/Highlights 是因为后者"自解释"。面向照片用户,优先 Shadows/Midtones/Highlights。
5. **饱和度"分离通道调整"是 HSL 8 色 × 3 滑杆(色相/饱和度/明度)**。Lightroom 8 色,Capture One 30 色,DaVinci 6 hue range。所有专业工具都同意:**这是照片色彩微调的基础**。

### 关键命名对照

| 概念 | Lightroom | Capture One | DaVinci | 我们采用 |
|---|---|---|---|---|
| 整体曝光 | Exposure | Exposure | (Y Gamma) | **曝光** |
| 中间调提亮 | (无独立,Brightness 通过对比+高光/阴影组合) | Brightness | Lum Mix | 不引入(理由见 §3) |
| 对比度 | Contrast | Contrast | Contrast | **对比度** |
| 高光区 | Highlights | HDR Highlight | Highlights | **高光** |
| 阴影区 | Shadows | HDR Shadow | Shadows | **阴影** |
| 白点 | Whites | HDR White | Gain | **白色色阶**(已有占位) |
| 黑点 | Blacks | HDR Black | Lift | **黑色色阶**(已有占位) |
| 清晰度 | Clarity / Texture / Dehaze | Clarity / Structure / Dehaze | Midtone Detail | **清晰度**(v1)/纹理(后续) |
| 色温 | Temperature(K) | Temperature(K) | Temperature | **色温** |
| 色调 | Tint | Tint | Tint | **色调** |
| 自然饱和度 | Vibrance | (与 Saturation 合并) | Color Boost | **自然饱和度**(已有占位) |
| 饱和度 | Saturation | Saturation | Saturation | **饱和度** |
| 分区染色 | Color Grading(3 色轮) | Color Balance(3 色轮) | Primaries(3 色轮) | **v2: 阴影/中间调/高光色轮** |
| 颜色微调 | Color Mixer | Color Editor | Qualifier + Curves | **v2: HSL 颜色混合器(8 色 × 3)** |
| 局部蒙版 | Brush / Radial / Graduated | Layers + 多种 Mask | Power Window | 椭圆内外径向、线性渐变、画笔蒙版 |

---

## 2. 我方调色板块的设计目标

1. **专业感**。参数命名、范围、默认值、分区逻辑与 Lightroom/Capture One 一致;用过任一专业工具的用户看到本应用,能直觉找到对应滑杆。
2. **轻量**。v1 不超过 **13 个全局滑杆 + 3 个局部滑杆**。这是参考 §3(a) "consumer-minimal" 子集的下界。
3. **AI 驱动**。所有滑杆都能由 AI 调整并产生可解释的修改;v1 只支持滑杆语义,色轮/曲线/HSL 在 v2 加入。
4. **诚实**。每一个滑杆的语义必须有可见效果;不引入只是"专业感符号"的占位滑杆。
5. **本地优先**。所有计算都在浏览器完成;AI 只生成 plan,不参与像素计算。

---

## 3. 设计取舍的具体记录

### 3.1 不引入 Capture One 的 Brightness

Capture One 的 Brightness 是"中间调专用的伽马弯曲",曝光不动它,白/黑点也不动它。优点:提亮人物而不爆天。缺点:
- 与 Exposure + 高光/阴影 + 白/黑的语义高度重叠,普通用户难以分清。
- Lightroom 不存在就没有?
- 我们的 SPEC 已有曝光 + 高光 + 阴影 + 白色色阶 + 黑色色阶,能完整覆盖"中间调单独提亮"的功能。

**结论**:v1 不引入 Brightness。如果用户在评测中抱怨"中间调提亮不便",再单独加。

### 3.2 暂时不引入 Dehaze

Dehaze 在三者中都是单滑杆,原理是局部对比度估计。Lightroom 的 Dehaze 在 Basic 和 Effects 中各暴露一次(同一参数)。
- 优点:对风景/雾霾照片效果大。
- 缺点:对室内人像/低对比照片容易造成"过曝假象"。
- 它和 Clarity 都是"局部对比度调整",差别只是 Dehaze 半径更大。

**结论**:v1 不引入。如果引入,优先 Clarity,因为它在所有三个工具中是必备项。

### 3.3 暂时不引入 Texture

Lightroom 的 Texture 是"中频细节",对皮肤毛孔/织物有用。C1 的 Structure 是同义。
- 优点:正负向都有用,负向可以磨皮。
- 缺点:与 Clarity 在普通照片上差异不大,普通用户难分辨。

**结论**:v1 只引入 Clarity;Texture 进 v2,与局部蒙版一起做"磨皮"功能。

### 3.4 暂时不引入三段色轮(Color Grading)

三段色轮是电影感的关键(Lightroom Color Grading、Capture One Color Balance、DaVinci Wheels 三者都用)。
- 优点:能做出"青蓝阴影 + 暖色高光"的电影感。
- 缺点:是 wheel UI 不是滑杆,设计/渲染统一要花精力;v1 还要先扩展 SPEC schema 与 ai-contract schema。

**结论**:v2 引入,放在"色彩"区段下;v1 用占位控件,等 SPEC 落地后再启用。

### 3.5 暂时不引入 HSL 颜色混合器

HSL 8 色 × 3 滑杆 = 24 个滑杆,数量上不算多,但都是参数。
- 优点:能精准微调"天空再蓝一点"、"树叶再绿一点"。
- 缺点:与三段色轮概念上重叠(三段色轮影响分区亮度,HSL 影响色相/饱和度/明度)。如果两个都做,SPEC 就要扩字段。

**结论**:v2 引入;v1 用占位控件。

### 3.6 局部调整从椭圆扩展到径向

局部蒙版工具在三个工具中都很丰富:Lightroom 有 渐变滤镜 / 径向滤镜 / 调整画笔;Capture One 有图层 + 多种 Mask;DaVinci 有 Power Window。
- 当前 SPEC 已支持椭圆区域(`RegionSchema` + `LocalAdjustments`),每个区域可调 exposureEV / highlights / saturation。
- 渐变和径向在照片场景中比画笔更常用,但实现成本高于椭圆。

**结论**:椭圆与椭圆外径向继续使用现有几何和反转影响范围。线性渐变用方向与过渡范围定义影响区域；画笔蒙版把用户在画布上的拖动采样为受限笔触点列表，避免无限增长的渲染数据。

---

## 4. 提案的 v1 调色面板结构

### 4.1 全局参数表(11 个)

| 区段 | 滑杆名 | 字段名 | 范围 | 默认 | 单位 | 含义 | 来源工具对应 |
|---|---|---|---|---|---|---|---|
| 光线 | 曝光 | `exposureEV` | -2 ~ +2 | 0 | EV | 线性增益,正负都调整整个场景亮度 | LR / C1 |
| 光线 | 对比度 | `contrast` | -100 ~ +100 | 0 | % | 围绕中间灰的对比度曲线斜率 | LR / C1 / DV |
| 光线 | 高光 | `highlights` | -100 ~ +100 | 0 | % | 仅影响直方图顶部约 25% | LR / C1 / DV |
| 光线 | 阴影 | `shadows` | -100 ~ +100 | 0 | % | 仅影响直方图底部约 25% | LR / C1 / DV |
| 光线 | 白色色阶 | `whites` | -100 ~ +100 | 0 | % | 调整白点(高端映射锚点) | LR / C1 Whites |
| 光线 | 黑色色阶 | `blacks` | -100 ~ +100 | 0 | % | 调整黑点(低端映射锚点) | LR / C1 Blacks |
| 光线 | 清晰度 | `clarity` | -100 ~ +100 | 0 | % | 中间调边缘对比度(局部对比度) | LR / C1 / DV Midtone Detail |
| 色彩 | 色温 | `warmth` | -100 ~ +100 | 0 | % | 暖↔冷(B/R 通道增益) | LR / C1 |
| 色彩 | 色调 | `tint` | -100 ~ +100 | 0 | % | 绿↔品红(G/R 通道增益) | LR / C1 |
| 色彩 | 自然饱和度 | `vibrance` | -100 ~ +100 | 0 | % | 非线性饱和度,优先提亮低饱和色 | LR / DV Color Boost |
| 色彩 | 饱和度 | `saturation` | -100 ~ +100 | 0 | % | 线性饱和度(已有) | LR / C1 / DV |

### 4.2 局部参数(3 个 + 椭圆几何)

| 区段 | 字段名 | 范围 | 默认 | 单位 | 含义 |
|---|---|---|---|---|---|
| 局部 | `exposureEV` | -2 ~ +2 | 0 | EV | 区域内曝光调整 |
| 局部 | `highlights` | -100 ~ +100 | 0 | % | 区域内高光调整 |
| 局部 | `saturation` | -100 ~ +100 | 0 | % | 区域内饱和度调整 |
| 几何 | `centerX/Y`, `radiusX/Y`, `feather` | 0~1 | 0.5 | 归一化 | 椭圆位置、大小、羽化 |

**v1 区域数上限**保持 4 个(已实现)。

### 4.3 局部蒙版实现

| 工具 | 操作 | 渲染表示 |
|---|---|---|
| 椭圆径向 | 调整中心、横纵范围和羽化；可反转影响范围 | 归一化椭圆距离场 |
| 线性渐变 | 调整渐变中心、方向和过渡范围 | 沿指定方向的平滑过渡 |
| 画笔蒙版 | 选择画笔后在照片上拖动 | 最多 32 个软边笔触点的并集 |

画笔上限避免单个局部区域无限增长，四个区域合计最多 128 个笔触点，可稳定适配 WebGL2 的 fragment uniform 限制。

---

## 5. SPEC / AI 合约 / 渲染器 改动清单

### 5.1 `packages/domain/src/index.ts` 改动

1. **新增 4 个全局参数**:`whites`、`blacks`、`clarity`、`vibrance`。范围 `±100`,默认 `0`。
2. **更新 `globalKeys`** 为 11 项。
3. **更新 `roundValue`**:whites、blacks、clarity、vibrance 都按整数化处理(与 contrast/highlights/shadows 一致)。
4. **更新 `defaultGlobal()`** 增加 4 个默认值 0。
5. **`rendererVersion`** 保持 `pc-render-1`(算法数学等价,只是新增参数;现有会话无须重渲染)。
6. **思考**:是否要 bump `SCHEMA_VERSION`?因为 schema 字段增加,老的状态文件反序列化会失败。建议:
   - 保留 `SCHEMA_VERSION = 1`,新增字段通过 `.strict()` 兼容(老状态没这些字段,但 `.strict()` 不允许 unknown 字段 —— 需要改为 `.passthrough()` 或在解析前补字段)。
   - 实际方案:由于本项目无持久化(v1 无本地存储),**可以直接 strict 升级**。在升级说明文档中标注 "本升级不向后兼容老会话状态"。

### 5.2 `packages/ai-contract/src/index.ts` 改动

1. **`PlanPayloadSchema` 的 `globalAssignments` 枚举需要扩展**为 11 项(`whites`/`blacks`/`clarity`/`vibrance` 加入)。
2. **AI prompt 的可用参数范围需要更新**(在 `apps/gateway/src/providers/{openai,anthropic}.ts` 的 system prompt 里维护一份参数清单)。
3. **AI prompt 要写入语义说明**(每个参数的"做什么")。这是为了让模型在中文自然语言指令("让画面更通透"、"提亮人脸")和滑杆之间建立准确映射。
4. **不要让模型直接输出 wheel/curve 类的复杂结构**:v1 严格限制在 11 个滑杆范围。

### 5.3 `packages/renderer/src/index.ts` 改动

新增 4 个 uniform,对应 4 个新参数。

1. `whites`:与 `highlights` 同向应用,但作用在更亮区域(`smoothstep(0.85, 1.0, y)`)。数学上,Whites 调整白点 = 调整高端映射斜率;在场景光照归一化的线性空间下,可以用 `c *= exp2(whites * smoothstep(0.85, 1.0, y))` 近似。
2. `blacks`:与 `shadows` 同向应用,但作用在更暗区域(`smoothstep(0.0, 0.15, 1-y)`)。
3. `clarity`:中间调边缘对比度 —— 在 GLSL 中比较复杂,需要 3x3 卷积采样邻域像素的亮度方差;v1 可以近似为 `c += (lum(c) - 0.5) * clarity * mask`,其中 mask 仅在中间亮度区域生效(参考 LR Clarity 的实际行为)。
4. `vibrance`:基于饱和度公式的非线性改造。

> **算法注释要求**:在 GLSL 中对每个新增参数注释其对应的业界工具名称(Lightroom Whites/Blacks/Clarity/Vibrance)和近似方式。这是为了把"基于业界语义"的设计取舍固化在代码里。

### 5.4 `apps/web/src/app/ControlsPanel.tsx` 改动

按 §4.1 的全局参数表组织 11 个 Slider。每个滑杆按定义的最小单位离散变化；提供精确数值输入、名称拖动、Shift 加速、Alt/Option 降低拖动速度与双击归零。

视觉组织:
- **构图**(保留):裁剪比例 / 旋转 / 4 个裁切 / 允许 AI 构图 勾选。
- **光线**:曝光 / 对比 / 高光 / 阴影 / 白色色阶 / 黑色色阶 / 清晰度。
- **色彩**:色温 / 色调 / 自然饱和度 / 饱和度。
- **局部调整**:椭圆内外径向 / 线性渐变 / 画笔蒙版，三者均可调整局部曝光、高光和饱和度。

### 5.5 `apps/web/src/app/App.tsx` 改动

`onGlobalChange` 的 type 扩展为 11 项 `GlobalKey`。如不打算重构 state reducer,可继续沿用 `keyof GlobalSchema` 的字符串联合,避免重写 dispatch。

### 5.6 `apps/gateway/src/providers/{openai,anthropic}.ts` 改动

System prompt 中更新参数清单:

```
全局可调参数(共 11 个,范围 ±100,除曝光为 ±2):
- exposureEV:曝光,单位 EV
- contrast:对比度
- highlights:高光
- shadows:阴影
- whites:白色色阶(白点)
- blacks:黑色色阶(黑点)
- clarity:清晰度(中间调边缘对比度)
- warmth:色温(暖↔冷)
- tint:色调(绿↔品红)
- vibrance:自然饱和度(非线性,优先提亮低饱和色)
- saturation:饱和度(线性)
```

---

## 6. v2 路线图(不在本次实现中)

按对体验的提升排序:

1. **径向蒙版**(Radial Filter)。椭圆已有,新增"径向"主要是反转逻辑:影响圈内/圈外。代码层面增加一个 `mode: 'inside' | 'outside'`,渲染器根据 mode 调整 mask 公式。
2. **三段色轮**(Color Grading / Color Balance)。SPEC 增加 `grading: { shadows, midtones, highlights }` 每段 `{ hue: 0~360, saturation: 0~100 }`。AI prompt 也需要扩展支持。
3. **HSL 颜色混合器**(8 色 × 3 滑杆)。SPEC 增加 `colorMix: { hue: { red: ..., orange: ..., ... } }` 等等。AI prompt 需要扩字段。
4. **曲线**(Tone Curve)。YRGB 4 通道 + 控制点列表。这是最复杂的扩展。
5. **纹理(Texture)**。v1 Clarity 已占位,真正实现后让 Clarity 与 Texture 区分。
6. **白平衡取色器**(`WB Picker`)。三款工具都默认暴露,体验立竿见影。
7. **缩放 / 构图 / 镜头校正**:在 `构图` 区段下加 Keystone 垂直/水平。

---

## 7. 与现有 SPEC/PRD/ARCHITECTURE 的对齐要点

- `packages/domain/src/index.ts` 中 `globalKeys` 与 `GlobalSchema` 是其他文档的事实地基。
- `docs/PRD.md` 中"参数面板包含构图、光线、色彩、局部调整四组"目前已有,但 4 组内的具体滑杆未列出。本文档的 §4.1 是首个明确清单。
- `docs/ARCHITECTURE.md` 中 "SPEC 中 rendererVersion 为 pc-render-1 的算法定义项目数值语义" 与本文档一致;新增 4 个参数仍是 pc-render-1 范畴。
- PRD 中"白色色阶、黑色色阶、自然饱和度、画笔、渐变、径向 当前未纳入 SPEC,以禁用占位控件展示" 的描述需要在 v1 实施时更新:
  - 前 3 个(白色色阶 / 黑色色阶 / 自然饱和度)升级为真实控件,占位删除。
  - 后 3 个(画笔 / 渐变 / 径向)仍为占位,等 v2。

---

## 8. 参考资料

### Adobe Lightroom Classic
- [Lightroom Classic — Adjust image color and tone (Adobe Help)](https://helpx.adobe.com/lightroom-classic/help/using-basic-panel-adjust-color-image-tone.html)
- [Lightroom Classic — Color Mixer panel](https://helpx.adobe.com/lightroom-classic/help/using-color-mixer-panel.html)
- [Lightroom Classic — Color Grading panel](https://helpx.adobe.com/lightroom-classic/help/color-grading-panel.html)
- [Lightroom Classic — Sharpening and noise reduction](https://helpx.adobe.com/lightroom-classic/help/sharpening-noise-reduction.html)
- [Lightroom Classic — Calibration](https://helpx.adobe.com/lightroom-classic/help/calibration-panel.html)

### Capture One Pro
- [Capture One — Exposure tool](https://support.captureone.com/hc/en-us/articles/360002785697-Exposure)
- [Capture One — Kelvin & Tint](https://support.captureone.com/hc/en-us/articles/360002596458)
- [Capture One — Color Balance](https://support.captureone.com/hc/en-us/articles/360002594937)
- [Capture One — Color Editor](https://support.captureone.com/hc/en-us/articles/360002594877)
- [Capture One — High Dynamic Range tool](https://support.captureone.com/hc/en-us/articles/360002610558)
- [Capture One — Composition section](https://support.captureone.com/hc/en-us/sections/360000689717-Composition)
- [Capture One — Skin Tone tool (Digital Camera World)](https://www.digitalcameraworld.com/tutorials/capture-ones-skin-tone-tool-how-to-use-it-for-more-uniform-skies)
- [Capture One — Clarity tool (Digital Camera World)](https://www.digitalcameraworld.com/tutorials/capture-ones-clarity-tool-what-it-can-do-and-how-to-use-it)

### DaVinci Resolve
- [DaVinci Resolve — Color product page](https://www.blackmagicdesign.com/products/davinciresolve/color)
- [DaVinci Resolve Reference Manual](https://www.blackmagicdesign.com/products/davinciresolve/resolvemanuals)
- [DaVinci Resolve Advanced Panel Manual](https://www.blackmagicdesign.com/products/davinciresolve/advancedpanels)

### 综合资料
- [Cambridge in Colour — Curves and Levels](https://www.cambridgeincolour.com/tutorials/levels-curves.htm)
- [Cambridge in Colour — Understanding White Balance](https://www.cambridgeincolour.com/tutorials/white-balance.htm)

> 本调研中所有数值范围均来自上述官方文档;无明确公开值的字段,我们按业界通行值落地并在代码注释中标注。
