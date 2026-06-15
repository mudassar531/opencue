/**
 * OpenAI Chat Completions LLM provider — streaming.
 *
 * Targets the publicly-documented `/v1/chat/completions` endpoint with
 * `stream: true`. Designed to also work with API-compatible third parties
 * (Groq, Together, etc.) by passing a different `baseUrl` to the subclass.
 */

import {
  LlmProviderId,
  type LlmProviderIdValue,
  ProviderError,
  type LlmProvider,
  type LlmRequest,
  type LlmStreamEvent,
} from '../../../shared/provider-types.js';
import { getApiKey, getSharedOpenAiKey } from '../secret-keys.js';
import { readSseLines } from './sse.js';

interface OpenAiDeltaChoice {
  delta?: { content?: string };
  finish_reason?: string;
}

interface OpenAiStreamPayload {
  choices?: OpenAiDeltaChoice[];
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAiLlmProvider implements LlmProvider {
  readonly id: LlmProviderIdValue = LlmProviderId.OpenAI;
  readonly displayName: string = 'OpenAI';
  readonly availableModels: readonly string[] = [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4.1',
    'gpt-4.1-mini',
    'o4-mini',
  ];

  protected readonly baseUrl: string;
  protected readonly model: string;

  constructor(model: string = 'gpt-4o-mini', baseUrl: string = 'https://api.openai.com/v1') {
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async *streamCompletion(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new ProviderError('missing-key', this.id, 'No OpenAI API key configured for LLM.');
    }
    const body: Record<string, unknown> = {
      model: this.model,
      messages: request.messages.map(transformOpenAiMessage),
      stream: true,
    };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxOutputTokens !== undefined) body.max_completion_tokens = request.maxOutputTokens;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
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
      throw new ProviderError('network', this.id, 'Network error contacting LLM endpoint', {
        cause: err,
      });
    }

    if (!response.ok) {
      throw this.classifyHttpError(response.status, await safeText(response));
    }

    let text = '';
    let model: string | undefined;
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;

    for await (const payload of readSseLines(response, request.signal)) {
      if (payload === '[DONE]') break;
      let json: OpenAiStreamPayload;
      try {
        json = JSON.parse(payload) as OpenAiStreamPayload;
      } catch {
        continue;
      }
      if (json.model && !model) model = json.model;
      if (json.usage) {
        usage = {
          ...(typeof json.usage.prompt_tokens === 'number'
            ? { inputTokens: json.usage.prompt_tokens }
            : {}),
          ...(typeof json.usage.completion_tokens === 'number'
            ? { outputTokens: json.usage.completion_tokens }
            : {}),
        };
      }
      for (const choice of json.choices ?? []) {
        const delta = choice.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          text += delta;
          yield { kind: 'delta', text: delta };
        }
      }
    }

    yield {
      kind: 'done',
      text,
      ...(usage ? { usage } : {}),
      ...(model ? { model } : { model: this.model }),
    };
  }

  protected resolveApiKey(): string | undefined {
    return getApiKey('llm', this.id) ?? getSharedOpenAiKey();
  }

  protected classifyHttpError(status: number, body: string): ProviderError {
    const summary = body.slice(0, 240);
    if (status === 401 || status === 403) {
      return new ProviderError('unauthorized', this.id, `Unauthorized (${status}): ${summary}`, {
        status,
      });
    }
    if (status === 429) {
      return new ProviderError('rate-limited', this.id, `Rate limited: ${summary}`, { status });
    }
    if (status === 400 && /model/i.test(body)) {
      return new ProviderError('unsupported-model', this.id, `Unsupported model: ${summary}`, {
        status,
      });
    }
    return new ProviderError('unknown', this.id, `HTTP ${status}: ${summary}`, { status });
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/**
 * Convert opencue's typed LlmMessage into the OpenAI Chat Completions
 * payload. When the message has images we emit the array-of-parts content
 * form that vision-capable models (gpt-4o, gpt-4o-mini, gpt-4.1) consume.
 */
export function transformOpenAiMessage(message: {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: { dataUrl: string; caption?: string }[];
}): { role: 'system' | 'user' | 'assistant'; content: string | unknown[] } {
  if (!message.images || message.images.length === 0) {
    return { role: message.role, content: message.content };
  }
  const parts: unknown[] = [{ type: 'text', text: message.content }];
  for (const image of message.images) {
    if (image.caption) parts.push({ type: 'text', text: image.caption });
    parts.push({ type: 'image_url', image_url: { url: image.dataUrl } });
  }
  return { role: message.role, content: parts };
}
