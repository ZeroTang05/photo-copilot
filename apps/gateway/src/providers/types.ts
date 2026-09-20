import type { PlanPayload } from '@photo-copilot/domain';

export type ProviderKind = 'openai' | 'anthropic';

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
  call(input: ProviderCallInput): Promise<ProviderCallResult>;
}

// Shared exception for any upstream/model failure. The planner wraps everything
// in this so the route handler only deals with one error type.
export class ProviderError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface PlannerSuccess {
  payload: PlanPayload;
  result: ProviderCallResult;
}