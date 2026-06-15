/**
 * Runtime provider router.
 *
 * Reads the current `ProviderSelection` from the settings store and returns
 * a freshly-constructed provider for each capability. Construction is cheap
 * (no I/O), so we don't bother caching — this also guarantees model overrides
 * take effect immediately when the user changes a setting.
 *
 * The router is the ONLY place that knows about concrete provider classes.
 * Callers (assist loop, ipc handlers) only see the `SttProvider`,
 * `LlmProvider`, `TtsProvider` interfaces.
 */

import {
  LlmProviderId,
  type LlmProvider,
  type LlmProviderIdValue,
  type ProviderSelection,
  type SttProvider,
  type SttProviderIdValue,
  SttProviderId,
  type TtsProvider,
  type TtsProviderIdValue,
  TtsProviderId,
} from '../../shared/provider-types.js';
import { getSettingsStore } from '../settings/store.js';
import { AnthropicProvider } from './llm/anthropic.js';
import { GeminiProvider } from './llm/gemini.js';
import { GroqProvider } from './llm/groq.js';
import { OllamaProvider } from './llm/ollama.js';
import { OpenAiLlmProvider } from './llm/openai.js';
import { AssemblyAiProvider } from './stt/assemblyai.js';
import { DeepgramProvider } from './stt/deepgram.js';
import { LocalSidecarSttProvider } from './stt/local-sidecar.js';
import { OpenAiWhisperProvider } from './stt/openai-whisper.js';
import { ElevenLabsProvider } from './tts/elevenlabs.js';
import { LocalSidecarTtsProvider } from './tts/local-sidecar.js';
import { OpenAiTtsProvider } from './tts/openai.js';

export interface ProviderRouterDeps {
  /** Override for tests; defaults to reading the real settings store. */
  getSelection?: () => ProviderSelection;
}

export class ProviderRouter {
  private readonly getSelection: () => ProviderSelection;

  constructor(deps: ProviderRouterDeps = {}) {
    this.getSelection = deps.getSelection ?? (() => getSettingsStore().getProviders());
  }

  getSttProvider(): SttProvider {
    const sel = this.getSelection();
    return buildStt(sel.stt.id, sel.stt.model);
  }

  getLlmProvider(): LlmProvider {
    const sel = this.getSelection();
    return buildLlm(sel.llm.id, sel.llm.model);
  }

  getTtsProvider(): TtsProvider {
    const sel = this.getSelection();
    return buildTts(sel.tts.id, sel.tts.model, sel.tts.voice);
  }

  /** Capability listing — drives the settings UI dropdowns. */
  listCapabilities(): {
    stt: { id: SttProviderIdValue; displayName: string; models: readonly string[] }[];
    llm: { id: LlmProviderIdValue; displayName: string; models: readonly string[] }[];
    tts: {
      id: TtsProviderIdValue;
      displayName: string;
      models: readonly string[];
      voices: readonly string[];
    }[];
  } {
    const stt = Object.values(SttProviderId).map((id) => {
      const p = buildStt(id);
      return { id: p.id, displayName: p.displayName, models: p.availableModels };
    });

    const llm = Object.values(LlmProviderId).map((id) => {
      const p = buildLlm(id);
      return { id: p.id, displayName: p.displayName, models: p.availableModels };
    });

    const tts = Object.values(TtsProviderId).map((id) => {
      const p = buildTts(id);
      return {
        id: p.id,
        displayName: p.displayName,
        models: p.availableModels,
        voices: p.availableVoices,
      };
    });

    return { stt, llm, tts };
  }
}

export function buildStt(id: SttProviderIdValue, model?: string): SttProvider {
  switch (id) {
    case SttProviderId.OpenAIWhisper:
      return new OpenAiWhisperProvider(model);
    case SttProviderId.Deepgram:
      return new DeepgramProvider(model);
    case SttProviderId.AssemblyAI:
      return new AssemblyAiProvider(model);
    case SttProviderId.LocalSidecar:
      return new LocalSidecarSttProvider(model);
    default: {
      const _exhaustive: never = id;
      void _exhaustive;
      return new OpenAiWhisperProvider(model);
    }
  }
}

export function buildLlm(id: LlmProviderIdValue, model?: string): LlmProvider {
  switch (id) {
    case LlmProviderId.OpenAI:
      return new OpenAiLlmProvider(model);
    case LlmProviderId.Anthropic:
      return new AnthropicProvider(model);
    case LlmProviderId.Gemini:
      return new GeminiProvider(model);
    case LlmProviderId.Groq:
      return new GroqProvider(model);
    case LlmProviderId.Ollama:
      return new OllamaProvider(model);
    default: {
      const _exhaustive: never = id;
      void _exhaustive;
      return new OpenAiLlmProvider(model);
    }
  }
}

export function buildTts(id: TtsProviderIdValue, model?: string, voice?: string): TtsProvider {
  switch (id) {
    case TtsProviderId.OpenAI:
      return new OpenAiTtsProvider(model, voice);
    case TtsProviderId.ElevenLabs:
      return new ElevenLabsProvider(model, voice);
    case TtsProviderId.LocalSidecar:
      return new LocalSidecarTtsProvider(model, voice);
    default: {
      const _exhaustive: never = id;
      void _exhaustive;
      return new OpenAiTtsProvider(model, voice);
    }
  }
}

let _router: ProviderRouter | null = null;
export function getProviderRouter(): ProviderRouter {
  if (!_router) _router = new ProviderRouter();
  return _router;
}
export function _resetRouterForTests(): void {
  _router = null;
}
