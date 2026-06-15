/**
 * Overlay window manager.
 *
 * Owns the single frameless / transparent / always-on-top `BrowserWindow`
 * that hosts opencue's live assistance UI. Responsibilities:
 *
 * - Create with hardened webPreferences (matches the main window).
 * - Apply `setContentProtection(true)` so the overlay is excluded from
 *   screen capture / recording (the signature feature).
 * - Manage opacity, click-through, always-on-top, position presets, and
 *   the `?view=overlay` renderer route.
 * - Persist position / size changes back to the settings store.
 * - Emit a typed event stream that the IPC layer relays to the renderer.
 */

import { BrowserWindow, screen, shell, type Display } from 'electron';
import { EventEmitter } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type OverlayPositionValue,
  type OverlaySettings,
  OVERLAY_MIN_HEIGHT,
  OVERLAY_MIN_WIDTH,
  OverlayPosition,
  clampOpacity,
  nextOverlayPosition,
} from '../../shared/settings-schema.js';
import { getSettingsStore } from '../settings/store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Padding from the screen edge when snapping the overlay to a preset. */
const SCREEN_EDGE_PADDING = 24;

/** Public observable state. Mirrors what the renderer renders. */
export interface OverlayState {
  visible: boolean;
  opacity: number;
  clickThrough: boolean;
  contentProtection: boolean;
  alwaysOnTop: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  positionPreset: OverlayPositionValue;
}

export type OverlayEvent =
  | { type: 'state-changed'; state: OverlayState }
  | { type: 'shown' }
  | { type: 'hidden' }
  | { type: 'closed' };

export class OverlayWindowManager extends EventEmitter {
  private window: BrowserWindow | null = null;
  private moveSavePending: NodeJS.Timeout | null = null;

  /** Lazily creates the overlay window the first time it is needed. */
  ensure(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;

    const settings = getSettingsStore().getOverlay();
    const target = this.computeInitialBounds(settings);

    const win = new BrowserWindow({
      width: target.width,
      height: target.height,
      x: target.x,
      y: target.y,
      minWidth: OVERLAY_MIN_WIDTH,
      minHeight: OVERLAY_MIN_HEIGHT,
      frame: false,
      transparent: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      resizable: true,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: settings.alwaysOnTop,
      focusable: true,
      title: 'opencue · overlay',
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        preload: join(__dirname, '../preload/index.cjs'),
      },
    });

    // Float above full-screen apps on macOS too.
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    win.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver');
    win.setContentProtection(settings.contentProtection);
    win.setOpacity(clampOpacity(settings.opacity));
    if (settings.clickThrough) {
      win.setIgnoreMouseEvents(true, { forward: true });
    }

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        void shell.openExternal(url);
      }
      return { action: 'deny' };
    });

    win.on('move', () => this.schedulePersist());
    win.on('resize', () => this.schedulePersist());
    win.on('show', () => {
      this.emit('event', { type: 'shown' } satisfies OverlayEvent);
      this.broadcastState();
    });
    win.on('hide', () => {
      this.emit('event', { type: 'hidden' } satisfies OverlayEvent);
      this.broadcastState();
    });
    win.on('closed', () => {
      this.window = null;
      this.emit('event', { type: 'closed' } satisfies OverlayEvent);
    });

    this.window = win;
    void this.loadRenderer(win);
    if (settings.showOnLaunch) {
      // Defer `show` until the contents are ready to avoid a flash.
      win.once('ready-to-show', () => win.show());
    }
    return win;
  }

  show(): void {
    const win = this.ensure();
    if (!win.isVisible()) {
      win.show();
    }
    win.focus();
    this.broadcastState();
  }

  hide(): void {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
      this.window.hide();
      this.broadcastState();
    }
  }

  toggle(): boolean {
    const win = this.ensure();
    if (win.isVisible()) {
      this.hide();
      return false;
    }
    this.show();
    return true;
  }

  setOpacity(value: number): number {
    const opacity = clampOpacity(value);
    const win = this.ensure();
    win.setOpacity(opacity);
    getSettingsStore().updateOverlay({ opacity });
    this.broadcastState();
    return opacity;
  }

  setClickThrough(enabled: boolean): boolean {
    const win = this.ensure();
    win.setIgnoreMouseEvents(enabled, { forward: true });
    getSettingsStore().updateOverlay({ clickThrough: enabled });
    this.broadcastState();
    return enabled;
  }

  setContentProtection(enabled: boolean): boolean {
    const win = this.ensure();
    win.setContentProtection(enabled);
    getSettingsStore().updateOverlay({ contentProtection: enabled });
    this.broadcastState();
    return enabled;
  }

  setAlwaysOnTop(enabled: boolean): boolean {
    const win = this.ensure();
    win.setAlwaysOnTop(enabled, 'screen-saver');
    getSettingsStore().updateOverlay({ alwaysOnTop: enabled });
    this.broadcastState();
    return enabled;
  }

  cyclePosition(): OverlayPositionValue {
    const settings = getSettingsStore().getOverlay();
    const nextPreset = nextOverlayPosition(settings.positionPreset);
    this.applyPositionPreset(nextPreset);
    return nextPreset;
  }

  applyPositionPreset(preset: OverlayPositionValue): void {
    const win = this.ensure();
    const display = screen.getDisplayMatching(win.getBounds());
    const [width, height] = win.getSize();
    const safeWidth = width ?? OVERLAY_MIN_WIDTH;
    const safeHeight = height ?? OVERLAY_MIN_HEIGHT;
    const { x, y } = computePresetPosition(preset, display, safeWidth, safeHeight);
    win.setPosition(x, y, false);
    getSettingsStore().updateOverlay({
      position: { x, y },
      positionPreset: preset,
    });
    this.broadcastState();
  }

  /** Move to an absolute screen coordinate (e.g., after a user drag). */
  reposition(x: number, y: number): void {
    const win = this.ensure();
    win.setPosition(Math.floor(x), Math.floor(y), false);
    getSettingsStore().updateOverlay({ position: { x: Math.floor(x), y: Math.floor(y) } });
    this.broadcastState();
  }

  getState(): OverlayState {
    const settings = getSettingsStore().getOverlay();
    const win = this.window;
    if (!win || win.isDestroyed()) {
      const fallbackPos = settings.position ?? { x: 0, y: 0 };
      return {
        visible: false,
        opacity: settings.opacity,
        clickThrough: settings.clickThrough,
        contentProtection: settings.contentProtection,
        alwaysOnTop: settings.alwaysOnTop,
        position: fallbackPos,
        size: settings.size,
        positionPreset: settings.positionPreset,
      };
    }
    const [w, h] = win.getSize();
    const [x, y] = win.getPosition();
    return {
      visible: win.isVisible(),
      opacity: win.getOpacity(),
      clickThrough: settings.clickThrough,
      contentProtection: settings.contentProtection,
      alwaysOnTop: win.isAlwaysOnTop(),
      position: { x: x ?? 0, y: y ?? 0 },
      size: { width: w ?? OVERLAY_MIN_WIDTH, height: h ?? OVERLAY_MIN_HEIGHT },
      positionPreset: settings.positionPreset,
    };
  }

  destroy(): void {
    if (this.moveSavePending) {
      clearTimeout(this.moveSavePending);
      this.moveSavePending = null;
    }
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
    }
    this.window = null;
  }

  private async loadRenderer(win: BrowserWindow): Promise<void> {
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) {
      await win.loadURL(`${devUrl}?view=overlay`);
    } else {
      await win.loadFile(join(__dirname, '../renderer/index.html'), {
        query: { view: 'overlay' },
      });
    }
  }

  private computeInitialBounds(
    settings: OverlaySettings,
  ): { x: number; y: number; width: number; height: number } {
    const width = Math.max(settings.size.width, OVERLAY_MIN_WIDTH);
    const height = Math.max(settings.size.height, OVERLAY_MIN_HEIGHT);
    if (settings.position) {
      return { ...settings.position, width, height };
    }
    const display = screen.getPrimaryDisplay();
    const { x, y } = computePresetPosition(settings.positionPreset, display, width, height);
    return { x, y, width, height };
  }

  private schedulePersist(): void {
    if (!this.window || this.window.isDestroyed()) return;
    if (this.moveSavePending) clearTimeout(this.moveSavePending);
    this.moveSavePending = setTimeout(() => {
      if (!this.window || this.window.isDestroyed()) return;
      const [width, height] = this.window.getSize();
      const [x, y] = this.window.getPosition();
      getSettingsStore().updateOverlay({
        position: { x: x ?? 0, y: y ?? 0 },
        size: {
          width: width ?? OVERLAY_MIN_WIDTH,
          height: height ?? OVERLAY_MIN_HEIGHT,
        },
      });
      this.broadcastState();
    }, 250);
  }

  private broadcastState(): void {
    this.emit('event', { type: 'state-changed', state: this.getState() } satisfies OverlayEvent);
  }
}

/** Pure helper — exposed so it can be exercised in tests without Electron. */
export function computePresetPosition(
  preset: OverlayPositionValue,
  display: Pick<Display, 'workArea'>,
  width: number,
  height: number,
  edgePadding: number = SCREEN_EDGE_PADDING,
): { x: number; y: number } {
  const { workArea } = display;
  const minX = workArea.x + edgePadding;
  const minY = workArea.y + edgePadding;
  const maxX = workArea.x + workArea.width - width - edgePadding;
  const maxY = workArea.y + workArea.height - height - edgePadding;
  const centerX = Math.round(workArea.x + (workArea.width - width) / 2);
  const centerY = Math.round(workArea.y + (workArea.height - height) / 2);
  switch (preset) {
    case OverlayPosition.TopLeft:
      return { x: minX, y: minY };
    case OverlayPosition.TopRight:
      return { x: Math.max(minX, maxX), y: minY };
    case OverlayPosition.BottomLeft:
      return { x: minX, y: Math.max(minY, maxY) };
    case OverlayPosition.BottomRight:
      return { x: Math.max(minX, maxX), y: Math.max(minY, maxY) };
    case OverlayPosition.Center:
    default:
      return { x: centerX, y: centerY };
  }
}

/** Singleton (matches Electron's single-window pattern). */
let _manager: OverlayWindowManager | null = null;
export function getOverlayManager(): OverlayWindowManager {
  if (!_manager) {
    _manager = new OverlayWindowManager();
  }
  return _manager;
}

/** Test-only reset. */
export function _resetOverlayManagerForTests(): void {
  _manager = null;
}
