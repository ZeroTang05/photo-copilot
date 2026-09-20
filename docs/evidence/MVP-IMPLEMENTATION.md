# MVP 实现记录

## 已实现范围

| 需求 | 实现位置 | 当前验证 |
| --- | --- | --- |
| FR-01 | apps/web/src/app/App.tsx | 真实 JPEG 与 PNG 选择、尺寸限制、浏览器解码和白底规范化已完成 |
| FR-02 至 FR-04 | apps/web/src/app/App.tsx 与 packages/renderer/src/index.ts | WebGL2 画布、缩放、全局参数、调平和裁切字段已完成 |
| FR-05 至 FR-08 | apps/gateway/src/index.ts 与 apps/web/src/app/App.tsx | 匿名会话、严格模型计划、候选预览和解释卡已完成 |
| FR-07 | apps/web/src/app/App.tsx 与 packages/renderer/src/index.ts | 四个柔和椭圆区域与局部参数已完成 |
| FR-09 至 FR-10 | apps/web/src/app/App.tsx | 撤销、重做、重置状态逻辑和浏览器 JPEG 导出已完成 |
| FR-11 至 FR-12 | apps/web/src/app/App.tsx 与 apps/gateway/src/index.ts | AbortController、过期关联检查、配额端点、发送说明和键盘撤销已完成 |

## 本次验证

2026-09-20 已通过 pnpm typecheck、pnpm test 和 pnpm build。

真实浏览器已完成空状态、PNG 导入、WebGL2 画布渲染、参数输入和撤销状态检查。网关以 Node 直接启动后，GET /api/session 返回未认证状态，POST /api/session 返回 204 与 HttpOnly 会话 Cookie。

## 受阻验证

真实模型计划调用等待配置 OPENAI_API_KEY。真实照片集、GPU 性能、2400 万像素导出和 AI 质量评测等待具备授权的样本与模型额度后执行。
