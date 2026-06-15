/**
 * Local STT provider — delegates to the Python sidecar.
 *
 * The renderer's PCM segment is forwarded as base64 Float32 over JSON-RPC.
 * The sidecar uses faster-whisper (or, when configured, Parakeet) and
 * returns `{ text, model, latencyMs? }`.
 */

import { Buffer } from 'node:buffer';
import {
  ProviderError,
  SttProviderId,
  type SttProvider,
  type SttRequest,
  type SttResult,
} from '../../../shared/provider-types.js';
import { getModelManager } from '../../models/model-manager.js';
import { sidecarRpc } from '../../sidecar/rpc-client.js';

interface SidecarTranscribeResult {
  text?: string;
  model?: string;
  latency_ms?: number;
  confidence?: number;
}

export class LocalSidecarSttProvider implements SttProvider {
  readonly id = SttProviderId.LocalSidecar;
  readonly displayName = 'Local sidecar (faster-whisper / Parakeet)';
  readonly availableModels = [
    'faster-whisper-tiny.en',
    'faster-whisper-base.en',
    'faster-whisper-small.en',
    'faster-whisper-medium.en',
    'faster-whisper-large-v3',
    'parakeet-tdt-0.6b-v2',
  ] as const;

  constructor(private readonly modelId: string = 'faster-whisper-base.en') {}

  async transcribe(request: SttRequest): Promise<SttResult> {
    const modelDir = await getModelManager().installedPath(this.modelId);
    if (!modelDir) {
      throw new ProviderError(
        'missing-key',
        this.id,
        `Local STT model "${this.modelId}" isn't downloaded yet. Open the Local models panel and download it first.`,
      );
    }
    const samplesBase64 = Buffer.from(
      new Uint8Array(request.samples.buffer, request.samples.byteOffset, request.samples.byteLength),
    ).toString('base64');

    const result = await sidecarRpc<SidecarTranscribeResult>(
      'transcribe',
      {
        model_id: this.modelId,
        model_dir: modelDir,
        sample_rate: request.sampleRate,
        samples_base64: samplesBase64,
        language_hint: request.languageHint ?? null,
      },
      this.id,
    );

    const text = (result.text ?? '').trim();
    const out: SttResult = {
      text,
      model: result.model ?? this.modelId,
    };
    if (typeof result.latency_ms === 'number') out.latencyMs = result.latency_ms;
    if (typeof result.confidence === 'number') out.confidence = result.confidence;
    return out;
  }
}
