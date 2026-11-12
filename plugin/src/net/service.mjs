/**
 * Protocol behavior: turns bridge calls into HTTP payloads and turns bridge
 * callbacks into SSE frames. The HTTP layer stays thin; everything that knows
 * about subscriptions, history ordering, or payload validation lives here so
 * tests can drive it without a socket.
 */
import { createId } from "../auth/tokens.mjs";
import { ApiError, apiError, isProtocolCode } from "./errors.mjs";

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TITLE_LENGTH = 200;
const DEFAULT_SESSION_LIMIT = 30;
const MAX_SESSION_LIMIT = 100;
const DEFAULT_HISTORY_MAX = 100;
const MAX_HISTORY_MAX = 500;
const MAX_CURSOR_LENGTH = 2048;
/** Successful prompt responses are remembered this long for requestId idempotency. */
const REQUEST_ID_TTL_MS = 10 * 60 * 1000;
const REQUEST_ID_MAX = 500;

const DEFAULT_CAPABILITIES = Object.freeze({
  assistantStream: true,
  approvals: true,
  models: true,
  problemQuestions: false,
  attachments: false,
  images: true
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value, maxLength) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return maxLength === undefined ? trimmed : trimmed.slice(0, maxLength);
}

function asNonNegativeInt(value) {
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number) || number < 0) return undefined;
  return Math.floor(number);
}

function normalizeOutcome(value) {
  const text = asString(value) ?? "";
  // DSH says "allowed-once"; the protocol only has allowed | rejected.
  if (text === "allowed" || text === "allowed-once" || text === "allow") return "allowed";
  return "rejected";
}

function queryValue(query, name) {
  if (query === null || query === undefined) return undefined;
  if (typeof query.get === "function") {
    const value = query.get(name);
    return value === null ? undefined : value;
  }
  return query[name];
}

function clampInt(value, fallback, min, max) {
  const parsed = asNonNegativeInt(value);
  if (parsed === undefined) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function requireString(value, field, maxLength) {
  const text = asString(value, maxLength);
  if (text === undefined) throw apiError("invalid-argument", field + " must be a non-empty string");
  return text;
}

/** DSH throws plain Errors for unknown sessions; normalize them at the boundary. */
const MISSING_SESSION_PATTERN = /not found|not attached|not visible|no such session|unknown session/i;

/** DSH rejects a provider/model outside its catalog with a plain Error. */
const INVALID_MODEL_SELECTION_PATTERN = /select an available model|available model/i;

/** DSH validates the client-provided time zone with a plain Error. */
const INVALID_CLIENT_TIMEZONE_PATTERN = /clientTimeZone must be UTC or a valid IANA/i;

function mapBridgeError(error, what) {
  if (error instanceof ApiError) return error;
  const message = typeof error?.message === "string" && error.message.length > 0 ? error.message : "bridge call failed";
  if (isProtocolCode(error?.code)) return apiError(error.code, message);
  // Only session-scoped messages qualify; "model/provider foo not found" stays internal.
  if (/session/i.test(message) && MISSING_SESSION_PATTERN.test(message)) return apiError("session-not-found", message);
  return apiError("internal", what + " failed: " + message);
}

function estimateBase64Bytes(data) {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

function normalizeContentBlock(block, index, counters) {
  if (!isRecord(block)) throw apiError("invalid-argument", "content[" + index + "] must be an object");
  const type = requireString(block.type, "content[" + index + "].type", 32);
  if (type === "text") {
    if (typeof block.text !== "string") throw apiError("invalid-argument", "content[" + index + "].text must be a string");
    return { type: "text", text: block.text };
  }
  if (type === "image") {
    counters.images += 1;
    if (counters.images > MAX_IMAGES) throw apiError("invalid-argument", "at most " + MAX_IMAGES + " images per prompt");
    const mediaType = requireString(block.mediaType, "content[" + index + "].mediaType", 64);
    if (!/^image\//i.test(mediaType)) throw apiError("invalid-argument", "content[" + index + "].mediaType must be an image/* MIME type");
    if (typeof block.data !== "string" || block.data.length === 0) throw apiError("invalid-argument", "content[" + index + "].data must be a base64 string");
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(block.data)) throw apiError("invalid-argument", "content[" + index + "].data is not valid base64");
    if (estimateBase64Bytes(block.data) > MAX_IMAGE_BYTES) throw apiError("invalid-argument", "content[" + index + "] exceeds the 5 MB image limit");
    const image = { type: "image", mediaType, data: block.data };
    if (typeof block.name === "string" && block.name.length > 0) image.name = block.name.slice(0, 200);
    return image;
  }
  throw apiError("invalid-argument", "content[" + index + "].type " + JSON.stringify(block.type) + " is not supported");
}

function sequenceOf(record) {
  const seq = record?.event?.seq ?? record?.seq;
  return typeof seq === "number" && Number.isFinite(seq) ? seq : Number.MAX_SAFE_INTEGER;
}

function normalizeOpenOptions(body) {
  const options = {};
  if (!isRecord(body)) return options;
  if (body.maxMessages !== undefined) {
    if (asNonNegativeInt(body.maxMessages) === undefined) throw apiError("invalid-argument", "maxMessages must be a non-negative integer");
    options.maxMessages = asNonNegativeInt(body.maxMessages);
  }
  if (body.assistantStream !== undefined) options.assistantStream = Boolean(body.assistantStream);
  if (body.turnWindow !== undefined) {
    if (!isRecord(body.turnWindow)) throw apiError("invalid-argument", "turnWindow must be an object");
    const turnWindow = {};
    for (const field of ["minMessages", "minTurns"]) {
      if (body.turnWindow[field] === undefined) continue;
      const parsed = asNonNegativeInt(body.turnWindow[field]);
      if (parsed === undefined) throw apiError("invalid-argument", "turnWindow." + field + " must be a non-negative integer");
      turnWindow[field] = parsed;
    }
    if (Object.keys(turnWindow).length > 0) options.turnWindow = turnWindow;
  }
  return options;
}

/**
 * One remote session surface: routes call these methods, bridge callbacks call
 * the hub through them.
 */
export class RemoteService {
  /**
   * @param {{config: object, devices: import("../auth/devices.mjs").DeviceStore,
   *   pairing: import("../auth/pairing.mjs").PairingManager,
   *   hub: import("./sse.mjs").EventHub, hostState: {hostId: string, name: string},
   *   pluginVersion: string, protocolVersion: number, now?: () => number,
   *   logger?: {debug?: Function, info?: Function, warn?: Function, error?: Function}}} options
   */
  constructor(options) {
    this.config = options.config;
    this.devices = options.devices;
    this.pairing = options.pairing;
    this.hub = options.hub;
    this.hostState = options.hostState;
    this.pluginVersion = options.pluginVersion;
    this.protocolVersion = options.protocolVersion;
    this.now = options.now ?? Date.now;
    this.logger = options.logger;
    /** @type {object|null} */
    this.bridge = null;
    /** @type {Map<string, object>} subscriptionId -> record */
    this.subscriptions = new Map();
    /** @type {Map<string, object>} deviceId|sessionId -> record */
    this.subscriptionsBySession = new Map();
    /** @type {Map<string, object>} approvalId -> Approval (mirror of bridge state) */
    this.pendingApprovals = new Map();
    /** @type {Map<string, {at:number, settled:boolean, response:object|null, promise:Promise<object>|null}>}
     * sessionId|requestId -> accepted prompt, so a retry never enqueues twice. */
    this.promptRequests = new Map();
    /** @type {Map<string, {running:boolean, active:boolean}>} last known session status */
    this.sessionStates = new Map();
  }

  /** @param {object} bridge */
  attachBridge(bridge) {
    this.bridge = bridge;
  }

  /** Host identity and capability advertisement, normalized across bridge versions. */
  hostDescriptor() {
    let raw = null;
    try {
      raw = typeof this.bridge?.hostInfo === "function" ? this.bridge.hostInfo() : null;
    } catch (error) {
      this.logger?.warn?.("dsh-remote: bridge.hostInfo failed: " + error.message);
    }
    const capabilities = isRecord(raw) && isRecord(raw.capabilities) ? raw.capabilities : {};
    return {
      hostId: asString(isRecord(raw) ? raw.hostId : undefined) ?? this.hostState.hostId,
      name: asString(isRecord(raw) ? raw.name : undefined) ?? this.hostState.name,
      platform: asString(isRecord(raw) ? raw.platform : undefined) ?? process.platform,
      dshVersion: asString(isRecord(raw) ? raw.dshVersion : undefined) ?? "unknown",
      defaultCwd: asString(isRecord(raw) ? raw.defaultCwd : undefined) ?? process.cwd(),
      capabilities: { ...DEFAULT_CAPABILITIES, ...capabilities }
    };
  }

  /** GET /v1/health body. */
  healthPayload() {
    const host = this.hostDescriptor();
    return {
      ok: true,
      name: "dsh-remote",
      protocol: this.protocolVersion,
      pluginVersion: this.pluginVersion,
      dshVersion: host.dshVersion,
      hostId: host.hostId,
      pairingRequired: this.devices.pairingRequired,
      publicUrl: typeof this.publicUrlProvider === "function" ? this.publicUrlProvider() : null,
      tunnel: typeof this.tunnelProvider === "function" ? this.tunnelProvider() : null,
      time: this.now()
    };
  }

  /** Host block returned inside the pairing response. */
  pairingHostPayload() {
    const host = this.hostDescriptor();
    return {
      id: host.hostId,
      name: host.name,
      platform: host.platform,
      dshVersion: host.dshVersion,
      pluginVersion: this.pluginVersion,
      publicUrl: typeof this.publicUrlProvider === "function" ? this.publicUrlProvider() : null
    };
  }

  /** GET /v1/host body. */
  hostPayload(deviceId) {
    const host = this.hostDescriptor();
    return {
      hostId: host.hostId,
      name: host.name,
      platform: host.platform,
      dshVersion: host.dshVersion,
      pluginVersion: this.pluginVersion,
      protocol: this.protocolVersion,
      capabilities: host.capabilities,
      defaultCwd: host.defaultCwd,
      publicUrl: typeof this.publicUrlProvider === "function" ? this.publicUrlProvider() : null,
      tunnel: typeof this.tunnelProvider === "function" ? this.tunnelProvider() : null,
      devices: this.devicesPayload(deviceId)
    };
  }

  devicesPayload(currentDeviceId) {
    return this.devices.list().map((device) => ({
      deviceId: device.deviceId,
      name: device.name,
      platform: device.platform,
      createdAt: device.createdAt,
      lastSeenAt: device.lastSeenAt,
      current: device.deviceId === currentDeviceId
    }));
  }

  async listSessions(query) {
    const limit = clampInt(queryValue(query, "limit"), DEFAULT_SESSION_LIMIT, 1, MAX_SESSION_LIMIT);
    const cursor = asString(queryValue(query, "cursor"), MAX_CURSOR_LENGTH) ?? null;
    const result = await this.#call(() => this.bridge.listSessions({ limit, cursor }), "list sessions");
    const items = Array.isArray(result?.items) ? result.items.filter((row) => isRecord(row) && typeof row.sessionId === "string") : [];
    for (const row of items) {
      this.sessionStates.set(row.sessionId, {
        running: row.running === true,
        active: typeof row.active === "boolean" ? row.active : row.agentAvailable !== false
      });
    }
    const nextCursor = asString(result?.nextCursor, MAX_CURSOR_LENGTH) ?? null;
    const workspaces = Array.isArray(result?.workspaces)
      ? result.workspaces.filter((workspace) => isRecord(workspace) && typeof workspace.id === "string" && typeof workspace.path === "string")
        .map(({ id, title, path }) => ({ id, title: typeof title === "string" ? title : undefined, path }))
      : undefined;
    return { items, nextCursor, ...(workspaces ? { workspaces } : {}) };
  }

  async createSession(body) {
    const options = {};
    if (body?.workspaceId !== undefined && body?.cwd !== undefined) throw apiError('invalid-argument', 'Specify workspaceId or cwd, not both');
    if (body?.workspaceId !== undefined) options.workspaceId = requireString(body.workspaceId, 'workspaceId', 200);
    if (body?.cwd !== undefined) options.cwd = requireString(body.cwd, "cwd", 1024);
    if (body?.agentPreset !== undefined) options.agentPreset = requireString(body.agentPreset, "agentPreset", 120);
    const result = await this.#call(() => this.bridge.createSession(options), "create session");
    const sessionId = asString(result?.sessionId);
    if (sessionId === undefined) throw apiError("internal", "bridge.createSession did not return a sessionId");
    return { sessionId, agentPreset: asString(result?.agentPreset) ?? options.agentPreset ?? null };
  }

  async getSession(sessionId) {
    const id = requireString(sessionId, "sessionId", 200);
    const result = await this.#call(() => this.bridge.getSession(id), "get session");
    if (!isRecord(result)) throw apiError("internal", "bridge.getSession returned no session");
    if (isRecord(result.state)) {
      const previous = this.sessionStates.get(id);
      this.sessionStates.set(id, {
        running: result.state.running === true,
        active: typeof result.state.active === "boolean" ? result.state.active : previous?.active ?? true
      });
    }
    return { ...result, sessionId: asString(result.sessionId) ?? id };
  }

  async history(sessionId, query) {
    const id = requireString(sessionId, "sessionId", 200);
    const beforeSeq = asNonNegativeInt(queryValue(query, "beforeSeq"));
    const maxMessages = clampInt(queryValue(query, "maxMessages"), DEFAULT_HISTORY_MAX, 1, MAX_HISTORY_MAX);
    const options = { maxMessages };
    if (beforeSeq !== undefined) options.beforeSeq = beforeSeq;
    const result = await this.#call(() => this.bridge.history(id, options), "session history");
    const records = Array.isArray(result?.records) ? [...result.records].sort((left, right) => sequenceOf(left) - sequenceOf(right)) : [];
    const cursor = typeof result?.cursor === "number" && Number.isFinite(result.cursor) ? result.cursor : null;
    return {
      records,
      cursor,
      hasMore: Boolean(result?.hasMore)
    };
  }

  async changes(sessionId, seqValue, indexValue) {
    const id = requireString(sessionId, 'sessionId', 200);
    const seq = Number(seqValue), index = indexValue === undefined ? undefined : Number(indexValue);
    if (!Number.isSafeInteger(seq) || seq < 0 || (index !== undefined && (!Number.isSafeInteger(index) || index < 0))) {
      throw apiError('invalid-argument', 'Invalid change sequence or file index');
    }
    return this.#call(() => this.bridge.changes(id, seq, index), 'workspace changes');
  }

  async readFile(sessionId, query) {
    const id = requireString(sessionId, 'sessionId', 200);
    const rawPath = queryValue(query, 'path');
    if (typeof rawPath === 'string' && rawPath.length > 4096) throw apiError('invalid-argument', 'File path is too long');
    const path = requireString(rawPath, 'path', 4096);
    if (path.includes('\0')) throw apiError('invalid-argument', 'Invalid file path');
    const format = queryValue(query, 'format') === 'text' ? 'text' : 'bytes';
    return this.#call(() => this.bridge.readFile(id, path, format), 'workspace file');
  }

  async open(deviceId, sessionId, body) {
    const id = requireString(sessionId, "sessionId", 200);
    const options = normalizeOpenOptions(body);
    // DSH's follow iterator fails asynchronously, which would make this route
    // answer 200 and only later emit an error frame. Probe first so an unknown
    // session is the documented 404 session-not-found.
    await this.#assertSessionExists(id, "open session");
    const subscriptionId = createId("sub_");
    const record = {
      subscriptionId,
      sessionId: id,
      deviceId,
      key: deviceId + "|" + id,
      handle: null,
      closed: false,
      snapshotDelivered: false,
      snapshotWritten: false,
      lastSnapshot: null,
      lastSnapshotKey: null
    };
    const result = await this.#call(
      () => this.bridge.openFollow(id, options, (kind, payload) => this.#onFollowFrame(record, kind, payload)),
      "open session"
    );
    record.handle = result?.subscription ?? null;
    if (!record.snapshotDelivered && isRecord(result?.opening)) this.#sendSnapshot(record, result.opening);
    const previous = this.subscriptionsBySession.get(record.key);
    this.subscriptions.set(subscriptionId, record);
    this.subscriptionsBySession.set(record.key, record);
    if (previous !== undefined && previous !== record) await this.#closeSubscription(previous, "replaced");
    return { subscriptionId, sessionId: id };
  }

  async close(deviceId, sessionId) {
    const id = requireString(sessionId, "sessionId", 200);
    const record = this.subscriptionsBySession.get(deviceId + "|" + id);
    if (record !== undefined) await this.#closeSubscription(record, "closed");
    return { closed: true };
  }

  async prompt(sessionId, body) {
    const id = requireString(sessionId, "sessionId", 200);
    if (!isRecord(body)) throw apiError("invalid-argument", "request body must be a JSON object");
    const requestId = body.requestId === undefined ? undefined : requireString(body.requestId, "requestId", 200);
    const mode = body.mode === undefined ? "queue" : requireString(body.mode, "mode", 32);
    if (mode !== "queue" && mode !== "steer") throw apiError("invalid-argument", "mode must be \"queue\" or \"steer\"");
    if (!Array.isArray(body.content) || body.content.length === 0) throw apiError("invalid-argument", "content must be a non-empty array");
    if (body.content.length > 64) throw apiError("invalid-argument", "content must contain at most 64 blocks");
    const counters = { images: 0 };
    const content = body.content.map((block, index) => normalizeContentBlock(block, index, counters));
    const payload = { mode, content };
    if (requestId !== undefined) payload.requestId = requestId;
    if (body.clientTimeZone !== undefined) payload.clientTimeZone = requireString(body.clientTimeZone, "clientTimeZone", 100);

    const key = requestId === undefined ? null : id + "|" + requestId;
    if (key !== null) {
      const known = this.#recallPrompt(key);
      if (known !== null) return known;
    }
    const operation = (async () => {
      let result;
      try {
        result = await this.#call(() => this.bridge.prompt(id, payload), "send prompt");
      } catch (error) {
        // DSH: "clientTimeZone must be UTC or a valid IANA Area/Location name"
        // is a client argument problem, not a server failure.
        if (error instanceof ApiError && error.code === "internal" && INVALID_CLIENT_TIMEZONE_PATTERN.test(error.message)) {
          throw apiError("invalid-argument", error.message);
        }
        throw error;
      }
      const accepted = result?.accepted !== false;
      return requestId === undefined ? { accepted } : { accepted, requestId };
    })();
    if (key === null) return operation;
    const entry = { at: this.now(), settled: false, response: null, promise: null };
    this.promptRequests.set(key, entry);
    entry.promise = operation.then(
      (response) => {
        entry.settled = true;
        entry.response = response;
        return response;
      },
      (error) => {
        // A failed attempt is not replayable: let the client retry for real.
        this.promptRequests.delete(key);
        throw error;
      }
    );
    this.#prunePromptRequests();
    return entry.promise;
  }

  async cancel(sessionId) {
    const id = requireString(sessionId, "sessionId", 200);
    const result = await this.#call(() => this.bridge.cancel(id), "cancel session");
    return { accepted: result?.accepted !== false };
  }

  async rename(sessionId, body) {
    const id = requireString(sessionId, "sessionId", 200);
    const title = requireString(body?.title, "title", MAX_TITLE_LENGTH);
    const result = await this.#call(() => this.bridge.rename(id, title), "rename session");
    return { title: asString(result?.title) ?? title, seq: asNonNegativeInt(result?.seq) ?? null };
  }

  async selectModel(sessionId, body) {
    const id = requireString(sessionId, "sessionId", 200);
    const provider = requireString(body?.provider, "provider", 120);
    const model = requireString(body?.model, "model", 200);
    const selection = { provider, model };
    if (body?.reasoningEffort !== undefined) selection.reasoningEffort = requireString(body.reasoningEffort, "reasoningEffort", 60);
    let result;
    try {
      result = await this.#call(() => this.bridge.selectModel(id, selection), "select model");
    } catch (error) {
      // DSH: "Select an available model before sending a message." — the client
      // sent a provider/model outside the catalog, which is a 400, not a 500.
      if (error instanceof ApiError && error.code === "internal" && INVALID_MODEL_SELECTION_PATTERN.test(error.message)) {
        throw apiError("invalid-argument", error.message);
      }
      throw error;
    }
    return { selected: isRecord(result?.selected) ? result.selected : selection };
  }

  async models() {
    const catalog = await this.#call(() => this.bridge.modelCatalog(), "model catalog");
    return isRecord(catalog) ? catalog : { default: null, routableProviders: [], groups: [], failures: [] };
  }

  async approvals() {
    try {
      const result = await this.#call(() => this.bridge.listApprovals(), "list approvals");
      const items = Array.isArray(result) ? result : Array.isArray(result?.items) ? result.items : [];
      return { items: items.filter((item) => isRecord(item) && typeof item.id === "string") };
    } catch (error) {
      // The bridge is authoritative; the local mirror only rescues a bridge that
      // cannot enumerate. Never invent approvals it never announced.
      if (this.pendingApprovals.size > 0) return { items: [...this.pendingApprovals.values()] };
      throw error;
    }
  }

  async answerApproval(approvalId, body) {
    const id = requireString(approvalId, "approvalId", 200);
    const decision = requireString(body?.decision, "decision", 32);
    if (decision !== "allow" && decision !== "reject") throw apiError("invalid-argument", "decision must be \"allow\" or \"reject\"");
    let result;
    try {
      result = await this.#call(() => this.bridge.answerApproval(id, decision), "answer approval");
    } finally {
      this.pendingApprovals.delete(id);
    }
    const outcome = result?.outcome === undefined || result?.outcome === null
      ? (decision === "allow" ? "allowed" : "rejected")
      : normalizeOutcome(result.outcome);
    return { resolved: result?.resolved !== false, outcome };
  }

  async revokeDevice(deviceId) {
    if (typeof deviceId !== "string" || deviceId.length === 0) throw apiError("invalid-argument", "deviceId is required");
    const removed = await this.devices.revoke(deviceId);
    if (removed) {
      await this.closeDeviceSubscriptions(deviceId, "device-removed");
      this.hub.closeDevice(deviceId, { event: "error", data: { code: "unauthorized", message: "device revoked" }, reason: "revoked" });
    }
    return { removed: true };
  }

  async closeSessionSubscriptions(sessionId, reason) {
    for (const record of [...this.subscriptions.values()]) {
      if (record.sessionId === sessionId) await this.#closeSubscription(record, reason);
    }
  }

  async closeDeviceSubscriptions(deviceId, reason) {
    for (const record of [...this.subscriptions.values()]) {
      if (record.deviceId === deviceId) await this.#closeSubscription(record, reason);
    }
  }

  /** Callbacks handed to DshBridge at construction. */
  bridgeHandlers() {
    return {
      onSessionAdded: (row) => {
        if (!isRecord(row) || typeof row.sessionId !== "string") return;
        this.sessionStates.set(row.sessionId, {
          running: row.running === true,
          active: typeof row.active === "boolean" ? row.active : row.agentAvailable !== false
        });
        this.hub.broadcast("session.added", { row });
      },
      onSessionRemoved: (sessionId) => {
        if (typeof sessionId !== "string") return;
        this.sessionStates.delete(sessionId);
        void this.closeSessionSubscriptions(sessionId, "session-removed");
        this.hub.broadcast("session.removed", { sessionId });
      },
      onSessionStatus: (info) => {
        if (!isRecord(info) || typeof info.sessionId !== "string") return;
        const previous = this.sessionStates.get(info.sessionId);
        const running = Boolean(info.running);
        // DSH's status event only carries running; keep the last known
        // availability (or infer it from a running turn) instead of sending false.
        const active = typeof info.active === "boolean"
          ? info.active
          : running
            ? true
            : previous?.active ?? true;
        this.sessionStates.set(info.sessionId, { running, active });
        this.hub.broadcast("session.status", { sessionId: info.sessionId, running, active });
      },
      onApprovalRequest: (request) => {
        if (!isRecord(request) || typeof request.id !== "string") return;
        this.pendingApprovals.set(request.id, request);
        this.hub.broadcast("approval.request", request);
      },
      onApprovalResolved: (info) => {
        if (!isRecord(info) || typeof info.id !== "string") return;
        this.pendingApprovals.delete(info.id);
        this.hub.broadcast("approval.resolved", { id: info.id, outcome: normalizeOutcome(info.outcome) });
      }
    };
  }

  /** Announce an SSE connection: hello, plus any snapshot that was sent too early. */
  onSSEConnect(deviceId, connection) {
    const subscriptions = [];
    for (const record of this.subscriptions.values()) {
      if (record.closed || record.deviceId !== deviceId) continue;
      subscriptions.push({ subscriptionId: record.subscriptionId, sessionId: record.sessionId });
    }
    this.hub.send(connection, "hello", {
      protocol: this.protocolVersion,
      serverTime: this.now(),
      hostId: this.hostDescriptor().hostId,
      subscriptions
    });
    for (const record of this.subscriptions.values()) {
      if (record.closed || record.deviceId !== deviceId) continue;
      if (record.lastSnapshot !== null && record.snapshotWritten !== true) {
        record.snapshotWritten = this.hub.send(connection, "session.snapshot", this.#snapshotData(record, record.lastSnapshot)) === true;
      }
    }
  }

  /** Release follow handles and forget subscriptions. */
  async dispose() {
    for (const record of [...this.subscriptions.values()]) {
      record.closed = true;
      try {
        await record.handle?.close?.();
      } catch (error) {
        this.logger?.warn?.("dsh-remote: closing follow handle failed: " + error.message);
      }
    }
    this.subscriptions.clear();
    this.subscriptionsBySession.clear();
    this.pendingApprovals.clear();
    this.promptRequests.clear();
    this.sessionStates.clear();
  }

  async #assertSessionExists(sessionId, what) {
    if (this.bridge === null) {
      throw apiError("internal", "dsh-remote bridge is not ready");
    }
    try {
      await this.bridge.getSession(sessionId);
    } catch (error) {
      const mapped = mapBridgeError(error, what);
      if (mapped.code === "session-not-found") throw mapped;
      // A probe failure that is not about existence must not block a valid session.
      this.logger?.debug?.("dsh-remote: existence probe for " + sessionId + " failed: " + mapped.message);
    }
  }

  #recallPrompt(key) {
    const entry = this.promptRequests.get(key);
    if (entry === undefined) return null;
    if (this.now() - entry.at > REQUEST_ID_TTL_MS) {
      this.promptRequests.delete(key);
      return null;
    }
    if (entry.settled && entry.response !== null) return { ...entry.response };
    return entry.promise;
  }

  #prunePromptRequests() {
    if (this.promptRequests.size <= REQUEST_ID_MAX) return;
    for (const [key, entry] of this.promptRequests) {
      if (this.promptRequests.size <= REQUEST_ID_MAX) break;
      if (!entry.settled) continue;
      this.promptRequests.delete(key);
    }
  }

  #onFollowFrame(record, kind, payload) {
    if (record.closed) return;
    if (kind === "snapshot") {
      this.#sendSnapshot(record, payload);
      return;
    }
    if (kind === "closed" || kind === "error") {
      // The bridge reports the end of a follow stream explicitly; never leave
      // the subscription dangling on the App side.
      if (kind === "error") {
        this.hub.sendTo(record.deviceId, "error", {
          code: asString(payload?.code) ?? "stream-unavailable",
          message: asString(payload?.message) ?? "session stream failed"
        });
      }
      void this.#closeSubscription(record, kind === "closed" ? asString(payload?.reason) ?? "upstream-ended" : "stream-error");
      return;
    }
    const base = { subscriptionId: record.subscriptionId, sessionId: record.sessionId };
    if (kind === "event") {
      this.#sendFrame(record, "session.event", { ...base, event: payload });
    } else if (kind === "assistant") {
      this.#sendFrame(record, "session.assistant", { ...base, frame: payload });
    } else if (kind === "state") {
      this.#sendFrame(record, "session.state", { ...base, state: payload });
    } else {
      this.#sendFrame(record, "session.other", { ...base, frame: payload });
    }
  }

  #sendSnapshot(record, payload) {
    const snapshot = isRecord(payload) ? payload : {};
    const key = JSON.stringify([snapshot.cursor ?? null, Array.isArray(snapshot.records) ? snapshot.records.length : -1, snapshot.header?.id ?? null]);
    record.snapshotDelivered = true;
    record.lastSnapshot = snapshot;
    if (record.lastSnapshotKey === key) return;
    record.lastSnapshotKey = key;
    record.snapshotWritten = this.hub.sendTo(record.deviceId, "session.snapshot", this.#snapshotData(record, snapshot)) === true;
  }

  #snapshotData(record, snapshot) {
    return {
      subscriptionId: record.subscriptionId,
      sessionId: record.sessionId,
      header: isRecord(snapshot.header) ? snapshot.header : null,
      records: Array.isArray(snapshot.records) ? snapshot.records : [],
      hasMore: Boolean(snapshot.hasMore),
      cursor: asNonNegativeInt(snapshot.cursor) ?? null,
      projections: isRecord(snapshot.projections) ? snapshot.projections : null,
      assistantStream: snapshot.assistantStream ?? null
    };
  }

  #sendFrame(record, event, data) {
    this.hub.sendTo(record.deviceId, event, data);
  }

  async #closeSubscription(record, reason) {
    if (record.closed) return;
    record.closed = true;
    this.subscriptions.delete(record.subscriptionId);
    if (this.subscriptionsBySession.get(record.key) === record) this.subscriptionsBySession.delete(record.key);
    try {
      await record.handle?.close?.();
    } catch (error) {
      this.logger?.warn?.("dsh-remote: closing follow handle failed: " + error.message);
    }
    this.hub.sendTo(record.deviceId, "subscription.closed", {
      subscriptionId: record.subscriptionId,
      sessionId: record.sessionId,
      reason
    });
  }

  async #call(operation, what) {
    if (this.bridge === null) throw apiError("internal", "dsh-remote bridge is not ready");
    try {
      return await operation();
    } catch (error) {
      throw mapBridgeError(error, what);
    }
  }
}
