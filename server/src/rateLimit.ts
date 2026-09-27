export interface TokenBucketOptions {
  capacity: number;
  refillPerSecond: number;
}

interface Bucket {
  tokens: number;
  at: number;
}

export class TokenBuckets {
  private readonly buckets = new Map<string, Bucket>();
  private readonly options: TokenBucketOptions;

  constructor(options: TokenBucketOptions) {
    this.options = options;
  }

  take(id: string, now = Date.now()): number {
    const { capacity, refillPerSecond } = this.options;
    const bucket = this.buckets.get(id) ?? { tokens: capacity, at: now };
    bucket.tokens = Math.min(capacity, bucket.tokens + (now - bucket.at) / 1000 * refillPerSecond);
    bucket.at = now;
    this.buckets.set(id, bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - bucket.tokens) / refillPerSecond);
  }
}
