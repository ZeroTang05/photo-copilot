import type { IncomingMessage, ServerResponse } from 'node:http';

// Vercel 将此入口编译为 CommonJS；网关是 ESM。动态 import() 可让两种模块格式
// 在 Node.js 函数中正常协作，并且只在第一个 API 请求时初始化网关。
type GatewayModule = typeof import('../apps/gateway/src/index.js');

let gateway: Promise<GatewayModule> | undefined;
let ready: PromiseLike<unknown> | undefined;

export const maxDuration = 45;

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const { app } = await (gateway ??= import('../apps/gateway/src/index.js'));
  ready ??= app.ready();
  await ready;
  app.server.emit('request', request, response);
}
