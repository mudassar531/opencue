import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROVIDER_SELECTION,
  LlmProviderId,
  SttProviderId,
  TtsProviderId,
  type ProviderSelection,
} from '../../shared/provider-types';
import {
  ProviderRouter,
  buildLlm,
  buildStt,
  buildTts,
} from './router';

function makeSelection(over: Partial<ProviderSelection> = {}): ProviderSelection {
  return {
    stt: { ...DEFAULT_PROVIDER_SELECTION.stt, ...over.stt },
    llm: { ...DEFAULT_PROVIDER_SELECTION.llm, ...over.llm },
    tts: { ...DEFAULT_PROVIDER_SELECTION.tts, ...over.tts },
    assistSystemPrompt: over.assistSystemPrompt ?? DEFAULT_PROVIDER_SELECTION.assistSystemPrompt,
  };
}

describe('ProviderRouter', () => {
  it('returns providers matching the selection', () => {
    const selection = makeSelection({
      stt: { id: SttProviderId.Deepgram, model: 'nova-3' },
      llm: { id: LlmProviderId.Anthropic, model: 'claude-3-5-haiku-latest', temperature: 0.4, maxOutputTokens: 200 },
      tts: { id: TtsProviderId.ElevenLabs, model: 'eleven_flash_v2_5', voice: 'X', autoPlay: true },
    });
    const router = new ProviderRouter({ getSelection: () => selection });
    expect(router.getSttProvider().id).toBe(SttProviderId.Deepgram);
    expect(router.getLlmProvider().id).toBe(LlmProviderId.Anthropic);
    expect(router.getTtsProvider().id).toBe(TtsProviderId.ElevenLabs);
  });

  it('reacts to selection changes between calls (no caching)', () => {
    let selection = makeSelection();
    const router = new ProviderRouter({ getSelection: () => selection });
    expect(router.getLlmProvider().id).toBe(LlmProviderId.OpenAI);
    selection = makeSelection({
      llm: { id: LlmProviderId.Groq, model: 'llama-3.3-70b-versatile', temperature: 0.3, maxOutputTokens: 256 },
    });
    expect(router.getLlmProvider().id).toBe(LlmProviderId.Groq);
  });

  it('listCapabilities exposes the cloud STT / LLM / TTS providers', () => {
    const router = new ProviderRouter({ getSelection: () => makeSelection() });
    const caps = router.listCapabilities();
    expect(caps.stt.map((p) => p.id)).toEqual(
      expect.arrayContaining([
        SttProviderId.OpenAIWhisper,
        SttProviderId.Deepgram,
        SttProviderId.AssemblyAI,
      ]),
    );
    expect(caps.llm.map((p) => p.id)).toEqual(
      expect.arrayContaining([
        LlmProviderId.OpenAI,
        LlmProviderId.Anthropic,
        LlmProviderId.Gemini,
        LlmProviderId.Groq,
      ]),
    );
    expect(caps.tts.map((p) => p.id)).toEqual(
      expect.arrayContaining([TtsProviderId.OpenAI, TtsProviderId.ElevenLabs]),
    );
    // Each entry has a non-empty model list.
    for (const list of [caps.stt, caps.llm]) {
      for (const entry of list) {
        expect(entry.models.length).toBeGreaterThan(0);
      }
    }
    for (const entry of caps.tts) {
      expect(entry.models.length).toBeGreaterThan(0);
      expect(entry.voices.length).toBeGreaterThan(0);
    }
  });
});

describe('buildStt / buildLlm / buildTts', () => {
  it('build every known cloud provider id', () => {
    expect(buildStt(SttProviderId.OpenAIWhisper).id).toBe(SttProviderId.OpenAIWhisper);
    expect(buildStt(SttProviderId.Deepgram).id).toBe(SttProviderId.Deepgram);
    expect(buildStt(SttProviderId.AssemblyAI).id).toBe(SttProviderId.AssemblyAI);

    expect(buildLlm(LlmProviderId.OpenAI).id).toBe(LlmProviderId.OpenAI);
    expect(buildLlm(LlmProviderId.Anthropic).id).toBe(LlmProviderId.Anthropic);
    expect(buildLlm(LlmProviderId.Gemini).id).toBe(LlmProviderId.Gemini);
    expect(buildLlm(LlmProviderId.Groq).id).toBe(LlmProviderId.Groq);

    expect(buildTts(TtsProviderId.OpenAI).id).toBe(TtsProviderId.OpenAI);
    expect(buildTts(TtsProviderId.ElevenLabs).id).toBe(TtsProviderId.ElevenLabs);
  });
});
