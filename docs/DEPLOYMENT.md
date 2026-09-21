# 部署

## Vercel

Vercel 部署包含 Vite 前端与 Node.js 网关函数。根目录的 `vercel.json` 会构建 `apps/web/dist` 并将 `/api/*` 交给 Fastify 网关。

在 Vercel 项目中配置以下环境变量。

```text
AI_SDK=openai
AI_API_KEY=
AI_BASE_URL=
AI_MODEL=gpt-4o-mini
SESSION_SECRET=
```

`ALLOWED_ORIGIN` 留空时，网关接受当前部署域名。需要限制来源时，填入逗号分隔的完整 HTTPS 来源。

```text
ALLOWED_ORIGIN=https://photo-copilot.vercel.app
```

预览部署与生产部署应使用各自的来源配置。Vercel 项目根目录应选择仓库根目录。

### 密钥设置

`AI_API_KEY` 与 `SESSION_SECRET` 是密钥。Vercel 一键部署链接会收集它们，但链接参数无法将变量直接标记为 **Sensitive**（敏感变量）。首次部署后，在 **Settings → Environment Variables** 中分别编辑这两个变量并开启 **Sensitive**。

`AI_SDK`、`AI_BASE_URL`、`AI_MODEL` 和 `ALLOWED_ORIGIN` 是公开配置，不需要标记为 Sensitive。

| 服务商 | `AI_SDK` | 必填配置 | 可选配置 |
| --- | --- | --- | --- |
| OpenAI | `openai` | `AI_API_KEY`、`AI_MODEL`、`SESSION_SECRET` | `AI_BASE_URL`、`ALLOWED_ORIGIN` |
| OpenAI 兼容服务 | `openai` | `AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL`、`SESSION_SECRET` | `ALLOWED_ORIGIN` |
| Anthropic | `anthropic` | `AI_API_KEY`、`AI_MODEL`、`SESSION_SECRET` | `AI_BASE_URL`、`ALLOWED_ORIGIN` |

## Cloudflare

Cloudflare Workers 配置托管 Vite 静态资源，并直接处理 `/api/*`。原生 Worker 后端使用 OpenAI Responses API 和 Durable Object 保存会话与每日额度。

```text
pnpm build:deploy
pnpm dlx wrangler secret put AI_API_KEY
pnpm dlx wrangler secret put SESSION_SECRET
pnpm dlx wrangler deploy
```

Cloudflare 的一键部署会从 `.dev.vars.example` 读取 `AI_API_KEY` 与 `SESSION_SECRET`，并将它们作为 Worker Secret（密钥）保存。`AI_SDK`、`AI_BASE_URL` 和 `AI_MODEL` 写在 `wrangler.jsonc` 的 `vars` 中，属于可公开查看的配置。需要限制来源时，配置 `ALLOWED_ORIGIN`。`AI_BASE_URL` 留空时使用 OpenAI 或 Anthropic 的官方地址。

| 服务商 | 必填配置 | 可选配置 |
| --- | --- | --- |
| OpenAI | `AI_SDK=openai`、`AI_API_KEY`、`SESSION_SECRET` | `AI_BASE_URL`、`AI_MODEL`、`ALLOWED_ORIGIN` |
| Anthropic | `AI_SDK=anthropic`、`AI_API_KEY`、`SESSION_SECRET` | `AI_BASE_URL`、`AI_MODEL`、`ALLOWED_ORIGIN` |

## 运行约束

会话与每日额度保存在 Durable Object。Vercel 网关仍使用进程内存。生产环境优先选择 Cloudflare 部署以获得持久化额度控制。
