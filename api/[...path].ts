import type { IncomingMessage, ServerResponse } from 'node:http';
import { app } from '../apps/gateway/src/index';

let ready: PromiseLike<unknown> | undefined;

export const maxDuration = 45;

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  ready ??= app.ready();
  await ready;
  app.server.emit('request', request, response);
}
