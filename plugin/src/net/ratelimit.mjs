/**
 * Per-device request limiting: 30 requests/second with a burst of 60, as
 * docs/protocol.md section 8 specifies. A token bucket is enough; it bounds
 * both sustained rate and burst without keeping per-request timestamps.
 */

/** @typedef {{allowed: boolean, retryAfterMs: number, remaining: number}} RateResult */

/** A single token bucket. */
export class TokenBucket {
  /**
   * @param {{rate?: number, burst?: number, now?: () => number}} [options]
   */
  constructor(options) {
    const settings = options ?? {};
    this.rate = settings.rate ?? 30;
    this.burst = settings.burst ?? 60;
    this.now = settings.now ?? Date.now;
    this.tokens = this.burst;
    this.updatedAt = this.now();
  }

  /**
   * Take one token if available.
   * @param {number} [count]
   * @returns {RateResult}
   */
  take(count) {
    const wanted = count ?? 1;
    const now = this.now();
    const elapsed = Math.max(0, now - this.updatedAt);
    if (elapsed > 0) {
      this.tokens = Math.min(this.burst, this.tokens + (elapsed / 1000) * this.rate);
      this.updatedAt = now;
    }
    if (this.tokens >= wanted) {
      this.tokens -= wanted;
      return { allowed: true, retryAfterMs: 0, remaining: Math.floor(this.tokens) };
    }
    const missing = wanted - this.tokens;
    return { allowed: false, retryAfterMs: Math.ceil((missing / this.rate) * 1000), remaining: Math.floor(this.tokens) };
  }
}

/** A keyed collection of token buckets (one per device). */
export class RateLimiter {
  /**
   * @param {{rate?: number, burst?: number, now?: () => number, maxKeys?: number,
   *   idleEvictMs?: number}} [options]
   */
  constructor(options) {
    const settings = options ?? {};
    this.rate = settings.rate ?? 30;
    this.burst = settings.burst ?? 60;
    this.now = settings.now ?? Date.now;
    this.maxKeys = settings.maxKeys ?? 1024;
    this.idleEvictMs = settings.idleEvictMs ?? 10 * 60 * 1000;
    /** @type {Map<string, {bucket: TokenBucket, lastUsed: number}>} */
    this.buckets = new Map();
  }

  /**
   * @param {string} key
   * @param {number} [count]
   * @returns {RateResult}
   */
  check(key, count) {
    const entry = this.#entry(key);
    entry.lastUsed = this.now();
    const result = entry.bucket.take(count);
    if (this.buckets.size > this.maxKeys) this.#evict();
    return result;
  }

  /** Forget one key (used when a device is revoked). */
  reset(key) {
    this.buckets.delete(key);
  }

  /** @returns {number} */
  get size() {
    return this.buckets.size;
  }

  #entry(key) {
    const existing = this.buckets.get(key);
    if (existing !== undefined) return existing;
    const bucket = new TokenBucket({ rate: this.rate, burst: this.burst, now: this.now });
    const created = { bucket, lastUsed: this.now() };
    this.buckets.set(key, created);
    return created;
  }

  #evict() {
    const cutoff = this.now() - this.idleEvictMs;
    for (const [key, entry] of this.buckets) {
      if (entry.lastUsed < cutoff) this.buckets.delete(key);
    }
    while (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next();
      if (oldest.done === true) break;
      this.buckets.delete(oldest.value);
    }
  }
}
