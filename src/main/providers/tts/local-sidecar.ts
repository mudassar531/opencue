/**
 * Local TTS provider — delegates to the Python sidecar (Piper / Kokoro).
 *
 * The sidecar returns base64-encoded WAV audio. We unpack it and hand back
 * the raw bytes so the renderer plays them via `HTMLAudioElement`.
 */

import { Buffer } from 'node:buffer';
import {
  ProviderError,
  TtsProviderId,
  type TtsProvider,
  type TtsRequest,
  type TtsResult,
} from '../../../shared/provider-types.js';
import { getModelManager } from '../../models/model-manager.js';
import { sidecarRpc } from '../../sidecar/rpc-client.js';

interface SidecarSpeakResult {
  audio_base64?: string;
  mime_type?: string;
  voice?: string;
  model?: string;
}

export class LocalSidecarTtsProvider implements TtsProvider {
  readonly id = TtsProviderId.LocalSidecar;
  readonly displayName = 'Local sidecar (Piper / Kokoro)';
  readonly availableModels = [
    'piper-en_US-amy-medium',
    'piper-en_GB-alan-medium',
    'kokoro-v0_19',
  ] as const;
  readonly availableVoices = ['default'] as const;

  constructor(
    private readonly modelId: string = 'piper-en_US-amy-medium',
    private readonly voice: string = 'default',
  ) {}

  async speak(request: TtsRequest): Promise<TtsResult> {
    const modelDir = await getModelManager().installedPath(this.modelId);
    if (!modelDir) {
      throw new ProviderError(
        'missing-key',
        this.id,
        `Local TTS model "${this.modelId}" isn't downloaded yet. Open the Local models panel and download it first.`,
      );
    }
    const result = await sidecarRpc<SidecarSpeakResult>(
      'synthesize',
      {
        model_id: this.modelId,
        model_dir: modelDir,
        text: request.text,
        voice: request.voice ?? this.voice,
      },
      this.id,
      request.signal ? { signal: request.signal } : {},
    );
    if (!result.audio_base64) {
      throw new ProviderError('unknown', this.id, 'Sidecar returned no audio.');
    }
    return {
      audio: new Uint8Array(Buffer.from(result.audio_base64, 'base64')),
      mimeType: result.mime_type ?? 'audio/wav',
      voice: result.voice ?? this.voice,
      model: result.model ?? this.modelId,
    };
  }
}
