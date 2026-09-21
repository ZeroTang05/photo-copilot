# 自动发布

每次代码合并到 `main` 后，GitHub Actions 会分别发布 Vercel 和 Cloudflare 生产版本。也可以在 GitHub 的 Actions 页面手动运行发布工作流。

## Vercel 配置

先在 Vercel 创建项目，并保持项目根目录为仓库根目录。然后在 GitHub 仓库的 Actions Secrets 中添加以下值。

Vercel 项目已连接 GitHub 自动发布时，需要关闭该项目的 Git 自动发布，避免同一提交发布两次。

| 名称 | 内容 |
| --- | --- |
| `VERCEL_TOKEN` | Vercel Personal Token |
| `VERCEL_ORG_ID` | Vercel 团队或个人账户 ID |
| `VERCEL_PROJECT_ID` | Vercel 项目 ID |

AI Key 和会话密钥保存在 Vercel 项目自己的环境变量中。

| 名称 | 用途 |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI 或兼容服务的访问密钥 |
| `AI_MODEL` | 使用的模型名称 |
| `SESSION_SECRET` | 会话签名密钥 |

## Cloudflare 配置

先在 Cloudflare 创建 Worker。然后在 GitHub Actions Secrets 中添加以下值。

Cloudflare 已启用 Git 集成发布时，需要关闭该集成，避免同一提交发布两次。

| 名称 | 内容 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 具有 Worker 编辑权限的最小范围 Token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID |

在 Cloudflare Worker 的 Secrets 中添加以下值。

| 名称 | 用途 |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI 或兼容服务的访问密钥 |
| `SESSION_SECRET` | 会话签名密钥 |

在 Cloudflare Worker 的 Variables 中添加 `AI_MODEL`。可按需添加 `OPENAI_BASE_URL`、`ALLOWED_ORIGIN` 和额度限制变量。

## 发布规则

发布工作流会先运行测试和构建。检查失败时不会发布。两个平台会各自保留最新一次发布任务，避免多个提交同时覆盖生产版本。
