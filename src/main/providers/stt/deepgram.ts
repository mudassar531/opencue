/**
 * Deepgram STT — batch (file upload) mode.
 *
 * We use the prerecorded endpoint with a WAV payload to keep the integration
 * symmetrical with the other STT providers. Streaming Deepgram is a future
 * iteration; in segment-based use (VAD chops at silence) the latency is
 * comparable for short turns.
 */

import {
  ProviderError,
  SttProviderId,
  type SttProvider,
  type SttRequest,
  type SttResult,
} from '../../../shared/provider-types.js';
import { getApiKey } from '../secret-keys.js';
import { encodeWavFromFloat32 } from '../wav.js';

const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen';
const REQUEST_TIMEOUT_MS = 30_000;

interface DeepgramAlternative {
  transcript?: string;
  confidence?: number;
}

interface DeepgramResponse {
  results?: {
    channels?: Array<{ alternatives?: DeepgramAlternative[] }>;
  };
  metadata?: { model_info?: { name?: string } };
}

export class DeepgramProvider implements SttProvider {
  readonly id = SttProviderId.Deepgram;
  readonly displayName = 'Deepgram';
  readonly availableModels = ['nova-3', 'nova-2', 'nova-2-meeting', 'nova-2-phonecall'] as const;

  constructor(private readonly model: string = 'nova-3') {}

  async transcribe(request: SttRequest): Promise<SttResult> {
    const apiKey = getApiKey('stt', this.id);
    if (!apiKey) {
      throw new ProviderError('missing-key', this.id, 'No Deepgram API key configured.');
    }
    const wav = encodeWavFromFloat32(request.samples, request.sampleRate);
    const params = new URLSearchParams({
      model: this.model,
      smart_format: 'true',
      punctuate: 'true',
    });
    if (request.languageHint) {
      params.set('language', request.languageHint);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${DEEPGRAM_URL}?${params.toString()}`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': 'audio/wav',
        },
        body: wav,
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new ProviderError('timeout', this.id, `Request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      }
      throw new ProviderError('network', this.id, 'Network error contacting Deepgram', {
        cause: err,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await safeText(response);
      if (response.status === 401 || response.status === 403) {
        throw new ProviderError('unauthorized', this.id, `Unauthorized (${response.status}): ${body}`, {
          status: response.status,
        });
      }
      if (response.status === 429) {
        throw new ProviderError('rate-limited', this.id, `Rate limited: ${body}`, {
          status: response.status,
        });
      }
      throw new ProviderError('unknown', this.id, `HTTP ${response.status}: ${body}`, {
        status: response.status,
      });
    }

    const json = (await response.json()) as DeepgramResponse;
    const alt = json.results?.channels?.[0]?.alternatives?.[0];
    const result: SttResult = {
      text: typeof alt?.transcript === 'string' ? alt.transcript.trim() : '',
      model: json.metadata?.model_info?.name ?? this.model,
    };
    if (typeof alt?.confidence === 'number') {
      result.confidence = alt.confidence;
    }
    return result;
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
