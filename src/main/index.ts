/**
 * Main process entry point for opencue.
 *
 * Boots in this order:
 *   1. Settings store (loads persisted preferences).
 *   2. Main window (settings / debug surface — Phase 0).
 *   3. Overlay window (Phase 1 — frameless, transparent, always-on-top).
 *   4. Global hotkeys + IPC handlers + event broadcasts.
 *
 * Later phases add: audio capture orchestrator (Phase 2), provider router
 * (Phase 3), Python sidecar lifecycle (Phase 4), screen capture (Phase 5),
 * session manager (Phase 6), and updater (Phase 7).
 */

import { app, BrowserWindow, globalShortcut, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HotkeyAction } from '../shared/settings-schema.js';
import { getAssistOrchestrator } from './assist/assist-orchestrator.js';
import { getHotkeyManager } from './hotkeys/hotkey-manager.js';
import { broadcastEvent, registerIpcHandlers, wireEventBroadcasts } from './ipc.js';
import { getModelManager } from './models/model-manager.js';
import { getOverlayManager } from './overlay/overlay-window.js';
import { getSessionManager } from './sessions/session-manager.js';
import { getSettingsStore } from './settings/store.js';
import { getSidecarManager } from './sidecar/sidecar-manager.js';
import { IpcEvent } from '../shared/ipc-contract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isDev = !app.isPackaged;
const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL;

let mainWindow: BrowserWindow | null = null;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    show: false,
    backgroundColor: '#0b0d12',
    title: 'opencue',
    webPreferences: {
      // Security defaults — do not weaken without explicit review.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: join(__dirname, '../preload/index.cjs'),
    },
  });

  // External links open in the user's default browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  if (isDev && RENDERER_DEV_URL) {
    void win.loadURL(RENDERER_DEV_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

/** Bind the side-effects of each named hotkey action to a real handler. */
function wireHotkeyActions(): void {
  const overlay = getOverlayManager();
  getHotkeyManager().onTrigger((action) => {
    switch (action) {
      case HotkeyAction.ToggleOverlay:
        overlay.toggle();
        break;
      case HotkeyAction.CycleOverlayPosition:
        overlay.cyclePosition();
        break;
      case HotkeyAction.ToggleClickThrough: {
        const current = getSettingsStore().getOverlay().clickThrough;
        overlay.setClickThrough(!current);
        break;
      }
      case HotkeyAction.Assist:
        overlay.show();
        broadcastEvent(IpcEvent.HotkeyTriggered, { action });
        void getAssistOrchestrator()
          .runAssist({ triggeredBy: 'hotkey' })
          .catch(() => undefined);
        break;
      case HotkeyAction.Recap:
        overlay.show();
        broadcastEvent(IpcEvent.HotkeyTriggered, { action });
        void getAssistOrchestrator()
          .runAssist({ triggeredBy: 'hotkey', isRecap: true })
          .catch(() => undefined);
        break;
      case HotkeyAction.ToggleAskBar:
        overlay.show();
        broadcastEvent(IpcEvent.HotkeyTriggered, { action });
        break;
    }
  });
}

void app.whenReady().then(() => {
  // Order matters: load settings first so window managers can read defaults.
  const settings = getSettingsStore().get();

  // Initialize the model manager with the user-data dir so download paths
  // are deterministic before any IPC handler is invoked.
  getModelManager().setRoot(app.getPath('userData'));
  getSessionManager().setRoot(app.getPath('userData'));

  registerIpcHandlers();
  wireEventBroadcasts();
  wireHotkeyActions();

  // Register global hotkeys from the persisted settings.
  const registration = getHotkeyManager().applyAll(settings.hotkeys);
  for (const r of registration) {
    if (!r.ok) {
      // eslint-disable-next-line no-console
      console.warn(`opencue: hotkey "${r.action}" → "${r.accelerator}" failed: ${r.error}`);
    }
  }

  mainWindow = createMainWindow();
  // Ensure the overlay exists immediately so the user can summon it via hotkey
  // even before opening the main window.
  getOverlayManager().ensure();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      getOverlayManager().ensure();
    }
  });
});

app.on('window-all-closed', () => {
  // Standard desktop behavior: stay alive on macOS, quit elsewhere.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  getHotkeyManager().unregisterAll();
  getOverlayManager().destroy();
  void getSessionManager().stop();
  void getSidecarManager().stop();
});

// Hard-deny any unexpected webContents creation — defense in depth.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
});
