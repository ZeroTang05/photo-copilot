import OpenAI from 'openai';
import type { Provider, ProviderCallInput, ProviderCallResult, ProviderConfig, ProviderKind } from './types';
import { ProviderError } from './types';

// OpenAI Responses API provider.
//
// We deliberately use text.format.type: 'json_object' instead of
// 'json_schema' (strict mode). Strict mode is honored only by OpenAI's own
// models and is silently ignored by most OpenAI-compatible providers (DeepSeek,
// Qwen, MiniMax, etc.). json_object guarantees valid JSON output; the Zod
// schema in planner.ts validates structure.

export class OpenAIResponsesProvider implements Provider {
  readonly name: ProviderKind = 'openai';
  private readonly client: OpenAI;
  private readonly cfg: ProviderConfig;

  constructor(cfg: ProviderConfig) {
    this.cfg = cfg;
    this.client = new OpenAI({
      apiKey: cfg.apiKey,
      ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
      maxRetries: 0,
      timeout: 30000,
    });
  }

  async call(input: ProviderCallInput): Promise<ProviderCallResult> {
    let response;
    try {
      response = await this.client.responses.create({
        model: this.cfg.model,
        store: false,
        reasoning: { effort: 'low' },
        max_output_tokens: 6000,
        instructions: input.instructions,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: input.userText },
            ...input.images.map((image) => ({
              type: 'input_image' as const,
              image_url: `data:image/jpeg;base64,${image.base64}`,
              detail: 'high' as const,
            })),
          ],
        }],
        text: { format: { type: 'json_object' } },
        tools: [],
      });
    } catch (error) {
      throw new ProviderError('openai request failed', error);
    }

    if (response.status !== 'completed' || !response.output_text) {
      throw new ProviderError(`openai returned incomplete response: ${response.status ?? 'no status'}`);
    }

    return {
      rawText: response.output_text,
      model: response.model,
      usage: {
        inputTokens: response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null,
        cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? null,
      },
    };
  }

  }