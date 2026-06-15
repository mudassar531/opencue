import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOTKEYS,
  DEFAULT_OVERLAY_SETTINGS,
  DEFAULT_SETTINGS,
  HotkeyAction,
  OverlayPosition,
  OVERLAY_OPACITY_MAX,
  OVERLAY_OPACITY_MIN,
  OVERLAY_POSITION_CYCLE,
  SETTINGS_SCHEMA_VERSION,
  clampOpacity,
  isPlausibleAccelerator,
  nextOverlayPosition,
} from './settings-schema';

describe('settings schema', () => {
  it('exposes a defined schema version', () => {
    expect(SETTINGS_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_SETTINGS.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
  });

  it('has a binding for every HotkeyAction', () => {
    for (const action of Object.values(HotkeyAction)) {
      expect(DEFAULT_HOTKEYS[action]).toBeTypeOf('string');
      expect(DEFAULT_HOTKEYS[action].length).toBeGreaterThan(0);
    }
  });

  it('has unique default hotkey accelerators', () => {
    const accelerators = Object.values(DEFAULT_HOTKEYS);
    expect(new Set(accelerators).size).toBe(accelerators.length);
  });

  it('uses CommandOrControl in every default accelerator (cross-platform)', () => {
    for (const accel of Object.values(DEFAULT_HOTKEYS)) {
      expect(accel).toContain('CommandOrControl');
    }
  });

  it('includes every position in the cycle exactly once', () => {
    const all = Object.values(OverlayPosition);
    expect(new Set(OVERLAY_POSITION_CYCLE).size).toBe(OVERLAY_POSITION_CYCLE.length);
    expect(OVERLAY_POSITION_CYCLE.length).toBe(all.length);
    for (const pos of all) {
      expect(OVERLAY_POSITION_CYCLE).toContain(pos);
    }
  });

  it('default overlay settings are within allowed bounds', () => {
    expect(DEFAULT_OVERLAY_SETTINGS.opacity).toBeGreaterThanOrEqual(OVERLAY_OPACITY_MIN);
    expect(DEFAULT_OVERLAY_SETTINGS.opacity).toBeLessThanOrEqual(OVERLAY_OPACITY_MAX);
    expect(DEFAULT_OVERLAY_SETTINGS.size.width).toBeGreaterThan(0);
    expect(DEFAULT_OVERLAY_SETTINGS.size.height).toBeGreaterThan(0);
  });
});

describe('clampOpacity', () => {
  it('clamps below the floor', () => {
    expect(clampOpacity(0)).toBe(OVERLAY_OPACITY_MIN);
    expect(clampOpacity(-1)).toBe(OVERLAY_OPACITY_MIN);
  });
  it('clamps above the ceiling', () => {
    expect(clampOpacity(2)).toBe(OVERLAY_OPACITY_MAX);
  });
  it('returns valid values unchanged', () => {
    expect(clampOpacity(0.5)).toBe(0.5);
  });
  it('falls back to default for non-finite inputs (NaN, +/-Infinity)', () => {
    expect(clampOpacity(Number.NaN)).toBe(DEFAULT_OVERLAY_SETTINGS.opacity);
    expect(clampOpacity(Number.POSITIVE_INFINITY)).toBe(DEFAULT_OVERLAY_SETTINGS.opacity);
    expect(clampOpacity(Number.NEGATIVE_INFINITY)).toBe(DEFAULT_OVERLAY_SETTINGS.opacity);
  });
});

describe('isPlausibleAccelerator', () => {
  it('accepts well-formed accelerators', () => {
    expect(isPlausibleAccelerator('CommandOrControl+Shift+\\')).toBe(true);
    expect(isPlausibleAccelerator('Alt+F4')).toBe(true);
    expect(isPlausibleAccelerator('Space')).toBe(true);
  });
  it('rejects empty / whitespace-only accelerators', () => {
    expect(isPlausibleAccelerator('')).toBe(false);
    expect(isPlausibleAccelerator('   ')).toBe(false);
  });
  it('rejects trailing or double plus signs', () => {
    expect(isPlausibleAccelerator('Ctrl+')).toBe(false);
    expect(isPlausibleAccelerator('Ctrl++A')).toBe(false);
  });
});

describe('nextOverlayPosition', () => {
  it('cycles through every preset and loops', () => {
    const seen: string[] = [];
    let current = OVERLAY_POSITION_CYCLE[0]!;
    for (let i = 0; i < OVERLAY_POSITION_CYCLE.length; i += 1) {
      seen.push(current);
      current = nextOverlayPosition(current);
    }
    expect(seen).toEqual([...OVERLAY_POSITION_CYCLE]);
    // After a full cycle we land back on the first entry.
    expect(current).toBe(OVERLAY_POSITION_CYCLE[0]);
  });
});
