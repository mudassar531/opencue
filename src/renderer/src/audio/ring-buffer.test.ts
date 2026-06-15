import { describe, expect, it } from 'vitest';
import { RingBuffer } from './ring-buffer';

function range(n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = i;
  return out;
}

describe('RingBuffer', () => {
  it('rejects invalid capacity', () => {
    expect(() => new RingBuffer({ capacity: 0 })).toThrow(RangeError);
    expect(() => new RingBuffer({ capacity: -1 })).toThrow(RangeError);
    expect(() => new RingBuffer({ capacity: 1.5 })).toThrow(RangeError);
  });

  it('reports zero availability before any writes', () => {
    const rb = new RingBuffer({ capacity: 10 });
    expect(rb.availableSamples).toBe(0);
    expect(rb.totalWrittenSamples).toBe(0);
    expect(rb.readLast(5)).toEqual(new Float32Array(0));
  });

  it('preserves recent samples when under capacity', () => {
    const rb = new RingBuffer({ capacity: 10 });
    rb.write(range(4));
    expect(rb.availableSamples).toBe(4);
    expect(Array.from(rb.readLast(4))).toEqual([0, 1, 2, 3]);
    expect(Array.from(rb.readLast(10))).toEqual([0, 1, 2, 3]); // clamped
  });

  it('returns only the requested tail when reading less than available', () => {
    const rb = new RingBuffer({ capacity: 10 });
    rb.write(range(8));
    expect(Array.from(rb.readLast(3))).toEqual([5, 6, 7]);
  });

  it('evicts oldest samples when writes exceed capacity', () => {
    const rb = new RingBuffer({ capacity: 5 });
    rb.write(range(8)); // 0..7 → only 3..7 retained
    expect(rb.availableSamples).toBe(5);
    expect(Array.from(rb.readLast(5))).toEqual([3, 4, 5, 6, 7]);
    expect(rb.totalWrittenSamples).toBe(8);
  });

  it('wraps correctly across the buffer boundary', () => {
    const rb = new RingBuffer({ capacity: 6 });
    rb.write(range(4)); // [0,1,2,3, _,_]  writePos = 4
    rb.write(range(4).map((v) => v + 100)); // appends 100,101,102,103 → wraps
    // After: data is [102,103, 2,3,100,101] but logical tail is 0..7 of which
    // we keep the 6 most recent: 2,3,100,101,102,103.
    expect(Array.from(rb.readLast(6))).toEqual([2, 3, 100, 101, 102, 103]);
    expect(rb.totalWrittenSamples).toBe(8);
  });

  it('handles a write larger than capacity by keeping only the tail', () => {
    const rb = new RingBuffer({ capacity: 4 });
    const big = range(10); // 0..9 → keep 6..9
    rb.write(big);
    expect(rb.availableSamples).toBe(4);
    expect(Array.from(rb.readLast(4))).toEqual([6, 7, 8, 9]);
    expect(rb.totalWrittenSamples).toBe(10);
  });

  it('clear() resets state but preserves capacity', () => {
    const rb = new RingBuffer({ capacity: 5 });
    rb.write(range(3));
    rb.clear();
    expect(rb.availableSamples).toBe(0);
    expect(rb.totalWrittenSamples).toBe(0);
    expect(rb.capacity).toBe(5);
    expect(Array.from(rb.readLast(5))).toEqual([]);
  });

  it('reading 0 (or a negative count) returns an empty array', () => {
    const rb = new RingBuffer({ capacity: 5 });
    rb.write(range(3));
    expect(rb.readLast(0)).toEqual(new Float32Array(0));
    expect(rb.readLast(-7)).toEqual(new Float32Array(0));
  });
});
