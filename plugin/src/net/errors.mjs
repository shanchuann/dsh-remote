/**
 * Protocol errors. Every failure leaves the server as
 * { error: { code, message, details? } } with an HTTP status that matches the
 * code, exactly as docs/protocol.md section 2 defines.
 */

const STATUS_BY_CODE = new Map([
  ["invalid-argument", 400],
  ["unauthorized", 401],
  ["pairing-invalid", 401],
  ["pairing-locked", 429],
  ["protocol-unsupported", 426],
  ["session-not-found", 404],
  ["session-unavailable", 409],
  ["stream-unavailable", 409],
  ["approval-gone", 410],
  ["rate-limited", 429],
  ["not-found", 404],
  ["forbidden", 403],
  ["feature-unavailable", 503],
  ["internal", 500]
]);

/** An error carrying a protocol code and HTTP status. */
export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {object} [details]
   * @param {{retryAfterMs?: number, cause?: unknown}} [options]
   */
  constructor(status, code, message, details, options) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
    if (options?.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
  }
}

/**
 * Whether a string is one of the protocol error codes.
 * @param {unknown} code
 * @returns {boolean}
 */
export function isProtocolCode(code) {
  return typeof code === "string" && STATUS_BY_CODE.has(code);
}

/**
 * Build an ApiError from a protocol code using the canonical status.
 * @param {string} code
 * @param {string} message
 * @param {object} [details]
 * @param {{retryAfterMs?: number}} [options]
 * @returns {ApiError}
 */
export function apiError(code, message, details, options) {
  return new ApiError(STATUS_BY_CODE.get(code) ?? 500, code, message, details, options);
}

/**
 * Convert any thrown value into the wire shape.
 * @param {unknown} error
 * @returns {{status:number, code:string, message:string, details?:object, retryAfterMs?:number}}
 */
export function normalizeError(error) {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
      ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs })
    };
  }
  const code = typeof error?.code === "string" && error.code.length > 0 ? error.code : "internal";
  const mapped = STATUS_BY_CODE.get(code);
  if (mapped !== undefined) {
    return { status: mapped, code, message: typeof error?.message === "string" ? error.message : code };
  }
  return { status: 500, code: "internal", message: "internal error" };
}

/**
 * @param {string} code
 * @param {string} message
 * @param {object} [details]
 * @returns {{error: {code: string, message: string, details?: object}}}
 */
export function errorBody(code, message, details) {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}
