/**
 * Lock-free single-producer / single-consumer ring buffer of Float32 samples.
 *
 * Used by the audio pipeline to retain the most-recent N seconds of normalized
 * PCM so a finalized speech segment can be reconstructed even when the VAD
 * fires retroactively (Silero's frame-by-frame detection means the actual
 * speech start is a few frames behind the trigger).
 *
 * The implementation is intentionally simple — it's tuned for the
 * Phase-2 use case where one AudioWorklet writes and one main-thread
 * consumer reads. We do NOT use a SharedArrayBuffer here; that level of
 * concurrency support arrives if/when we move VAD off the main thread in
 * a later phase.
 */

/** Configuration for `RingBuffer`. */
export interface RingBufferOptions {
  /** Maximum capacity in samples. Must be a positive integer. */
  capacity: number;
}

export class RingBuffer {
  readonly capacity: number;
  private readonly data: Float32Array;
  /** Index of the next slot to write. */
  private writePos = 0;
  /** Total samples ever written. Used to detect overruns and to seek by time. */
  private totalWritten = 0;

  constructor(options: RingBufferOptions) {
    if (!Number.isInteger(options.capacity) || options.capacity <= 0) {
      throw new RangeError(`RingBuffer capacity must be a positive integer; got ${options.capacity}`);
    }
    this.capacity = options.capacity;
    this.data = new Float32Array(options.capacity);
  }

  /** How many samples have ever been written. Monotonic. */
  get totalWrittenSamples(): number {
    return this.totalWritten;
  }

  /** How many samples are currently retained (capped at `capacity`). */
  get availableSamples(): number {
    return Math.min(this.totalWritten, this.capacity);
  }

  /** Append samples. If the input is larger than `capacity`, only the tail is kept. */
  write(samples: Float32Array): void {
    const n = samples.length;
    if (n === 0) return;
    if (n >= this.capacity) {
      // Keep only the most recent `capacity` samples — the rest would be evicted anyway.
      this.data.set(samples.subarray(n - this.capacity));
      this.writePos = 0;
      this.totalWritten += n;
      return;
    }
    const tailRoom = this.capacity - this.writePos;
    if (n <= tailRoom) {
      this.data.set(samples, this.writePos);
    } else {
      this.data.set(samples.subarray(0, tailRoom), this.writePos);
      this.data.set(samples.subarray(tailRoom));
    }
    this.writePos = (this.writePos + n) % this.capacity;
    this.totalWritten += n;
  }

  /**
   * Read the `count` most recent samples into a freshly-allocated `Float32Array`.
   * If fewer samples are available, returns whatever is currently retained.
   */
  readLast(count: number): Float32Array {
    const available = this.availableSamples;
    const want = Math.min(Math.max(0, Math.floor(count)), available);
    const out = new Float32Array(want);
    if (want === 0) return out;
    // Earliest retained sample index in the underlying buffer.
    const startInBuffer = (this.writePos - want + this.capacity) % this.capacity;
    if (startInBuffer + want <= this.capacity) {
      out.set(this.data.subarray(startInBuffer, startInBuffer + want));
    } else {
      const head = this.capacity - startInBuffer;
      out.set(this.data.subarray(startInBuffer));
      out.set(this.data.subarray(0, want - head), head);
    }
    return out;
  }

  /** Discard all retained samples. Capacity is preserved. */
  clear(): void {
    this.writePos = 0;
    this.totalWritten = 0;
    this.data.fill(0);
  }
}
