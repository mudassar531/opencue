/**
 * Assist orchestrator (Phase 3).
 *
 * Tracks the live transcript and recent assist suggestions; coordinates an
 * Assist request from the renderer (or from a hotkey) by:
 *
 *   1. Building the prompt from the transcript buffer + user input.
 *   2. Streaming the active LLM provider's response, emitting `delta` updates.
 *   3. Optionally invoking TTS on the final text.
 *
 * The orchestrator owns no audio — segments arrive via `submitSegmentAudio`
 * which the IPC layer calls when the renderer ships a finalized VAD segment.
 * Both the audio bytes (for STT) and the segment metadata (for UI) are
 * provided. Raw audio is not retained after transcription.
 */

import { EventEmitter } from 'node:events';
import {
  type AssistStatus,
  type AssistSuggestion,
  type LlmMessage,
  ProviderError,
  type TranscriptEntry,
} from '../../shared/provider-types.js';
import { getProviderRouter } from '../providers/router.js';
import { getSettingsStore } from '../settings/store.js';
import { DEFAULT_ASSIST_PROMPT, DEFAULT_RECAP_PROMPT, TranscriptBuffer } from './transcript-buffer.js';

export interface SubmitSegmentArgs {
  segmentId: number;
  startedAt: number;
  samples: Float32Array;
  sampleRate: number;
  languageHint?: string;
}

export interface AssistRunArgs {
  /** User-supplied prompt or null to use the default 'what should I say' question. */
  prompt?: string;
  /** When true we use the recap prompt instead. */
  isRecap?: boolean;
  triggeredBy: 'hotkey' | 'manual' | 'auto';
}

export type AssistOrchestratorEvent =
  | { type: 'status-changed'; status: AssistStatus; error: string | null }
  | { type: 'transcript-entry'; entry: TranscriptEntry }
  | { type: 'transcript-error'; message: string; segmentId: number }
  | { type: 'suggestion-started'; suggestion: AssistSuggestion }
  | { type: 'suggestion-delta'; suggestionId: number; delta: string; textSoFar: string }
  | { type: 'suggestion-completed'; suggestion: AssistSuggestion }
  | { type: 'suggestion-error'; suggestionId: number; message: string }
  | { type: 'tts-audio'; suggestionId: number; mimeType: string; audio: Uint8Array }
  | { type: 'reset' };

export class AssistOrchestrator extends EventEmitter {
  private readonly buffer = new TranscriptBuffer();
  private status: AssistStatus = 'idle';
  private lastError: string | null = null;
  private transcriptCounter = 0;
  private suggestionCounter = 0;
  private suggestions: AssistSuggestion[] = [];
  private currentAbort: AbortController | null = null;

  getStatus(): AssistStatus {
    return this.status;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  getTranscript(): readonly TranscriptEntry[] {
    return this.buffer.list();
  }

  getSuggestions(): readonly AssistSuggestion[] {
    return this.suggestions;
  }

  reset(): void {
    this.buffer.clear();
    this.suggestions = [];
    this.transcriptCounter = 0;
    this.suggestionCounter = 0;
    this.lastError = null;
    this.setStatus('idle');
    this.emit('event', { type: 'reset' } satisfies AssistOrchestratorEvent);
  }

  /**
   * Transcribe a segment with the currently-selected STT provider and append
   * the result to the transcript buffer. Errors are surfaced via the event
   * stream but do not change orchestrator status (transcription failures
   * shouldn't block subsequent Assist calls).
   */
  async submitSegmentAudio(args: SubmitSegmentArgs): Promise<TranscriptEntry | null> {
    const provider = getProviderRouter().getSttProvider();
    const startedAt = args.startedAt;
    const requestStart = Date.now();
    try {
      const result = await provider.transcribe({
        samples: args.samples,
        sampleRate: args.sampleRate,
        ...(args.languageHint ? { languageHint: args.languageHint } : {}),
      });
      const text = (result.text ?? '').trim();
      if (text.length === 0) return null;
      this.transcriptCounter += 1;
      const entry: TranscriptEntry = {
        id: this.transcriptCounter,
        startedAt,
        completedAt: Date.now(),
        text,
        providerId: provider.id,
        ...(result.model ? { model: result.model } : {}),
        latencyMs: Date.now() - requestStart,
      };
      this.buffer.add(entry);
      this.emit('event', { type: 'transcript-entry', entry } satisfies AssistOrchestratorEvent);
      return entry;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit('event', {
        type: 'transcript-error',
        message,
        segmentId: args.segmentId,
      } satisfies AssistOrchestratorEvent);
      return null;
    }
  }

  /** Run a full Assist cycle. Concurrent calls cancel the previous one. */
  async runAssist(args: AssistRunArgs): Promise<AssistSuggestion | null> {
    this.cancelInFlight();
    const abort = new AbortController();
    this.currentAbort = abort;

    const settings = getSettingsStore().getProviders();
    const userPrompt = args.prompt?.trim().length
      ? args.prompt.trim()
      : args.isRecap
        ? DEFAULT_RECAP_PROMPT
        : DEFAULT_ASSIST_PROMPT;
    const messages: LlmMessage[] = this.buffer.buildPrompt(
      settings.assistSystemPrompt,
      userPrompt,
    );

    const provider = getProviderRouter().getLlmProvider();
    this.suggestionCounter += 1;
    const triggeredAt = Date.now();
    const suggestion: AssistSuggestion = {
      id: this.suggestionCounter,
      triggeredAt,
      completedAt: null,
      text: '',
      streaming: true,
      providerId: provider.id,
      ttsAvailable: settings.tts.autoPlay,
    };
    this.suggestions = [suggestion, ...this.suggestions].slice(0, 20);
    this.setStatus('thinking');
    this.emit('event', {
      type: 'suggestion-started',
      suggestion,
    } satisfies AssistOrchestratorEvent);

    let fullText = '';
    let finalModel: string | undefined;
    try {
      for await (const evt of provider.streamCompletion({
        messages,
        temperature: settings.llm.temperature,
        maxOutputTokens: settings.llm.maxOutputTokens,
        signal: abort.signal,
      })) {
        if (evt.kind === 'delta') {
          fullText += evt.text;
          this.emit('event', {
            type: 'suggestion-delta',
            suggestionId: suggestion.id,
            delta: evt.text,
            textSoFar: fullText,
          } satisfies AssistOrchestratorEvent);
        } else {
          fullText = evt.text || fullText;
          if (evt.model) finalModel = evt.model;
        }
      }
    } catch (err) {
      const message =
        err instanceof ProviderError
          ? `${err.kind}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      this.lastError = message;
      this.setStatus('error');
      this.emit('event', {
        type: 'suggestion-error',
        suggestionId: suggestion.id,
        message,
      } satisfies AssistOrchestratorEvent);
      // Mark the in-flight suggestion as no longer streaming, so the UI clears its spinner.
      this.suggestions = this.suggestions.map((s) =>
        s.id === suggestion.id ? { ...s, streaming: false, completedAt: Date.now() } : s,
      );
      this.currentAbort = null;
      return null;
    }

    const completed: AssistSuggestion = {
      ...suggestion,
      text: fullText.trim(),
      streaming: false,
      completedAt: Date.now(),
      ...(finalModel ? { model: finalModel } : {}),
    };
    this.suggestions = this.suggestions.map((s) => (s.id === suggestion.id ? completed : s));
    this.emit('event', {
      type: 'suggestion-completed',
      suggestion: completed,
    } satisfies AssistOrchestratorEvent);

    // Optional TTS — surfaced as an event so the renderer plays the audio.
    if (settings.tts.autoPlay && completed.text.length > 0) {
      this.setStatus('speaking');
      try {
        const tts = getProviderRouter().getTtsProvider();
        const result = await tts.speak({
          text: completed.text,
          voice: settings.tts.voice,
          signal: abort.signal,
        });
        this.emit('event', {
          type: 'tts-audio',
          suggestionId: completed.id,
          mimeType: result.mimeType,
          audio: result.audio,
        } satisfies AssistOrchestratorEvent);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.lastError = message;
      }
    }

    this.currentAbort = null;
    this.setStatus('idle');
    return completed;
  }

  cancelInFlight(): void {
    if (this.currentAbort) {
      this.currentAbort.abort();
      this.currentAbort = null;
    }
  }

  private setStatus(status: AssistStatus): void {
    if (status === this.status) return;
    this.status = status;
    if (status !== 'error') this.lastError = null;
    this.emit('event', {
      type: 'status-changed',
      status,
      error: this.lastError,
    } satisfies AssistOrchestratorEvent);
  }
}

let _orchestrator: AssistOrchestrator | null = null;
export function getAssistOrchestrator(): AssistOrchestrator {
  if (!_orchestrator) _orchestrator = new AssistOrchestrator();
  return _orchestrator;
}
export function _resetAssistOrchestratorForTests(): void {
  _orchestrator = null;
}
