import { OpenAIResponsesProvider } from './openai.js';
import { AnthropicMessagesProvider } from './anthropic.js';
import type { Provider, ProviderConfig, ProviderKind } from './types.js';

export function createProvider(kind: ProviderKind, cfg: ProviderConfig): Provider {
  switch (kind) {
    case 'anthropic':
      return new AnthropicMessagesProvider(cfg);
    case 'openai':
      return new OpenAIResponsesProvider(cfg);
  }
}

export function resolveProviderKind(raw: string | undefined): ProviderKind {
  return raw?.toLowerCase() === 'anthropic' ? 'anthropic' : 'openai';
}

export type { Provider, ProviderConfig, ProviderCallInput, ProviderCallResult, ProviderKind, PlannerSuccess } from './types.js';
export { ProviderError } from './types.js';
