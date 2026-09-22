# Photo Copilot

一款在浏览器中完成照片调色、局部修图和 AI 编辑建议的照片编辑器。

导入常见图片、TIFF 或相机 RAW 后，可以先手动调整画面，再用自然语言让 AI 提出可预览的编辑方案。每次建议都可以应用或放弃，照片始终由编辑者掌控。

## 可以做什么

- 输入一句话获得曝光、色彩和构图建议
- 调整曝光、对比度、高光、阴影、白色色阶和黑色色阶
- 调整清晰度、色温、色调、自然饱和度和饱和度
- 批量选择或直接拖入 JPEG、PNG、WebP、AVIF、GIF、TIFF 或相机 RAW 照片，在左侧缩略图快速切换
- 添加椭圆、线性渐变或画笔蒙版，单独提亮主体、压暗背景或调整局部色彩
- 裁切照片、锁定常用画幅，支持 -180° 至 180° 的自动裁切旋转
- 按需显示或隐藏缩略图、调整和 AI 副驾面板，自由整理工作区
- 随时撤销、重做和对比原图
- 导出 JPEG、PNG、WebP、AVIF 或 TIFF 成片

## 图片质量与 AI

本地编辑始终使用导入图片的完整像素尺寸，AI 只会收到两张长边不超过 1024 像素的 JPEG 预览图。压缩预览不会降低本地画布和导出的分辨率。

导入时，图片会转换为 sRGB PNG，EXIF 和原始色彩配置不会保留。JPEG、WebP 与 AVIF 会进行有损压缩；PNG 和 TIFF 可作为不增加有损压缩的中间文件。需要保留相机原始文件时，请同时保留导入前的照片。

相机 RAW（DNG、ARW、CR2、CR3、NEF、RAF 等）会在浏览器内通过 LibRaw 解码为 sRGB 像素后进入编辑器。解码过程不会上传原始照片；RAW 的原始传感器数据和相机元数据不会包含在导出文件中。

## 编辑流程

1. 选择或拖入一张或多张照片
2. 在右侧控制面板手动调整照片
3. 输入想要的效果，或使用自然改善功能
4. 预览 AI 建议后选择应用或放弃
5. 选择需要的格式并导出成片

## 适合的场景

- 旅行照片的快速整理
- 人像照片的肤色和光线微调
- 风光照片的明暗与色彩调整
- 社交媒体和作品集的成片准备

## 本地开始

需要 Node.js 22 或更高版本，以及 pnpm 10。

```bash
pnpm install
pnpm dev
pnpm dev:gateway
```

前端默认地址为 `http://localhost:5173`。AI 功能需要在 `.env` 中配置 API Key。可复制 `.env.example` 作为起点。

## 部署

项目可单独部署到 Vercel，也可单独部署到 Cloudflare Workers。Cloudflare 版本提供持久化的会话额度控制。

部署完成后，平台会自动连接 Fork 后的仓库。后续推送到默认分支时，平台会自动发布新版本。

### Vercel

部署页面会显示需要填写的全部环境变量，默认填入 OpenAI 的可用配置。使用 Anthropic 时，将 `AI_SDK` 改为 `anthropic`，将 `AI_BASE_URL` 改为 `https://api.anthropic.com`，并填写对应的模型名称。

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FZeroTang05%2Fphoto-copilot&project-name=photo-copilot&repository-name=photo-copilot&env=AI_SDK%2CAI_API_KEY%2CAI_BASE_URL%2CAI_MODEL%2CSESSION_SECRET&envDefaults=%7B%22AI_SDK%22%3A%22openai%22%2C%22AI_BASE_URL%22%3A%22https%3A%2F%2Fapi.openai.com%2Fv1%22%2C%22AI_MODEL%22%3A%22gpt-4o-mini%22%7D&envLink=https%3A%2F%2Fgithub.com%2FZeroTang05%2Fphoto-copilot%2Fblob%2Fmain%2Fdocs%2FDEPLOYMENT.md)

首次部署后，打开 Vercel 项目中的 **Settings → Environment Variables**，将 `AI_API_KEY` 与 `SESSION_SECRET` 标记为 **Sensitive**（敏感变量）。

### Cloudflare

Cloudflare 原生 Worker 支持 OpenAI SDK 和 Anthropic SDK。部署页面只会要求填写 `AI_API_KEY` 和 `SESSION_SECRET` 两个密钥；SDK、接口地址与模型名称是可编辑的公开配置。接口地址留空时使用所选 SDK 的官方地址。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FZeroTang05%2Fphoto-copilot)

完整步骤见 [部署说明](docs/DEPLOYMENT.md)。

## 排查 AI 调用

每次 AI 调色请求都会写入部署平台的运行日志。出现“模型服务暂时不可用”时，先从前端错误提示中的 `requestId` 开始查找；它能把一次请求的开始、模型输出、自动修复、成功或失败记录串在一起。

- Vercel：进入项目的 **Logs**，搜索 `requestId` 或 `ai.plan.failed`。
- Cloudflare：进入 Worker 的 **Logs**，搜索 `requestId` 或 `ai.provider.failed`。

日志会保留模型返回的 JSON、HTTP 状态、耗时和用量信息；不会记录 API Key、Cookie 或上传图片的 base64 内容。

## 参与贡献

欢迎提交功能建议、问题报告和 Pull Request。提交前请阅读 [贡献指南](CONTRIBUTING.md)。

## 安全

安全问题请遵循 [安全策略](SECURITY.md) 报告。

## 协议

项目使用 [MIT 协议](LICENSE)。
