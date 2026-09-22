import type { PlanPayload } from '@photo-copilot/domain';

export type ProviderKind = 'openai' | 'anthropic';

/** 给 Vercel 函数保留返回错误或修复计划的时间余量。 */
export const PROVIDER_TIMEOUT_MS = 75_000;

export interface ProviderConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
}

export interface ProviderImage {
  base64: string;
}

export interface ProviderCallInput {
  instructions: string;
  userText: string;
  images: ProviderImage[];
}

export interface ProviderUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
}

export interface ProviderCallResult {
  rawText: string;
  model: string;
  usage: ProviderUsage;
  // Anthropic tool_use returns already-parsed input; OpenAI leaves this unset.
  structuredInput?: unknown;
}

export interface Provider {
  readonly name: ProviderKind;
  call(input: ProviderCallInput, timeoutMs?: number): Promise<ProviderCallResult>;
}

// Shared exception for any upstream/model failure. The planner wraps everything
// in this so the route handler only deals with one error type.
export class ProviderError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** 将 SDK 错误压缩为可安全写入运行时日志的字段，避免输出请求头和密钥。 */
export function errorLogDetails(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) };
  const details: Record<string, unknown> = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
  const source = error.cause instanceof Error ? error.cause : error;
  if (source instanceof Error) {
    details.cause = { name: source.name, message: source.message, stack: source.stack };
  }
  if (typeof source === 'object' && source !== null) {
    const record = source as unknown as Record<string, unknown>;
    for (const key of ['status', 'code', 'type', 'request_id', 'requestId', 'requestID']) {
      const value = record[key];
      if (typeof value === 'string' || typeof value === 'number') details[key] = value;
    }
  }
  return details;
}

export interface PlannerSuccess {
  payload: PlanPayload;
  result: ProviderCallResult;
  attempts: number;
}
