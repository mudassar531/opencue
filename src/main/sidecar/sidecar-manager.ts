/**
 * Python sidecar lifecycle manager.
 *
 * The sidecar is a small Python aiohttp server (see `sidecar/`) that exposes
 * JSON-RPC over a localhost WebSocket. In Phase 4 we run it from the user's
 * `python3` interpreter — Phase 7 packages it with PyInstaller so end users
 * don't need Python.
 *
 * Lifecycle:
 *   spawn → health-poll (waits for "ready") → in-use → graceful shutdown
 *
 * The manager surfaces a 3-state status (`stopped` / `starting` / `running` /
 * `error`) over IPC so the renderer can show a clear "Python sidecar not
 * installed" message instead of a low-level error.
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
import { app } from 'electron';

export type SidecarStatus =
  | { state: 'stopped' }
  | { state: 'starting'; pid: number; startedAt: number }
  | { state: 'running'; pid: number; startedAt: number; port: number }
  | { state: 'error'; message: string };

export interface SidecarSpawnOptions {
  /** Override `python3` binary. */
  python?: string;
  /** Override the sidecar script path (defaults to bundled `sidecar/main.py`). */
  scriptPath?: string;
  /** Port the sidecar should listen on. */
  port?: number;
  /** ms to wait for the sidecar to print 'opencue-sidecar ready' before giving up. */
  readyTimeoutMs?: number;
  /** Where the sidecar should store models (defaults to userData/models). */
  modelsDir?: string;
}

const DEFAULT_PORT = 8763;
const DEFAULT_READY_TIMEOUT_MS = 15_000;
const READY_MARKER = 'opencue-sidecar ready';

type SidecarChild = ChildProcessByStdio<null, Readable, Readable>;

export class SidecarManager extends EventEmitter {
  private status: SidecarStatus = { state: 'stopped' };
  private child: SidecarChild | null = null;

  getStatus(): SidecarStatus {
    return this.status;
  }

  /** Resolve the path to `sidecar/main.py` in dev or in the packaged app. */
  defaultScriptPath(): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, 'sidecar', 'main.py');
    }
    // In dev the cwd is the project root.
    return join(app.getAppPath(), 'sidecar', 'main.py');
  }

  async checkScriptExists(scriptPath?: string): Promise<boolean> {
    const candidate = scriptPath ?? this.defaultScriptPath();
    try {
      const s = await stat(candidate);
      return s.isFile();
    } catch {
      return false;
    }
  }

  async start(options: SidecarSpawnOptions = {}): Promise<SidecarStatus> {
    if (this.status.state === 'running' || this.status.state === 'starting') {
      return this.status;
    }
    const python = options.python ?? (process.platform === 'win32' ? 'python' : 'python3');
    const scriptPath = options.scriptPath ?? this.defaultScriptPath();
    const port = options.port ?? DEFAULT_PORT;
    const readyTimeout = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    const modelsDir = options.modelsDir ?? join(app.getPath('userData'), 'models');

    if (!existsSync(scriptPath)) {
      return this.fail(
        `Sidecar script not found at ${scriptPath}. See README → 'Local inference' to install it.`,
      );
    }

    let child: SidecarChild;
    try {
      child = spawn(python, [scriptPath, '--port', String(port), '--models-dir', modelsDir], {
        env: { ...process.env, OPENCUE_SIDECAR_PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      return this.fail(
        `Failed to spawn '${python}': ${err instanceof Error ? err.message : String(err)}. ` +
          `Install Python 3.10+ and try again.`,
      );
    }

    this.child = child;
    this.setStatus({ state: 'starting', pid: child.pid ?? -1, startedAt: Date.now() });

    return new Promise<SidecarStatus>((resolve) => {
      let resolved = false;
      const finish = (status: SidecarStatus): void => {
        if (resolved) return;
        resolved = true;
        this.setStatus(status);
        resolve(status);
      };

      const timeout = setTimeout(() => {
        finish({
          state: 'error',
          message: `Sidecar didn't report ready within ${readyTimeout}ms.`,
        });
      }, readyTimeout);

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        // Forward each line so the UI / logs can surface it.
        this.emit('log', { stream: 'stdout', text });
        if (text.includes(READY_MARKER)) {
          clearTimeout(timeout);
          finish({
            state: 'running',
            pid: child.pid ?? -1,
            startedAt: Date.now(),
            port,
          });
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        this.emit('log', { stream: 'stderr', text: chunk.toString('utf8') });
      });
      child.on('error', (err) => {
        clearTimeout(timeout);
        finish({ state: 'error', message: err.message });
      });
      child.on('exit', (code, signal) => {
        clearTimeout(timeout);
        this.child = null;
        if (this.status.state === 'starting' || this.status.state === 'running') {
          finish({
            state: 'error',
            message: `Sidecar exited (code=${code}, signal=${signal ?? 'none'}).`,
          });
        } else {
          this.setStatus({ state: 'stopped' });
        }
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.child) {
      this.setStatus({ state: 'stopped' });
      return;
    }
    const pid = this.child.pid ?? 0;
    try {
      this.child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    // Hard-kill after a short grace.
    const child = this.child;
    setTimeout(() => {
      try {
        if (pid > 0 && !child.killed) child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, 1500);
    this.child = null;
    this.setStatus({ state: 'stopped' });
  }

  private fail(message: string): SidecarStatus {
    const status: SidecarStatus = { state: 'error', message };
    this.setStatus(status);
    return status;
  }

  private setStatus(status: SidecarStatus): void {
    this.status = status;
    this.emit('status', status);
  }
}

let _manager: SidecarManager | null = null;
export function getSidecarManager(): SidecarManager {
  if (!_manager) _manager = new SidecarManager();
  return _manager;
}
export function _resetSidecarManagerForTests(): void {
  _manager = null;
}
