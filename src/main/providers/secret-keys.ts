/**
 * Typed accessor over the `SecretStore` for API keys.
 *
 * Keys are stored encrypted via Electron `safeStorage`. We namespace them by
 * provider kind + id so an OpenAI key for STT and one for LLM/TTS are stored
 * separately (most users will share a single key — the renderer settings UI
 * sets them all at once when the user enters their OpenAI key).
 */

import {
  LlmProviderId,
  type LlmProviderIdValue,
  SttProviderId,
  type SttProviderIdValue,
  TtsProviderId,
  type TtsProviderIdValue,
} from '../../shared/provider-types.js';
import { getSecretStore } from '../settings/store.js';

export type SecretScope = 'stt' | 'llm' | 'tts';

function key(scope: SecretScope, providerId: string): string {
  return `apiKey.${scope}.${providerId}`;
}

export function setApiKey(scope: SecretScope, providerId: string, apiKey: string): boolean {
  const store = getSecretStore();
  if (!store.isAvailable()) return false;
  if (apiKey.length === 0) {
    store.delete(key(scope, providerId));
    return true;
  }
  return store.set(key(scope, providerId), apiKey);
}

export function getApiKey(scope: SecretScope, providerId: string): string | undefined {
  return getSecretStore().get(key(scope, providerId));
}

export function hasApiKey(scope: SecretScope, providerId: string): boolean {
  const value = getApiKey(scope, providerId);
  return typeof value === 'string' && value.length > 0;
}

export function deleteApiKey(scope: SecretScope, providerId: string): void {
  getSecretStore().delete(key(scope, providerId));
}

/** Returns a snapshot of `{ scope.providerId: hasKey }` so the UI can render padlocks. */
export function getApiKeyPresenceMap(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const id of Object.values(SttProviderId)) out[`stt.${id}`] = hasApiKey('stt', id);
  for (const id of Object.values(LlmProviderId)) out[`llm.${id}`] = hasApiKey('llm', id);
  for (const id of Object.values(TtsProviderId)) out[`tts.${id}`] = hasApiKey('tts', id);
  return out;
}

/** Cross-scope reuse — used by the OpenAI provider family which shares a key. */
export function getSharedOpenAiKey(): string | undefined {
  return (
    getApiKey('llm', LlmProviderId.OpenAI) ??
    getApiKey('stt', SttProviderId.OpenAIWhisper) ??
    getApiKey('tts', TtsProviderId.OpenAI)
  );
}

/* Re-export the typed unions for callers. */
export type { LlmProviderIdValue, SttProviderIdValue, TtsProviderIdValue };
