/**
 * Token, pairing-code, and digest primitives. The plaintext device token only
 * ever lives in the HTTP response that hands it to the App; the host persists
 * its SHA-256 digest.
 */
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

/** Number of random bytes behind a device token (hex-encoded to 64 chars). */
const TOKEN_BYTES = 32;

/** Digits in a pairing code. */
const PAIRING_CODE_DIGITS = 6;

/** @returns {string} 64 lowercase hex characters */
export function createDeviceToken() {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

/**
 * SHA-256 digest of a token, lowercase hex.
 * @param {string} token
 * @returns {string}
 */
export function hashToken(token) {
  return createHash("sha256").update(String(token), "utf8").digest("hex");
}

/**
 * Constant-time comparison of two lowercase hex digests.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function safeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || a.length === 0) return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/**
 * Constant-time comparison of two short strings of arbitrary length.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function safeEqualString(a, b) {
  const left = Buffer.from(String(a), "utf8");
  const right = Buffer.from(String(b), "utf8");
  const length = Math.max(left.length, right.length, 1);
  const leftPadded = Buffer.alloc(length);
  const rightPadded = Buffer.alloc(length);
  left.copy(leftPadded);
  right.copy(rightPadded);
  return left.length === right.length && timingSafeEqual(leftPadded, rightPadded);
}

/** @returns {string} 6-digit zero-padded pairing code */
export function createPairingCode() {
  return String(randomInt(0, 10 ** PAIRING_CODE_DIGITS)).padStart(PAIRING_CODE_DIGITS, "0");
}

/**
 * Prefixed opaque identifier.
 * @param {string} prefix e.g. "sub_"
 * @param {number} [bytes]
 * @returns {string}
 */
export function createId(prefix, bytes) {
  return prefix + randomBytes(bytes ?? 12).toString("hex");
}

/** @returns {string} RFC 4122 v4 UUID */
export function randomId() {
  return randomUUID();
}
