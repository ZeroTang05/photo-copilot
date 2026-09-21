# 部署

## Vercel

Vercel 部署包含 Vite 前端与 Node.js 网关函数。根目录的 `vercel.json` 会构建 `apps/web/dist` 并将 `/api/*` 交给 Fastify 网关。

在 Vercel 项目中配置以下环境变量。

```text
OPENAI_API_KEY=
AI_MODEL=gpt-4o-mini
SESSION_SECRET=
```

`ALLOWED_ORIGIN` 留空时，网关接受当前部署域名。需要限制来源时，填入逗号分隔的完整 HTTPS 来源。

```text
ALLOWED_ORIGIN=https://photo-copilot.vercel.app
```

预览部署与生产部署应使用各自的来源配置。Vercel 项目根目录应选择仓库根目录。

| 服务商 | `AI_PROVIDER` | 必填配置 | 可选配置 |
| --- | --- | --- | --- |
| OpenAI | `openai` | `OPENAI_API_KEY`、`AI_MODEL`、`SESSION_SECRET` | `ALLOWED_ORIGIN` |
| OpenAI 兼容服务 | `openai` | `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`AI_MODEL`、`SESSION_SECRET` | `ALLOWED_ORIGIN` |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY`、`AI_MODEL`、`SESSION_SECRET` | `ANTHROPIC_BASE_URL`、`ALLOWED_ORIGIN` |

## Cloudflare

Cloudflare Workers 配置托管 Vite 静态资源，并直接处理 `/api/*`。原生 Worker 后端使用 OpenAI Responses API 和 Durable Object 保存会话与每日额度。

```text
pnpm build:deploy
pnpm dlx wrangler secret put OPENAI_API_KEY
pnpm dlx wrangler secret put SESSION_SECRET
pnpm dlx wrangler deploy
```

Cloudflare 项目中配置 `AI_MODEL`。需要限制来源时，配置 `ALLOWED_ORIGIN`。Cloudflare 版本当前使用 OpenAI 和 OpenAI 兼容接口。

| 服务商 | 必填配置 | 可选配置 |
| --- | --- | --- |
| OpenAI | `OPENAI_API_KEY`、`SESSION_SECRET` | `AI_MODEL`、`ALLOWED_ORIGIN` |
| OpenAI 兼容服务 | `OPENAI_API_KEY`、`SESSION_SECRET`、`OPENAI_BASE_URL`、`AI_MODEL` | `ALLOWED_ORIGIN` |

## 运行约束

会话与每日额度保存在 Durable Object。Vercel 网关仍使用进程内存。生产环境优先选择 Cloudflare 部署以获得持久化额度控制。
