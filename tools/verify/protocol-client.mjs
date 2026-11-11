#!/usr/bin/env node
/**
 * DSH Remote protocol v1 — independent black-box client.
 *
 * Implemented ONLY from docs/protocol.md (v1 frozen, 2026-11-11).
 * Deliberately does NOT import or copy plugin/** code: this is the verifier's
 * oracle, so it must be able to catch implementation/protocol drift.
 *
 * Runtime: Node >= 18 (global fetch / WebStreams). No dependencies.
 *
 * Library usage:
 *   import { DshRemoteClient, EventStream } from './protocol-client.mjs';
 *   const c = new DshRemoteClient({ baseUrl: 'http://127.0.0.1:8790' });
 *   await c.pair({ code: '123456', deviceName: 'verifier' });
 *   const sse = c.events(); await sse.connect();
 *   const { items } = await c.sessions();
 *   const sub = await c.open(items[0].sessionId, { maxMessages: 60 });
 *   await c.prompt(id, { requestId: crypto.randomUUID(), content: [{type:'text',text:'hi'}] });
 *   const ev = await sse.waitFor(f => f.event === 'session.assistant');
 *
 * CLI (smoke = pair -> host -> sessions -> open -> prompt -> stream -> cancel -> devices):
 *   node tools/verify/protocol-client.mjs --url http://127.0.0.1:8790 --code 123456
 *   node tools/verify/protocol-client.mjs health --url ...
 *   node tools/verify/protocol-client.mjs prompt --session session-x --text "hello"
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 8790;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ProtocolError extends Error {
  /**
   * @param {string} message
   * @param {{status?:number, code?:string, details?:any, path?:string, method?:string, bodyText?:string}} info
   */
  constructor(message, info = {}) {
    super(message);
    this.name = 'ProtocolError';
    this.status = info.status ?? 0;
    this.code = info.code ?? 'unknown';
    this.details = info.details ?? null;
    this.path = info.path ?? null;
    this.method = info.method ?? null;
    this.bodyText = info.bodyText ?? '';
  }
}

export class TimeoutError extends Error {
  constructor(message) { super(message); this.name = 'TimeoutError'; }
}

// ---------------------------------------------------------------------------
// SSE parser (hand-written, per WHATWG EventSource frame grammar)
// ---------------------------------------------------------------------------

/**
 * Incremental Server-Sent Events parser.
 * Feed it decoded text chunks; it calls onFrame({id, event, data, dataJson, retry}).
 *
 * Grammar implemented from the SSE spec:
 *  - lines end with CRLF, LF or CR; a trailing CR is held until next chunk
 *  - "field: value" (single leading space after colon is stripped)
 *  - data: lines join with "\n"; blank line dispatches
 *  - lines beginning with ":" are comments (ignored)
 *  - id: / event: / retry: fields handled; default event name is "message"
 *  - a frame with no data lines does not dispatch
 */
export function createSseParser(onFrame, onComment) {
  let buffer = '';
  let first = true;
  let lastEventId = '';
  let eventName = '';
  let dataLines = [];
  let retryField = null;
  let swallowLF = false; // true after a lone trailing CR, in case CRLF is split across chunks

  function dispatch() {
    if (dataLines.length > 0) {
      const data = dataLines.join('\n');
      let dataJson;
      let parseError = null;
      try { dataJson = JSON.parse(data); }
      catch (e) { dataJson = undefined; parseError = String(e && e.message ? e.message : e); }
      const frame = { id: lastEventId, event: eventName || 'message', data, dataJson, parseError, retry: retryField, receivedAt: Date.now() };
      try { onFrame(frame); } catch (e) { queueMicrotask(() => { throw e; }); }
    }
    eventName = '';
    dataLines = [];
    retryField = null;
  }

  function processLine(line) {
    if (line === '') { dispatch(); return; }
    if (line.startsWith(':')) { if (onComment) onComment(line); return; }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    switch (field) {
      case 'event': eventName = value; break;
      case 'data': dataLines.push(value); break;
      case 'id': if (!value.includes('\u0000')) lastEventId = value; break;
      case 'retry': if (/^\d+$/.test(value)) retryField = Number(value); break;
      default: break; // unknown fields ignored
    }
  }

  /** Locate next complete line terminator; a trailing lone CR is deferred. */
  function findLineBreak(s) {
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      if (ch === 0x0a) return { index: i, length: 1 };
      if (ch === 0x0d) {
        // A trailing CR is optimistically treated as a line end; if the next
        // chunk starts with LF it is swallowed as the second half of CRLF.
        if (i === s.length - 1) return { index: i, length: 1, loneCR: true };
        return { index: i, length: s.charCodeAt(i + 1) === 0x0a ? 2 : 1 };
      }
    }
    return null;
  }

  return {
    push(chunk) {
      if (typeof chunk !== 'string') throw new TypeError('sse.push expects string');
      buffer += chunk;
      if (swallowLF) {
        if (buffer.startsWith('\n')) buffer = buffer.slice(1);
        swallowLF = false;
      }
      if (first && buffer.length > 0) {
        first = false;
        if (buffer.charCodeAt(0) === 0xfeff) buffer = buffer.slice(1); // strip BOM
      }
      for (;;) {
        const br = findLineBreak(buffer);
        if (!br) break;
        const line = buffer.slice(0, br.index);
        buffer = buffer.slice(br.index + br.length);
        if (br.loneCR) swallowLF = true;
        processLine(line);
      }
    },
    /** Flush at EOF: process a final unterminated line and dispatch pending data. */
    end() {
      if (buffer.length > 0) {
        let line = buffer;
        buffer = '';
        if (line.endsWith('\r')) line = line.slice(0, -1);
        processLine(line);
      }
      dispatch();
    },
    get lastEventId() { return lastEventId; },
  };
}

// ---------------------------------------------------------------------------
// EventStream — one /v1/events SSE connection
// ---------------------------------------------------------------------------

export class EventStream {
  /**
   * @param {DshRemoteClient} client
   * @param {{path?:string, token?:string, tokenInQuery?:boolean, logger?:(...a:any[])=>void}} [options]
   */
  constructor(client, options = {}) {
    this.client = client;
    this.path = options.path ?? '/v1/events';
    this.token = options.token ?? client.token ?? '';
    this.tokenInQuery = options.tokenInQuery ?? true;
    this.authHeader = options.authHeader ?? true;
    this.logger = options.logger ?? (() => {});
    this.frames = [];
    this.comments = [];
    this.listeners = new Set();
    this.waiters = new Set();
    this.status = 'idle'; // idle | connecting | open | closing | closed | error
    this.connectionIndex = 0;
    this.replaced = false;
    this.error = null;
    this.closedReason = null;
    this.startedAt = 0;
    this.endedAt = 0;
    this._abort = new AbortController();
    this._parser = createSseParser((frame) => this._emit(frame), (c) => this.comments.push(c));
    this._closePromise = null;
  }

  get connected() { return this.status === 'open'; }
  get closed() { return this.status === 'closed' || this.status === 'error'; }

  onFrame(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  /** Open the SSE connection. Resolves after HTTP 200 + content-type is validated. */
  async connect({ timeoutMs = 15000 } = {}) {
    if (this.status !== 'idle') throw new Error('EventStream.connect called twice; create a new EventStream');
    this.status = 'connecting';
    this.startedAt = Date.now();
    const url = this.client._url(this.path, this.tokenInQuery && this.token ? { token: this.token } : null);
    const headers = { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' };
    // Protocol allows ?token= for EventSource-compat; we also send the header when available.
    if (this.token && this.authHeader) headers.Authorization = 'Bearer ' + this.token;
    this.logger('[sse] connecting ' + url);
    let res;
    try {
      res = await this.client._fetchRaw(url, { method: 'GET', headers, signal: this._abort.signal, timeoutMs });
    } catch (e) {
      this.status = 'error'; this.error = e; throw e;
    }
    if (res.status !== 200) {
      let text = '';
      try { text = await res.text(); } catch { /* ignore */ }
      this.status = 'error';
      this.error = new ProtocolError('SSE connect failed: HTTP ' + res.status, {
        status: res.status, code: safeErrorCode(text), bodyText: text, path: this.path, method: 'GET',
      });
      throw this.error;
    }
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    if (!ctype.includes('text/event-stream')) {
      this.status = 'error';
      this.error = new ProtocolError('SSE connect failed: content-type is ' + JSON.stringify(ctype), {
        status: res.status, code: 'bad-content-type', path: this.path, method: 'GET',
      });
      throw this.error;
    }
    this.status = 'open';
    this.connectionIndex += 1;
    this._closePromise = this._readLoop(res.body);
    return this;
  }

  async _readLoop(body) {
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const reader = body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this._parser.push(decoder.decode(value, { stream: true }));
      }
      const rest = decoder.decode();
      if (rest) this._parser.push(rest);
      this._parser.end();
      if (this.status !== 'closing') {
        this.status = 'closed';
        this.closedReason = this.closedReason ?? (this.replaced ? 'connection-replaced' : 'server-eof');
      }
    } catch (e) {
      if (this.status === 'closing' || this._abort.signal.aborted) {
        this.status = 'closed';
        this.closedReason = this.closedReason ?? 'client-abort';
      } else {
        this.status = 'error';
        this.error = e;
        this.closedReason = 'read-error';
      }
    } finally {
      this.endedAt = Date.now();
      try { reader.releaseLock(); } catch { /* ignore */ }
      this._resolveWaitersOnClose();
    }
  }

  _emit(frame) {
    this.frames.push(frame);
    if (frame.event === 'connection.replaced') this.replaced = true;
    for (const cb of [...this.listeners]) {
      try { cb(frame); } catch (e) { this.logger('[sse] listener error ' + e); }
    }
    for (const w of [...this.waiters]) {
      let hit = false;
      try { hit = w.predicate(frame); } catch (e) { w.reject(e); this.waiters.delete(w); continue; }
      if (hit) { clearTimeout(w.timer); this.waiters.delete(w); w.resolve(frame); }
    }
  }

  _resolveWaitersOnClose() {
    for (const w of [...this.waiters]) {
      clearTimeout(w.timer);
      this.waiters.delete(w);
      w.reject(new Error('SSE stream closed before matching event (reason=' + (this.closedReason ?? 'unknown') + ')'));
    }
  }

  /**
   * Wait for the first frame matching predicate (checks buffered frames first).
   * @param {(f:any)=>boolean} predicate
   */
  waitFor(predicate, { timeoutMs = 20000, sinceIndex = 0 } = {}) {
    for (let i = sinceIndex; i < this.frames.length; i++) {
      const f = this.frames[i];
      if (predicate(f)) return Promise.resolve(f);
    }
    if (this.closed) return Promise.reject(new Error('SSE stream already closed (reason=' + (this.closedReason ?? 'unknown') + ') before waiting'));
    return new Promise((resolveP, rejectP) => {
      const w = { predicate, resolve: resolveP, reject: rejectP, timer: null };
      w.timer = setTimeout(() => {
        this.waiters.delete(w);
        rejectP(new TimeoutError('Timed out after ' + timeoutMs + 'ms waiting for SSE frame'));
      }, timeoutMs);
      this.waiters.add(w);
    });
  }

  waitForEvent(eventName, opts) { return this.waitFor((f) => f.event === eventName, opts); }

  /** Wait until no matching frame arrives for quietMs (used to assert "no more events"). */
  async quiet(matches = () => true, { quietMs = 800, timeoutMs = 15000 } = {}) {
    const started = Date.now();
    let lastCount = this.frames.filter(matches).length;
    let lastChange = Date.now();
    while (Date.now() - started < timeoutMs) {
      await sleep(50);
      const count = this.frames.filter(matches).length;
      if (count !== lastCount) { lastCount = count; lastChange = Date.now(); }
      if (Date.now() - lastChange >= quietMs) return true;
    }
    return false;
  }

  async close({ timeoutMs = 5000 } = {}) {
    if (this.status === 'idle') { this.status = 'closed'; this.closedReason = 'never-opened'; return; }
    if (this.closed) return;
    this.status = 'closing';
    this.closedReason = this.closedReason ?? 'client-close';
    this._abort.abort();
    if (this._closePromise) {
      await Promise.race([this._closePromise.catch(() => {}), sleep(timeoutMs)]);
    }
    if (this.status !== 'error') this.status = 'closed';
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class DshRemoteClient {
  /**
   * @param {{baseUrl:string, token?:string, deviceId?:string, timeoutMs?:number,
   *          fetchImpl?:typeof fetch, logger?:(...a:any[])=>void}} opts
   */
  constructor(opts) {
    if (!opts || !opts.baseUrl) throw new Error('DshRemoteClient requires baseUrl');
    this.baseUrl = String(opts.baseUrl).replace(/\/+$/, '');
    this.token = opts.token ?? '';
    this.deviceId = opts.deviceId ?? '';
    this.timeoutMs = opts.timeoutMs ?? 15000;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.logger = opts.logger ?? (() => {});
    this.requestLog = [];
    this.streams = new Set();
  }

  _url(path, query) {
    const u = new URL(this.baseUrl + path);
    if (query) for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  _headers(extra, { auth = true } = {}) {
    const h = { Accept: 'application/json', ...extra };
    if (auth && this.token) h.Authorization = 'Bearer ' + this.token;
    return h;
  }

  async _fetchRaw(url, { method = 'GET', headers, body, signal, timeoutMs = this.timeoutMs } = {}) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const composed = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const started = Date.now();
    const res = await this.fetchImpl(url, { method, headers, body, signal: composed, redirect: 'manual' });
    this.logger('[http] ' + method + ' ' + url + ' -> ' + res.status + ' (' + (Date.now() - started) + 'ms)');
    return res;
  }

  /**
   * Low-level request. Returns {status, headers, bodyText, body, durationMs}.
   * Does not throw on HTTP error status.
   */
  async request(method, path, { body, query, auth = true, headers = {}, timeoutMs = this.timeoutMs, parse = 'json' } = {}) {
    const url = this._url(path, query);
    const h = this._headers(headers, { auth });
    let payload;
    if (body !== undefined) {
      if (typeof body === 'string' || body instanceof Uint8Array) payload = body;
      else { payload = JSON.stringify(body); h['Content-Type'] = h['Content-Type'] ?? 'application/json; charset=utf-8'; }
    }
    const entry = { method, path, url, requestBody: body, startedAt: Date.now() };
    let res;
    try {
      res = await this._fetchRaw(url, { method, headers: h, body: payload, timeoutMs });
    } catch (e) {
      entry.error = String(e && e.message ? e.message : e);
      entry.durationMs = Date.now() - entry.startedAt;
      this.requestLog.push(entry);
      if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        throw new ProtocolError('Request timed out after ' + timeoutMs + 'ms: ' + method + ' ' + path, {
          status: 0, code: 'timeout', path, method,
        });
      }
      throw e;
    }
    const text = await res.text();
    let parsed = null; let parseError = null;
    if (parse === 'json' && text.length > 0) {
      try { parsed = JSON.parse(text); } catch (e) { parseError = String(e.message); }
    }
    const result = {
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      bodyText: text,
      body: parsed,
      parseError,
      durationMs: Date.now() - entry.startedAt,
      contentType: res.headers.get('content-type'),
    };
    entry.status = res.status;
    entry.responseBody = parsed ?? text;
    entry.durationMs = result.durationMs;
    this.requestLog.push(entry);
    return result;
  }

  /** Request that throws ProtocolError on non-2xx. */
  async call(method, path, opts = {}) {
    const r = await this.request(method, path, opts);
    if (r.status >= 200 && r.status < 300) return r;
    const err = (r.body && r.body.error) || {};
    throw new ProtocolError(err.message || ('HTTP ' + r.status + ' for ' + method + ' ' + path), {
      status: r.status, code: err.code || ('http-' + r.status), details: err.details ?? null,
      path, method, bodyText: r.bodyText,
    });
  }

  // --- protocol endpoints -------------------------------------------------

  /** GET /v1/health (no auth) */
  health() { return this.call('GET', '/v1/health', { auth: false }); }

  /** POST /v1/pair (no auth). On success stores token/deviceId. */
  async pair({ code, deviceId, deviceName, platform = 'android', appVersion } = {}) {
    const body = { code, deviceName, platform, appVersion };
    if (deviceId) body.deviceId = deviceId;
    const r = await this.call('POST', '/v1/pair', { auth: false, body });
    if (r.body && r.body.token) { this.token = r.body.token; this.deviceId = r.body.deviceId ?? this.deviceId; }
    return r;
  }

  /** GET /v1/host */
  host() { return this.call('GET', '/v1/host'); }

  /** GET /v1/sessions */
  sessions({ limit, cursor } = {}) { return this.call('GET', '/v1/sessions', { query: { limit, cursor } }); }

  /** POST /v1/sessions */
  createSession({ cwd, agentPreset } = {}) { return this.call('POST', '/v1/sessions', { body: { cwd, agentPreset } }); }

  /** GET /v1/sessions/:id */
  session(sessionId) { return this.call('GET', '/v1/sessions/' + encodeURIComponent(sessionId)); }

  /** GET /v1/sessions/:id/history */
  history(sessionId, { beforeSeq, maxMessages } = {}) {
    return this.call('GET', '/v1/sessions/' + encodeURIComponent(sessionId) + '/history', { query: { beforeSeq, maxMessages } });
  }

  /** POST /v1/sessions/:id/open */
  open(sessionId, options = {}) {
    const body = {
      maxMessages: options.maxMessages ?? 60,
      assistantStream: options.assistantStream ?? true,
    };
    if (options.turnWindow !== undefined) body.turnWindow = options.turnWindow;
    return this.call('POST', '/v1/sessions/' + encodeURIComponent(sessionId) + '/open', { body });
  }

  /** POST /v1/sessions/:id/close */
  close(sessionId) { return this.call('POST', '/v1/sessions/' + encodeURIComponent(sessionId) + '/close', { body: {} }); }

  /** POST /v1/sessions/:id/prompt */
  prompt(sessionId, { requestId, mode = 'queue', content, clientTimeZone } = {}) {
    return this.call('POST', '/v1/sessions/' + encodeURIComponent(sessionId) + '/prompt', {
      body: { requestId: requestId ?? randomUUID(), mode, content, ...(clientTimeZone ? { clientTimeZone } : {}) },
    });
  }

  /** POST /v1/sessions/:id/cancel */
  cancel(sessionId) { return this.call('POST', '/v1/sessions/' + encodeURIComponent(sessionId) + '/cancel', { body: {} }); }

  /** POST /v1/sessions/:id/rename */
  rename(sessionId, title) { return this.call('POST', '/v1/sessions/' + encodeURIComponent(sessionId) + '/rename', { body: { title } }); }

  /** POST /v1/sessions/:id/model */
  selectModel(sessionId, selection) { return this.call('POST', '/v1/sessions/' + encodeURIComponent(sessionId) + '/model', { body: selection }); }

  /** GET /v1/models */
  models() { return this.call('GET', '/v1/models'); }

  /** GET /v1/approvals */
  approvals() { return this.call('GET', '/v1/approvals'); }

  /** POST /v1/approvals/:id */
  answerApproval(approvalId, decision) {
    return this.call('POST', '/v1/approvals/' + encodeURIComponent(approvalId), { body: { decision } });
  }

  /** GET /v1/devices */
  devices() { return this.call('GET', '/v1/devices'); }

  /** DELETE /v1/devices/:id */
  removeDevice(deviceId) { return this.call('DELETE', '/v1/devices/' + encodeURIComponent(deviceId)); }

  /** GET /pair (loopback HTML) — no auth, returns raw text. */
  pairPage() { return this.call('GET', '/pair', { auth: false, parse: 'text' }); }

  // --- SSE ----------------------------------------------------------------

  /** Create (but do not connect) an EventStream bound to this client. */
  events(options = {}) {
    const sse = new EventStream(this, { token: this.token, logger: this.logger, ...options });
    this.streams.add(sse);
    const origClose = sse.close.bind(sse);
    sse.close = async (o) => { const r = await origClose(o); this.streams.delete(sse); return r; };
    return sse;
  }

  async closeAllStreams() { await Promise.all([...this.streams].map((s) => s.close().catch(() => {}))); }
}

function safeErrorCode(text) {
  try { const j = JSON.parse(text); return (j.error && j.error.code) || 'http-error'; } catch { return 'http-error'; }
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgv(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

function nowIso() { return new Date().toISOString(); }

function loadState(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

function saveState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n');
}

function describeFrame(f) {
  return { id: f.id, event: f.event, data: f.dataJson ?? f.data, at: new Date(f.receivedAt).toISOString() };
}

const USAGE = [
  'DSH Remote protocol v1 client (verifier oracle)',
  '',
  'Usage:',
  '  node tools/verify/protocol-client.mjs [command] --url <baseUrl> [options]',
  '',
  'Commands (default: smoke):',
  '  smoke                pair -> host -> sessions -> open -> prompt -> stream -> cancel -> devices',
  '  health               GET /v1/health',
  '  pair                 POST /v1/pair (requires --code)',
  '  host                 GET /v1/host',
  '  sessions             GET /v1/sessions',
  '  create-session       POST /v1/sessions',
  '  session              GET /v1/sessions/:id          (--session)',
  '  history              GET /v1/sessions/:id/history  (--session)',
  '  open                 POST /v1/sessions/:id/open + print SSE frames (--session, --seconds)',
  '  prompt               POST /v1/sessions/:id/prompt  (--session, --text)',
  '  cancel               POST /v1/sessions/:id/cancel  (--session)',
  '  rename               POST /v1/sessions/:id/rename  (--session, --title)',
  '  models               GET /v1/models',
  '  approvals            GET /v1/approvals',
  '  answer-approval      POST /v1/approvals/:id        (--approval, --decision allow|reject)',
  '  devices              GET /v1/devices',
  '  remove-device        DELETE /v1/devices/:id        (--device)',
  '',
  'Common options:',
  '  --url <url>          Host base URL (default http://127.0.0.1:8790, or --port)',
  '  --port <n>           Shorthand for http://127.0.0.1:<n>',
  '  --code <6 digits>    Pairing code',
  '  --token <token>      Existing device token (or from --state)',
  '  --state <path>       JSON file to load/save baseUrl/token/deviceId',
  '  --device-name <s>    Device name sent while pairing (default verifier-cli)',
  '  --json               Machine-readable JSON output only',
  '  --seconds <n>        How long to print SSE frames for open/smoke (default 8)',
  '  --timeout <ms>       Per-request timeout (default 15000)',
  '',
].join('\n');

async function main(argv) {
  const args = parseArgv(argv);
  if (args.help || args.h) { console.log(USAGE); return 0; }
  const cmd = args._[0] || 'smoke';
  const statePath = resolve(String(args.state ?? resolve(HERE, '.verify-client-state.json')));
  const state = loadState(statePath);
  const baseUrl = args.url || state.baseUrl || (args.port ? 'http://127.0.0.1:' + args.port : 'http://127.0.0.1:' + DEFAULT_PORT);
  const jsonOut = !!args.json;
  const log = jsonOut ? () => {} : (...a) => console.log(...a);
  const client = new DshRemoteClient({
    baseUrl,
    token: args.token || state.token || '',
    deviceId: state.deviceId || '',
    timeoutMs: args.timeout ? Number(args.timeout) : 15000,
    logger: jsonOut ? () => {} : (...a) => console.error('[client] ' + a.join(' ')),
  });
  const persist = () => {
    saveState(statePath, { baseUrl, token: client.token, deviceId: client.deviceId, updatedAt: nowIso() });
  };
  const done = (obj) => { console.log(JSON.stringify(obj, null, 2)); return 0; };

  try {
    switch (cmd) {
      case 'health': return done((await client.health()).body);
      case 'pair': {
        if (!args.code) throw new Error('--code is required for pair');
        const r = await client.pair({
          code: String(args.code), deviceName: String(args['device-name'] ?? 'verifier-cli'),
          appVersion: String(args['app-version'] ?? '0.1.0'),
        });
        persist();
        return done(r.body);
      }
      case 'host': return done((await client.host()).body);
      case 'sessions': return done((await client.sessions()).body);
      case 'create-session': return done((await client.createSession({ cwd: args.cwd, agentPreset: args.preset })).body);
      case 'session': return done((await client.session(reqSession(args))).body);
      case 'history': return done((await client.history(reqSession(args), { beforeSeq: args.beforeSeq ? Number(args.beforeSeq) : undefined })).body);
      case 'models': return done((await client.models()).body);
      case 'approvals': return done((await client.approvals()).body);
      case 'devices': return done((await client.devices()).body);
      case 'remove-device': {
        if (!args.device) throw new Error('--device is required');
        return done((await client.removeDevice(String(args.device))).body);
      }
      case 'answer-approval': {
        if (!args.approval) throw new Error('--approval is required');
        return done((await client.answerApproval(String(args.approval), String(args.decision ?? 'allow'))).body);
      }
      case 'rename': {
        if (!args.title) throw new Error('--title is required');
        return done((await client.rename(reqSession(args), String(args.title))).body);
      }
      case 'prompt': {
        if (!args.text) throw new Error('--text is required');
        return done((await client.prompt(reqSession(args), {
          requestId: args.requestId || randomUUID(),
          content: [{ type: 'text', text: String(args.text) }],
          clientTimeZone: args.tz,
        })).body);
      }
      case 'cancel': return done((await client.cancel(reqSession(args))).body);
      case 'open': {
        const sse = client.events(); await sse.connect();
        const r = await client.open(reqSession(args), { maxMessages: 60 });
        log('subscription: ' + JSON.stringify(r.body));
        await pump(sse, Number(args.seconds ?? 8), log, jsonOut);
        return 0;
      }
      case 'smoke': {
        return done(await runSmoke(client, { code: args.code ? String(args.code) : undefined, seconds: Number(args.seconds ?? 8), log }));
      }
      default: throw new Error('Unknown command: ' + cmd + '\n\n' + USAGE);
    }
  } finally {
    await client.closeAllStreams().catch(() => {});
    try { persist(); } catch { /* ignore */ }
  }
}

function reqSession(args) {
  const id = args.session || args.id;
  if (!id) throw new Error('--session is required');
  return String(id);
}

async function pump(sse, seconds, log, jsonOut) {
  const seen = [];
  const unsub = sse.onFrame((f) => {
    seen.push(describeFrame(f));
    if (!jsonOut) log('[sse] ' + f.id + ' ' + f.event + ' ' + JSON.stringify(f.dataJson ?? f.data));
  });
  await sleep(seconds * 1000);
  unsub();
  return seen;
}

/**
 * Full protocol happy path used as the CLI default and by run-e2e.
 * Returns a structured result with every step + raw evidence.
 */
export async function runSmoke(client, { code, seconds = 8, log = () => {}, promptText = 'verifier smoke test: reply with a short greeting' } = {}) {
  const result = { baseUrl: client.baseUrl, startedAt: nowIso(), steps: [], errors: [] };
  const step = (name, ok, detail) => {
    result.steps.push({ name, ok, detail, at: nowIso() });
    log((ok ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : ' ' + JSON.stringify(detail)));
    return ok;
  };
  try {
    const health = await client.health();
    step('health', health.status === 200 && health.body && health.body.ok === true && health.body.protocol === 1, health.body);

    if (!client.token) {
      if (!code) throw new Error('no token and no --code: cannot pair');
      const pair = await client.pair({ code, deviceName: 'verifier-cli', appVersion: '0.1.0' });
      result.device = pair.body;
      step('pair', pair.status === 200 && /^[0-9a-f]{64}$/i.test(String(pair.body.token ?? '')), {
        status: pair.status, deviceId: pair.body.deviceId, host: pair.body.host,
      });
    } else {
      step('pair', true, 'reused saved token');
    }

    const host = await client.host();
    step('host', host.status === 200 && host.body.protocol === 1 && host.body.hostId === health.body.hostId, {
      hostId: host.body.hostId, name: host.body.name, capabilities: host.body.capabilities,
    });

    const sse = client.events();
    await sse.connect();
    const hello = await sse.waitForEvent('hello', { timeoutMs: 15000 });
    step('sse.hello', hello.dataJson && hello.dataJson.protocol === 1, hello.dataJson);

    const sessions = await client.sessions();
    const items = (sessions.body && sessions.body.items) || [];
    step('sessions.list', sessions.status === 200 && Array.isArray(items), { count: items.length, sample: items[0] ? { sessionId: items[0].sessionId, title: items[0].title, running: items[0].running } : null });

    let sessionId = items[0] && items[0].sessionId;
    if (!sessionId) {
      const created = await client.createSession({ agentPreset: 'standard' });
      sessionId = created.body.sessionId;
      step('sessions.create', !!sessionId, created.body);
    } else {
      step('sessions.create', true, 'reused existing session ' + sessionId);
    }

    const open = await client.open(sessionId, { maxMessages: 60, assistantStream: true });
    const subscriptionId = open.body.subscriptionId;
    step('sessions.open', open.status === 200 && typeof subscriptionId === 'string', open.body);

    const snapshot = await sse.waitFor((f) => f.event === 'session.snapshot' && f.dataJson && (f.dataJson.subscriptionId === subscriptionId || f.dataJson.sessionId === sessionId), { timeoutMs: 15000 });
    step('sse.snapshot', !!snapshot.dataJson && snapshot.dataJson.sessionId === sessionId, {
      records: Array.isArray(snapshot.dataJson.records) ? snapshot.dataJson.records.length : null,
      hasMore: snapshot.dataJson.hasMore, projections: snapshot.dataJson.projections ?? null,
    });

    const requestId = randomUUID();
    const prompt = await client.prompt(sessionId, { requestId, content: [{ type: 'text', text: promptText }], clientTimeZone: 'Asia/Shanghai' });
    step('prompt.accepted', prompt.status === 200 && prompt.body.accepted === true && prompt.body.requestId === requestId, prompt.body);

    const userEvent = await sse.waitFor((f) => f.event === 'session.event' && f.dataJson && f.dataJson.sessionId === sessionId && f.dataJson.event && f.dataJson.event.type === 'user/message', { timeoutMs: 20000 });
    step('sse.user/message', true, { seq: userEvent.dataJson.event.seq });

    const assistantFrame = await sse.waitFor((f) => f.event === 'session.assistant', { timeoutMs: 30000 });
    step('sse.session.assistant', true, { frameType: assistantFrame.dataJson && (assistantFrame.dataJson.frame && assistantFrame.dataJson.frame.type) });

    const assistantMsg = await sse.waitFor((f) => f.event === 'session.event' && f.dataJson && f.dataJson.event && f.dataJson.event.type === 'assistant/message', { timeoutMs: 60000 });
    step('sse.assistant/message', true, { seq: assistantMsg.dataJson.event.seq });

    const cancel = await client.cancel(sessionId);
    step('cancel', cancel.status === 200 && cancel.body.accepted === true, cancel.body);

    const devices = await client.devices();
    const deviceItems = (devices.body && devices.body.items) || [];
    step('devices', devices.status === 200 && Array.isArray(deviceItems) && deviceItems.some((d) => d.current === true), { count: deviceItems.length });

    await client.close(sessionId).catch(() => {});
    await sse.close();
    result.sessionId = sessionId;
    result.ok = result.steps.every((s) => s.ok);
  } catch (e) {
    result.errors.push({ message: String(e && e.message ? e.message : e), code: e && e.code, status: e && e.status });
    result.ok = false;
    log('ERROR ' + String(e && e.stack ? e.stack : e));
  } finally {
    result.finishedAt = nowIso();
    result.requestLog = client.requestLog;
  }
  return result;
}

// Only auto-run when executed directly, not when imported.
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).then((code) => process.exitCode = code).catch((e) => {
    console.error('fatal: ' + (e && e.stack ? e.stack : e));
    process.exitCode = 1;
  });
}
