/**
 * Provider abstractions for opencue (Phase 3).
 *
 * Each capability (STT, LLM, TTS) has a single small interface. Cloud and
 * local backends implement the same interface so the rest of the app does
 * not know which is in use. The router (`src/main/providers/router.ts`)
 * picks the active backend at runtime from the user's settings.
 *
 * Types here are deliberately small / serializable so they can also be
 * shipped over IPC to the renderer for telemetry and UI.
 */

/* ----------------------------- STT ----------------------------- */

/** Identifiers for every STT provider opencue knows about. */
export const SttProviderId = {
  OpenAIWhisper: 'openai-whisper',
  Deepgram: 'deepgram',
  AssemblyAI: 'assemblyai',
  /** Local Python-sidecar STT — wired in Phase 4. */
  LocalSidecar: 'local-sidecar',
} as const;
export type SttProviderIdValue = (typeof SttProviderId)[keyof typeof SttProviderId];

export interface SttRequest {
  /** Mono 16 kHz Float32 PCM, [-1, 1]. */
  samples: Float32Array;
  sampleRate: number;
  /** Optional BCP-47 hint (e.g., 'en-US'). */
  languageHint?: string;
}

export interface SttResult {
  text: string;
  /** Optional per-word timing — not yet exposed in the UI but kept for future use. */
  words?: { word: string; startSec: number; endSec: number }[];
  /** Provider-reported confidence in [0, 1] if available. */
  confidence?: number;
  /** Model identifier the provider used. */
  model?: string;
  /** Round-trip latency in ms (set by the orchestrator). */
  latencyMs?: number;
}

export interface SttProvider {
  readonly id: SttProviderIdValue;
  /** Human-readable provider name shown in the picker. */
  readonly displayName: string;
  /** Available model identifiers shown in the picker. */
  readonly availableModels: readonly string[];
  /** Transcribe a single speech segment. May throw — orchestrator handles it. */
  transcribe(request: SttRequest): Promise<SttResult>;
}

/* ----------------------------- LLM ----------------------------- */

export const LlmProviderId = {
  OpenAI: 'openai',
  Anthropic: 'anthropic',
  Gemini: 'gemini',
  Groq: 'groq',
  /** Local LLM via Ollama HTTP API — Phase 4. */
  Ollama: 'ollama',
} as const;
export type LlmProviderIdValue = (typeof LlmProviderId)[keyof typeof LlmProviderId];

export type LlmRole = 'system' | 'user' | 'assistant';

/** Optional inline image attachment for multimodal LLMs. */
export interface LlmImageAttachment {
  /** Data URL, e.g. `data:image/png;base64,...`. */
  dataUrl: string;
  /** Optional caption shown to the model alongside the image. */
  caption?: string;
}

export interface LlmMessage {
  role: LlmRole;
  content: string;
  /** Image attachments — only honored on the `user` role by multimodal providers. */
  images?: LlmImageAttachment[];
}

export interface LlmRequest {
  messages: LlmMessage[];
  /** Hard cap on output tokens. Provider may further clamp. */
  maxOutputTokens?: number;
  /** Sampling temperature, [0, 2]. */
  temperature?: number;
  /** Abort signal — wired through to the provider's fetch call where possible. */
  signal?: AbortSignal;
}

/** Token-by-token streaming chunk. */
export interface LlmStreamChunk {
  kind: 'delta';
  text: string;
}

export interface LlmStreamDone {
  kind: 'done';
  /** Full assembled text the orchestrator persists. */
  text: string;
  /** Best-effort token counts from the provider. */
  usage?: { inputTokens?: number; outputTokens?: number };
  model?: string;
}

export type LlmStreamEvent = LlmStreamChunk | LlmStreamDone;

export interface LlmProvider {
  readonly id: LlmProviderIdValue;
  readonly displayName: string;
  readonly availableModels: readonly string[];
  /** Streaming completion; yields delta chunks then a single done event. */
  streamCompletion(request: LlmRequest): AsyncIterable<LlmStreamEvent>;
}

/* ----------------------------- TTS ----------------------------- */

export const TtsProviderId = {
  OpenAI: 'openai',
  ElevenLabs: 'elevenlabs',
  /** Local Piper/Kokoro TTS via the Python sidecar — Phase 4. */
  LocalSidecar: 'local-sidecar',
} as const;
export type TtsProviderIdValue = (typeof TtsProviderId)[keyof typeof TtsProviderId];

export interface TtsRequest {
  text: string;
  voice?: string;
  /** Sampling temperature when supported. */
  temperature?: number;
  signal?: AbortSignal;
}

export interface TtsResult {
  /** Raw audio bytes; format identified by `mimeType`. Renderer plays via HTMLAudioElement. */
  audio: Uint8Array;
  mimeType: string;
  voice?: string;
  model?: string;
}

export interface TtsProvider {
  readonly id: TtsProviderIdValue;
  readonly displayName: string;
  readonly availableModels: readonly string[];
  readonly availableVoices: readonly string[];
  speak(request: TtsRequest): Promise<TtsResult>;
}

/* --------------------------- Settings --------------------------- */

/**
 * The user-selected provider configuration. Keys live in the encrypted
 * secret store keyed by `${kind}.${id}.apiKey`; only the public selection
 * lives in plain settings.
 */
export interface ProviderSelection {
  stt: { id: SttProviderIdValue; model: string };
  llm: { id: LlmProviderIdValue; model: string; temperature: number; maxOutputTokens: number };
  tts: { id: TtsProviderIdValue; model: string; voice: string; autoPlay: boolean };
  /** Localised system prompt the assist loop prepends. */
  assistSystemPrompt: string;
}

export const DEFAULT_ASSIST_SYSTEM_PROMPT =
  'You are an unobtrusive meeting copilot. The user is on a live call; ' +
  'give very short, specific, actionable suggestions. ' +
  'Prefer one or two sentences. Never invent facts about the call.';

export const DEFAULT_PROVIDER_SELECTION: ProviderSelection = {
  stt: { id: SttProviderId.OpenAIWhisper, model: 'whisper-1' },
  llm: {
    id: LlmProviderId.OpenAI,
    model: 'gpt-4o-mini',
    temperature: 0.4,
    maxOutputTokens: 256,
  },
  tts: { id: TtsProviderId.OpenAI, model: 'gpt-4o-mini-tts', voice: 'alloy', autoPlay: false },
  assistSystemPrompt: DEFAULT_ASSIST_SYSTEM_PROMPT,
};

/* --------------------------- Errors --------------------------- */

/** Stable provider-error categorization the UI can react to. */
export type ProviderErrorKind =
  | 'missing-key'
  | 'unauthorized'
  | 'rate-limited'
  | 'timeout'
  | 'unsupported-model'
  | 'network'
  | 'aborted'
  | 'unknown';

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly providerId: string;
  /** HTTP status if the failure came from a fetch call. */
  readonly status?: number;
  constructor(
    kind: ProviderErrorKind,
    providerId: string,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'ProviderError';
    this.kind = kind;
    this.providerId = providerId;
    if (options.status !== undefined) this.status = options.status;
  }
}

/* ---------------- Assist orchestration (Phase 3) ---------------- */

export interface TranscriptEntry {
  /** Monotonic id within the session. */
  id: number;
  /** ms since epoch when the segment started. */
  startedAt: number;
  /** ms since epoch when transcription completed. */
  completedAt: number;
  text: string;
  /** STT provider that produced it. */
  providerId: SttProviderIdValue;
  model?: string;
  latencyMs?: number;
}

export type AssistTriggerSource = 'hotkey' | 'manual' | 'auto';

export interface AssistRequest {
  /** Optional override of the latest user message — defaults to last transcript line(s). */
  prompt?: string;
  triggeredBy: AssistTriggerSource;
}

export type AssistStatus = 'idle' | 'thinking' | 'speaking' | 'error';

export interface AssistSuggestion {
  id: number;
  triggeredAt: number;
  completedAt: number | null;
  text: string;
  /** True while the LLM is still streaming. */
  streaming: boolean;
  providerId: LlmProviderIdValue;
  model?: string;
  ttsAvailable: boolean;
}
