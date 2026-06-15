import { describe, expect, it } from 'vitest';
import { dbFsToMeter, peak, rms, toDbFs } from './level-meter';

describe('rms', () => {
  it('is zero for an empty frame', () => {
    expect(rms(new Float32Array(0))).toBe(0);
  });

  it('is zero for a silent frame', () => {
    expect(rms(new Float32Array([0, 0, 0, 0]))).toBe(0);
  });

  it('matches a hand-computed example', () => {
    // RMS of [1, -1, 1, -1] = sqrt(1) = 1
    expect(rms(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(1, 6);
    // RMS of [0.5, -0.5] = 0.5
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5, 6);
  });

  it('is non-negative for any finite input', () => {
    expect(rms(new Float32Array([-0.3, 0.2, -0.1, 0.4]))).toBeGreaterThanOrEqual(0);
  });
});

describe('peak', () => {
  it('returns the absolute maximum', () => {
    expect(peak(new Float32Array([-0.8, 0.3, -0.4]))).toBeCloseTo(0.8, 6);
    expect(peak(new Float32Array([0.1, 0.2, 0.05]))).toBeCloseTo(0.2, 6);
  });

  it('returns 0 for an empty / silent frame', () => {
    expect(peak(new Float32Array(0))).toBe(0);
    expect(peak(new Float32Array([0, 0, 0]))).toBe(0);
  });
});

describe('toDbFs', () => {
  it('returns 0 dB for full-scale amplitude', () => {
    expect(toDbFs(1)).toBeCloseTo(0, 4);
  });
  it('returns -6 dB for half amplitude', () => {
    expect(toDbFs(0.5)).toBeCloseTo(-6.0206, 3);
  });
  it('returns the floor for silence', () => {
    expect(toDbFs(0)).toBe(-120);
    expect(toDbFs(-1)).toBe(-120);
  });
});

describe('dbFsToMeter', () => {
  it('returns 1 at or above 0 dB', () => {
    expect(dbFsToMeter(0)).toBe(1);
    expect(dbFsToMeter(3)).toBe(1);
  });
  it('returns 0 at the floor', () => {
    expect(dbFsToMeter(-60)).toBe(0);
    expect(dbFsToMeter(-90)).toBe(0);
  });
  it('linearly maps mid-range values', () => {
    expect(dbFsToMeter(-30)).toBeCloseTo(0.5, 4);
    expect(dbFsToMeter(-12)).toBeCloseTo(0.8, 4);
  });
});