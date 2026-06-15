import { describe, expect, it } from 'vitest';
import { OverlayPosition } from '../../shared/settings-schema';
import { computePresetPosition } from './overlay-window';

const display = {
  workArea: { x: 0, y: 0, width: 1920, height: 1080 },
} as const;

describe('computePresetPosition', () => {
  const w = 400;
  const h = 300;
  const pad = 24;

  it('places TopLeft at workArea origin + padding', () => {
    expect(computePresetPosition(OverlayPosition.TopLeft, display, w, h, pad)).toEqual({
      x: pad,
      y: pad,
    });
  });

  it('places TopRight against the right edge', () => {
    const p = computePresetPosition(OverlayPosition.TopRight, display, w, h, pad);
    expect(p.x).toBe(display.workArea.width - w - pad);
    expect(p.y).toBe(pad);
  });

  it('places BottomLeft against the bottom edge', () => {
    const p = computePresetPosition(OverlayPosition.BottomLeft, display, w, h, pad);
    expect(p.x).toBe(pad);
    expect(p.y).toBe(display.workArea.height - h - pad);
  });

  it('places BottomRight in the bottom-right corner', () => {
    const p = computePresetPosition(OverlayPosition.BottomRight, display, w, h, pad);
    expect(p.x).toBe(display.workArea.width - w - pad);
    expect(p.y).toBe(display.workArea.height - h - pad);
  });

  it('centers when preset is Center', () => {
    const p = computePresetPosition(OverlayPosition.Center, display, w, h, pad);
    expect(p.x).toBe((display.workArea.width - w) / 2);
    expect(p.y).toBe((display.workArea.height - h) / 2);
  });

  it('handles a non-zero workArea origin (e.g. macOS menu bar)', () => {
    const macDisplay = { workArea: { x: 0, y: 25, width: 1920, height: 1055 } };
    const p = computePresetPosition(OverlayPosition.TopLeft, macDisplay, w, h, pad);
    expect(p).toEqual({ x: pad, y: 25 + pad });
  });

  it('keeps the overlay on-screen when the window is larger than the work area', () => {
    const tinyDisplay = { workArea: { x: 0, y: 0, width: 100, height: 100 } };
    const p = computePresetPosition(OverlayPosition.BottomRight, tinyDisplay, 400, 300, pad);
    // The bottom-right snap falls back to the padded minimum corner rather
    // than producing a negative coordinate that would push the window off-screen.
    expect(p.x).toBeGreaterThanOrEqual(pad);
    expect(p.y).toBeGreaterThanOrEqual(pad);
  });
});
