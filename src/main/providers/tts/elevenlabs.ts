/**
 * ElevenLabs TTS provider.
 *
 * `POST /v1/text-to-speech/{voice_id}` returns audio (mp3 by default). Voice
 * IDs come from the user's account, so the picker shows a curated list of
 * well-known IDs and we let advanced users paste their own.
 */

import {
  ProviderError,
  TtsProviderId,
  type TtsProvider,
  type TtsRequest,
  type TtsResult,
} from '../../../shared/provider-types.js';
import { getApiKey } from '../secret-keys.js';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';

export class ElevenLabsProvider implements TtsProvider {
  readonly id = TtsProviderId.ElevenLabs;
  readonly displayName = 'ElevenLabs';
  readonly availableModels = ['eleven_multilingual_v2', 'eleven_turbo_v2_5', 'eleven_flash_v2_5'] as const;
  // Default voices — every ElevenLabs account has access to these.
  readonly availableVoices = [
    'JBFqnCBsd6RMkjVDRZzb', // George
    '21m00Tcm4TlvDq8ikWAM', // Rachel
    'EXAVITQu4vr4xnSDxMaL', // Sarah
    'TX3LPaxmHKxFdv7VOQHJ', // Liam
  ] as const;

  constructor(
    private readonly model: string = 'eleven_multilingual_v2',
    private readonly voice: string = 'JBFqnCBsd6RMkjVDRZzb',
  ) {}

  async speak(request: TtsRequest): Promise<TtsResult> {
    const apiKey = getApiKey('tts', this.id);
    if (!apiKey) {
      throw new ProviderError('missing-key', this.id, 'No ElevenLabs API key configured.');
    }
    const voice = request.voice ?? this.voice;
    const body = {
      text: request.text,
      model_id: this.model,
    };

    let response: Response;
    try {
      response = await fetch(`${ELEVENLABS_BASE}/${encodeURIComponent(voice)}`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (err) {
      if (request.signal?.aborted) {
        throw new ProviderError('aborted', this.id, 'Request aborted by caller');
      }
      throw new ProviderError('network', this.id, 'Network error contacting ElevenLabs', {
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

    return {
      audio: new Uint8Array(await response.arrayBuffer()),
      mimeType: 'audio/mpeg',
      voice,
      model: this.model,
    };
  }
}
