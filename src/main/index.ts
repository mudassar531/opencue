/**
 * Main process entry point for opencue.
 *
 * Responsibilities (Phase 0): create a single BrowserWindow, load the renderer,
 * wire IPC handlers, and configure security defaults.
 *
 * Later phases add: overlay window manager + content protection (Phase 1),
 * audio capture orchestrator (Phase 2), provider router (Phase 3),
 * Python sidecar lifecycle (Phase 4), screen capture (Phase 5),
 * session manager (Phase 6), and updater (Phase 7).
 */

import { app, BrowserWindow, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registerIpcHandlers } from './ipc.js';

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

  // Show only when ready to avoid the white-flash on launch.
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

void app.whenReady().then(() => {
  registerIpcHandlers();
  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Standard desktop behavior: stay alive on macOS, quit elsewhere.
  if (process.platform !== 'darwin') {
    app.quit();
  }
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
