/**
 * In-memory DshBridge stand-in with the same surface the plugin codes against.
 * Tests inject protocol frames through emit()/pushApproval() and inspect the
 * calls the net layer made.
 */

export const SILENT_LOGGER = Object.freeze({
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
});

let sessionCounter = 0;

/**
 * @param {Record<string, unknown>} [overrides]
 * @returns {object} SessionRow-shaped object
 */
export function makeSessionRow(overrides) {
  sessionCounter += 1;
  const id = overrides?.sessionId ?? "session-" + sessionCounter;
  return {
    sessionId: id,
    title: "Session " + sessionCounter,
    createdAt: 1763000000000 + sessionCounter,
    updatedAt: 1763000005000 + sessionCounter,
    cwd: "D:\\Code\\demo",
    running: false,
    active: true,
    blank: false,
    agentAvailable: true,
    model: { provider: "opencode-go", model: "deepseek-v4.1-flash", reasoningEffort: "high" },
    lastMessage: null,
    parentSessionId: null,
    origin: null,
    agentPreset: "standard",
    ...overrides
  };
}

/**
 * @param {Record<string, unknown>} [overrides]
 * @returns {object} Approval-shaped object
 */
export function makeApproval(overrides) {
  const id = overrides?.id ?? "apr_test";
  return {
    id,
    sessionId: "session-1",
    tool: "pwsh",
    callId: "call_" + id,
    reason: "run command",
    displayReason: "执行命令：npm install",
    requestedAt: 1763000000000,
    expiresAt: null,
    ...overrides
  };
}

export class FakeBridge {
  /**
   * @param {{handlers?: object, host?: object, sessions?: object[],
   *   historyRecords?: Record<string, object[]>, modelCatalog?: object}} [options]
   */
  constructor(options) {
    const settings = options ?? {};
    this.handlers = settings.handlers ?? {};
    this.host = {
      hostId: undefined,
      name: "TEST-HOST",
      platform: "win32",
      dshVersion: "0.2.2-rc.1",
      defaultCwd: "D:\\Code\\demo",
      capabilities: { assistantStream: true, approvals: true, models: true, images: true },
      ...(settings.host ?? {})
    };
    this.sessions = settings.sessions ?? [makeSessionRow({ sessionId: "session-1" })];
    this.historyRecords = settings.historyRecords ?? {};
    this.modelCatalogValue = settings.modelCatalog ?? {
      default: { provider: "opencode-go", model: "deepseek-v4.1-flash" },
      routableProviders: [{ id: "opencode-go" }],
      groups: [],
      failures: []
    };
    this.follows = new Map();
    this.followSeq = 0;
    this.listRequests = [];
    this.historyRequests = [];
    this.getSessionCalls = [];
    this.promptCalls = [];
    this.promptResults = new Map();
    this.cancelCalls = [];
    this.renameCalls = [];
    this.modelCalls = [];
    this.createCalls = [];
    this.answerCalls = [];
    this.approvals = new Map();
    this.initCalls = 0;
    this.disposed = false;
  }

  async init() {
    this.initCalls += 1;
  }

  hostInfo() {
    return { ...this.host, capabilities: { ...this.host.capabilities } };
  }

  async listSessions(request) {
    this.listRequests.push(request ?? {});
    const limit = Number.isInteger(request?.limit) ? request.limit : 50;
    return { items: this.sessions.slice(0, limit), nextCursor: null };
  }

  async getSession(sessionId) {
    this.getSessionCalls.push(sessionId);
    const row = this.sessions.find((session) => session.sessionId === sessionId);
    if (row === undefined) {
      const error = new Error("Session " + sessionId + " is not visible");
      error.code = "session-not-found";
      throw error;
    }
    return {
      sessionId,
      title: row.title,
      header: { id: sessionId, createdAt: row.createdAt, cwd: row.cwd, agentPreset: row.agentPreset },
      state: { active: row.active, running: row.running, queue: [], pendingInput: [] },
      projections: { values: { title: row.title } }
    };
  }

  async history(sessionId, options) {
    if (!this.sessions.some((session) => session.sessionId === sessionId)) {
      throw new Error('session "' + sessionId + '" not found');
    }
    this.historyRequests.push({ sessionId, options: options ?? {} });
    const records = this.historyRecords[sessionId] ?? [];
    const beforeSeq = Number.isInteger(options?.beforeSeq) ? options.beforeSeq : undefined;
    const selected = beforeSeq === undefined ? records : records.filter((record) => (record.event?.seq ?? 0) < beforeSeq);
    const maxMessages = Number.isInteger(options?.maxMessages) ? options.maxMessages : selected.length;
    const page = selected.slice(Math.max(0, selected.length - maxMessages));
    const last = page.length === 0 ? null : page[page.length - 1].event?.seq ?? -1;
    return { records: page, cursor: last === null ? -1 : last, hasMore: selected.length > page.length };
  }

  async openFollow(sessionId, options, onFrame) {
    if (!this.sessions.some((session) => session.sessionId === sessionId)) {
      const error = new Error("Session " + sessionId + " is not visible");
      error.code = "session-not-found";
      throw error;
    }
    const entry = {
      id: "fake-sub-" + (this.followSeq += 1),
      sessionId,
      options: options ?? {},
      onFrame,
      closed: false
    };
    entry.close = () => {
      if (entry.closed) return;
      entry.closed = true;
      this.follows.delete(entry.id);
    };
    this.follows.set(entry.id, entry);
    const row = this.sessions.find((session) => session.sessionId === sessionId);
    const records = this.historyRecords[sessionId] ?? [];
    const cursor = records.length === 0 ? 0 : records[records.length - 1].event?.seq ?? 0;
    onFrame("snapshot", {
      header: { version: 4, id: sessionId, createdAt: row.createdAt, cwd: row.cwd, isSeeded: false, agentPreset: row.agentPreset },
      cursor,
      records,
      hasMore: false,
      projections: { asOfSeq: cursor, values: { title: row.title } },
      assistantStream: null
    });
    return { subscription: { close: entry.close }, opening: null };
  }

  /** Push a follow frame to every open follow of a session. */
  emit(sessionId, kind, payload) {
    for (const entry of [...this.follows.values()]) {
      if (entry.closed || entry.sessionId !== sessionId) continue;
      entry.onFrame(kind, payload);
    }
  }

  async prompt(sessionId, payload) {
    if (!this.sessions.some((session) => session.sessionId === sessionId)) {
      // Real DSH throws a plain Error here (no .code); the net layer must map it.
      throw new Error('session "' + sessionId + '" not found');
    }
    if (typeof payload?.clientTimeZone === "string" && payload.clientTimeZone === "GMT") {
      // Real DSH rejects non-IANA time zones with a plain, code-less Error.
      throw new Error("clientTimeZone must be UTC or a valid IANA Area/Location name");
    }
    this.promptCalls.push({ sessionId, payload });
    const requestId = payload?.requestId;
    if (typeof requestId === "string" && this.promptResults.has(requestId)) {
      return this.promptResults.get(requestId);
    }
    const result = { accepted: true };
    if (typeof requestId === "string") this.promptResults.set(requestId, result);
    return result;
  }

  async cancel(sessionId) {
    if (!this.sessions.some((session) => session.sessionId === sessionId)) {
      throw new Error('session "' + sessionId + '" not found (not attached)');
    }
    this.cancelCalls.push(sessionId);
    return { accepted: true };
  }

  async rename(sessionId, title) {
    if (!this.sessions.some((session) => session.sessionId === sessionId)) {
      throw new Error('session "' + sessionId + '" not found');
    }
    this.renameCalls.push({ sessionId, title });
    return { title, seq: 42 };
  }

  async selectModel(sessionId, selection) {
    if (!this.sessions.some((session) => session.sessionId === sessionId)) {
      throw new Error('session "' + sessionId + '" not found');
    }
    const provider = selection?.provider;
    const model = selection?.model;
    if (provider === "no-such-provider" || model === "no-such-model") {
      // Real DSH throws a plain, code-less Error here.
      throw new Error("Select an available model before sending a message.");
    }
    this.modelCalls.push({ sessionId, selection });
    return { selected: selection };
  }

  async modelCatalog() {
    return this.modelCatalogValue;
  }

  async createSession(options) {
    this.createCalls.push(options);
    const row = makeSessionRow({ cwd: options?.cwd, agentPreset: options?.agentPreset });
    this.sessions.unshift(row);
    return { sessionId: row.sessionId, agentPreset: options?.agentPreset };
  }

  async listApprovals() {
    return [...this.approvals.values()];
  }

  async answerApproval(approvalId, decision) {
    if (!this.approvals.has(approvalId)) {
      const error = new Error("approval is no longer pending");
      error.code = "approval-gone";
      throw error;
    }
    this.approvals.delete(approvalId);
    this.answerCalls.push({ approvalId, decision });
    const outcome = decision === "allow" ? "allowed-once" : "rejected";
    this.handlers.onApprovalResolved?.({ id: approvalId, outcome });
    return { resolved: true, outcome };
  }

  /** Announce an approval through the bridge callback, as the real bridge does. */
  pushApproval(approval) {
    this.approvals.set(approval.id, approval);
    this.handlers.onApprovalRequest?.(approval);
  }

  emitSessionAdded(row) {
    this.handlers.onSessionAdded?.(row);
  }

  emitSessionStatus(info) {
    this.handlers.onSessionStatus?.(info);
  }

  emitSessionRemoved(sessionId) {
    this.handlers.onSessionRemoved?.(sessionId);
  }

  emitApprovalResolved(info) {
    this.handlers.onApprovalResolved?.(info);
  }

  async dispose() {
    this.disposed = true;
    for (const entry of [...this.follows.values()]) entry.close();
    this.follows.clear();
  }
}

export default FakeBridge;
