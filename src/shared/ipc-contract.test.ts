import { describe, expect, it } from 'vitest';
import { IpcChannel } from './ipc-contract';

describe('IPC contract', () => {
  it('uses stable namespaced channel strings', () => {
    expect(IpcChannel.AppGetVersion).toBe('app:get-version');
    expect(IpcChannel.AppGetPlatform).toBe('app:get-platform');
    expect(IpcChannel.AppPing).toBe('app:ping');
  });

  it('has unique channel names', () => {
    const values = Object.values(IpcChannel);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('uses the `app:` prefix for app-scope channels', () => {
    const appChannels = [
      IpcChannel.AppGetVersion,
      IpcChannel.AppGetPlatform,
      IpcChannel.AppPing,
    ];
    for (const channel of appChannels) {
      expect(channel.startsWith('app:')).toBe(true);
    }
  });
});
