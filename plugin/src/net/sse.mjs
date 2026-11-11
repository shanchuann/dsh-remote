/**
 * Server-Sent Events hub: one connection per device, replace-on-reconnect
 * (protocol section 4), a 15s ping, and a monotonically increasing frame id.
 *
 * Frames are best-effort: a dead socket is dropped rather than retried, and
 * this layer never replays events (the App re-opens a session instead).
 */

/** Standard SSE response headers. */
export const SSE_HEADERS = Object.freeze({
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-store",
  "Connection": "keep-alive",
  "X-Accel-Buffering": "no"
});

/**
 * Encode one SSE frame.
 * @param {{id?: number, event: string, data: unknown}} frame
 * @returns {string}
 */
export function encodeFrame(frame) {
  const lines = [];
  if (frame.id !== undefined) lines.push("id: " + String(frame.id));
  lines.push("event: " + frame.event);
  let data;
  try {
    data = JSON.stringify(frame.data);
  } catch {
    data = JSON.stringify({ error: { code: "internal", message: "unserializable event data" } });
  }
  lines.push("data: " + data);
  return lines.join("\n") + "\n\n";
}

/**
 * Owns all open SSE responses.
 */
export class EventHub {
  /**
   * @param {{pingIntervalMs?: number, now?: () => number,
   *   logger?: {debug?: Function, warn?: Function}}} [options]
   */
  constructor(options) {
    const settings = options ?? {};
    this.pingIntervalMs = settings.pingIntervalMs ?? 15000;
    this.now = settings.now ?? Date.now;
    this.logger = settings.logger;
    /** @type {Map<string, object>} deviceId -> connection */
    this.connections = new Map();
    this.sequence = 0;
    this.connectionSequence = 0;
    /** @type {NodeJS.Timeout|null} */
    this.pingTimer = null;
  }

  /** @returns {number} */
  get size() {
    return this.connections.size;
  }

  /** Number of devices with a live SSE connection. @returns {number} */
  deviceCount() {
    return this.connections.size;
  }

  /** Whether any mobile client is listening. @returns {boolean} */
  hasDevices() {
    return this.connections.size > 0;
  }

  /** Start the heartbeat. Safe to call twice. */
  start() {
    if (this.pingTimer !== null) return;
    this.pingTimer = setInterval(() => this.#pingAll(), this.pingIntervalMs);
    this.pingTimer.unref?.();
  }

  /** Stop the heartbeat and close every connection. */
  stop() {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    for (const connection of [...this.connections.values()]) {
      this.close(connection, { reason: "server-stopped" });
    }
    this.connections.clear();
  }

  /**
   * Register an HTTP response as this device's SSE connection. An older
   * connection for the same device receives connection.replaced and closes.
   * @param {{deviceId: string, res: import("node:http").ServerResponse}} input
   */
  add(input) {
    const previous = this.connections.get(input.deviceId);
    if (previous !== undefined) {
      this.close(previous, {
        event: "connection.replaced",
        data: { reason: "replaced" },
        reason: "replaced"
      });
    }
    const res = input.res;
    res.writeHead(200, SSE_HEADERS);
    res.flushHeaders?.();
    const connection = {
      id: ++this.connectionSequence,
      deviceId: input.deviceId,
      res,
      createdAt: this.now(),
      closed: false
    };
    this.connections.set(input.deviceId, connection);
    const forget = () => {
      connection.closed = true;
      if (this.connections.get(input.deviceId) === connection) this.connections.delete(input.deviceId);
    };
    res.on("close", forget);
    res.on("error", forget);
    this.logger?.debug?.("dsh-remote: SSE connected for device " + input.deviceId);
    return connection;
  }

  /** @param {string} deviceId */
  connectionFor(deviceId) {
    return this.connections.get(deviceId) ?? null;
  }

  /**
   * Send one event to one connection.
   * @param {object} connection
   * @param {string} event
   * @param {unknown} data
   * @returns {boolean} whether the frame reached a writable socket
   */
  send(connection, event, data) {
    if (connection === null || connection === undefined || connection.closed === true) return false;
    const res = connection.res;
    if (res.writableEnded || res.destroyed) {
      connection.closed = true;
      return false;
    }
    try {
      res.write(encodeFrame({ id: ++this.sequence, event, data }));
      return true;
    } catch (error) {
      this.logger?.warn?.("dsh-remote: SSE write failed: " + error.message);
      connection.closed = true;
      return false;
    }
  }

  /**
   * Send one event to the connection owned by a device.
   * @param {string} deviceId
   * @param {string} event
   * @param {unknown} data
   * @returns {boolean}
   */
  sendTo(deviceId, event, data) {
    const connection = this.connections.get(deviceId);
    if (connection === undefined) return false;
    return this.send(connection, event, data);
  }

  /**
   * Broadcast to every connected device.
   * @param {string} event
   * @param {unknown} data
   * @param {{exceptDeviceId?: string}} [options]
   * @returns {number} number of sockets written
   */
  broadcast(event, data, options) {
    let sent = 0;
    for (const connection of this.connections.values()) {
      if (options?.exceptDeviceId !== undefined && connection.deviceId === options.exceptDeviceId) continue;
      if (this.send(connection, event, data)) sent += 1;
    }
    return sent;
  }

  /**
   * Send an optional final event, then end the response.
   * @param {object} connection
   * @param {{event?: string, data?: unknown, reason?: string}} [options]
   */
  close(connection, options) {
    if (connection === null || connection === undefined || connection.closed === true) return;
    // The farewell frame has to go out before the connection is marked closed:
    // send() refuses to write to a closed connection.
    if (options?.event !== undefined) this.send(connection, options.event, options.data ?? {});
    connection.closed = true;
    if (this.connections.get(connection.deviceId) === connection) this.connections.delete(connection.deviceId);
    try {
      connection.res.end();
    } catch {
      // Already closed by the peer.
    }
    this.logger?.debug?.("dsh-remote: SSE closed for device " + connection.deviceId + (options?.reason ? " (" + options.reason + ")" : ""));
  }

  /**
   * Close a device's connection by id.
   * @param {string} deviceId
   * @param {{event?: string, data?: unknown, reason?: string}} [options]
   * @returns {boolean}
   */
  closeDevice(deviceId, options) {
    const connection = this.connections.get(deviceId);
    if (connection === undefined) return false;
    this.close(connection, options);
    return true;
  }

  #pingAll() {
    const now = this.now();
    for (const connection of [...this.connections.values()]) {
      const alive = this.send(connection, "ping", { t: now });
      if (!alive) this.close(connection, { reason: "ping-failed" });
    }
  }
}
