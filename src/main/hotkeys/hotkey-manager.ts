/**
 * Global hotkey manager.
 *
 * Wraps Electron `globalShortcut` so the rest of the app subscribes to
 * named actions instead of raw accelerator strings. A single accelerator is
 * registered per action — re-registering an action automatically tears down
 * the previous binding.
 *
 * Hotkeys are loaded from the settings store and can be re-bound at runtime;
 * the manager keeps a single source of truth and notifies observers when a
 * registration fails (e.g., the OS refused the accelerator).
 */

import { globalShortcut } from 'electron';
import { EventEmitter } from 'node:events';
import {
  type HotkeyActionValue,
  type HotkeyMap,
  HotkeyAction,
  isPlausibleAccelerator,
} from '../../shared/settings-schema.js';

export type HotkeyTriggerListener = (action: HotkeyActionValue) => void;

export interface HotkeyRegistrationResult {
  action: HotkeyActionValue;
  accelerator: string;
  ok: boolean;
  error?: string;
}

export class HotkeyManager extends EventEmitter {
  private readonly registered = new Map<HotkeyActionValue, string>();

  /** Replaces all bindings with the given map. Returns per-action results. */
  applyAll(map: HotkeyMap): HotkeyRegistrationResult[] {
    this.unregisterAll();
    const results: HotkeyRegistrationResult[] = [];
    for (const action of Object.values(HotkeyAction)) {
      const accelerator = map[action];
      results.push(this.register(action, accelerator));
    }
    return results;
  }

  /** Bind (or re-bind) a single action. */
  register(action: HotkeyActionValue, accelerator: string): HotkeyRegistrationResult {
    // Drop any previous binding for this action.
    const previous = this.registered.get(action);
    if (previous) {
      try {
        globalShortcut.unregister(previous);
      } catch {
        // Ignore — best effort.
      }
      this.registered.delete(action);
    }

    if (!isPlausibleAccelerator(accelerator)) {
      const error = `Accelerator "${accelerator}" is malformed`;
      this.emit('registration-failed', { action, accelerator, error });
      return { action, accelerator, ok: false, error };
    }

    try {
      const ok = globalShortcut.register(accelerator, () => {
        this.emit('trigger', action);
      });
      if (!ok) {
        const error = `OS refused to register "${accelerator}" (already in use?)`;
        this.emit('registration-failed', { action, accelerator, error });
        return { action, accelerator, ok: false, error };
      }
      this.registered.set(action, accelerator);
      return { action, accelerator, ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.emit('registration-failed', { action, accelerator, error });
      return { action, accelerator, ok: false, error };
    }
  }

  unregisterAll(): void {
    for (const accelerator of this.registered.values()) {
      try {
        globalShortcut.unregister(accelerator);
      } catch {
        // Ignore — best effort.
      }
    }
    this.registered.clear();
  }

  onTrigger(listener: HotkeyTriggerListener): () => void {
    this.on('trigger', listener);
    return () => this.off('trigger', listener);
  }

  /** Returns a snapshot of the currently-bound accelerators. */
  snapshot(): HotkeyMap {
    const out: Partial<HotkeyMap> = {};
    for (const [action, accel] of this.registered.entries()) {
      out[action] = accel;
    }
    return out as HotkeyMap;
  }
}

let _manager: HotkeyManager | null = null;
export function getHotkeyManager(): HotkeyManager {
  if (!_manager) {
    _manager = new HotkeyManager();
  }
  return _manager;
}

export function _resetHotkeyManagerForTests(): void {
  _manager = null;
}
