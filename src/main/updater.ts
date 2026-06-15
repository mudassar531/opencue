/**
 * Auto-update glue (Phase 7).
 *
 * Wraps `electron-updater` so the main process checks for new opencue
 * releases on GitHub after launch. The check is deliberately silent in dev
 * (`app.isPackaged === false`) so contributors don't see update prompts
 * while iterating on the codebase.
 *
 * The IPC layer broadcasts update lifecycle events as renderer-friendly
 * payloads; later phases can expose a UI banner. For now we just log.
 */

import { app } from 'electron';
import { autoUpdater } from 'electron-updater';

// Be quieter in dev — electron-updater otherwise warns on every launch.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = false;

export function initAutoUpdater(): void {
  // Skip in dev — no signed app, no release feed.
  if (!app.isPackaged) {
    // eslint-disable-next-line no-console
    console.info('opencue: skipping auto-update check (running unpackaged).');
    return;
  }

  autoUpdater.on('checking-for-update', () => {
    // eslint-disable-next-line no-console
    console.info('opencue: checking for updates…');
  });
  autoUpdater.on('update-available', (info) => {
    // eslint-disable-next-line no-console
    console.info(`opencue: update available — ${info.version}`);
  });
  autoUpdater.on('update-not-available', () => {
    // eslint-disable-next-line no-console
    console.info('opencue: no update available.');
  });
  autoUpdater.on('download-progress', (progress) => {
    // eslint-disable-next-line no-console
    console.info(
      `opencue: update download ${progress.percent.toFixed(1)}% (${Math.round(progress.bytesPerSecond / 1024)} KB/s)`,
    );
  });
  autoUpdater.on('update-downloaded', (info) => {
    // eslint-disable-next-line no-console
    console.info(
      `opencue: update ${info.version} downloaded; will install on next quit.`,
    );
  });
  autoUpdater.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.warn('opencue: auto-update error:', err.message);
  });

  // Don't block startup — fire-and-forget after the first window opens.
  setTimeout(() => {
    void autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
  }, 5_000);
}
