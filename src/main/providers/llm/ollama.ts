/**
 * Ollama LLM provider — local HTTP at `http://127.0.0.1:11434`.
 *
 * Uses Ollama's native `/api/chat` streaming endpoint (NDJSON, one JSON
 * object per line) rather than the OpenAI-compatible shim so we get the
 * accurate `model` echo and `eval_count` token totals.
 *
 * `availableModels` is intentionally left empty — the renderer fetches it
 * dynamically via `/api/tags` because Ollama users have their own model
 * inventory. Until that surface lands, the user types the model id by hand.
 */

import {
  LlmProviderId,
  ProviderError,
  type LlmProvider,
  type LlmRequest,
  type LlmStreamEvent,
} from '../../../shared/provider-types.js';

const DEFAULT_BASE_URL = process.env.OPENCUE_OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';

interface OllamaChatChunk {
  model?: string;
  message?: { role?: string; content?: string };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements LlmProvider {
  readonly id = LlmProviderId.Ollama;
  readonly displayName = 'Ollama (local)';
  readonly availableModels = [
    'llama3.2',
    'llama3.1',
    'qwen2.5',
    'mistral',
    'phi3.5',
  ] as const;

  constructor(
    private readonly model: string = 'llama3.2',
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  /** Probe `/api/tags` so the renderer knows whether Ollama is installed. */
  static async listInstalled(baseUrl: string = DEFAULT_BASE_URL): Promise<string[]> {
    try {
      const response = await fetch(`${baseUrl}/api/tags`, { method: 'GET' });
      if (!response.ok) return [];
      const json = (await response.json()) as { models?: Array<{ name?: string }> };
      return (json.models ?? []).flatMap((m) => (typeof m.name === 'string' ? [m.name] : []));
    } catch {
      return [];
    }
  }

  async *streamCompletion(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    const body = {
      model: this.model,
      messages: request.messages,
      stream: true,
      ...(request.temperature !== undefined || request.maxOutputTokens !== undefined
        ? {
            options: {
              ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
              ...(request.maxOutputTokens !== undefined
                ? { num_predict: request.maxOutputTokens }
                : {}),
            },
          }
        : {}),
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (err) {
      if (request.signal?.aborted) {
        throw new ProviderError('aborted', this.id, 'Request aborted by caller');
      }
      throw new ProviderError(
        'network',
        this.id,
        `Couldn't reach Ollama at ${this.baseUrl}. Is the service running?`,
        { cause: err },
      );
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ProviderError(
        'unknown',
        this.id,
        `Ollama HTTP ${response.status}: ${text.slice(0, 200)}`,
        { status: response.status },
      );
    }
    if (!response.body) {
      throw new ProviderError('unknown', this.id, 'Ollama returned an empty body.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let text = '';
    let model: string | undefined;
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line.length > 0) {
            let chunk: OllamaChatChunk;
            try {
              chunk = JSON.parse(line) as OllamaChatChunk;
            } catch {
              continue;
            }
            if (chunk.model && !model) model = chunk.model;
            const piece = chunk.message?.content;
            if (typeof piece === 'string' && piece.length > 0) {
              text += piece;
              yield { kind: 'delta', text: piece };
            }
            if (chunk.done) {
              usage = {
                ...(typeof chunk.prompt_eval_count === 'number'
                  ? { inputTokens: chunk.prompt_eval_count }
                  : {}),
                ...(typeof chunk.eval_count === 'number'
                  ? { outputTokens: chunk.eval_count }
                  : {}),
              };
            }
          }
          newlineIndex = buffer.indexOf('\n');
        }
      }
    } finally {
      try {
        void reader.cancel();
      } catch {
        /* ignore */
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
