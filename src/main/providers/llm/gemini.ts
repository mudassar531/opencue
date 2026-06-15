/**
 * Google Gemini LLM provider — streaming via `streamGenerateContent`.
 *
 * Gemini's REST surface accepts an OpenAI-compatible role list under
 * `contents[]` after a small transform: `assistant` becomes `model`, system
 * prompts collapse into a top-level `systemInstruction`.
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

interface GeminiPart {
  text?: string;
}
interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
}
interface GeminiStreamChunk {
  candidates?: GeminiCandidate[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  modelVersion?: string;
}

export class GeminiProvider implements LlmProvider {
  readonly id = LlmProviderId.Gemini;
  readonly displayName = 'Google Gemini';
  readonly availableModels = [
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
  ] as const;

  constructor(private readonly model: string = 'gemini-2.5-flash') {}

  async *streamCompletion(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    const apiKey = getApiKey('llm', this.id);
    if (!apiKey) {
      throw new ProviderError('missing-key', this.id, 'No Google Gemini API key configured.');
    }

    const { systemInstruction, contents } = transformMessages(request.messages);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxOutputTokens !== undefined
          ? { maxOutputTokens: request.maxOutputTokens }
          : {}),
      },
    };
    if (systemInstruction) body.systemInstruction = systemInstruction;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.model,
    )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
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
      throw new ProviderError('network', this.id, 'Network error contacting Gemini', {
        cause: err,
      });
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      if (response.status === 401 || response.status === 403) {
        throw new ProviderError('unauthorized', this.id, `Unauthorized (${response.status}): ${errBody.slice(0, 200)}`, { status: response.status });
      }
      if (response.status === 429) {
        throw new ProviderError('rate-limited', this.id, `Rate limited: ${errBody.slice(0, 200)}`, { status: response.status });
      }
      throw new ProviderError('unknown', this.id, `HTTP ${response.status}: ${errBody.slice(0, 200)}`, { status: response.status });
    }

    let text = '';
    let model: string | undefined;
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;

    // Gemini's SSE payloads are also `data: { ... }` lines — reuse the OpenAI helper.
    const { readSseLines } = await import('./sse.js');
    for await (const payload of readSseLines(response, request.signal)) {
      if (payload === '[DONE]' || payload.length === 0) continue;
      let chunk: GeminiStreamChunk;
      try {
        chunk = JSON.parse(payload) as GeminiStreamChunk;
      } catch {
        continue;
      }
      if (chunk.modelVersion && !model) model = chunk.modelVersion;
      if (chunk.usageMetadata) {
        usage = {
          ...(typeof chunk.usageMetadata.promptTokenCount === 'number'
            ? { inputTokens: chunk.usageMetadata.promptTokenCount }
            : {}),
          ...(typeof chunk.usageMetadata.candidatesTokenCount === 'number'
            ? { outputTokens: chunk.usageMetadata.candidatesTokenCount }
            : {}),
        };
      }
      for (const candidate of chunk.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if (typeof part.text === 'string' && part.text.length > 0) {
            text += part.text;
            yield { kind: 'delta', text: part.text };
          }
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
}

function transformMessages(messages: LlmMessage[]): {
  systemInstruction: { parts: { text: string }[] } | undefined;
  contents: { role: 'user' | 'model'; parts: { text: string }[] }[];
} {
  const systemParts: string[] = [];
  const contents: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content);
    } else {
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      });
    }
  }
  return {
    systemInstruction:
      systemParts.length > 0 ? { parts: [{ text: systemParts.join('\n\n') }] } : undefined,
    contents,
  };
}
