import Anthropic from '@anthropic-ai/sdk';
import { planPayloadJsonSchema } from '@photo-copilot/ai-contract';
import type { Provider, ProviderCallInput, ProviderCallResult, ProviderConfig, ProviderKind } from './types.js';
import { ProviderError } from './types.js';

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

// Tool-specific prefix added to the generic system instructions. Tells the
// model to return its plan exclusively by calling submit_edit_plan.
const TOOL_SYSTEM_PREFIX = '你必须通过调用 submit_edit_plan 工具返回编辑计划,不要输出任何其他文本。';

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
      timeout: 30000,
    });
  }

  async call(input: ProviderCallInput): Promise<ProviderCallResult> {
    let response;
    try {
      response = await this.client.messages.create({
        model: this.cfg.model,
        max_tokens: 6000,
        system: `${TOOL_SYSTEM_PREFIX}\n\n${input.instructions}`,
        tools: [{
          name: TOOL_NAME,
          description: '提交照片编辑的候选计划。input_schema 已定义所有字段与约束。',
          input_schema: planPayloadJsonSchema as Anthropic.Tool.InputSchema,
        }],
        tool_choice: { type: 'tool', name: TOOL_NAME },
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
      });
    } catch (error) {
      throw new ProviderError('anthropic request failed', error);
    }

    if (response.stop_reason === 'refusal') {
      throw new ProviderError('model refused the request');
    }

    const toolBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === TOOL_NAME,
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
