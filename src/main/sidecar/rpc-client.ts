/**
 * WebSocket JSON-RPC client for the Python sidecar.
 *
 * Tiny on purpose: opens a single ws://127.0.0.1:<port>/rpc connection, sends
 * `{ id, method, params }` requests and resolves the matching `{ id, result }`
 * or `{ id, error }` reply. Reconnects are handled by callers — each provider
 * grabs a fresh client per call so a single failure doesn't poison subsequent
 * requests.
 */

import { WebSocket } from 'ws';
import { ProviderError } from '../../shared/provider-types.js';
import { getSidecarManager } from './sidecar-manager.js';

const REQUEST_TIMEOUT_MS = 60_000;

export interface SidecarRpcOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function sidecarRpc<T>(
  method: string,
  params: Record<string, unknown>,
  providerIdForError: string,
  options: SidecarRpcOptions = {},
): Promise<T> {
  const status = getSidecarManager().getStatus();
  if (status.state !== 'running') {
    throw new ProviderError(
      'unknown',
      providerIdForError,
      `Python sidecar is not running (state: ${status.state}). Start it from the Local models panel first.`,
    );
  }
  const url = `ws://127.0.0.1:${status.port}/rpc`;
  const ws = new WebSocket(url);
  const id = Math.floor(Math.random() * 0x7fffffff).toString(16);
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new ProviderError(
          'timeout',
          providerIdForError,
          `Sidecar call ${method} timed out after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    const onAbort = (): void => {
      cleanup();
      clearTimeout(timeout);
      reject(new ProviderError('aborted', providerIdForError, 'Aborted by caller'));
    };
    if (options.signal) {
      if (options.signal.aborted) return onAbort();
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    ws.on('open', () => {
      try {
        ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        cleanup();
        clearTimeout(timeout);
        reject(
          new ProviderError(
            'network',
            providerIdForError,
            `Failed to send to sidecar: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    });

    ws.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as
          | { id: string; result: T }
          | { id: string; error: { message: string } };
        if (message.id !== id) return;
        clearTimeout(timeout);
        cleanup();
        if ('error' in message) {
          reject(new ProviderError('unknown', providerIdForError, message.error.message));
        } else {
          resolve(message.result);
        }
      } catch (err) {
        clearTimeout(timeout);
        cleanup();
        reject(
          new ProviderError(
            'unknown',
            providerIdForError,
            `Malformed sidecar reply: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      cleanup();
      reject(
        new ProviderError(
          'network',
          providerIdForError,
          `Sidecar connection error: ${err.message}`,
        ),
      );
    });

    ws.on('close', () => {
      if (!settled) {
        clearTimeout(timeout);
        reject(
          new ProviderError(
            'network',
            providerIdForError,
            'Sidecar connection closed before reply',
          ),
        );
      }
    });
  });
}
