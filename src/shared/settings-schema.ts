/**
 * Typed settings schema for opencue.
 *
 * Every persisted preference lives here so the renderer, main process,
 * and tests can share one shape. Update `SETTINGS_SCHEMA_VERSION` whenever
 * the shape changes in an incompatible way and add a migration in `store.ts`.
 */

/** Bump on every breaking change to the persisted shape. */
export const SETTINGS_SCHEMA_VERSION = 1;

/** Tunable opacity range for the overlay. */
export const OVERLAY_OPACITY_MIN = 0.3;
export const OVERLAY_OPACITY_MAX = 1.0;

/** Default minimum overlay size — keeps the layout usable. */
export const OVERLAY_MIN_WIDTH = 320;
export const OVERLAY_MIN_HEIGHT = 200;

/** A named action that can be bound to a global accelerator. */
export const HotkeyAction = {
  ToggleOverlay: 'toggleOverlay',
  CycleOverlayPosition: 'cycleOverlayPosition',
  Assist: 'assist',
  Recap: 'recap',
  ToggleAskBar: 'toggleAskBar',
  ToggleClickThrough: 'toggleClickThrough',
} as const;

export type HotkeyActionValue = (typeof HotkeyAction)[keyof typeof HotkeyAction];

/** A user-configurable map from action → Electron accelerator string. */
export type HotkeyMap = Record<HotkeyActionValue, string>;

/** Corner / edge presets the overlay cycles through with the move hotkey. */
export const OverlayPosition = {
  TopRight: 'topRight',
  TopLeft: 'topLeft',
  BottomRight: 'bottomRight',
  BottomLeft: 'bottomLeft',
  Center: 'center',
} as const;

export type OverlayPositionValue = (typeof OverlayPosition)[keyof typeof OverlayPosition];

/** Cycle order — kept stable for deterministic UX and tests. */
export const OVERLAY_POSITION_CYCLE: readonly OverlayPositionValue[] = [
  OverlayPosition.TopRight,
  OverlayPosition.BottomRight,
  OverlayPosition.BottomLeft,
  OverlayPosition.TopLeft,
  OverlayPosition.Center,
] as const;

export interface OverlaySettings {
  /** Whether the overlay window is hidden from screen-share / recording. */
  contentProtection: boolean;
  /** 0..1 window opacity. Clamped to [OVERLAY_OPACITY_MIN, OVERLAY_OPACITY_MAX]. */
  opacity: number;
  /** When true, pointer events pass through the overlay to the window beneath. */
  clickThrough: boolean;
  /** Pin the overlay above all other windows. */
  alwaysOnTop: boolean;
  /** Remember the last user-chosen position. `null` = use default placement. */
  position: { x: number; y: number } | null;
  /** Persisted window size. */
  size: { width: number; height: number };
  /** Last selected preset (used when cycling). */
  positionPreset: OverlayPositionValue;
  /** Whether the overlay should auto-show on launch. */
  showOnLaunch: boolean;
}

export interface OpencueSettings {
  schemaVersion: number;
  overlay: OverlaySettings;
  hotkeys: HotkeyMap;
}

export const DEFAULT_HOTKEYS: HotkeyMap = {
  [HotkeyAction.ToggleOverlay]: 'CommandOrControl+Shift+\\',
  [HotkeyAction.CycleOverlayPosition]: 'CommandOrControl+Shift+M',
  [HotkeyAction.Assist]: 'CommandOrControl+Shift+Enter',
  [HotkeyAction.Recap]: 'CommandOrControl+Shift+R',
  [HotkeyAction.ToggleAskBar]: 'CommandOrControl+Shift+/',
  [HotkeyAction.ToggleClickThrough]: 'CommandOrControl+Shift+L',
};

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  contentProtection: true,
  opacity: 0.95,
  clickThrough: false,
  alwaysOnTop: true,
  position: null,
  size: { width: 420, height: 320 },
  positionPreset: OverlayPosition.TopRight,
  showOnLaunch: true,
};

export const DEFAULT_SETTINGS: OpencueSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  overlay: DEFAULT_OVERLAY_SETTINGS,
  hotkeys: { ...DEFAULT_HOTKEYS },
};

/** Clamp opacity to the allowed range. Pure — safe to use in tests. */
export function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_OVERLAY_SETTINGS.opacity;
  return Math.min(OVERLAY_OPACITY_MAX, Math.max(OVERLAY_OPACITY_MIN, value));
}

/**
 * Returns the accelerator-string syntax acceptable to Electron's `globalShortcut`.
 *
 * This is a lightweight check, not a full validator — Electron itself will
 * reject malformed accelerators at registration time. We use it for early UI
 * feedback (e.g., refuse to save an obviously empty binding).
 */
export function isPlausibleAccelerator(accelerator: string): boolean {
  if (typeof accelerator !== 'string') return false;
  const trimmed = accelerator.trim();
  if (trimmed.length === 0) return false;
  // Must include a key (last segment) and zero or more modifiers separated by '+'.
  const parts = trimmed.split('+').map((p) => p.trim());
  if (parts.length === 0 || parts.some((p) => p.length === 0)) return false;
  // Last part is the trigger key; must be at least one character.
  const last = parts[parts.length - 1];
  return typeof last === 'string' && last.length >= 1;
}

/** Returns the next preset in `OVERLAY_POSITION_CYCLE` after `current`. */
export function nextOverlayPosition(current: OverlayPositionValue): OverlayPositionValue {
  const idx = OVERLAY_POSITION_CYCLE.indexOf(current);
  const next = OVERLAY_POSITION_CYCLE[(idx + 1) % OVERLAY_POSITION_CYCLE.length];
  // OVERLAY_POSITION_CYCLE is non-empty so the indexed access is safe; assertion
  // satisfies `noUncheckedIndexedAccess`.
  return next as OverlayPositionValue;
}
