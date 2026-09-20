# 技术选型与项目架构

## ADR-01 前端主导的执行边界

浏览器承担解码、参数状态、图像渲染、候选预览、历史和导出。服务端承担匿名会话、请求校验、配额和模型调用。服务端不接收原始文件，不参与成片计算，不建立照片资产库。

AI 的输出进入校验器与候选区。应用建议后，确定性的状态 reducer 产生新状态，渲染器读取状态完成画面更新。

```text
本地文件 → 解码与规范化 → 原始像素资源 → WebGL2 → 画布与 JPEG
                              ↑            ↑
                         坐标映射      已提交状态或候选状态
                                           ↑
手动控件 → 状态 reducer ← 校验后的变更集 ← AI 候选计划
                                           ↑
规范化原图与当前效果缩略图 → 同源网关 → 视觉语言模型
```

箭头中的图像上行仅包含缩略图。状态、区域和解释以 JSON 传递。浏览器保留唯一的已提交编辑状态。

## 技术栈

| 层 | 选择 | 理由与边界 |
| --- | --- | --- |
| 前端 | React 19.3、TypeScript 严格模式、Vite 8 | 单页工作台无需服务端渲染，类型契约贯穿前后端 |
| 样式 | CSS Modules、CSS 变量、原生语义控件 | 控制中性色彩和布局,减少无关组件框架依赖。滚动条自定义为 4px 细线 + 主题色 (`--border-strong` + `--text-faint` hover),track 透明,避免默认 12px 灰条与暗色界面对比突兀 |
| 状态 | Zustand 加纯 reducer | React 订阅界面状态，事务逻辑独立于视图 |
| 图形 | 原生 WebGL2、GLSL ES 3.00 | 自有参数需要固定像素语义，单张图片管线较短 |
| 解码编码 | createImageBitmap、Canvas 2D、Blob | 使用浏览器真实解码与 JPEG 编码能力 |
| 请求与校验 | fetch、AbortController、Zod | 同一套领域 Schema 供浏览器与网关校验 |
| 服务端 | Node.js 24 LTS、Fastify | 同源静态文件与少量 API，便于本地及单实例托管 |
| 模型 SDK | OpenAI 官方 JavaScript SDK（Responses API）、`@anthropic-ai/sdk`（Messages API） | 通过 `AI_PROVIDER` 选择；OpenAI 路径用 `text.format.type: 'json_object'`，Anthropic 路径强制调用 `submit_edit_plan` 工具并以 `input_schema` 约束输入 |
| 初始模型 | 取决于 `AI_PROVIDER`：OpenAI 路径默认 `gpt-4o-mini`，Anthropic 路径由 `AI_MODEL` 显式指定 | 模型 ID 必须与所选 provider 能力匹配，切换后重新校准 max_output_tokens 与黄金场景 |
| 依赖管理 | pnpm workspace | 两个应用和三个内聚包共享类型 |
| 验证 | Vitest、Playwright、真实桌面浏览器 | 领域不变量、网络契约和实际渲染分别验证 |
| 持久化 | 首版无编辑持久化,网关采用进程内匿名会话与计数器 | 单实例开放试用,后续扩容再引入持久共享存储 |

[React 官方版本页](https://react.dev/versions) 在资料核验时列出 19.3。[Vite 官方指南](https://vite.dev/guide/) 给出运行时最低要求，Node.js 24 LTS 满足该要求。[Node.js 发布页](https://nodejs.org/en/about/previous-releases) 用于开发启动时再次确认支持周期。其余依赖在 G0 选择当时兼容的稳定版本并固定到 lockfile，记录精确版本，禁止依赖未固定的 latest 部署。

模型选择采用 [GPT-5.6 Terra 官方页](https://developers.openai.com/api/docs/models/gpt-5.6-terra) 所列能力。该选择是首轮评测基线，文档没有假定其在修图任务上优于其他模型。更换模型需要重新完成固定样本评测并记录模型 ID。

## ADR-02 WebGL2 渲染

首版使用一个全屏片元着色器完成采样、全局调节和最多 4 个局部区域。参数放入 uniforms，原图作为只读纹理。预览和导出共用着色器源码。

WebGPU 的计算能力适合后续分割或复杂管线，但引入两套渲染实现会增加一致性维护成本。首版选择 WebGL2，并在能力检测中明确要求。浏览器支持变化以 [MDN WebGPU 文档](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API) 和实测为准。

Canvas 2D 用于解码规范化、缩略图生成和输出编码。逐像素调色由 GPU 负责。CSS filter 的处理语义不足以实现本规格中的线性色彩与局部蒙版。

必须查询设备纹理、渲染目标和视口上限，检查着色器编译与帧缓冲完整性。资源释放、上下文丢失和读取像素成本依照 [MDN WebGL 最佳实践](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices) 处理。浏览器 GPU 上限通过实机检测得出。

## ADR-03 自有编辑参数

SPEC 中 rendererVersion 为 pc-render-1 的算法定义项目数值语义。曝光使用 EV，暖冷和色偏使用相对强度。JPEG 色温滑杆不能宣称为相机原始 Kelvin 温度。

项目不把 Lightroom 参数名作为算法兼容承诺。提示词必须传入本项目的范围、公式效果和当前值。禁止直接将外部 XMP 值当作可重放项目文件。

## ADR-04 AI 工作流

一次操作对应一次有界规划调用。浏览器提交当前状态及两张缩略图，服务端生成严格 Schema 请求，模型返回候选变更集。计划通过结构与业务校验后显示预览。

初版不加入自治循环、工具执行、多代理编排或自动审美打分回路。一次格式修复属于同一用户操作，最多增加一次模型调用，并单独统计。

## 目录设计

```text
apps/web/src/app/TopBar.tsx           # 顶部工具栏：导入/撤销/重做/对比/缩放/导出
apps/web/src/app/ThumbnailSidebar.tsx # 左侧缩略图栏，支持多图会话切换
apps/web/src/app/ControlsPanel.tsx    # 右侧参数面板（构图/光线/色彩/局部调整）
apps/web/src/app/CopilotPanel.tsx     # 底部 AI 副驾面板
apps/web/src/app/Slider.tsx           # 复用滑杆组件，支持 warmth/tint 渐变轨道
apps/web/src/state/editor.ts          # Zustand store，多图状态与撤销/重做
apps/gateway/src/providers            # Provider 抽象与 createProvider 工厂
apps/gateway/src/providers/openai
apps/gateway/src/providers/anthropic
apps/gateway/src/planner              # planWithRepair 修复重试
packages/domain/src
packages/renderer/src
packages/ai-contract/src
tests/fixtures
tests/e2e
docs
```

domain 包包含状态、参数边界、几何、事务和业务校验，不依赖 React、DOM 或模型 SDK。renderer 包依赖 domain，并暴露图像加载、渲染、导出和资源释放入口。ai-contract 包依赖 domain，定义请求、响应和模型输出 Schema。

web 依赖三个包，负责用户交互和浏览器资源生命周期。gateway 依赖 domain 与 ai-contract，持有模型 SDK 和凭据。任何前端代码均不得导入 gateway 模块。

原图 Blob、ImageBitmap、纹理和 Canvas 由资源管理对象持有，Zustand 保存资源 ID 和元数据，避免将大对象序列化到状态。每次替换照片释放旧纹理、撤销旧 Object URL 并关闭 ImageBitmap。

### 多图会话

`apps/web/src/state/editor.ts` 用 `ImageSlot[]` 跟踪当前会话的所有图片，每张图持有独立的 `EditState`、`history`、`future` 与缩略图（base64 data URL）。`activeIndex` 指向当前画布绑定的图片；commit / undo / redo / reset / candidate 操作只作用于 activeIndex 对应的那张。首次版本不跨图片同步状态；切换图片时 dispose 旧 PhotoRenderer 并 load 新 Blob，闪烁是已知可优化项。

## 模块公开契约

| 模块 | 输入 | 输出及错误 |
| --- | --- | --- |
| importImage | File、取消信号 | 规范化资源、宽高、能力限制或明确导入错误 |
| reduceTransaction | 当前状态、完整事务 | 新状态及变更摘要，非法事务整体拒绝 |
| validatePlan | 请求上下文、模型计划 | 可预览计划或具名业务错误 |
| renderPreview | 资源、状态、视口 | 当前帧，失败时报告 GPU 错误 |
| buildAnalysisImages | 资源、已提交状态 | 原图与当前效果 JPEG Blob，固定原图坐标 |
| planWithRepair | provider、调用输入、当前状态、allowComposition | 可预览计划或最后一次错误；解析或校验失败时按 SPEC 允许一次修复调用 |
| createProvider | provider kind（openai \| anthropic）、密钥、端点、模型 | 实现统一 Provider 接口的实例 |
| exportImage | 资源、冻结状态、尺寸与质量、取消信号 | JPEG Blob 与输出元数据 |
| useEditor | 无 | Zustand store 钩子，导出 `images`、`activeIndex`、`candidate` 以及 `addImage` / `setActiveIndex` / `removeImage` / `commit` / `undo` / `redo` / `setCandidate` / `reset` |

所有异步任务携带 imageId 和 generation。替换图片时增加 generation，旧任务完成时检查后丢弃资源和结果。renderPreview 每个动画帧取最新状态，避免为每次滑杆事件排队。

## 编辑界面布局

主屏采用三栏布局：`缩略图栏 \| 画布 \| 参数面板`，副驾面板只占据左下（不延伸至参数栏下方）。CSS Grid 关键约束：

- `main`：`grid-template-rows: 56px 1fr`，顶部工具栏 56px，内容区占满
- `.content`：`grid-template-columns: 1fr 320px`，左栈 + 右栏 3 栏
- `.leftStack`：`grid-template-columns: 110px 1fr` + `grid-template-rows: minmax(0, 1fr) 240px`，缩略图跨两行、画布与副驾纵向分摊
- `.controls`：`grid-row: 1 / span 2` 占据整个内容区高度

参数面板按 SPEC 自有参数 + 设计图补充的"占位项"组织。`画笔`、`渐变`、`径向` 暂未在 `domain` schema 内，因此以禁用的"即将推出"占位控件呈现，等待参数加入 schema 后再启用。`白色色阶`、`黑色色阶`、`清晰度`、`自然饱和度` 已于 COLOR-GRADING.md 落地。

## 部署设计

本地开发使用 Vite，代理同源 API 到 Fastify。生产环境使用一个 Node 进程提供 Vite 构建产物及 API，前方配置 HTTPS 反向代理。静态资源使用内容指纹缓存，HTML 与 API 使用适当的非缓存策略。API 响应统一设置 no-store。

服务端必需配置 `AI_PROVIDER`、`OPENAI_API_KEY` 或 `ANTHROPIC_API_KEY`(按 provider 取对应密钥)、`OPENAI_BASE_URL` 或 `ANTHROPIC_BASE_URL`(可选,覆盖默认上游)、`AI_MODEL`、`ALLOWED_ORIGIN` 和 `DAILY_AI_ATTEMPT_LIMIT`。`SESSION_SECRET` 用于签名会话 cookie;若不配置,启动时自动生成进程级随机值,每次重启会让旧 cookie 失效,但 AI 仍然可用。`AI_PROVIDER` 默认 `openai`;OpenAI 路径默认模型 `gpt-4o-mini`,Anthropic 路径必须显式指定 `AI_MODEL`。每个匿名会话每天最多 30 次上游尝试,全局每天最多 300 次。缺少凭据时启动诊断显示 AI 不可用,手动编辑页面可以运行。

会话标识只存在服务端与 HttpOnly Cookie 通道。首版无邀请码门槛:任何同源请求都自动签发 24 小时匿名会话,会话内按上述速率限制计数。进程内计数重启会清零,首版通过单实例运行和供应商项目消费上限控制预算。公开开放或多实例部署前必须实现持久配额存储,该项是架构扩展门槛。

部署目标为普通 Node 容器环境。首版所需服务为静态文件、同源 API 和上游模型接口。

## 开发约定

`tmp/`(含 `tmp/photo/`)是手动测试和调试验证过程的中间产物目录——例如截图、对照图、调试输出。该目录被 `.gitignore` 忽略,不进入版本库。`pnpm dev` 不会自动清理;调试完成可由开发者手动清理或保留作记录。

`packages/*` 的 `exports.import` 指向编译产物 `dist/index.js`。修改 `src/` 后必须 `pnpm --filter @photo-copilot/<pkg> build` 把改动同步到 dist,否则 Vite dev 仍服务旧版源码。这一点在 `packages/renderer/src/index.ts` 顶部的注释中有提醒。

## 成本与维护

请求日志保留模型 ID、promptVersion、rendererVersion、耗时、token 用量和结果类别。费用由实际用量乘以当时官方费率计算，不能把本应用的订阅价格当作 API 费率。

模型与参数算法分开版本化。更改模型提示词时重跑 AI 评测，更改渲染公式时增加 rendererVersion 并更新图像基准。现有会话保留其 rendererVersion，首版禁止热切换算法。
