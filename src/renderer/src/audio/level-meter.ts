/**
 * Pure audio-level helpers — RMS and peak detection on Float32 PCM frames.
 *
 * Used by the UI level meter and by the segment metadata (we annotate every
 * emitted speech segment with its RMS so the renderer can render an instant
 * "loudness" indicator without re-decoding the audio).
 */

/**
 * Root-mean-square level of a PCM frame in linear [0, 1] units.
 * Returns 0 for an empty frame.
 */
export function rms(samples: Float32Array): number {
  const n = samples.length;
  if (n === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < n; i += 1) {
    const s = samples[i] ?? 0;
    sumSq += s * s;
  }
  const mean = sumSq / n;
  // Clamp tiny negatives from FP error.
  return Math.sqrt(Math.max(0, mean));
}

/** Absolute peak amplitude in linear [0, 1]. */
export function peak(samples: Float32Array): number {
  let p = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.abs(samples[i] ?? 0);
    if (v > p) p = v;
  }
  return p;
}

/** Convert linear amplitude to dBFS. -∞ for silence; capped at -120 dB for finite floor. */
export function toDbFs(amplitude: number): number {
  if (amplitude <= 0) return -120;
  return Math.max(-120, 20 * Math.log10(amplitude));
}

/**
 * Map a dBFS value (typically [-60, 0]) to a [0, 1] meter position with a
 * piecewise-linear curve that gives extra resolution near speech levels.
 */
export function dbFsToMeter(db: number, floorDb = -60): number {
  if (!Number.isFinite(db)) return 0;
  if (db >= 0) return 1;
  if (db <= floorDb) return 0;
  return (db - floorDb) / -floorDb;
}
