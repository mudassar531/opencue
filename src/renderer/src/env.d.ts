import type { OpencueBridge } from '../../shared/ipc-contract';

declare global {
  interface Window {
    /** Typed bridge exposed by the preload script — the renderer's only path to native APIs. */
    readonly opencue: OpencueBridge;
  }
}

export {};
