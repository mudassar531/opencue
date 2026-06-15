/**
 * On-demand screen capture for the Ask-bar (Phase 5).
 *
 * Uses `desktopCapturer.getSources` to grab a still of a screen or window.
 * Crucially, opencue's overlay is created with `setContentProtection(true)`,
 * which excludes it from every Chromium / OS capture path on Windows and
 * macOS. We additionally HIDE the overlay window before capture as a
 * belt-and-braces measure for OSes / drivers where content-protection isn't
 * honored (Linux). The previous visibility is restored once the capture
 * completes, regardless of success.
 */

import { desktopCapturer, screen } from 'electron';
import { getOverlayManager } from '../overlay/overlay-window.js';

export interface ScreenCaptureSource {
  /** desktopCapturer source id. */
  id: string;
  /** Human-readable name. */
  label: string;
  /** 'screen' or 'window'. */
  kind: 'screen' | 'window';
}

export interface ScreenCaptureResult {
  /** Inline image (PNG). Suitable for `<img src>` or LLM image payloads. */
  dataUrl: string;
  /** Source that produced it. */
  source: ScreenCaptureSource;
  /** Captured-image dimensions in CSS pixels. */
  width: number;
  height: number;
  /** Approximate PNG byte size. */
  byteSize: number;
}

const DEFAULT_THUMBNAIL_SIZE = { width: 1920, height: 1200 };

export async function listScreenCaptureSources(): Promise<ScreenCaptureSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false,
  });
  return sources.map((s) => ({
    id: s.id,
    label: s.name || (s.id.startsWith('screen:') ? 'Screen' : 'Window'),
    kind: s.id.startsWith('screen:') ? 'screen' : 'window',
  }));
}

/**
 * Capture the primary screen (or a specific source if `sourceId` is supplied).
 *
 * Hides the overlay during the capture so it cannot accidentally appear in
 * the shot on OSes that don't honor `setContentProtection`. The previous
 * visibility is restored even when the capture throws.
 */
export async function captureScreen(options: { sourceId?: string } = {}): Promise<ScreenCaptureResult> {
  // Probe display sizes so we ask desktopCapturer for the right resolution.
  const primary = screen.getPrimaryDisplay();
  const sizeHint = {
    width: Math.max(DEFAULT_THUMBNAIL_SIZE.width, primary.size.width),
    height: Math.max(DEFAULT_THUMBNAIL_SIZE.height, primary.size.height),
  };

  const overlay = getOverlayManager();
  const stateBefore = overlay.getState();
  if (stateBefore.visible) {
    overlay.hide();
    // Give the compositor a frame to release the overlay. Without this the
    // overlay can still appear in screenshots taken immediately after.
    await new Promise((r) => setTimeout(r, 50));
  }

  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: sizeHint,
      fetchWindowIcons: false,
    });
    if (sources.length === 0) {
      throw new Error(
        'No capturable sources available. Grant Screen Recording permission and try again.',
      );
    }
    const picked =
      (options.sourceId ? sources.find((s) => s.id === options.sourceId) : undefined) ??
      sources.find((s) => s.id.startsWith('screen:')) ??
      sources[0]!;

    const dataUrl = picked.thumbnail.toDataURL();
    if (!dataUrl || picked.thumbnail.isEmpty()) {
      throw new Error('Screen capture returned an empty image.');
    }
    const size = picked.thumbnail.getSize();
    return {
      dataUrl,
      source: {
        id: picked.id,
        label: picked.name || (picked.id.startsWith('screen:') ? 'Screen' : 'Window'),
        kind: picked.id.startsWith('screen:') ? 'screen' : 'window',
      },
      width: size.width,
      height: size.height,
      byteSize: estimateDataUrlBytes(dataUrl),
    };
  } finally {
    if (stateBefore.visible) {
      overlay.show();
    }
  }
}

function estimateDataUrlBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) return 0;
  const b64 = dataUrl.slice(commaIdx + 1);
  // Base64 → bytes: 4 base64 chars → 3 bytes (minus padding).
  let padding = 0;
  if (b64.endsWith('==')) padding = 2;
  else if (b64.endsWith('=')) padding = 1;
  return Math.floor((b64.length * 3) / 4) - padding;
}
