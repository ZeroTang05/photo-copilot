import Anthropic from '@anthropic-ai/sdk';
import { planPayloadJsonSchema } from '@photo-copilot/ai-contract';
import type { Provider, ProviderCallInput, ProviderCallResult, ProviderConfig, ProviderKind } from './types.js';
import { ProviderError, PROVIDER_TIMEOUT_MS } from './types.js';

// Anthropic Messages API provider.
//
// Forces the model to call submit_edit_plan via tool_use; the tool's
// input_schema is the JSON Schema derived from PlanPayloadSchema, so the
// model must return arguments matching the contract. The SDK parses the
// arguments automatically into the tool_use.input field as a plain object.
//
// This is the path MiniMax-M3 reportedly handles well (Anthropic-compatible
// protocol). For OpenAI's own models, prefer OpenAIResponsesProvider.

const TOOL_NAME = 'submit_edit_plan';

export class AnthropicMessagesProvider implements Provider {
  readonly name: ProviderKind = 'anthropic';
  private readonly client: Anthropic;
  private readonly cfg: ProviderConfig;

  constructor(cfg: ProviderConfig) {
    this.cfg = cfg;
    this.client = new Anthropic({
      apiKey: cfg.apiKey,
      ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
      maxRetries: 0,
      timeout: PROVIDER_TIMEOUT_MS,
    });
  }

  async call(input: ProviderCallInput, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<ProviderCallResult> {
    let response;
    try {
      response = await this.client.messages.create({
        model: this.cfg.model,
        max_tokens: input.maxOutputTokens ?? 6000,
        system: `你必须通过调用 ${input.toolName ?? TOOL_NAME} 工具返回结果，不输出其他文本。\n\n${input.instructions}`,
        tools: [{
          name: input.toolName ?? TOOL_NAME,
          description: '提交当前工作流阶段的结构化结果。',
          input_schema: (input.outputSchema ?? planPayloadJsonSchema) as Anthropic.Tool.InputSchema,
        }],
        tool_choice: { type: 'tool', name: input.toolName ?? TOOL_NAME },
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: input.userText },
            ...input.images.map((image) => ({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: 'image/jpeg' as const,
                data: image.base64,
              },
            })),
          ],
        }],
      }, { timeout: timeoutMs });
    } catch (error) {
      throw new ProviderError('anthropic request failed', error);
    }

    if (response.stop_reason === 'refusal') {
      throw new ProviderError('model refused the request');
    }

    const toolBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === (input.toolName ?? TOOL_NAME),
    );
    if (!toolBlock) {
      throw new ProviderError(`model did not call ${TOOL_NAME}; stop_reason=${response.stop_reason}`);
    }

    return {
      rawText: JSON.stringify(toolBlock.input),
      structuredInput: toolBlock.input,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedInputTokens: response.usage.cache_read_input_tokens,
      },
    };
  }
}
