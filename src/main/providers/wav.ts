/**
 * Pure WAV encoder for Float32 PCM segments.
 *
 * Cloud STT providers (OpenAI Whisper, AssemblyAI, Deepgram batch) accept a
 * standard PCM WAV upload. The renderer ships the segment's raw Float32 over
 * IPC, and we encode it here in main before posting to the provider.
 */

/**
 * Build a single-channel 16-bit PCM WAV from Float32 samples in [-1, 1].
 */
export function encodeWavFromFloat32(samples: Float32Array, sampleRate: number): Uint8Array {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`encodeWavFromFloat32: invalid sample rate ${sampleRate}`);
  }
  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header.
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');

  // fmt chunk.
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);

  // data chunk.
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Sample payload.
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const raw = samples[i] ?? 0;
    const clamped = raw < -1 ? -1 : raw > 1 ? 1 : raw;
    view.setInt16(offset, Math.round(clamped * 0x7fff), true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
