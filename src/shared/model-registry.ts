/**
 * Curated registry of locally-runnable models for opencue (Phase 4).
 *
 * Every model is a fully-described downloadable artifact: id, kind, size,
 * URL, optional sha256 checksum, and the runtime that consumes it
 * (`faster-whisper`, `piper`, `kokoro`, …). The model manager downloads
 * these into the app's user-data directory, verifies the hash when one
 * is provided, and tells the sidecar where to load them from.
 *
 * The registry deliberately lives in `src/shared/` so the renderer
 * (settings UI) can render the catalog without going through the
 * provider router.
 */

export type ModelKind = 'stt' | 'tts';

export type ModelRuntime =
  | 'faster-whisper'
  | 'parakeet'
  | 'piper'
  | 'kokoro'
  | 'silero-vad';

/** Approximate disk footprint label for the picker. */
export interface ModelSizeHint {
  bytes: number;
  /** Human-readable size, e.g. '142 MB'. Pre-computed so the renderer
   *  doesn't depend on Intl.NumberFormat behavior. */
  label: string;
}

export interface DownloadableFile {
  /** Stable name used as the on-disk filename. */
  name: string;
  url: string;
  /** Optional hex-encoded SHA-256 for integrity verification. */
  sha256?: string;
  bytes?: number;
}

export interface ModelDefinition {
  /** Stable identifier — also used as the on-disk directory name. */
  id: string;
  kind: ModelKind;
  runtime: ModelRuntime;
  /** Human-readable label rendered in the settings UI. */
  displayName: string;
  /** One-paragraph description shown next to the picker. */
  description: string;
  /** Approximate download size. */
  size: ModelSizeHint;
  /** Curated language tag list — '*' for multilingual. */
  languages: readonly string[];
  /** Optional hardware hint, surfaced in the UI. */
  hardware?: 'cpu' | 'cpu-or-gpu' | 'gpu-recommended';
  /** One or more files to fetch. The first file's name is what the runtime loads. */
  files: readonly DownloadableFile[];
  /** Sidecar-specific kwargs forwarded with the `loadModel` call. */
  runtimeOptions?: Record<string, string | number | boolean>;
}

/* ---------------- faster-whisper sizes (STT) ----------------
 *
 * URLs target the official CTranslate2 conversions on Hugging Face under
 * the Systran namespace, which is what faster-whisper recommends.
 * Approximate sizes mirror the upstream READMEs; the model manager
 * uses the Content-Length header at download time for accurate progress.
 */

function whisper(
  id: string,
  displayName: string,
  description: string,
  approxBytes: number,
): ModelDefinition {
  const repo = `Systran/faster-whisper-${id}`;
  const base = `https://huggingface.co/${repo}/resolve/main`;
  return {
    id: `faster-whisper-${id}`,
    kind: 'stt',
    runtime: 'faster-whisper',
    displayName: `faster-whisper ${displayName}`,
    description,
    size: { bytes: approxBytes, label: humanBytes(approxBytes) },
    languages: ['*'],
    hardware: 'cpu-or-gpu',
    files: [
      { name: 'model.bin', url: `${base}/model.bin`, bytes: approxBytes },
      { name: 'config.json', url: `${base}/config.json` },
      { name: 'tokenizer.json', url: `${base}/tokenizer.json` },
      { name: 'vocabulary.txt', url: `${base}/vocabulary.txt` },
      { name: 'preprocessor_config.json', url: `${base}/preprocessor_config.json` },
    ],
    runtimeOptions: { model_dir: id },
  };
}

/* ---------------- Piper voices (TTS) ----------------
 *
 * Piper voices are tiny single-file .onnx + .json bundles. We curate a
 * couple of high-quality English voices; users can request additions.
 */

function piper(
  id: string,
  displayName: string,
  bytes: number,
  voiceUrl: string,
  configUrl: string,
): ModelDefinition {
  return {
    id: `piper-${id}`,
    kind: 'tts',
    runtime: 'piper',
    displayName: `Piper · ${displayName}`,
    description: 'Local English voice from rhasspy/piper.',
    size: { bytes, label: humanBytes(bytes) },
    languages: ['en-US', 'en-GB'],
    hardware: 'cpu',
    files: [
      { name: 'voice.onnx', url: voiceUrl, bytes },
      { name: 'voice.onnx.json', url: configUrl },
    ],
    runtimeOptions: { voice_file: 'voice.onnx', config_file: 'voice.onnx.json' },
  };
}

/* ---------------- Kokoro (TTS) ---------------- */

function kokoro(): ModelDefinition {
  const repo = 'hexgrad/Kokoro-82M';
  const base = `https://huggingface.co/${repo}/resolve/main`;
  const approxBytes = 327_000_000; // ~327 MB combined
  return {
    id: 'kokoro-v0_19',
    kind: 'tts',
    runtime: 'kokoro',
    displayName: 'Kokoro · 82M (multilingual)',
    description:
      'High-quality multilingual TTS (~82M params). Heavier than Piper but more expressive.',
    size: { bytes: approxBytes, label: humanBytes(approxBytes) },
    languages: ['en-US', 'ja-JP', 'ko-KR', 'zh-CN'],
    hardware: 'cpu-or-gpu',
    files: [
      { name: 'kokoro-v0_19.onnx', url: `${base}/kokoro-v0_19.onnx`, bytes: approxBytes },
      { name: 'voices.bin', url: `${base}/voices.bin` },
    ],
  };
}

/* ---------------- Parakeet (STT, NVIDIA) ----------------
 *
 * Parakeet is the NVIDIA ASR family — Phase-4 surfaces it in the registry
 * so users on supported hardware can download it; the sidecar runtime
 * adapter is a TODO that returns a clear error until implemented (the
 * `parakeet` runtime label gates that). It does NOT live under TTS.
 */

function parakeetRnntCtc(): ModelDefinition {
  const repo = 'nvidia/parakeet-tdt-0.6b-v2';
  const base = `https://huggingface.co/${repo}/resolve/main`;
  const approxBytes = 626_000_000;
  return {
    id: 'parakeet-tdt-0.6b-v2',
    kind: 'stt',
    runtime: 'parakeet',
    displayName: 'NVIDIA Parakeet · TDT 0.6B v2',
    description:
      'NVIDIA Parakeet TDT speech recognizer. CUDA-capable GPU strongly recommended; CPU inference is slow.',
    size: { bytes: approxBytes, label: humanBytes(approxBytes) },
    languages: ['en-US'],
    hardware: 'gpu-recommended',
    files: [
      { name: 'parakeet-tdt-0.6b-v2.nemo', url: `${base}/parakeet-tdt-0.6b-v2.nemo`, bytes: approxBytes },
    ],
  };
}

/* ---------------- Registry ---------------- */

export const MODEL_REGISTRY: readonly ModelDefinition[] = [
  whisper('tiny.en', 'tiny.en', 'English-only, smallest faster-whisper checkpoint.', 75_000_000),
  whisper(
    'base.en',
    'base.en',
    'English-only base checkpoint. Decent baseline for short meeting turns.',
    142_000_000,
  ),
  whisper(
    'small.en',
    'small.en',
    'English-only small checkpoint. Recommended starting point on a modern CPU.',
    470_000_000,
  ),
  whisper(
    'medium.en',
    'medium.en',
    'English-only medium. Significantly better than small but ~1.5 GB on disk.',
    1_500_000_000,
  ),
  whisper(
    'large-v3',
    'large-v3',
    'Multilingual large-v3. GPU recommended for usable latency.',
    3_000_000_000,
  ),
  parakeetRnntCtc(),
  piper(
    'en_US-amy-medium',
    'Amy (en-US, medium)',
    63_000_000,
    'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx',
    'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json',
  ),
  piper(
    'en_GB-alan-medium',
    'Alan (en-GB, medium)',
    63_000_000,
    'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx',
    'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json',
  ),
  kokoro(),
];

/** Convenience selectors used by the renderer. */
export function modelsByKind(kind: ModelKind): readonly ModelDefinition[] {
  return MODEL_REGISTRY.filter((m) => m.kind === kind);
}

export function findModel(id: string): ModelDefinition | undefined {
  return MODEL_REGISTRY.find((m) => m.id === id);
}

/** Lifecycle states surfaced over IPC. */
export type ModelStatus =
  | { state: 'absent' }
  | { state: 'downloading'; receivedBytes: number; totalBytes: number; bytesPerSec: number; etaSec: number | null }
  | { state: 'verifying' }
  | { state: 'installed'; totalBytes: number; installedAt: number }
  | { state: 'failed'; message: string };

export interface ModelStatusEntry {
  id: string;
  status: ModelStatus;
}

export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`;
}
