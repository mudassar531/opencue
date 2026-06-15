/**
 * OpenAI Whisper STT provider.
 *
 * Uses the file-upload `/v1/audio/transcriptions` endpoint with a WAV-encoded
 * speech segment. Streaming Whisper isn't exposed by the public API, so we
 * call it once per VAD-emitted segment — which matches opencue's "transcribe
 * after silence" pacing.
 */

import {
  ProviderError,
  SttProviderId,
  type SttProvider,
  type SttRequest,
  type SttResult,
} from '../../../shared/provider-types.js';
import { getApiKey, getSharedOpenAiKey } from '../secret-keys.js';
import { encodeWavFromFloat32 } from '../wav.js';

const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';
const DEFAULT_MODEL = 'whisper-1';
const REQUEST_TIMEOUT_MS = 30_000;

export class OpenAiWhisperProvider implements SttProvider {
  readonly id = SttProviderId.OpenAIWhisper;
  readonly displayName = 'OpenAI Whisper';
  readonly availableModels = ['whisper-1', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe'] as const;

  constructor(private readonly model: string = DEFAULT_MODEL) {}

  async transcribe(request: SttRequest): Promise<SttResult> {
    const apiKey = getApiKey('stt', this.id) ?? getSharedOpenAiKey();
    if (!apiKey) {
      throw new ProviderError('missing-key', this.id, 'No OpenAI API key configured for STT.');
    }

    const wav = encodeWavFromFloat32(request.samples, request.sampleRate);
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'segment.wav');
    form.append('model', this.model);
    form.append('response_format', 'json');
    if (request.languageHint) {
      // OpenAI expects a primary language code only (e.g., 'en' from 'en-US').
      const lang = request.languageHint.split('-')[0];
      if (lang) form.append('language', lang);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new ProviderError('timeout', this.id, `Request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      }
      throw new ProviderError('network', this.id, 'Network error contacting OpenAI', { cause: err });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw classifyOpenAiError(this.id, response.status, await safeText(response));
    }

    const json = (await response.json()) as { text?: string };
    return {
      text: typeof json.text === 'string' ? json.text.trim() : '',
      model: this.model,
    };
  }
}

export function classifyOpenAiError(
  providerId: string,
  status: number,
  body: string,
): ProviderError {
  const summary = body.slice(0, 240);
  if (status === 401 || status === 403) {
    return new ProviderError('unauthorized', providerId, `Unauthorized (${status}): ${summary}`, {
      status,
    });
  }
  if (status === 429) {
    return new ProviderError('rate-limited', providerId, `Rate limited: ${summary}`, { status });
  }
  if (status === 400 && /model/i.test(body)) {
    return new ProviderError('unsupported-model', providerId, `Unsupported model: ${summary}`, {
      status,
    });
  }
  return new ProviderError('unknown', providerId, `HTTP ${status}: ${summary}`, { status });
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
