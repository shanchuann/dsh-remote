#!/usr/bin/env node
/**
 * Mock DSH Remote host implementing protocol v1 (docs/protocol.md).
 *
 * Purpose: black-box self-test of tools/verify/protocol-client.mjs and the
 * baseline oracle for negative/contract tests, before a real DSH host exists.
 * It is intentionally a *reference implementation of the contract*, not of the
 * plugin: behavior follows docs/protocol.md only.
 *
 * CLI:
 *   node tools/verify/mock-server.mjs --port 8799 --code 123456
 *   -> prints one line: MOCK_READY {"baseUrl":"http://127.0.0.1:8799","code":"123456"}
 *
 * Programmatic:
 *   const { startMockServer } = await import('./mock-server.mjs');
 *   const mock = await startMockServer({ port: 0, code: '123456' });
 *   await mock.close();
 */

import { createServer } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROTO_VERSION = 1;
const DSH_VERSION = '0.2.2-rc.1';
const PLUGIN_VERSION = '0.1.0';
const BODY_LIMIT_BYTES = 24 * 1024 * 1024; // images: 4 x 5MB + json envelope

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function sendJson(res, status, body, extraHeaders = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    ...extraHeaders,
  });
  res.end(text);
}

function sendError(res, err) {
  const e = err instanceof HttpError ? err : new HttpError(500, 'internal', String(err && err.message ? err.message : err));
  sendJson(res, e.status, { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } });
}

function readBody(req, limit = BODY_LIMIT_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        // Drain the rest without buffering so the client still gets a JSON error.
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) reject(new HttpError(413, 'invalid-argument', 'request body too large', { limit }));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

async function readJson(req, limit) {
  const text = await readBody(req, limit);
  if (!text.trim()) return {};
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (e) { throw new HttpError(400, 'invalid-argument', 'request body is not valid JSON: ' + String(e.message)); }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'invalid-argument', 'request body must be a JSON object');
  }
  return parsed;
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpError(400, 'invalid-argument', 'field "' + field + '" must be a non-empty string');
  }
  return value;
}

// ---------------------------------------------------------------------------
// Mock host
// ---------------------------------------------------------------------------

export async function startMockServer(options = {}) {
  const opts = {
    port: options.port ?? 0,
    host: options.host ?? '127.0.0.1',
    code: options.code ?? '123456',
    hostName: options.hostName ?? 'VERIFIER-MOCK',
    assistantDelayMs: options.assistantDelayMs ?? 40,
    heartbeatMs: options.heartbeatMs ?? 15000,
    rateLimit: options.rateLimit ?? false,
    maxBodyBytes: options.maxBodyBytes ?? BODY_LIMIT_BYTES,
    quiet: options.quiet ?? true,
    // Simulated assistant reply. "auto" completes quickly; "hang" keeps running
    // until cancel, which lets tests assert cancel semantics.
    replyMode: options.replyMode ?? 'auto',
  };

  const log = (...a) => { if (!opts.quiet) console.error('[mock]', ...a); };

  const state = {
    hostId: randomUUID(),
    hostName: opts.hostName,
    platform: process.platform === 'win32' ? 'win32' : process.platform,
    dshVersion: DSH_VERSION,
    pluginVersion: PLUGIN_VERSION,
    pairingCode: opts.code,
    pairingExpiresAt: now() + 10 * 60 * 1000,
    pairFailures: 0,
    pairLockedUntil: 0,
    devices: new Map(), // token -> device
    sessions: new Map(), // sessionId -> session
    globalSeq: 100,
    sseConnections: new Map(), // deviceId -> connection
    subscriptions: new Map(), // subscriptionId -> {id, sessionId, deviceId}
    approvals: new Map(),
    rateBuckets: new Map(),
  };

  // Seed one pre-existing session so 'sessions list' is non-empty.
  createSessionObject({ title: 'Welcome session', seed: true });

  function createSessionObject({ title, cwd, agentPreset = 'standard', seed = false } = {}) {
    const sessionId = 'session-' + randomUUID();
    const t = now();
    const session = {
      sessionId,
      title: title ?? 'New session',
      createdAt: t,
      updatedAt: t,
      cwd: cwd ?? 'D:\\Code\\dsh-remote',
      running: false,
      active: true,
      blank: true,
      agentAvailable: true,
      model: { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' },
      parentSessionId: null,
      origin: null,
      agentPreset,
      header: { id: sessionId, createdAt: t, cwd: cwd ?? 'D:\\Code\\dsh-remote', agentPreset },
      projections: {
        asOfSeq: 0,
        values: {
          title,
          modelSelection: { next: { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' } },
        },
      },
      records: [],
      queue: [],
      pendingInput: [],
      seq: 0,
      requestIds: new Set(),
      cancelFlag: false,
      turn: 0,
    };
    if (seed) {
      pushEvent(session, { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'hello from seed history' }], source: 'user' } });
      pushEvent(session, { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'Seed reply from mock host.' }] } } });
      pushEvent(session, { type: 'session/title', data: { title } });
      session.blank = false;
    }
    state.sessions.set(sessionId, session);
    return session;
  }

  function rowOf(session, device) {
    const last = [...session.records].reverse().find((r) => r.type === 'user/message' || r.type === 'assistant/message');
    let lastMessage = null;
    if (last) {
      const role = last.type === 'user/message' ? 'user' : 'assistant';
      const text = eventText(last);
      lastMessage = { role, text: text.slice(0, 200), time: last.time };
    }
    return {
      sessionId: session.sessionId,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      cwd: session.cwd,
      running: session.running,
      active: session.active,
      blank: session.blank,
      agentAvailable: session.agentAvailable,
      model: session.model,
      lastMessage,
      parentSessionId: session.parentSessionId,
      origin: session.origin,
    };
  }

  function eventText(record) {
    const data = record.data || {};
    const parts = [];
    const walk = (content) => {
      if (!Array.isArray(content)) return;
      for (const c of content) {
        if (c && c.type === 'text' && typeof c.text === 'string') parts.push(c.text);
        else if (c && c.type === 'reasoning' && typeof c.text === 'string') parts.push(c.text);
        else if (c && typeof c.text === 'string') parts.push(c.text);
      }
    };
    if (record.type === 'user/message') walk(data.content);
    else if (record.type === 'assistant/message') walk(data.message && data.message.content);
    return parts.join('\n');
  }

  function nextSeq() { return ++state.globalSeq; }

  function pushEvent(session, partial) {
    const event = { seq: nextSeq(), time: now(), ...partial };
    const record = { type: 'event', event };
    session.records.push(record);
    session.updatedAt = event.time;
    session.seq = event.seq;
    if (partial.type === 'user/message' || partial.type === 'assistant/message') session.blank = false;
    if (partial.type === 'session/title' && partial.data && typeof partial.data.title === 'string') {
      session.title = partial.data.title;
      if (session.projections && session.projections.values) session.projections.values.title = session.title;
    }
    if (session.projections) session.projections.asOfSeq = event.seq;
    broadcastSessionEvent(session, event);
    return event;
  }

  function sseWrite(conn, eventName, data, id) {
    if (!conn || conn.closed) return false;
    try {
      let frame = '';
      if (id !== undefined) frame += 'id: ' + id + '\n';
      frame += 'event: ' + eventName + '\n';
      frame += 'data: ' + JSON.stringify(data) + '\n\n';
      conn.res.write(frame);
      return true;
    } catch (e) {
      log('sse write failed', e.message);
      return false;
    }
  }

  function connectionsForSession(sessionId) {
    const out = [];
    for (const sub of state.subscriptions.values()) {
      if (sub.sessionId !== sessionId) continue;
      const conn = state.sseConnections.get(sub.deviceId);
      if (conn && !conn.closed) out.push({ conn, sub });
    }
    return out;
  }

  function broadcast(eventName, data, sessionId) {
    const out = [];
    if (sessionId) {
      for (const { conn, sub } of connectionsForSession(sessionId)) out.push({ conn, data: { subscriptionId: sub.id, sessionId, ...data } });
    } else {
      for (const conn of state.sseConnections.values()) out.push({ conn, data });
    }
    for (const item of out) sseWrite(item.conn, eventName, item.data, nextSeq());
    return out.length;
  }

  function broadcastSessionEvent(session, event) {
    broadcast('session.event', { event }, session.sessionId);
  }

  function broadcastState(session) {
    const stateData = {
      active: session.active,
      running: session.running,
      queue: session.queue.slice(),
      pendingInput: session.pendingInput.slice(),
    };
    broadcast('session.state', { state: stateData }, session.sessionId);
    broadcast('session.status', { sessionId: session.sessionId, running: session.running, active: session.active }, null);
  }

  function snapshotOf(session) {
    return {
      header: session.header,
      records: session.records.slice(-60),
      hasMore: session.records.length > 60,
      cursor: session.records.length > 60 ? session.records[session.records.length - 60].event.seq : null,
      projections: session.projections,
    };
  }

  function deliverSnapshot(sub) {
    const session = state.sessions.get(sub.sessionId);
    const conn = state.sseConnections.get(sub.deviceId);
    if (!session || !conn) return;
    sseWrite(conn, 'session.snapshot', { subscriptionId: sub.id, sessionId: session.sessionId, ...snapshotOf(session) }, nextSeq());
    sseWrite(conn, 'session.state', { subscriptionId: sub.id, sessionId: session.sessionId, state: { active: session.active, running: session.running, queue: session.queue.slice(), pendingInput: session.pendingInput.slice() } }, nextSeq());
  }

  async function runTurn(session, text, requestId) {
    const turn = ++session.turn;
    session.running = true;
    session.cancelFlag = false;
    broadcastState(session);
    pushEvent(session, { type: 'turn/start', data: { turn } });
    await sleep(opts.assistantDelayMs);
    if (session.cancelFlag) { finishTurn(session, turn, true); return; }
    const userEvent = pushEvent(session, { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user', rpcId: requestId, clientTimeZone: 'Asia/Shanghai' } } });
    log('user/message seq', userEvent.seq);
    broadcast('session.state', { state: { active: session.active, running: true, queue: [], pendingInput: [] } }, session.sessionId);

    const attempt = session.sessionId + ':' + turn;
    let revision = 0;
    broadcast('session.assistant', { frame: { type: 'start', attemptId: attempt, revision: revision++, turn, step: 1, startedAfterSeq: userEvent.seq } }, session.sessionId);
    broadcast('session.assistant', { frame: { type: 'chunk', attemptId: attempt, revision: revision++, index: 0, time: now(), chunk: { type: 'block-start', index: 0, blockType: 'text' } } }, session.sessionId);
    const reply = (opts.replyMode === 'hang')
      ? 'This mock reply streams slowly until the client cancels; cancel should stop it.'
      : 'Mock reply #' + turn + ' to: ' + text;
    const chunks = splitChunks(reply, 12);
    for (const chunk of chunks) {
      if (session.cancelFlag) { finishTurn(session, turn, true); return; }
      await sleep(opts.replyMode === 'hang' ? 400 : opts.assistantDelayMs);
      broadcast('session.assistant', { frame: { type: 'chunk', attemptId: attempt, revision: revision++, index: 1, time: now(), chunk: { type: 'text-delta', index: 0, text: chunk } } }, session.sessionId);
    }
    if (session.cancelFlag) { finishTurn(session, turn, true); return; }
    broadcast('session.assistant', { frame: { type: 'chunk', attemptId: attempt, revision: revision++, index: 2, time: now(), chunk: { type: 'block-end', index: 0, block: { type: 'text', text: reply } } } }, session.sessionId);
    broadcast('session.assistant', { frame: { type: 'end', attemptId: attempt } }, session.sessionId);
    pushEvent(session, { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: reply }] }, attempt } });
    finishTurn(session, turn, false);
  }

  function finishTurn(session, turn, cancelled) {
    session.running = false;
    session.queue = [];
    pushEvent(session, { type: 'turn/end', data: { turn, cancelled: !!cancelled } });
    broadcastState(session);
  }

  function splitChunks(text, n) {
    const size = Math.max(1, Math.ceil(text.length / n));
    const out = [];
    for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
    return out;
  }

  // --- HTTP -----------------------------------------------------------------

  function authenticate(req, url) {
    let token = '';
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) token = auth.slice(7).trim();
    if (!token && url && url.searchParams.get('token')) token = url.searchParams.get('token');
    if (!token) throw new HttpError(401, 'unauthorized', 'missing bearer token');
    const device = state.devices.get(token);
    if (!device) throw new HttpError(401, 'unauthorized', 'invalid or revoked device token');
    device.lastSeenAt = now();
    return device;
  }

  function checkRate(device) {
    if (!opts.rateLimit) return;
    const bucket = state.rateBuckets.get(device.deviceId) || { tokens: 60, last: now() };
    const elapsed = (now() - bucket.last) / 1000;
    bucket.tokens = Math.min(60, bucket.tokens + elapsed * 30);
    bucket.last = now();
    if (bucket.tokens < 1) {
      state.rateBuckets.set(device.deviceId, bucket);
      throw new HttpError(429, 'rate-limited', 'too many requests');
    }
    bucket.tokens -= 1;
    state.rateBuckets.set(device.deviceId, bucket);
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    const path = url.pathname;
    const method = req.method || 'GET';
    log(method, path);

    try {
      // -------- unauthenticated --------
      if (path === '/v1/health' && method === 'GET') {
        return sendJson(res, 200, {
          ok: true, name: 'dsh-remote', protocol: PROTO_VERSION,
          pluginVersion: PLUGIN_VERSION, dshVersion: DSH_VERSION,
          hostId: state.hostId, pairingRequired: state.devices.size === 0, time: now(),
        });
      }

      if (path === '/v1/pair' && method === 'POST') {
        if (state.pairLockedUntil > now()) {
          throw new HttpError(429, 'pairing-locked', 'too many failed pairing attempts; try later');
        }
        const body = await readJson(req, opts.maxBodyBytes);
        const code = String(body.code ?? '');
        const valid = code === state.pairingCode && state.pairingExpiresAt > now();
        if (!valid) {
          state.pairFailures += 1;
          if (state.pairFailures >= 5) {
            state.pairLockedUntil = now() + 5 * 60 * 1000;
            state.pairFailures = 0;
            throw new HttpError(429, 'pairing-locked', 'too many failed pairing attempts; locked for 5 minutes');
          }
          throw new HttpError(401, 'pairing-invalid', 'pairing code is invalid or expired');
        }
        state.pairFailures = 0;
        const token = randomBytes(32).toString('hex');
        const deviceId = (typeof body.deviceId === 'string' && body.deviceId) || randomUUID();
        const device = {
          deviceId, token, name: typeof body.deviceName === 'string' ? body.deviceName : 'Unknown device',
          platform: typeof body.platform === 'string' ? body.platform : 'android',
          appVersion: typeof body.appVersion === 'string' ? body.appVersion : null,
          createdAt: now(), lastSeenAt: now(),
        };
        state.devices.set(token, device);
        // one-time code: rotate after success
        state.pairingCode = String(Math.floor(100000 + Math.random() * 900000));
        state.pairingExpiresAt = now() + 10 * 60 * 1000;
        return sendJson(res, 200, {
          protocol: PROTO_VERSION, token, deviceId,
          host: { id: state.hostId, name: state.hostName, platform: state.platform, dshVersion: DSH_VERSION, pluginVersion: PLUGIN_VERSION },
        });
      }

      if (path === '/pair' && method === 'GET') {
        const remote = req.socket.remoteAddress || '';
        const isLoopback = remote.includes('127.0.0.1') || remote === '::1' || remote === '::ffff:127.0.0.1';
        if (!isLoopback) throw new HttpError(403, 'forbidden', 'pair page is loopback-only');
        const html = '<!doctype html><html><head><meta charset="utf-8"><title>DSH Remote pairing</title></head>'
          + '<body><h1>DSH Remote</h1><p>Pairing code: <b>' + state.pairingCode + '</b></p>'
          + '<p>Devices: ' + state.devices.size + '</p></body></html>';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }

      // -------- authenticated --------
      const device = authenticate(req, url);
      checkRate(device);

      if (path === '/v1/host' && method === 'GET') {
        return sendJson(res, 200, {
          hostId: state.hostId, name: state.hostName, platform: state.platform,
          dshVersion: DSH_VERSION, pluginVersion: PLUGIN_VERSION, protocol: PROTO_VERSION,
          capabilities: { assistantStream: true, approvals: true, models: true, problemQuestions: false, attachments: false, images: true },
          defaultCwd: 'D:\\Code\\dsh-remote',
          devices: [...state.devices.values()].map((d) => ({
            deviceId: d.deviceId, name: d.name, platform: d.platform, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt,
            current: d.deviceId === device.deviceId,
          })),
        });
      }

      if (path === '/v1/sessions' && method === 'GET') {
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 30)));
        const all = [...state.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
        const cursorRaw = url.searchParams.get('cursor');
        const offset = cursorRaw ? Number(Buffer.from(cursorRaw, 'base64url').toString('utf8')) || 0 : 0;
        const slice = all.slice(offset, offset + limit);
        const nextOffset = offset + slice.length;
        return sendJson(res, 200, {
          items: slice.map((s) => rowOf(s, device)),
          nextCursor: nextOffset < all.length ? Buffer.from(String(nextOffset)).toString('base64url') : null,
        });
      }

      if (path === '/v1/sessions' && method === 'POST') {
        const body = await readJson(req, opts.maxBodyBytes);
        if (body.cwd !== undefined && typeof body.cwd !== 'string') throw new HttpError(400, 'invalid-argument', 'cwd must be a string');
        if (body.agentPreset !== undefined && typeof body.agentPreset !== 'string') throw new HttpError(400, 'invalid-argument', 'agentPreset must be a string');
        const session = createSessionObject({ agentPreset: body.agentPreset ?? 'standard', cwd: body.cwd });
        broadcast('session.added', { row: rowOf(session, device) }, null);
        return sendJson(res, 200, { sessionId: session.sessionId, agentPreset: session.agentPreset });
      }

      if (path === '/v1/models' && method === 'GET') {
        return sendJson(res, 200, {
          default: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
          routableProviders: ['opencode-go'],
          groups: [{ id: 'opencode-go', name: 'OpenCode Go', models: [
            { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
            { id: 'deepseek-v4.1-pro', name: 'DeepSeek V4.1 Pro' },
          ] }],
          failures: [],
        });
      }

      if (path === '/v1/approvals' && method === 'GET') {
        return sendJson(res, 200, { items: [...state.approvals.values()] });
      }

      let m = /^\/v1\/approvals\/([^/]+)$/.exec(path);
      if (m && method === 'POST') {
        const body = await readJson(req, opts.maxBodyBytes);
        const approval = state.approvals.get(decodeURIComponent(m[1]));
        if (!approval) throw new HttpError(410, 'approval-gone', 'approval not found, expired or already answered');
        if (body.decision !== 'allow' && body.decision !== 'reject') {
          throw new HttpError(400, 'invalid-argument', 'decision must be "allow" or "reject"');
        }
        state.approvals.delete(approval.id);
        const outcome = body.decision === 'allow' ? 'allowed' : 'rejected';
        broadcast('approval.resolved', { id: approval.id, outcome }, null);
        return sendJson(res, 200, { resolved: true, outcome });
      }

      if (path === '/v1/devices' && method === 'GET') {
        return sendJson(res, 200, {
          items: [...state.devices.values()].map((d) => ({
            deviceId: d.deviceId, name: d.name, platform: d.platform, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt,
            current: d.deviceId === device.deviceId,
          })),
        });
      }

      m = /^\/v1\/devices\/([^/]+)$/.exec(path);
      if (m && method === 'DELETE') {
        const deviceId = decodeURIComponent(m[1]);
        let found = false;
        for (const [token, d] of state.devices) {
          if (d.deviceId === deviceId) { state.devices.delete(token); found = true; break; }
        }
        if (!found) throw new HttpError(404, 'invalid-argument', 'device not found');
        // close SSE for removed device
        for (const [devId, conn] of state.sseConnections) {
          if (devId === deviceId) { sseWrite(conn, 'error', { code: 'unauthorized', message: 'device removed' }, nextSeq()); try { conn.res.end(); } catch { /* ignore */ } state.sseConnections.delete(devId); }
        }
        return sendJson(res, 200, { removed: true });
      }

      m = /^\/v1\/sessions\/([^/]+)$/.exec(path);
      if (m && method === 'GET') {
        const session = state.sessions.get(decodeURIComponent(m[1]));
        if (!session) throw new HttpError(404, 'session-not-found', 'session ' + m[1] + ' not found');
        return sendJson(res, 200, {
          sessionId: session.sessionId,
          title: session.title,
          header: session.header,
          state: { active: session.active, running: session.running, queue: session.queue.slice(), pendingInput: session.pendingInput.slice() },
          projections: session.projections,
        });
      }

      m = /^\/v1\/sessions\/([^/]+)\/history$/.exec(path);
      if (m && method === 'GET') {
        const session = state.sessions.get(decodeURIComponent(m[1]));
        if (!session) throw new HttpError(404, 'session-not-found', 'session not found');
        const beforeSeq = url.searchParams.get('beforeSeq') ? Number(url.searchParams.get('beforeSeq')) : Infinity;
        const maxMessages = Math.max(1, Math.min(500, Number(url.searchParams.get('maxMessages') || 100)));
        const eligible = session.records.filter((r) => r.event.seq <= beforeSeq);
        const slice = eligible.slice(-maxMessages);
        return sendJson(res, 200, {
          records: slice.map((r) => ({ type: 'event', event: r.event })),
          cursor: slice.length > 0 ? slice[0].event.seq : null,
          hasMore: eligible.length > slice.length,
        });
      }

      m = /^\/v1\/sessions\/([^/]+)\/open$/.exec(path);
      if (m && method === 'POST') {
        const session = state.sessions.get(decodeURIComponent(m[1]));
        if (!session) throw new HttpError(404, 'session-not-found', 'session not found');
        const body = await readJson(req, opts.maxBodyBytes);
        if (body.maxMessages !== undefined && typeof body.maxMessages !== 'number') throw new HttpError(400, 'invalid-argument', 'maxMessages must be a number');
        // replace previous subscription on same device+session
        for (const [subId, sub] of state.subscriptions) {
          if (sub.deviceId === device.deviceId && sub.sessionId === session.sessionId) state.subscriptions.delete(subId);
        }
        const sub = { id: 'sub_' + randomUUID(), sessionId: session.sessionId, deviceId: device.deviceId };
        state.subscriptions.set(sub.id, sub);
        deliverSnapshot(sub);
        return sendJson(res, 200, { subscriptionId: sub.id, sessionId: session.sessionId });
      }

      m = /^\/v1\/sessions\/([^/]+)\/close$/.exec(path);
      if (m && method === 'POST') {
        const sessionId = decodeURIComponent(m[1]);
        for (const [subId, sub] of state.subscriptions) {
          if (sub.sessionId === sessionId && sub.deviceId === device.deviceId) {
            state.subscriptions.delete(subId);
            broadcast('subscription.closed', { subscriptionId: subId, sessionId, reason: 'closed' }, null);
          }
        }
        return sendJson(res, 200, { closed: true });
      }

      m = /^\/v1\/sessions\/([^/]+)\/prompt$/.exec(path);
      if (m && method === 'POST') {
        const session = state.sessions.get(decodeURIComponent(m[1]));
        if (!session) throw new HttpError(404, 'session-not-found', 'session not found');
        if (!session.agentAvailable) throw new HttpError(409, 'session-unavailable', 'session has no agent');
        const body = await readJson(req, opts.maxBodyBytes);
        const requestId = requireString(body.requestId, 'requestId');
        if ('mode' in body && body.mode !== 'queue' && body.mode !== 'steer') throw new HttpError(400, 'invalid-argument', 'mode must be queue or steer');
        if (!Array.isArray(body.content) || body.content.length === 0) throw new HttpError(400, 'invalid-argument', 'content must be a non-empty array');
        for (const part of body.content) {
          if (!part || typeof part !== 'object' || typeof part.type !== 'string') throw new HttpError(400, 'invalid-argument', 'content parts must be objects with a type');
          if (part.type === 'text' && typeof part.text !== 'string') throw new HttpError(400, 'invalid-argument', 'text parts need string text');
          if (part.type === 'image') {
            if (typeof part.data !== 'string' || typeof part.mediaType !== 'string') throw new HttpError(400, 'invalid-argument', 'image parts need data and mediaType');
            if (Buffer.from(part.data, 'base64').length > 5 * 1024 * 1024) throw new HttpError(400, 'invalid-argument', 'image exceeds 5MB');
          }
        }
        if (session.requestIds.has(requestId)) {
          // idempotent: same accepted, no re-enqueue
          return sendJson(res, 200, { accepted: true, requestId });
        }
        session.requestIds.add(requestId);
        session.queue.push(requestId);
        const text = body.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
        setImmediate(() => { runTurn(session, text, requestId).catch((e) => log('turn error', e)); });
        return sendJson(res, 200, { accepted: true, requestId });
      }

      m = /^\/v1\/sessions\/([^/]+)\/cancel$/.exec(path);
      if (m && method === 'POST') {
        const session = state.sessions.get(decodeURIComponent(m[1]));
        if (!session) throw new HttpError(404, 'session-not-found', 'session not found');
        session.cancelFlag = true;
        session.queue = [];
        if (session.running) {
          session.running = false;
          broadcastState(session);
        }
        return sendJson(res, 200, { accepted: true });
      }

      m = /^\/v1\/sessions\/([^/]+)\/rename$/.exec(path);
      if (m && method === 'POST') {
        const session = state.sessions.get(decodeURIComponent(m[1]));
        if (!session) throw new HttpError(404, 'session-not-found', 'session not found');
        const body = await readJson(req, opts.maxBodyBytes);
        const title = requireString(body.title, 'title');
        if (title.length > 200) throw new HttpError(400, 'invalid-argument', 'title too long');
        pushEvent(session, { type: 'session/title', data: { title } });
        return sendJson(res, 200, { title, seq: session.seq });
      }

      m = /^\/v1\/sessions\/([^/]+)\/model$/.exec(path);
      if (m && method === 'POST') {
        const session = state.sessions.get(decodeURIComponent(m[1]));
        if (!session) throw new HttpError(404, 'session-not-found', 'session not found');
        const body = await readJson(req, opts.maxBodyBytes);
        const provider = requireString(body.provider, 'provider');
        const model = requireString(body.model, 'model');
        const selection = { provider, model, ...(body.reasoningEffort ? { reasoningEffort: String(body.reasoningEffort) } : {}) };
        session.model = selection;
        session.projections = {
          asOfSeq: session.seq,
          values: { title: session.title, modelSelection: { next: selection } },
        };
        pushEvent(session, { type: 'model/selection', data: selection });
        return sendJson(res, 200, { selected: selection });
      }

      // ---------- SSE ----------
      if (path === '/v1/events' && method === 'GET') {
        const ctype = req.headers.accept || '';
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.flushHeaders?.();
        const conn = { deviceId: device.deviceId, res, closed: false, heartbeat: null };
        // enforce 1 SSE per device: close old
        const old = state.sseConnections.get(device.deviceId);
        if (old && !old.closed) {
          sseWrite(old, 'connection.replaced', { reason: 'new connection from same device' }, nextSeq());
          old.closed = true;
          try { old.res.end(); } catch { /* ignore */ }
          if (old.heartbeat) clearInterval(old.heartbeat);
        }
        state.sseConnections.set(device.deviceId, conn);
        sseWrite(conn, 'hello', { protocol: PROTO_VERSION, serverTime: now(), hostId: state.hostId, subscriptions: [...state.subscriptions.values()].filter((s) => s.deviceId === device.deviceId).map((s) => ({ subscriptionId: s.id, sessionId: s.sessionId })) }, nextSeq());
        if (opts.heartbeatMs > 0) {
          conn.heartbeat = setInterval(() => {
            if (conn.closed) return;
            try { conn.res.write('event: ping\ndata: ' + JSON.stringify({ t: now() }) + '\n\n'); } catch { /* ignore */ }
          }, opts.heartbeatMs);
          conn.heartbeat.unref?.();
        }
        const cleanup = () => {
          conn.closed = true;
          if (conn.heartbeat) clearInterval(conn.heartbeat);
          if (state.sseConnections.get(device.deviceId) === conn) state.sseConnections.delete(device.deviceId);
          for (const [subId, sub] of state.subscriptions) if (sub.deviceId === device.deviceId) state.subscriptions.delete(subId);
        };
        req.on('close', cleanup);
        res.on('close', cleanup);
        res.on('error', cleanup);
        return; // keep open
      }

      throw new HttpError(404, 'invalid-argument', 'unknown route ' + method + ' ' + path);
    } catch (err) {
      if (err instanceof HttpError) {
        if (!res.headersSent) sendError(res, err);
        else { try { res.end(); } catch { /* ignore */ } }
      } else {
        log('internal error', err && err.stack ? err.stack : err);
        if (!res.headersSent) sendError(res, err);
        else { try { res.end(); } catch { /* ignore */ } }
      }
    }
  });

  await new Promise((resolveP, rejectP) => {
    server.once('error', rejectP);
    server.listen(opts.port, opts.host, () => { server.off('error', rejectP); resolveP(); });
  });
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : opts.port;
  const baseUrl = 'http://' + opts.host + ':' + port;

  return {
    server,
    baseUrl,
    port,
    code: opts.code,
    hostId: state.hostId,
    state,
    pairingCode: () => state.pairingCode,
    createSession: (o) => createSessionObject(o),
    async close() {
      for (const conn of state.sseConnections.values()) {
        conn.closed = true;
        if (conn.heartbeat) clearInterval(conn.heartbeat);
        try { conn.res.end(); } catch { /* ignore */ }
      }
      state.sseConnections.clear();
      await new Promise((r) => server.close(r));
    },
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && resolvePath(process.argv[1]) === resolvePath(fileURLToPath(import.meta.url));
if (isMain) {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '0' },
      host: { type: 'string', default: '127.0.0.1' },
      code: { type: 'string', default: '123456' },
      name: { type: 'string', default: 'VERIFIER-MOCK' },
      'assistant-delay': { type: 'string', default: '40' },
      'heartbeat-ms': { type: 'string', default: '15000' },
      'reply-mode': { type: 'string', default: 'auto' },
      'rate-limit': { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  const mock = await startMockServer({
    port: Number(values.port),
    host: values.host,
    code: values.code,
    hostName: values.name,
    assistantDelayMs: Number(values['assistant-delay']),
    heartbeatMs: Number(values['heartbeat-ms']),
    replyMode: values['reply-mode'],
    rateLimit: values['rate-limit'],
    quiet: values.quiet,
  });
  console.log('MOCK_READY ' + JSON.stringify({ baseUrl: mock.baseUrl, code: mock.code, hostId: mock.hostId }));
  const shutdown = async () => { await mock.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
