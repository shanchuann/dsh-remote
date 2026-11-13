/**
 * DSH bridge: the only part of the plugin that touches DeepSeek Harness services.
 * Verified against DSH 0.2.2-rc.1 in a real host (see docs/wire-events.md):
 *  - ctx.get('sessionController') methods are callable in-process; they take a
 *    plain request object plus a trailing AbortSignal.
 *  - controller.follow(...) yields {type:'snapshot'|'event'|'assistant-stream'}.
 *  - Host events: api-session/added|removed|status|activity, agent/created.
 *  - Approvals are answered through an agent-scoped 'approval/request' waterfall
 *    listener on the live Agent context (payload.agent.ctx).
 */
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';

const DEFAULT_APPROVAL_TIMEOUT_MS = 90000;

function safe(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

function freshSignal() {
  return new AbortController().signal;
}

/**
 * Best-effort DSH version. The desktop bundle ships resources/app.asar whose
 * dsh/package.json is @deepseek-ai/dsh-desktop-runtime; its version is the DSH
 * version (0.2.2-rc.1 etc.). The "<exe>/version" file is the Electron version,
 * so it is deliberately not used.
 */
function detectDshVersion() {
  // Electron patches fs for asar paths, so read the manifest THROUGH the
  // archive instead of parsing the archive container ourselves.
  const manifests = [];
  const execDir = safe(() => dirname(process.execPath), undefined);
  if (execDir !== undefined) manifests.push(join(execDir, 'resources', 'app.asar', 'dsh', 'package.json'));
  for (const arg of safe(() => process.argv, [])) {
    if (typeof arg !== 'string') continue;
    const marker = arg.toLowerCase().indexOf('app.asar');
    if (marker !== -1) {
      const root = arg.slice(0, marker + 'app.asar'.length);
      manifests.push(join(root, 'dsh', 'package.json'));
    }
  }
  for (const manifest of manifests) {
    try {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
      if (typeof parsed.version === 'string' && /^\d+\.\d+\.\d+/.test(parsed.version)) return parsed.version;
    } catch { /* ignore: next candidate */ }
  }
  return undefined;
}

function mapModelSelection(selection) {
  if (selection === null || selection === undefined) return null;
  if (typeof selection.provider !== 'string' || typeof selection.model !== 'string') return null;
  const mapped = { provider: selection.provider, model: selection.model };
  if (typeof selection.reasoningEffort === 'string') mapped.reasoningEffort = selection.reasoningEffort;
  return mapped;
}

export function mapSessionRow(row) {
  const values = (row && row.projections && row.projections.values) || {};
  const selectionValue = values.modelSelection === undefined ? null : (values.modelSelection.next ?? values.modelSelection.lastUsed ?? null);
  return {
    sessionId: row.sessionId,
    title: typeof values.title === 'string' && values.title.length > 0 ? values.title : null,
    createdAt: Number.isFinite(row.createdAt) ? row.createdAt : 0,
    updatedAt: Number.isFinite(row.updatedAt) ? row.updatedAt : 0,
    cwd: typeof row.cwd === 'string' ? row.cwd : (typeof values.workingDirectory === 'string' ? values.workingDirectory : null),
    running: row.running === true,
    active: row.agentAvailable === true,
    blank: row.blank === true,
    agentAvailable: row.agentAvailable === true,
    model: mapModelSelection(selectionValue),
    lastMessage: null,
    parentSessionId: typeof row.parentSessionId === 'string' ? row.parentSessionId : null,
    origin: row.origin === 'subagent' ? 'subagent' : null,
    agentPreset: typeof values.agentPreset === 'string' ? values.agentPreset : null
  };
}

function mapRecords(records) {
  if (!Array.isArray(records)) return [];
  return records.filter((record) => record !== null && typeof record === 'object');
}

export function bridgeError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

export class DshBridge {
  constructor(ctx, options) {
    this.ctx = ctx;
    this.options = options || {};
    this.handlers = this.options.handlers || {};
    this.hasMobileClients = this.options.hasMobileClients || (() => true);
    this.approvalTimeoutMs = Number.isInteger(this.options.approvalTimeoutMs) ? this.options.approvalTimeoutMs : DEFAULT_APPROVAL_TIMEOUT_MS;
    this.controller = undefined;
    this.approvalService = undefined;
    this.pendingApprovals = new Map();
    this.pendingByCallId = new Map();
    this.follows = new Map();
    this.disposers = [];
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    this.controller = this.ctx.get('sessionController');
    if (this.controller === undefined) throw new Error('dsh-remote: sessionController service is unavailable');
    this.approvalService = this.ctx.get('approval');
    const listen = (event, listener) => {
      const dispose = safe(() => this.ctx.on(event, listener), undefined);
      if (typeof dispose === 'function') this.disposers.push(dispose);
    };
    listen('api-session/added', (summary) => {
      try { this.handlers.onSessionAdded && this.handlers.onSessionAdded(this.mapRow(summary)); } catch (error) { this.log('warn', 'onSessionAdded failed', error); }
    });
    listen('api-session/removed', (sessionId) => {
      try { this.handlers.onSessionRemoved && this.handlers.onSessionRemoved(String(sessionId)); } catch (error) { this.log('warn', 'onSessionRemoved failed', error); }
    });
    listen('api-session/status', (sessionId, running) => {
      try { this.handlers.onSessionStatus && this.handlers.onSessionStatus({ sessionId: String(sessionId), running: running === true, active: true }); } catch (error) { this.log('warn', 'onSessionStatus failed', error); }
    });
    const attachApprovalAnswerer = (agent) => {
      const agentCtx = safe(() => agent && agent.ctx, undefined);
      if (agentCtx === undefined || typeof agentCtx.on !== 'function') return;
      try {
        const dispose = agentCtx.on('approval/request', (request, next) => this.answerApprovalRequest(request, next));
        if (typeof dispose === 'function') this.disposers.push(dispose);
        this.log('info', 'approval answerer attached');
      } catch (error) {
        this.log('warn', 'approval answerer attach failed', error);
      }
    };
    listen('agent/created', (payload) => attachApprovalAnswerer(safe(() => payload && payload.agent, undefined)));
    const agents = this.ctx.get('agents');
    for (const agent of safe(() => (agents && typeof agents.list === 'function' ? agents.list() : []), [])) attachApprovalAnswerer(agent);
    this.initialized = true;
    this.log('info', 'bridge initialized');
  }

  log(level, message, detail) {
    const logger = this.ctx.logger;
    if (!logger) return;
    const write = typeof logger[level] === 'function' ? logger[level] : logger.info;
    if (typeof write !== 'function') return;
    try {
      if (detail === undefined) write.call(logger, 'dsh-remote: ' + message);
      else write.call(logger, 'dsh-remote: ' + message, detail);
    } catch (error) { /* logging must never break the bridge */ }
  }

  hostInfo() {
    const detectedName = safe(() => hostname(), '');
    const cwd = safe(() => process.cwd(), '');
    return {
      hostId: undefined,
      name: detectedName.length > 0 ? detectedName : 'dsh-host',
      platform: process.platform,
      dshVersion: detectDshVersion(),
      defaultCwd: typeof cwd === 'string' && cwd.length > 0 ? cwd : null,
      capabilities: {
        assistantStream: true,
        approvals: this.approvalService !== undefined,
        models: true,
        messageFork: true,
        messageFeedback: Boolean(this.ctx.get('messageFeedback')),
        images: true,
        workspaceFiles: Boolean(this.ctx.get('workspaceFiles')),
        workspaceChanges: Boolean(this.ctx.get('workspaceChanges'))
      }
    };
  }

  listWorkspaces() {
    const registry = this.ctx.get('workspaceRegistry');
    if (!registry || typeof registry.list !== 'function') return undefined;
    // Snapshot membership once: entity getters can consult persisted headers.
    return registry.list().map((workspace) => ({
      id: workspace.id, title: workspace.title, path: workspace.path,
      sessionIds: [...workspace.sessionIds]
    }));
  }

  mapRow(row, workspaces = this.listWorkspaces()) {
    const mapped = mapSessionRow(row);
    // An explicit null means the desktop knows this session is ungrouped.
    // Omitted fields retain compatibility with older hosts without Workspaces.
    if (workspaces) {
      const workspace = workspaces.find((item) => item.sessionIds.includes(row.sessionId));
      mapped.workspaceId = workspace?.id ?? null;
      mapped.workspaceTitle = workspace?.title ?? null;
      mapped.workspacePath = workspace?.path ?? null;
    }
    return mapped;
  }

  async listSessions(request) {
    const query = request || {};
    const result = await this.controller.list({}, freshSignal());
    const workspaces = this.listWorkspaces();
    const items = Array.isArray(result && result.items) ? result.items.map((row) => this.mapRow(row, workspaces)) : [];
    const limit = Number.isInteger(query.limit) && query.limit > 0 ? Math.min(query.limit, 100) : 50;
    const cursor = query.cursor ?? '0';
    if (typeof cursor !== 'string' || !/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) {
      throw bridgeError('invalid-argument', 'invalid session cursor');
    }
    const offset = Number(cursor);
    return {
      items: items.slice(offset, offset + limit),
      nextCursor: offset + limit < items.length ? String(offset + limit) : null,
      ...(workspaces ? { workspaces: workspaces.map(({ id, title, path }) => ({ id, title, path })) } : {})
    };
  }

  async findRow(sessionId) {
    const result = await this.controller.list({}, freshSignal());
    const rows = Array.isArray(result && result.items) ? result.items : [];
    return rows.find((row) => row.sessionId === sessionId);
  }

  async getSession(sessionId) {
    const row = await this.findRow(sessionId);
    if (row === undefined) throw bridgeError('session-not-found', 'Session ' + sessionId + ' is not visible');
    const stateValue = await Promise.resolve(safe(() => this.controller.state({ sessionId }, freshSignal()), null)).then((value) => value, () => null);
    const projections = await Promise.resolve(safe(() => this.controller.projections({ sessionId }, freshSignal()), null)).then((value) => value, () => null);
    const mapped = this.mapRow(row);
    return {
      sessionId,
      title: mapped.title,
      header: { id: sessionId, createdAt: mapped.createdAt, cwd: mapped.cwd, agentPreset: mapped.agentPreset },
      state: stateValue || { active: false, running: false, queue: null, pendingInput: [] },
      projections: projections || null,
      row: mapped
    };
  }

  async history(sessionId, options) {
    const query = options || {};
    const request = { address: { kind: 'session', sessionId } };
    if (Number.isInteger(query.beforeSeq)) request.beforeSeq = query.beforeSeq;
    if (Number.isInteger(query.maxMessages)) request.maxMessages = Math.max(1, Math.min(query.maxMessages, 500));
    const result = await this.controller.events(request, freshSignal());
    return {
      records: mapRecords(result && result.records),
      cursor: Number.isInteger(result && result.cursor) ? result.cursor : -1,
      hasMore: Boolean(result && result.hasMore)
    };
  }

  async changes(sessionId, seq, index) {
    if (!await this.findRow(sessionId)) throw bridgeError('session-not-found', 'Session is not visible');
    const changes = this.ctx.get('workspaceChanges');
    if (!changes) throw bridgeError('feature-unavailable', 'Host does not provide workspace changes');
    const result = index === undefined
      ? await changes.summary(sessionId, seq)
      : await changes.diff(sessionId, seq, index, freshSignal());
    return result ?? { unavailable: true, reason: 'snapshot-released' };
  }

  async readFile(sessionId, path, format) {
    const row = await this.findRow(sessionId);
    if (!row) throw bridgeError('session-not-found', 'Session is not visible');
    const files = this.ctx.get('workspaceFiles');
    if (!files) throw bridgeError('feature-unavailable', 'Host does not provide workspace files');
    const scope = { sessionId, workspaceRoot: row.cwd ?? this.ctx.get("sandboxPolicy")?.workspaceRoot };
    try {
    // Preserve DSH filesystem access rules instead of using raw node:fs paths.
    if (format === 'text') return await files.read(scope, path, { offset: 1, limit: Math.min(3000, files.config?.maxLines ?? 3000) }, freshSignal());
    const stat = await files.stat(scope, path, freshSignal());
    if ((stat.bytes ?? stat.size) > 32 * 1024 * 1024) throw bridgeError('invalid-argument', 'File exceeds the 32 MB download limit');
    const result = await files.readBytes(scope, path, {}, freshSignal());
    const bytes = Buffer.from(result.data);
    if (bytes.length > 32 * 1024 * 1024) throw bridgeError('invalid-argument', 'File exceeds the 32 MB download limit');
    return { data: bytes, path: result.absolutePath ?? result.path ?? path };
    } catch (error) {
      const code = String(error?.code ?? '');
      if (/not-found|ENOENT/.test(code)) throw bridgeError('not-found', '文件不存在或已被移动');
      if (/permission|denied|forbidden|EACCES/.test(code)) throw bridgeError('forbidden', 'DSH 文件访问权限不足');
      if (/not-text|too-large/.test(code)) throw bridgeError('invalid-argument', /not-text/.test(code) ? '此文件不支持文本预览，请下载后打开' : '文件超过预览或下载上限');
      throw error;
    }
  }

  async openFollow(sessionId, options, onFrame) {
    const query = options || {};
    const emit = typeof onFrame === 'function' ? onFrame : () => {};
    const ac = new AbortController();
    const previous = this.follows.get(sessionId);
    if (previous !== undefined) previous.close();
    const request = {
      address: { kind: 'session', sessionId },
      activate: query.activate !== false,
      assistantStream: query.assistantStream !== false
    };
    if (Number.isInteger(query.maxMessages)) request.maxMessages = Math.min(query.maxMessages, 200);
    if (query.turnWindow !== undefined) request.turnWindow = query.turnWindow;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      ac.abort();
      const current = this.follows.get(sessionId);
      if (current !== undefined && current.close === close) this.follows.delete(sessionId);
    };
    const iterable = this.controller.follow(request, ac.signal);
    const run = (async () => {
      try {
        for await (const frame of iterable) {
          if (closed) break;
          const type = frame && frame.type;
          if (type === 'snapshot') {
            const opening = {
              header: frame.header,
              records: mapRecords(frame.records),
              hasMore: frame.hasMore === true,
              cursor: Number.isInteger(frame.cursor) ? frame.cursor : -1,
              projections: frame.projections || null,
              assistantStream: frame.assistantStream || null
            };
            emit('snapshot', opening);
          } else if (type === 'event') {
            const event = frame.event;
            emit('event', event);
            if (event && event.type === 'turn/start') emit('state', { active: true, running: true, queue: null, pendingInput: [] });
            else if (event && event.type === 'turn/end') emit('state', { active: true, running: false, queue: null, pendingInput: [] });
          } else if (type === 'assistant-stream') {
            emit('assistant', frame.frame);
          } else {
            emit('other', frame);
          }
        }
        if (!closed) { closed = true; emit('closed', { reason: 'upstream-ended' }); }
      } catch (error) {
        if (!closed) { closed = true; emit('error', { code: 'stream-unavailable', message: String((error && error.message) || error) }); }
      } finally {
        const current = this.follows.get(sessionId);
        if (current !== undefined && current.close === close) this.follows.delete(sessionId);
      }
    })();
    this.follows.set(sessionId, { close, done: run });
    return { subscription: { close }, opening: null };
  }

  async prompt(sessionId, payload) {
    const input = payload || {};
    const content = Array.isArray(input.content) ? input.content : [];
    const requestId = typeof input.requestId === 'string' && input.requestId.length > 0
      ? input.requestId
      : 'req-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    const request = {
      requestId,
      sessionId,
      mode: input.mode === 'steer' ? 'steer' : 'queue',
      content
    };
    if (typeof input.clientTimeZone === 'string') request.clientTimeZone = input.clientTimeZone;
    const result = await this.controller.prompt(request, freshSignal());
    return result || { accepted: true };
  }

  async cancel(sessionId) {
    const result = await this.controller.cancel({ sessionId });
    return result || { accepted: true };
  }

  async rename(sessionId, title) {
    if (typeof title !== 'string' || title.trim().length === 0) throw bridgeError('invalid-argument', 'title is required');
    const result = await this.controller.rename({ sessionId, title: title.trim() });
    return { title: (result && result.title) || title.trim(), seq: Number.isInteger(result && result.seq) ? result.seq : -1 };
  }

  async selectModel(sessionId, selection) {
    const input = selection || {};
    const request = { sessionId, provider: input.provider, model: input.model };
    if (typeof input.reasoningEffort === 'string') request.reasoningEffort = input.reasoningEffort;
    const result = await this.controller.selectModel(request);
    return result || { selected: request };
  }

  async modelCatalog() {
    return this.controller.modelCatalog();
  }

  async createSession(options) {
    const input = options || {};
    const request = {};
    if (input.workspaceId !== undefined && input.cwd !== undefined) {
      throw bridgeError('invalid-argument', 'Specify workspaceId or cwd, not both');
    }
    if (typeof input.workspaceId === 'string' && input.workspaceId.length > 0) {
      request.workspaceId = input.workspaceId;
    } else if (typeof input.cwd === 'string' && input.cwd.length > 0) {
      // Older mobile apps send cwd. A directory alone does not attach a DSH
      // session to a Workspace; resolve its registered identity first.
      const registry = this.ctx.get('workspaceRegistry');
      const workspace = registry && typeof registry.resolveByPath === 'function'
        ? await registry.resolveByPath(input.cwd) : undefined;
      if (workspace) request.workspaceId = workspace.id;
      else request.cwd = input.cwd;
    }
    if (typeof input.agentPreset === 'string' && input.agentPreset.length > 0) request.agentPreset = input.agentPreset;
    return this.controller.create(request);
  }

  async forkSession(sessionId, options) {
    const input = options || {};
    const request = { sessionId };
    if (Number.isInteger(input.atSeq)) request.atSeq = input.atSeq;
    return this.controller.fork(request);
  }

  async messageFeedback(sessionId, body) {
    const feedback = this.ctx.get('messageFeedback');
    if (!feedback) throw bridgeError('feature-unavailable', '当前 DSH 未启用消息反馈服务。');
    const result = body === undefined ? await feedback.list({ sessionId }) : body.rating === null
      ? await feedback.delete({ sessionId, messageId: body.messageId, ifVersion: body.ifVersion })
      : await feedback.put({ sessionId, messageId: body.messageId, rating: body.rating, ifVersion: body.ifVersion });
    if (!result?.ok) throw bridgeError(result?.error?.code === 'version-conflict' ? 'session-unavailable' : 'invalid-argument', '消息反馈未保存：' + (result?.error?.code ?? 'unknown'), result?.error);
    return result.value;
  }

  listApprovals() {
    const result = [];
    for (const entry of this.pendingApprovals.values()) result.push({ ...entry.public });
    return result;
  }

  answerApproval(approvalId, decision) {
    const entry = this.pendingApprovals.get(approvalId);
    if (entry === undefined) throw bridgeError('approval-gone', 'approval is no longer pending');
    this.pendingApprovals.delete(approvalId);
    if (entry.callId !== null) this.pendingByCallId.delete(entry.callId);
    const outcome = decision === 'allow' ? 'allowed-once' : 'rejected';
    entry.resolve(outcome);
    try { this.handlers.onApprovalResolved && this.handlers.onApprovalResolved({ id: approvalId, outcome }); } catch (error) { /* ignore */ }
    return { resolved: true, outcome };
  }

  answerApprovalRequest(request, next) {
    if (typeof next !== 'function') return Promise.resolve('unavailable');
    if (!this.hasMobileClients()) return next();
    const callId = typeof (request && request.callId) === 'string' && request.callId.length > 0 ? request.callId : null;
    const sessionId = safe(() => (request.agent && request.agent.session && request.agent.session.id) || (request.agent && request.agent.id) || '', '');
    const publicRequest = {
      id: 'apr_' + Date.now().toString(36) + '_' + Math.random().toString(16).slice(2, 8),
      sessionId: String(sessionId),
      tool: typeof (request && request.tool) === 'string' ? request.tool : 'unknown',
      callId,
      reason: typeof (request && request.reason) === 'string' ? request.reason : 'approval required',
      displayReason: typeof (request && request.displayReason) === 'string' ? request.displayReason : null,
      requestedAt: Date.now(),
      expiresAt: null
    };
    return new Promise((resolve) => {
      let settled = false;
      let timer;
      const finish = (outcome, delegate) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pendingApprovals.delete(publicRequest.id);
        if (callId !== null) this.pendingByCallId.delete(callId);
        resolve(delegate ? next() : outcome);
      };
      timer = setTimeout(() => {
        this.log('warn', 'approval timed out on mobile; delegating to desktop answerers');
        finish(undefined, true);
      }, this.approvalTimeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      this.pendingApprovals.set(publicRequest.id, {
        public: publicRequest,
        callId,
        resolve: (outcome) => finish(outcome, false)
      });
      if (callId !== null) this.pendingByCallId.set(callId, this.pendingApprovals.get(publicRequest.id));
      try { this.handlers.onApprovalRequest && this.handlers.onApprovalRequest(publicRequest); } catch (error) { this.log('warn', 'onApprovalRequest failed', error); }
      const requestSignal = request && request.signal;
      if (requestSignal !== undefined && requestSignal !== null) {
        const onAbort = () => finish('cancelled', false);
        if (requestSignal.aborted) onAbort();
        else requestSignal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  async dispose() {
    for (const follow of this.follows.values()) safe(() => follow.close(), undefined);
    this.follows.clear();
    for (const entry of this.pendingApprovals.values()) safe(() => entry.resolve('cancelled'), undefined);
    this.pendingApprovals.clear();
    for (const dispose of this.disposers.splice(0)) safe(() => dispose(), undefined);
    this.initialized = false;
  }
}

export default DshBridge;
