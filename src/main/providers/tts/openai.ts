/**
 * OpenAI TTS provider.
 *
 * Uses `/v1/audio/speech` to synthesize a single utterance and returns the
 * raw audio bytes (default mp3) for the renderer to play through
 * `HTMLAudioElement`.
 */

import {
  ProviderError,
  TtsProviderId,
  type TtsProvider,
  type TtsRequest,
  type TtsResult,
} from '../../../shared/provider-types.js';
import { getApiKey, getSharedOpenAiKey } from '../secret-keys.js';

const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';

export class OpenAiTtsProvider implements TtsProvider {
  readonly id = TtsProviderId.OpenAI;
  readonly displayName = 'OpenAI TTS';
  readonly availableModels = ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'] as const;
  readonly availableVoices = [
    'alloy',
    'ash',
    'ballad',
    'coral',
    'echo',
    'fable',
    'nova',
    'onyx',
    'sage',
    'shimmer',
    'verse',
  ] as const;

  constructor(
    private readonly model: string = 'gpt-4o-mini-tts',
    private readonly voice: string = 'alloy',
  ) {}

  async speak(request: TtsRequest): Promise<TtsResult> {
    const apiKey = getApiKey('tts', this.id) ?? getSharedOpenAiKey();
    if (!apiKey) {
      throw new ProviderError('missing-key', this.id, 'No OpenAI API key configured for TTS.');
    }
    const body: Record<string, unknown> = {
      model: this.model,
      voice: request.voice ?? this.voice,
      input: request.text,
      response_format: 'mp3',
    };

    let response: Response;
    try {
      response = await fetch(OPENAI_TTS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (err) {
      if (request.signal?.aborted) {
        throw new ProviderError('aborted', this.id, 'Request aborted by caller');
      }
      throw new ProviderError('network', this.id, 'Network error contacting OpenAI TTS', {
        cause: err,
      });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (response.status === 401 || response.status === 403) {
        throw new ProviderError(
          'unauthorized',
          this.id,
          `Unauthorized (${response.status}): ${text.slice(0, 200)}`,
          { status: response.status },
        );
      }
      if (response.status === 429) {
        throw new ProviderError('rate-limited', this.id, `Rate limited: ${text.slice(0, 200)}`, {
          status: response.status,
        });
      }
      throw new ProviderError(
        'unknown',
        this.id,
        `HTTP ${response.status}: ${text.slice(0, 200)}`,
        { status: response.status },
      );
    }

    const buffer = await response.arrayBuffer();
    return {
      audio: new Uint8Array(buffer),
      mimeType: 'audio/mpeg',
      voice: request.voice ?? this.voice,
      model: this.model,
    };
  }
}
