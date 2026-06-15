import { describe, expect, it } from 'vitest';
import { IpcChannel, IpcEvent } from './ipc-contract';

describe('IPC contract', () => {
  it('uses stable namespaced channel strings', () => {
    expect(IpcChannel.AppGetVersion).toBe('app:get-version');
    expect(IpcChannel.AppGetPlatform).toBe('app:get-platform');
    expect(IpcChannel.AppPing).toBe('app:ping');
  });

  it('has unique channel names across the whole contract', () => {
    const values = Object.values(IpcChannel);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('uses a colon-separated namespace prefix for every channel', () => {
    for (const channel of Object.values(IpcChannel)) {
      expect(channel).toMatch(/^[a-z]+:[a-z]/);
    }
  });

  it('has unique event names', () => {
    const values = Object.values(IpcEvent);
    expect(new Set(values).size).toBe(values.length);
  });

  it('event names do not collide with channel names', () => {
    const channels = new Set<string>(Object.values(IpcChannel));
    for (const event of Object.values(IpcEvent)) {
      expect(channels.has(event)).toBe(false);
    }
  });

  it('prefixes push events with "event:" so they are distinguishable from invokes', () => {
    for (const event of Object.values(IpcEvent)) {
      expect(event.startsWith('event:')).toBe(true);
    }
  });
});
