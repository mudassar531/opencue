/**
 * AssemblyAI STT (file upload).
 *
 * Two-step flow: upload the WAV, then create a transcript referencing the
 * returned upload URL and poll for completion.
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

const UPLOAD_URL = 'https://api.assemblyai.com/v2/upload';
const TRANSCRIPT_URL = 'https://api.assemblyai.com/v2/transcript';
const POLL_INTERVAL_MS = 800;
const TOTAL_TIMEOUT_MS = 60_000;

export class AssemblyAiProvider implements SttProvider {
  readonly id = SttProviderId.AssemblyAI;
  readonly displayName = 'AssemblyAI';
  readonly availableModels = ['best', 'nano'] as const;

  constructor(private readonly model: string = 'best') {}

  async transcribe(request: SttRequest): Promise<SttResult> {
    const apiKey = getApiKey('stt', this.id);
    if (!apiKey) {
      throw new ProviderError('missing-key', this.id, 'No AssemblyAI API key configured.');
    }
    const wav = encodeWavFromFloat32(request.samples, request.sampleRate);

    // 1. Upload audio bytes.
    const upload = await safeFetch(this.id, UPLOAD_URL, {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/octet-stream' },
      body: wav,
    });
    const uploadJson = (await upload.json()) as { upload_url?: string };
    if (!uploadJson.upload_url) {
      throw new ProviderError(
        'unknown',
        this.id,
        'AssemblyAI upload returned no upload_url',
      );
    }

    // 2. Create transcript.
    const create = await safeFetch(this.id, TRANSCRIPT_URL, {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_url: uploadJson.upload_url,
        speech_model: this.model,
        ...(request.languageHint ? { language_code: request.languageHint.split('-')[0] } : {}),
      }),
    });
    const createJson = (await create.json()) as { id?: string };
    if (!createJson.id) {
      throw new ProviderError(
        'unknown',
        this.id,
        'AssemblyAI transcript creation returned no id',
      );
    }

    // 3. Poll until completed / errored.
    const deadline = Date.now() + TOTAL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const poll = await safeFetch(this.id, `${TRANSCRIPT_URL}/${createJson.id}`, {
        method: 'GET',
        headers: { Authorization: apiKey },
      });
      const pollJson = (await poll.json()) as {
        status?: string;
        text?: string;
        error?: string;
        confidence?: number;
      };
      if (pollJson.status === 'completed') {
        const result: SttResult = {
          text: (pollJson.text ?? '').trim(),
          model: this.model,
        };
        if (typeof pollJson.confidence === 'number') {
          result.confidence = pollJson.confidence;
        }
        return result;
      }
      if (pollJson.status === 'error') {
        throw new ProviderError(
          'unknown',
          this.id,
          `AssemblyAI transcript failed: ${pollJson.error ?? 'unknown'}`,
        );
      }
      await sleep(POLL_INTERVAL_MS);
    }
    throw new ProviderError('timeout', this.id, `AssemblyAI transcript did not complete within ${TOTAL_TIMEOUT_MS}ms`);
  }
}

async function safeFetch(
  providerId: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    throw new ProviderError('network', providerId, `Network error contacting ${url}`, {
      cause: err,
    });
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError('unauthorized', providerId, `Unauthorized (${response.status})`, {
        status: response.status,
      });
    }
    if (response.status === 429) {
      throw new ProviderError('rate-limited', providerId, `Rate limited`, {
        status: response.status,
      });
    }
    throw new ProviderError('unknown', providerId, `HTTP ${response.status}: ${body.slice(0, 200)}`, {
      status: response.status,
    });
  }
  return response;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
