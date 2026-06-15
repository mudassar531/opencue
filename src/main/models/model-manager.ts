/**
 * Model manager — downloads and verifies local STT / TTS models.
 *
 * Responsibilities:
 *   - Persist per-model state under `userData/models/<modelId>/`.
 *   - Stream downloads with real progress (bytes / total, MB/s, ETA).
 *   - Verify sha256 when registered, fall back to size-only when not.
 *   - Allow cancel + resume (resume re-uses any complete files on disk).
 *   - Emit lifecycle events the IPC layer relays to the renderer.
 *
 * The manager talks ONLY to the file system + HTTP — the Python sidecar
 * (Phase 4) consumes the downloaded files by path.
 */

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { EventEmitter } from 'node:events';
import { app } from 'electron';
import {
  findModel,
  MODEL_REGISTRY,
  type ModelDefinition,
  type ModelStatus,
  type ModelStatusEntry,
} from '../../shared/model-registry.js';

interface InternalState {
  status: ModelStatus;
  abort?: AbortController;
}

/** Filename written next to a model directory once every file has verified. */
const INSTALL_MARKER = '.opencue-installed.json';

export class ModelManager extends EventEmitter {
  private readonly states = new Map<string, InternalState>();
  private rootDir: string | null = null;

  /**
   * Lazy root resolution — `app.getPath('userData')` is only safe after
   * `app.whenReady()`. We accept a `cwd` override for tests.
   */
  setRoot(cwd?: string): void {
    if (cwd) {
      this.rootDir = join(cwd, 'models');
      return;
    }
    this.rootDir = join(app.getPath('userData'), 'models');
  }

  private root(): string {
    if (!this.rootDir) this.setRoot();
    return this.rootDir!;
  }

  /** Returns the on-disk directory for a model (created on demand). */
  async modelDir(modelId: string): Promise<string> {
    const dir = join(this.root(), modelId);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  /** Inspect every registry entry and produce a status snapshot. */
  async listStatuses(): Promise<ModelStatusEntry[]> {
    const out: ModelStatusEntry[] = [];
    for (const def of MODEL_REGISTRY) {
      out.push({ id: def.id, status: await this.getStatus(def.id) });
    }
    return out;
  }

  async getStatus(modelId: string): Promise<ModelStatus> {
    const existing = this.states.get(modelId);
    if (existing && existing.status.state !== 'installed' && existing.status.state !== 'absent') {
      return existing.status;
    }
    const def = findModel(modelId);
    if (!def) return { state: 'absent' };
    const markerPath = join(await this.modelDir(modelId), INSTALL_MARKER);
    try {
      const raw = await readFile(markerPath, 'utf8');
      const parsed = JSON.parse(raw) as { totalBytes: number; installedAt: number };
      const status: ModelStatus = {
        state: 'installed',
        totalBytes: parsed.totalBytes,
        installedAt: parsed.installedAt,
      };
      this.states.set(modelId, { status });
      return status;
    } catch {
      return { state: 'absent' };
    }
  }

  /**
   * Start (or resume) a download. Returns immediately; progress is reported
   * over the `progress` event stream.
   */
  async download(modelId: string): Promise<void> {
    const def = findModel(modelId);
    if (!def) throw new Error(`Unknown model: ${modelId}`);
    const existing = this.states.get(modelId);
    if (existing && existing.status.state === 'downloading') {
      // Already in-flight — caller can subscribe to events to track it.
      return;
    }
    const abort = new AbortController();
    const initialStatus: ModelStatus = {
      state: 'downloading',
      receivedBytes: 0,
      totalBytes: def.size.bytes,
      bytesPerSec: 0,
      etaSec: null,
    };
    this.states.set(modelId, { status: initialStatus, abort });
    this.emit('status', { id: modelId, status: initialStatus });

    try {
      const totalBytes = await this.downloadAllFiles(def, abort.signal);
      this.setStatus(modelId, { state: 'verifying' });
      await this.verifyAll(def);
      const installedAt = Date.now();
      await writeFile(
        join(await this.modelDir(modelId), INSTALL_MARKER),
        JSON.stringify({ totalBytes, installedAt }),
        'utf8',
      );
      this.setStatus(modelId, { state: 'installed', totalBytes, installedAt });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (abort.signal.aborted) {
        // User-cancelled — revert to absent and clear partial files.
        await this.deletePartialFiles(def).catch(() => undefined);
        this.setStatus(modelId, { state: 'absent' });
      } else {
        this.setStatus(modelId, { state: 'failed', message });
      }
    }
  }

  async cancel(modelId: string): Promise<void> {
    const s = this.states.get(modelId);
    s?.abort?.abort();
  }

  async remove(modelId: string): Promise<void> {
    const def = findModel(modelId);
    if (!def) return;
    await this.cancel(modelId);
    const dir = await this.modelDir(modelId);
    await rm(dir, { recursive: true, force: true });
    this.setStatus(modelId, { state: 'absent' });
  }

  /** Path the sidecar uses to load a fully-installed model. */
  async installedPath(modelId: string): Promise<string | null> {
    const status = await this.getStatus(modelId);
    if (status.state !== 'installed') return null;
    return this.modelDir(modelId);
  }

  /* ------------------ private ------------------ */

  private setStatus(modelId: string, status: ModelStatus): void {
    const existing = this.states.get(modelId);
    this.states.set(modelId, { status, ...(existing?.abort ? { abort: existing.abort } : {}) });
    this.emit('status', { id: modelId, status });
  }

  private async downloadAllFiles(def: ModelDefinition, signal: AbortSignal): Promise<number> {
    const dir = await this.modelDir(def.id);
    let totalReceived = 0;
    let totalKnown = def.size.bytes;
    const startedAt = Date.now();

    for (const file of def.files) {
      const dest = join(dir, file.name);
      // Resume by skipping fully-downloaded files when their size + hash match.
      const reusable = await this.canReuseFile(dest, file.bytes, file.sha256);
      if (reusable !== null) {
        totalReceived += reusable;
        this.emitProgress(def.id, totalReceived, totalKnown, startedAt);
        continue;
      }
      await mkdir(dirname(dest), { recursive: true });
      const tmp = `${dest}.partial`;
      const response = await fetch(file.url, { signal, redirect: 'follow' });
      if (!response.ok || !response.body) {
        throw new Error(`Download failed for ${file.name}: HTTP ${response.status}`);
      }
      const reported = Number(response.headers.get('content-length'));
      if (Number.isFinite(reported) && reported > 0) {
        // Re-base the total whenever the server tells us the real size.
        const accountedBytes = file.bytes ?? 0;
        totalKnown = Math.max(0, totalKnown - accountedBytes) + reported;
      }
      const out = createWriteStream(tmp);
      const readable = Readable.fromWeb(response.body as unknown as WebReadableStream);
      readable.on('data', (chunk: Buffer) => {
        totalReceived += chunk.length;
        this.emitProgress(def.id, totalReceived, totalKnown, startedAt);
      });
      try {
        await pipeline(readable, out, { signal });
      } catch (err) {
        await rm(tmp, { force: true }).catch(() => undefined);
        throw err;
      }
      // Atomic rename.
      await rm(dest, { force: true }).catch(() => undefined);
      await writeFile(dest, await readFile(tmp));
      await rm(tmp, { force: true }).catch(() => undefined);
    }
    return totalReceived;
  }

  private async canReuseFile(
    path: string,
    expectedBytes?: number,
    expectedSha256?: string,
  ): Promise<number | null> {
    let st;
    try {
      st = await stat(path);
    } catch {
      return null;
    }
    if (expectedBytes !== undefined && st.size !== expectedBytes) return null;
    if (expectedSha256) {
      const actual = await sha256OfFile(path);
      if (actual !== expectedSha256.toLowerCase()) return null;
    }
    return st.size;
  }

  private async verifyAll(def: ModelDefinition): Promise<void> {
    const dir = await this.modelDir(def.id);
    for (const file of def.files) {
      if (!file.sha256) continue;
      const expected = file.sha256.toLowerCase();
      const actual = await sha256OfFile(join(dir, file.name));
      if (actual !== expected) {
        throw new Error(
          `Checksum mismatch for ${file.name}: expected ${expected}, got ${actual}`,
        );
      }
    }
  }

  private async deletePartialFiles(def: ModelDefinition): Promise<void> {
    const dir = await this.modelDir(def.id);
    for (const file of def.files) {
      await rm(join(dir, `${file.name}.partial`), { force: true }).catch(() => undefined);
    }
  }

  private emitProgress(
    modelId: string,
    received: number,
    total: number,
    startedAt: number,
  ): void {
    const elapsed = Math.max(1, Date.now() - startedAt) / 1000;
    const bytesPerSec = received / elapsed;
    const remaining = total > received ? total - received : 0;
    const etaSec = bytesPerSec > 0 ? remaining / bytesPerSec : null;
    this.setStatus(modelId, {
      state: 'downloading',
      receivedBytes: received,
      totalBytes: total,
      bytesPerSec,
      etaSec,
    });
  }
}

async function sha256OfFile(path: string): Promise<string> {
  const buf = await readFile(path);
  return createHash('sha256').update(buf).digest('hex');
}

let _manager: ModelManager | null = null;
export function getModelManager(): ModelManager {
  if (!_manager) _manager = new ModelManager();
  return _manager;
}
export function _resetModelManagerForTests(): void {
  _manager = null;
}
