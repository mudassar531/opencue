/**
 * Anthropic Messages LLM provider — streaming.
 *
 * Anthropic's SSE schema differs from OpenAI's: each event has a `type`
 * (`message_start`, `content_block_delta`, `message_delta`, `message_stop`),
 * and content deltas are nested under `delta.text` for text blocks.
 */

import {
  LlmProviderId,
  ProviderError,
  type LlmMessage,
  type LlmProvider,
  type LlmRequest,
  type LlmStreamEvent,
} from '../../../shared/provider-types.js';
import { getApiKey } from '../secret-keys.js';
import { readSseLines } from './sse.js';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';

interface AnthropicTextDelta {
  type: 'text_delta';
  text: string;
}
interface AnthropicEvent {
  type: string;
  delta?: AnthropicTextDelta | { stop_reason?: string };
  message?: { model?: string; usage?: { input_tokens?: number; output_tokens?: number } };
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class AnthropicProvider implements LlmProvider {
  readonly id = LlmProviderId.Anthropic;
  readonly displayName = 'Anthropic';
  readonly availableModels = [
    'claude-3-5-sonnet-latest',
    'claude-3-5-haiku-latest',
    'claude-3-opus-latest',
  ] as const;

  constructor(private readonly model: string = 'claude-3-5-haiku-latest') {}

  async *streamCompletion(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    const apiKey = getApiKey('llm', this.id);
    if (!apiKey) {
      throw new ProviderError('missing-key', this.id, 'No Anthropic API key configured.');
    }
    const { system, messages } = splitSystem(request.messages);

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: request.maxOutputTokens ?? 1024,
      stream: true,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (system) body.system = system;
    if (request.temperature !== undefined) body.temperature = request.temperature;

    let response: Response;
    try {
      response = await fetch(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (err) {
      if (request.signal?.aborted) {
        throw new ProviderError('aborted', this.id, 'Request aborted by caller');
      }
      throw new ProviderError('network', this.id, 'Network error contacting Anthropic', {
        cause: err,
      });
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (response.status === 401 || response.status === 403) {
        throw new ProviderError('unauthorized', this.id, `Unauthorized (${response.status}): ${body.slice(0, 200)}`, { status: response.status });
      }
      if (response.status === 429) {
        throw new ProviderError('rate-limited', this.id, `Rate limited: ${body.slice(0, 200)}`, { status: response.status });
      }
      throw new ProviderError('unknown', this.id, `HTTP ${response.status}: ${body.slice(0, 200)}`, { status: response.status });
    }

    let text = '';
    let model: string | undefined;
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;

    for await (const payload of readSseLines(response, request.signal)) {
      if (payload === '[DONE]' || payload.length === 0) continue;
      let event: AnthropicEvent;
      try {
        event = JSON.parse(payload) as AnthropicEvent;
      } catch {
        continue;
      }
      if (event.type === 'message_start' && event.message?.model && !model) {
        model = event.message.model;
      }
      if (
        event.type === 'content_block_delta' &&
        event.delta &&
        'type' in event.delta &&
        event.delta.type === 'text_delta'
      ) {
        const piece = event.delta.text;
        text += piece;
        yield { kind: 'delta', text: piece };
      }
      if (event.type === 'message_delta' && event.usage) {
        usage = {
          ...(typeof event.usage.input_tokens === 'number'
            ? { inputTokens: event.usage.input_tokens }
            : {}),
          ...(typeof event.usage.output_tokens === 'number'
            ? { outputTokens: event.usage.output_tokens }
            : {}),
        };
      }
      if (event.type === 'message_stop') break;
    }

    yield {
      kind: 'done',
      text,
      ...(usage ? { usage } : {}),
      ...(model ? { model } : { model: this.model }),
    };
  }
}

function splitSystem(messages: LlmMessage[]): {
  system: string | undefined;
  messages: LlmMessage[];
} {
  const systemParts: string[] = [];
  const rest: LlmMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') systemParts.push(m.content);
    else rest.push(m);
  }
  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    messages: rest,
  };
}
