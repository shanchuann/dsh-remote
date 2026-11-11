/**
 * Test harness: boots the real runtime (HTTP server, auth, SSE hub) against a
 * FakeBridge on an ephemeral port and offers small HTTP/SSE clients.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRemoteRuntime } from "../../src/net/app.mjs";
import { FakeBridge, SILENT_LOGGER } from "./fake-bridge.mjs";

/** @param {number} ms */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Remove a temp directory, retrying while Windows reports ENOTEMPTY because a
 * just-finished atomic write is still settling. Test-only helper.
 * @param {string} dir
 * @param {number} [attempts]
 */
export async function removeDir(dir, attempts = 8) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === attempts - 1) throw error;
      await delay(30);
    }
  }
}

/**
 * Boot a runtime with a FakeBridge.
 * @param {{fake?: FakeBridge, config?: object, now?: () => number,
 *   interfaces?: object, logger?: object}} [options]
 */
export async function startHarness(options) {
  const settings = options ?? {};
  const dataDir = await mkdtemp(join(tmpdir(), "dsh-remote-test-"));
  const runtime = await createRemoteRuntime({
    rawConfig: { port: 0, dataDir, logLevel: "silent", ...(settings.config ?? {}) },
    now: settings.now,
    interfaces: settings.interfaces ?? {},
    logger: settings.logger ?? SILENT_LOGGER,
    rateLimit: settings.rateLimit,
    pairRateLimit: settings.pairRateLimit,
    pingIntervalMs: settings.pingIntervalMs
  });
  const bridge = settings.fake ?? new FakeBridge({ handlers: runtime.bridgeHandlers() });
  if (bridge.handlers === undefined || Object.keys(bridge.handlers).length === 0) {
    bridge.handlers = runtime.bridgeHandlers();
  }
  runtime.attachBridge(bridge);
  await runtime.start();
  const baseUrl = "http://127.0.0.1:" + runtime.port;
  return {
    runtime,
    bridge,
    dataDir,
    port: runtime.port,
    baseUrl,
    async close() {
      await runtime.stop();
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          await rm(dataDir, { recursive: true, force: true });
          return;
        } catch (error) {
          if (attempt === 5) throw error;
          await delay(20);
        }
      }
    }
  };
}

/**
 * JSON request helper.
 * @param {string} baseUrl
 * @param {string} path
 * @param {{method?: string, token?: string, body?: unknown, rawBody?: string,
 *   headers?: Record<string,string>}} [options]
 */
export async function request(baseUrl, path, options) {
  const settings = options ?? {};
  const headers = { ...(settings.headers ?? {}) };
  if (settings.token !== undefined) headers.authorization = "Bearer " + settings.token;
  let body;
  if (settings.rawBody !== undefined) {
    body = settings.rawBody;
    headers["content-type"] = headers["content-type"] ?? "application/json";
  } else if (settings.body !== undefined) {
    body = JSON.stringify(settings.body);
    headers["content-type"] = "application/json";
  }
  const response = await fetch(baseUrl + path, { method: settings.method ?? "GET", headers, body });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, headers: response.headers, text, body: json };
}

/**
 * Open an SSE connection and expose parsed events.
 * @param {string} baseUrl
 * @param {string} token
 */
export async function openSse(baseUrl, token) {
  const controller = new AbortController();
  const response = await fetch(baseUrl + "/v1/events?token=" + encodeURIComponent(token), {
    headers: { accept: "text/event-stream" },
    signal: controller.signal
  });
  const events = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  const pump = () => {
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseFrame(raw);
      if (event !== null) events.push(event);
      boundary = buffer.indexOf("\n\n");
    }
  };
  const readLoop = (async () => {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        pump();
      }
    } catch {
      // aborted by close()
    } finally {
      finished = true;
    }
  })();
  return {
    events,
    status: response.status,
    headers: response.headers,
    get finished() {
      return finished;
    },
    async waitFor(name, timeoutMs) {
      const deadline = Date.now() + (timeoutMs ?? 5000);
      while (Date.now() < deadline) {
        const index = events.findIndex((event) => event.event === name);
        if (index !== -1) return events.splice(index, 1)[0];
        await delay(5);
      }
      throw new Error("timed out waiting for SSE event " + name + "; seen: " + events.map((event) => event.event).join(","));
    },
    async waitForMatching(name, predicate, timeoutMs) {
      const deadline = Date.now() + (timeoutMs ?? 5000);
      while (Date.now() < deadline) {
        const index = events.findIndex((event) => event.event === name && predicate(event));
        if (index !== -1) return events.splice(index, 1)[0];
        await delay(5);
      }
      throw new Error("timed out waiting for matching SSE event " + name);
    },
    close() {
      controller.abort();
      return readLoop;
    }
  };
}

/**
 * Parse one SSE frame block.
 * @param {string} raw
 */
export function parseFrame(raw) {
  const event = { id: null, event: "message", data: null };
  for (const line of raw.split("\n")) {
    if (line.startsWith("id:")) event.id = Number(line.slice(3).trim());
    else if (line.startsWith("event:")) event.event = line.slice(6).trim();
    else if (line.startsWith("data:")) {
      const payload = line.slice(5).trim();
      try {
        event.data = JSON.parse(payload);
      } catch {
        event.data = payload;
      }
    }
  }
  if (event.data === null && event.event === "message" && event.id === null) return null;
  return event;
}

/**
 * Pair a fresh device through the public endpoint.
 * @param {Awaited<ReturnType<typeof startHarness>>} harness
 * @param {{code?: string, deviceName?: string, platform?: string, deviceId?: string}} [options]
 */
export async function pairDevice(harness, options) {
  const code = options?.code ?? harness.runtime.pairing.snapshot().code;
  const response = await request(harness.baseUrl, "/v1/pair", {
    method: "POST",
    body: {
      code,
      deviceName: options?.deviceName ?? "Pixel 9",
      platform: options?.platform ?? "android",
      appVersion: "0.1.0",
      ...(options?.deviceId === undefined ? {} : { deviceId: options.deviceId })
    }
  });
  if (response.status !== 200) throw new Error("pair failed: " + response.status + " " + response.text);
  return response.body;
}
