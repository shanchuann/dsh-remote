/**
 * HTTP plumbing shared by the routes: JSON responses, body limits, loopback
 * detection. Every response is Cache-Control: no-store (devices hold bearer
 * tokens; nothing about this API may be cached).
 */
import { ApiError } from "./errors.mjs";

/** Content type used by every JSON response. */
export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

/**
 * Security headers that apply to every response, including errors and SSE.
 * @param {import("node:http").ServerResponse} res
 */
export function setCommonHeaders(res) {
  if (res.headersSent) return;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 * @param {Record<string, string|number|string[]>} [extraHeaders]
 */
export function sendJson(res, status, payload, extraHeaders) {
  if (res.writableEnded || res.destroyed) return;
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  setCommonHeaders(res);
  res.setHeader("Content-Type", JSON_CONTENT_TYPE);
  res.setHeader("Content-Length", String(body.length));
  if (extraHeaders !== undefined) {
    for (const [name, value] of Object.entries(extraHeaders)) {
      if (value !== undefined) res.setHeader(name, value);
    }
  }
  res.statusCode = status;
  res.end(body);
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {string} html
 */
export function sendHtml(res, status, html, extraHeaders) {
  if (res.writableEnded || res.destroyed) return;
  const body = Buffer.from(html, "utf8");
  setCommonHeaders(res);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Length", String(body.length));
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'");
  if (extraHeaders !== undefined) {
    for (const [name, value] of Object.entries(extraHeaders)) {
      if (value !== undefined) res.setHeader(name, value);
    }
  }
  res.statusCode = status;
  res.end(body);
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {unknown} error
 */
export function sendError(res, error) {
  const normalized = normalize(error);
  const headers = normalized.status === 429 && normalized.retryAfterMs !== undefined
    ? { "Retry-After": String(Math.max(1, Math.ceil(normalized.retryAfterMs / 1000))) }
    : undefined;
  sendJson(res, normalized.status, {
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details === undefined ? {} : { details: normalized.details })
    }
  }, headers);
}

function normalize(error) {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
      ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs })
    };
  }
  return { status: 500, code: "internal", message: "internal error" };
}

/**
 * Read the request body up to a hard byte limit.
 * @param {import("node:http").IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<Buffer>}
 */
export async function readBody(req, limit) {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) {
    throw new ApiError(413, "invalid-argument", "request body exceeds " + limit + " bytes");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      throw new ApiError(413, "invalid-argument", "request body exceeds " + limit + " bytes");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Read a JSON object body. An empty body means {}.
 * @param {import("node:http").IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readJsonBody(req, limit) {
  const raw = await readBody(req, limit);
  if (raw.length === 0) return {};
  let value;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new ApiError(400, "invalid-argument", "request body is not valid JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "invalid-argument", "request body must be a JSON object");
  }
  return value;
}

/**
 * Whether a socket address is loopback. Handles IPv4, IPv6, and IPv4-mapped
 * IPv6 forms the way Node reports them.
 * @param {string|undefined} address
 * @returns {boolean}
 */
export function isLoopbackAddress(address) {
  if (typeof address !== "string") return false;
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  if (normalized.startsWith("127.")) return true;
  return false;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {string}
 */
export function clientIp(req) {
  const address = req.socket?.remoteAddress;
  return typeof address === "string" ? address : "unknown";
}

/**
 * End the response, then drop the request stream so an oversized upload stops
 * occupying the socket.
 * @param {import("node:http").ServerResponse} res
 * @param {import("node:http").IncomingMessage} req
 */
export function respondAndDrop(res, req) {
  if (res.writableEnded || res.destroyed) return;
  res.once("finish", () => {
    if (!req.destroyed) req.destroy();
  });
}
