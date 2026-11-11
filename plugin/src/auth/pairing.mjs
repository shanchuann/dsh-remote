/**
 * One-time pairing code state machine: 6 digits, TTL-bounded, rotated on every
 * successful pairing, and locked for a cooldown after repeated failures.
 */
import { safeEqualString } from "./tokens.mjs";

const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_LOCK_MS = 5 * 60 * 1000;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @typedef {{code: string, expiresAt: number, failedAttempts: number,
 *   lockedUntil: number|null, ttlMs: number}} PairingSnapshot
 */

/**
 * Pairing code manager. All timing is injectable so tests can move the clock
 * without sleeping.
 */
export class PairingManager {
  /**
   * @param {{ttlMs?: number, now?: () => number, codeFactory?: () => string,
   *   maxFailures?: number, lockMs?: number,
   *   onChange?: (snapshot: PairingSnapshot) => void}} [options]
   */
  constructor(options) {
    const settings = options ?? {};
    this.ttlMs = settings.ttlMs ?? 10 * 60 * 1000;
    this.now = settings.now ?? Date.now;
    this.codeFactory = settings.codeFactory ?? (() => {
      throw new Error("dsh-remote: PairingManager needs a codeFactory");
    });
    this.maxFailures = settings.maxFailures ?? DEFAULT_MAX_FAILURES;
    this.lockMs = settings.lockMs ?? DEFAULT_LOCK_MS;
    this.onChange = typeof settings.onChange === "function" ? settings.onChange : null;
    /** @type {string} */
    this.code = "";
    this.expiresAt = 0;
    this.failedAttempts = 0;
    /** @type {number|null} */
    this.lockedUntil = null;
  }

  /** @returns {PairingSnapshot} */
  snapshot() {
    const now = this.now();
    return {
      code: this.code,
      expiresAt: this.expiresAt,
      failedAttempts: this.failedAttempts,
      lockedUntil: this.lockedUntil !== null && this.lockedUntil > now ? this.lockedUntil : null,
      ttlMs: this.ttlMs
    };
  }

  /** @returns {boolean} */
  get locked() {
    return this.lockedUntil !== null && this.now() < this.lockedUntil;
  }

  /** @returns {boolean} */
  get expired() {
    return this.code.length === 0 || this.now() >= this.expiresAt;
  }

  /**
   * Replace the code and extend its TTL. Does not clear a failure lock.
   * @returns {PairingSnapshot}
   */
  rotate() {
    this.code = this.codeFactory();
    this.expiresAt = this.now() + this.ttlMs;
    this.#notify();
    return this.snapshot();
  }

  /**
   * Rotate when the current code is missing or expired; a no-op otherwise.
   * @returns {boolean} whether a rotation happened
   */
  ensureFresh() {
    if (this.locked) return false;
    if (!this.expired) return false;
    this.rotate();
    return true;
  }

  /**
   * Check a submitted code. A successful check also rotates the code and
   * clears the failure counter; a failed one counts toward the lock.
   * @param {string} candidate
   * @returns {{ok: true} | {ok: false, status: number, code: "pairing-invalid"|"pairing-locked",
   *   message: string, retryAfterMs: number, remainingAttempts: number}}
   */
  verify(candidate) {
    const now = this.now();
    if (this.lockedUntil !== null && now < this.lockedUntil) {
      return {
        ok: false,
        status: 429,
        code: "pairing-locked",
        message: "too many failed pairing attempts; try again later",
        retryAfterMs: this.lockedUntil - now,
        remainingAttempts: 0
      };
    }
    if (this.lockedUntil !== null && now >= this.lockedUntil) {
      this.lockedUntil = null;
      this.failedAttempts = 0;
    }
    if (this.expired) {
      return {
        ok: false,
        status: 401,
        code: "pairing-invalid",
        message: "pairing code expired",
        retryAfterMs: 0,
        remainingAttempts: Math.max(0, this.maxFailures - this.failedAttempts)
      };
    }
    if (typeof candidate === "string" && safeEqualString(candidate, this.code)) {
      this.failedAttempts = 0;
      this.rotate();
      return { ok: true };
    }
    this.failedAttempts += 1;
    if (this.failedAttempts >= this.maxFailures) {
      this.lockedUntil = now + this.lockMs;
      this.failedAttempts = this.maxFailures;
      this.#notify();
      return {
        ok: false,
        status: 429,
        code: "pairing-locked",
        message: "too many failed pairing attempts; pairing locked for a few minutes",
        retryAfterMs: this.lockMs,
        remainingAttempts: 0
      };
    }
    this.#notify();
    return {
      ok: false,
      status: 401,
      code: "pairing-invalid",
      message: "pairing code is not valid",
      retryAfterMs: 0,
      remainingAttempts: this.maxFailures - this.failedAttempts
    };
  }

  #notify() {
    if (this.onChange === null) return;
    try {
      this.onChange(this.snapshot());
    } catch {
      // Observers must not break pairing.
    }
  }
}
