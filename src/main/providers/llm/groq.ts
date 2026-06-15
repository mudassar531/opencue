/**
 * Groq LLM provider — OpenAI-compatible chat completions.
 *
 * Reuses the OpenAI base implementation but points at Groq's endpoint and
 * resolves its API key from the Groq-scoped slot.
 */

import { LlmProviderId, type LlmProviderIdValue, type ProviderError } from '../../../shared/provider-types.js';
import { getApiKey } from '../secret-keys.js';
import { OpenAiLlmProvider } from './openai.js';

export class GroqProvider extends OpenAiLlmProvider {
  override readonly id: LlmProviderIdValue = LlmProviderId.Groq;
  override readonly displayName: string = 'Groq';
  override readonly availableModels: readonly string[] = [
    'llama-3.3-70b-versatile',
    'llama-3.1-70b-versatile',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768',
  ];

  constructor(model: string = 'llama-3.3-70b-versatile') {
    super(model, 'https://api.groq.com/openai/v1');
  }

  protected override resolveApiKey(): string | undefined {
    return getApiKey('llm', this.id);
  }

  protected override classifyHttpError(status: number, body: string): ProviderError {
    return super.classifyHttpError(status, body);
  }
}
