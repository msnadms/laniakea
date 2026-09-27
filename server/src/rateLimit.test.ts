import { describe, expect, it } from 'vitest';
import { TokenBuckets } from './rateLimit';

describe('token buckets', () => {
  it('spends a full bucket, then waits for the refill', () => {
    const buckets = new TokenBuckets({ capacity: 3, refillPerSecond: 0.5 });
    expect([0, 1, 2].map(() => buckets.take('a', 0))).toEqual([0, 0, 0]);
    expect(buckets.take('a', 0)).toBe(2);
    expect(buckets.take('b', 0)).toBe(0);
    expect(buckets.take('a', 2000)).toBe(0);
    expect(buckets.take('a', 2000)).toBe(2);
  });

  it('never fills past its capacity', () => {
    const buckets = new TokenBuckets({ capacity: 2, refillPerSecond: 1 });
    buckets.take('a', 0);
    const spent = [0, 1, 2].map(() => buckets.take('a', 60_000));
    expect(spent).toEqual([0, 0, 1]);
  });
});
