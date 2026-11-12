/**
 * HTTP surface. Routes are a flat table (method + path pattern); the flow is
 *   security headers -> loopback gate -> auth -> rate limit -> body limit ->
 *   handler.
 * Handlers return {status?, body?, html?, headers?} and errors become protocol
 * JSON automatically.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ApiError, apiError } from "./errors.mjs";
import {
  clientIp,
  isLoopbackAddress,
  readJsonBody,
  respondAndDrop,
  sendError,
  sendHtml,
  sendJson,
  setCommonHeaders
} from "./http-util.mjs";
import { RateLimiter } from "./ratelimit.mjs";

const SMALL_BODY_LIMIT = 64 * 1024;
const DEFAULT_BODY_LIMIT = 1024 * 1024;
const PROMPT_BODY_LIMIT = 12 * 1024 * 1024;

function bearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match === null) return null;
  const token = match[1].trim();
  return token.length === 0 ? null : token;
}

function decodeParam(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function setCorsHeaders(res) {
  if (res.headersSent) return;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Max-Age", "600");
}

/**
 * Create the HTTP server around a RemoteService.
 *
 * @param {{
 *   service: import("./service.mjs").RemoteService,
 *   devices: import("../auth/devices.mjs").DeviceStore,
 *   pairing: import("../auth/pairing.mjs").PairingManager,
 *   hub: import("./sse.mjs").EventHub,
 *   config: {host: string, port: number},
 *   protocolVersion: number,
 *   pluginVersion: string,
 *   renderPairingPage: () => Promise<string>|string,
 *   logger?: object,
 *   now?: () => number,
 *   rateLimit?: {rate?: number, burst?: number},
 *   pairRateLimit?: {rate?: number, burst?: number}
 * }} options
 */
export function createRemoteServer(options) {
  const { service, devices, pairing, hub, config, protocolVersion, renderPairingPage } = options;
  const logger = options.logger;
  const now = options.now ?? Date.now;
  const rateLimiter = new RateLimiter({
    rate: options.rateLimit?.rate ?? 30,
    burst: options.rateLimit?.burst ?? 60,
    now
  });
  const pairLimiter = new RateLimiter({
    rate: options.pairRateLimit?.rate ?? 1,
    burst: options.pairRateLimit?.burst ?? 10,
    now,
    maxKeys: 256
  });

  async function handlePair({ req, ip }) {
    const limit = pairLimiter.check("pair:" + ip);
    if (!limit.allowed) throw apiError("rate-limited", "too many pairing attempts", undefined, { retryAfterMs: limit.retryAfterMs });
    const body = await readJsonBody(req, SMALL_BODY_LIMIT);
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (code.length === 0) throw apiError("invalid-argument", "code is required");
    const verdict = pairing.verify(code);
    if (!verdict.ok) {
      throw new ApiError(verdict.status, verdict.code, verdict.message, undefined, { retryAfterMs: verdict.retryAfterMs });
    }
    const paired = await devices.pair({
      deviceId: body.deviceId,
      name: body.deviceName,
      platform: body.platform,
      appVersion: body.appVersion
    });
    logger?.info?.("dsh-remote: paired device " + paired.device.name + " (" + paired.device.platform + ")");
    return {
      status: 200,
      body: {
        protocol: protocolVersion,
        token: paired.token,
        deviceId: paired.device.deviceId,
        host: service.pairingHostPayload()
      }
    };
  }

  function handleEvents({ res, device }) {
    const connection = hub.add({ deviceId: device.deviceId, res });
    try {
      service.onSSEConnect(device.deviceId, connection);
    } catch (error) {
      logger?.warn?.("dsh-remote: hello failed: " + error.message);
    }
    return null;
  }

  const routes = [
    {
      method: 'GET',
      pattern: /^\/v1\/sessions\/([^/]+)\/changes\/(\d+)(?:\/(\d+))?$/,
      handler: async ({ params }) => ({ body: await service.changes(decodeParam(params[0]), params[1], params[2]) })
    },
    {
      method: 'GET',
      pattern: /^\/v1\/sessions\/([^/]+)\/file$/,
      handler: async ({ params, query, res }) => {
        const result = await service.readFile(decodeParam(params[0]), query);
        if (query.get('format') === 'text') return { body: result };
        const data = result.data;
        res.writeHead(200, { 'content-type': sniffImageType(data), 'content-length': String(data.length),
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(data);
        return null;
      }
    },
    {
      method: "GET",
      pattern: /^\/v1\/health$/,
      public: true,
      handler: () => ({ body: service.healthPayload() })
    },
    {
      method: "POST",
      pattern: /^\/v1\/pair$/,
      public: true,
      handler: handlePair
    },
    {
      method: "GET",
      pattern: /^\/pair$/,
      loopback: true,
      public: true,
      handler: async () => ({ html: await renderPairingPage() })
    },
    {
      method: "GET",
      pattern: /^\/v1\/events$/,
      queryToken: true,
      streaming: true,
      handler: handleEvents
    },
    {
      method: "GET",
      pattern: /^\/v1\/attachments\/([^/]+)$/,
      handler: handleAttachment
    },
    {
      method: "GET",
      pattern: /^\/v1\/host$/,
      handler: ({ device }) => ({ body: service.hostPayload(device.deviceId) })
    },
    {
      method: "GET",
      pattern: /^\/v1\/sessions$/,
      handler: async ({ query }) => ({ body: await service.listSessions(query) })
    },
    {
      method: "POST",
      pattern: /^\/v1\/sessions$/,
      bodyLimit: SMALL_BODY_LIMIT,
      handler: async ({ body }) => ({ body: await service.createSession(body) })
    },
    {
      method: "GET",
      pattern: /^\/v1\/sessions\/([^/]+)$/,
      handler: async ({ params }) => ({ body: await service.getSession(decodeParam(params[0])) })
    },
    {
      method: "GET",
      pattern: /^\/v1\/sessions\/([^/]+)\/history$/,
      handler: async ({ params, query }) => ({ body: await service.history(decodeParam(params[0]), query) })
    },
    {
      method: "POST",
      pattern: /^\/v1\/sessions\/([^/]+)\/open$/,
      bodyLimit: DEFAULT_BODY_LIMIT,
      handler: async ({ params, body, device }) => ({ body: await service.open(device.deviceId, decodeParam(params[0]), body) })
    },
    {
      method: "POST",
      pattern: /^\/v1\/sessions\/([^/]+)\/close$/,
      bodyLimit: SMALL_BODY_LIMIT,
      handler: async ({ params, device }) => ({ body: await service.close(device.deviceId, decodeParam(params[0])) })
    },
    {
      method: "POST",
      pattern: /^\/v1\/sessions\/([^/]+)\/prompt$/,
      bodyLimit: PROMPT_BODY_LIMIT,
      handler: async ({ params, body }) => ({ body: await service.prompt(decodeParam(params[0]), body) })
    },
    {
      method: "POST",
      pattern: /^\/v1\/sessions\/([^/]+)\/cancel$/,
      bodyLimit: SMALL_BODY_LIMIT,
      handler: async ({ params }) => ({ body: await service.cancel(decodeParam(params[0])) })
    },
    {
      method: "POST",
      pattern: /^\/v1\/sessions\/([^/]+)\/rename$/,
      bodyLimit: SMALL_BODY_LIMIT,
      handler: async ({ params, body }) => ({ body: await service.rename(decodeParam(params[0]), body) })
    },
    {
      method: "POST",
      pattern: /^\/v1\/sessions\/([^/]+)\/model$/,
      bodyLimit: SMALL_BODY_LIMIT,
      handler: async ({ params, body }) => ({ body: await service.selectModel(decodeParam(params[0]), body) })
    },
    {
      method: "GET",
      pattern: /^\/v1\/models$/,
      handler: async () => ({ body: await service.models() })
    },
    {
      method: "GET",
      pattern: /^\/v1\/approvals$/,
      handler: async () => ({ body: await service.approvals() })
    },
    {
      method: "POST",
      pattern: /^\/v1\/approvals\/([^/]+)$/,
      bodyLimit: SMALL_BODY_LIMIT,
      handler: async ({ params, body }) => ({ body: await service.answerApproval(decodeParam(params[0]), body) })
    },
    {
      method: "GET",
      pattern: /^\/v1\/devices$/,
      handler: ({ device }) => ({ body: { items: service.devicesPayload(device.deviceId) } })
    },
    {
      method: "DELETE",
      pattern: /^\/v1\/devices\/([^/]+)$/,
      handler: async ({ params, device }) => {
        const target = decodeParam(params[0]);
        const result = await service.revokeDevice(target);
        if (target === device.deviceId) rateLimiter.reset(target);
        return { body: result };
      }
    }
  ];

  const attachmentsRoot = options.attachmentsRoot;

  function sniffImageType(buffer) {
    if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
    if (buffer.length >= 6 && buffer.toString("ascii", 0, 6).startsWith("GIF8")) return "image/gif";
    if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
    return "application/octet-stream";
  }

  /** GET /v1/attachments/:id — serves a DSH attachment object to a paired device. */
  async function handleAttachment({ params, res }) {
    const raw = decodeParam(params[0] ?? "");
    const match = /^sha256:([a-f0-9]{64})$/.exec(raw);
    if (match === null) throw apiError("invalid-argument", "attachmentId must be sha256:<hex>");
    if (typeof attachmentsRoot !== "string" || attachmentsRoot.length === 0) {
      throw apiError("internal", "attachment storage is not configured");
    }
    const hex = match[1];
    let buffer;
    try {
      buffer = await readFile(join(attachmentsRoot, hex.slice(0, 2), hex));
    } catch {
      throw apiError("not-found", "attachment not found");
    }
    const type = sniffImageType(buffer);
    res.writeHead(200, {
      "content-type": type,
      "content-length": String(buffer.length),
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff"
    });
    res.end(buffer);
    return null;
  }

  async function handle(req, res) {
    const startedAt = now();
    setCommonHeaders(res);
    setCorsHeaders(res);
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }
      const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
      let selected = null;
      let pathMatched = false;
      for (const route of routes) {
        const match = route.pattern.exec(pathname);
        if (match === null) continue;
        pathMatched = true;
        if (route.method === req.method) {
          selected = { route, params: match.slice(1) };
          break;
        }
      }
      if (selected === null) {
        throw pathMatched
          ? new ApiError(405, "invalid-argument", "method " + String(req.method) + " is not allowed on " + pathname)
          : new ApiError(404, "invalid-argument", "unknown endpoint " + pathname);
      }
      const { route, params } = selected;
      if (route.loopback === true && !isLoopbackAddress(req.socket?.remoteAddress)) {
        throw new ApiError(403, "unauthorized", "the pairing page is only available on the host (loopback)");
      }
      let device = null;
      if (route.public !== true) {
        const queryToken = route.queryToken === true ? url.searchParams.get("token") : null;
        const token = bearerToken(req) ?? (queryToken !== null && queryToken.length > 0 ? queryToken : null);
        device = token === null ? null : devices.authenticate(token);
        if (device === null) throw apiError("unauthorized", "missing or invalid device token");
        const limit = rateLimiter.check(device.deviceId);
        if (!limit.allowed) {
          throw apiError("rate-limited", "request rate limit exceeded", undefined, { retryAfterMs: limit.retryAfterMs });
        }
      }
      if (route.bodyLimit !== undefined) {
        req.dshBody = await readJsonBody(req, route.bodyLimit);
      }
      const result = await route.handler({
        req,
        res,
        url,
        params,
        query: url.searchParams,
        body: req.dshBody ?? {},
        device,
        ip: clientIp(req)
      });
      if (result === null || result === undefined) {
        logger?.debug?.("dsh-remote: " + req.method + " " + pathname + " streamed");
        return;
      }
      const status = result.status ?? 200;
      if (result.html !== undefined) {
        sendHtml(res, status, result.html, result.headers);
      } else {
        sendJson(res, status, result.body ?? {}, result.headers);
      }
      logger?.debug?.("dsh-remote: " + req.method + " " + pathname + " " + status + " (" + (now() - startedAt) + "ms)");
    } catch (error) {
      if (res.headersSent) {
        logger?.warn?.("dsh-remote: " + (req.method ?? "?") + " " + (req.url ?? "?") + " failed after headers: " + (error?.message ?? error));
        res.destroy?.();
        return;
      }
      if (!(error instanceof ApiError)) {
        logger?.warn?.("dsh-remote: " + (req.method ?? "?") + " " + (req.url ?? "?") + " failed: " + (error?.stack ?? error));
      }
      sendError(res, error);
      const normalized = error instanceof ApiError ? error.status : 500;
      if (normalized === 413) respondAndDrop(res, req);
    }
  }

  const server = createServer((req, res) => {
    void handle(req, res);
  });
  server.on("clientError", (error, socket) => {
    logger?.debug?.("dsh-remote: client error: " + error.message);
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  return {
    server,
    rateLimiter,
    pairLimiter,
    routes,
    /**
     * Bind the listener and resolve with the actual address (port 0 resolves to
     * the kernel-assigned port).
     */
    async listen() {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(config.port, config.host);
      });
      return server.address();
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    }
  };
}
