#!/usr/bin/env node
/**
 * DSH Remote protocol v1 — end-to-end matrix runner against a REAL DSH host.
 *
 * Modes:
 *   reuse (default): --url/--port + --code/--token, or read the plugin's pairing.json
 *   spawn:           --start-cmd "<command to start DSH>" (+ --dsh-home) and wait for health
 *
 * Usage:
 *   node tools/verify/run-e2e.mjs --url http://127.0.0.1:8790 --code 123456
 *   node tools/verify/run-e2e.mjs --port 8790 --pairing-json D:\Code\dsh-remote\.testhome\plugins\dsh-remote\pairing.json
 *   node tools/verify/run-e2e.mjs --url ... --token <device token>
 *   node tools/verify/run-e2e.mjs --start-cmd "pnpm dsh web" --dsh-home D:\Code\dsh-remote\.testhome --kill-on-exit
 *   node tools/verify/run-e2e.mjs --url ... --code ... --json-out tools/verify/.e2e-report.json
 *
 * Writes JSON evidence (default tools/verify/.e2e-report.json) and a human report
 * (default docs/verification/e2e-report.md). Exit code 0 only when no hard failures.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DshRemoteClient, ProtocolError, sleep } from './protocol-client.mjs';

const BT = String.fromCharCode(96);
const RESULTS = [];
const startedAt = new Date();
const startedMs = Date.now();

class E2eFailure extends Error {
  constructor(message, detail) { super(message); this.name = 'E2eFailure'; this.detail = detail; }
}
function assert(cond, message, detail) { if (!cond) throw new E2eFailure(message, detail); }
function assertEqual(actual, expected, label) {
  if (!Object.is(actual, expected)) throw new E2eFailure(label + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual), { expected, actual });
}
function assertType(value, type, label) {
  assert(typeof value === type, label + ': expected ' + type + ', got ' + typeof value, { actual: value });
}
function assertArray(value, label) { assert(Array.isArray(value), label + ': expected array, got ' + typeof value); }

let fatal = null;
async function step(name, fn, opts = {}) {
  if (opts.skip || fatal && !opts.allowAfterFatal) {
    const reason = opts.skip || ('blocked by earlier failure: ' + fatal);
    RESULTS.push({ name, status: 'skip', reason, durationMs: 0 });
    console.log('SKIP ' + name + ' :: ' + reason);
    return;
  }
  const t0 = Date.now();
  try {
    const detail = await fn();
    RESULTS.push({ name, status: 'pass', detail, durationMs: Date.now() - t0 });
    console.log('PASS ' + name);
  } catch (e) {
    const status = opts.severity === 'warn' ? 'warn' : 'fail';
    const err = e && e.message ? e.message : String(e);
    RESULTS.push({ name, status, error: err, detail: e && e.detail, durationMs: Date.now() - t0 });
    console.log((status === 'fail' ? 'FAIL ' : 'WARN ') + name + ' :: ' + err);
    if (status === 'fail' && opts.fatal) fatal = name + ': ' + err;
  }
}

function textOfEvent(event) {
  const data = (event && event.data) || {};
  const parts = [];
  const walk = (content) => { if (Array.isArray(content)) for (const c of content) if (c && typeof c.text === 'string') parts.push(c.text); };
  if (event && event.type === 'user/message') walk(data.content);
  else if (event && event.type === 'assistant/message') walk(data.message && data.message.content);
  return parts.join('\n');
}

function mask(token) {
  if (!token) return '';
  return token.length <= 10 ? '***' : token.slice(0, 6) + '...' + token.slice(-4);
}

function compactValue(value, maxLen = 1200) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > maxLen ? s.slice(0, maxLen) + '...<truncated>' : s;
}

function readPairingInfo(args) {
  const candidates = [];
  if (args['pairing-json']) candidates.push(resolve(args['pairing-json']));
  if (args['dsh-home']) candidates.push(resolve(args['dsh-home'], 'plugins', 'dsh-remote', 'pairing.json'));
  const info = { code: null, port: null, hostId: null, addresses: null, source: null, path: null };
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const j = JSON.parse(readFileSync(p, 'utf8'));
      info.path = p;
      info.source = 'pairing.json';
      info.code = typeof j.pairingCode === 'string' ? j.pairingCode : null;
      info.port = typeof j.port === 'number' ? j.port : null;
      info.hostId = j.hostId || null;
      info.addresses = Array.isArray(j.addresses) ? j.addresses : null;
      break;
    } catch { /* try next */ }
  }
  // pairing.txt fallback: first 6-digit token
  if (!info.code) {
    const txtCandidates = candidates.map((p) => p.replace(/pairing\.json$/, 'pairing.txt'));
    for (const p of txtCandidates) {
      if (!existsSync(p)) continue;
      try {
        const m = readFileSync(p, 'utf8').match(/\b(\d{6})\b/);
        if (m) { info.code = m[1]; info.source = 'pairing.txt'; info.path = p; break; }
      } catch { /* ignore */ }
    }
  }
  return info;
}

async function waitForHealth(baseUrl, timeoutMs, child) {
  const t0 = Date.now();
  let lastErr = null;
  while (Date.now() - t0 < timeoutMs) {
    if (child && child.exitCode !== null) {
      throw new E2eFailure('host process exited early (code=' + child.exitCode + ') while waiting for health');
    }
    try {
      const res = await fetch(baseUrl.replace(/\/+$/, '') + '/v1/health', { signal: AbortSignal.timeout(3000) });
      if (res.status === 200) {
        const body = await res.json();
        if (body && body.ok === true) return { body, waitedMs: Date.now() - t0 };
      }
      lastErr = 'HTTP ' + res.status;
    } catch (e) { lastErr = String(e && e.message ? e.message : e); }
    await sleep(500);
  }
  throw new E2eFailure('host did not become healthy within ' + timeoutMs + 'ms (' + lastErr + ')');
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      url: { type: 'string' },
      port: { type: 'string' },
      code: { type: 'string' },
      token: { type: 'string' },
      'pairing-json': { type: 'string' },
      'dsh-home': { type: 'string' },
      'start-cmd': { type: 'string' },
      cwd: { type: 'string' },
      'start-timeout': { type: 'string', default: '90000' },
      'kill-on-exit': { type: 'boolean', default: true },
      timeout: { type: 'string', default: '20000' },
      'event-timeout': { type: 'string', default: '30000' },
      'assistant-timeout': { type: 'string', default: '180000' },
      'cancel-grace': { type: 'string', default: '3000' },
      'json-out': { type: 'string', default: 'tools/verify/.e2e-report.json' },
      report: { type: 'string', default: 'docs/verification/e2e-report.md' },
      verbose: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  const log = args.quiet ? () => {} : (...a) => console.log(...a);
  const pairing = readPairingInfo(args);
  const baseUrl = (args.url || (args.port ? 'http://127.0.0.1:' + args.port : null)
    || (pairing.port ? 'http://127.0.0.1:' + pairing.port : null)
    || 'http://127.0.0.1:8790').replace(/\/+$/, '');
  const timeoutMs = Number(args.timeout);
  const eventTimeout = Number(args['event-timeout']);
  const assistantTimeout = Number(args['assistant-timeout']);
  const cancelGrace = Number(args['cancel-grace']);

  let child = null;
  let hostLogs = null;
  if (args['start-cmd']) {
    const logDir = resolve('tools/verify/.host-logs');
    mkdirSync(logDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = join(logDir, 'host-' + stamp + '.out.log');
    const errPath = join(logDir, 'host-' + stamp + '.err.log');
    const outStream = createWriteStream(outPath);
    const errStream = createWriteStream(errPath);
    const env = { ...process.env };
    if (args['dsh-home']) env.DSH_HOME = resolve(args['dsh-home']);
    log('[setup] spawning host: ' + args['start-cmd']);
    child = spawn(args['start-cmd'], { shell: true, cwd: args.cwd ? resolve(args.cwd) : process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(outStream);
    child.stderr.pipe(errStream);
    hostLogs = { out: outPath, err: errPath, pid: child.pid };
    try {
      const health = await waitForHealth(baseUrl, Number(args['start-timeout']), child);
      log('[setup] host healthy after ' + health.waitedMs + 'ms');
    } catch (e) {
      fatal = 'host spawn failed: ' + (e && e.message ? e.message : e);
      log('[setup] ' + fatal);
      try { outStream.end(); errStream.end(); } catch { /* ignore */ }
    }
  }

  const client = new DshRemoteClient({
    baseUrl,
    token: args.token || '',
    timeoutMs,
    logger: args.verbose ? (...a) => console.log('[client] ' + a.join(' ')) : undefined,
  });
  const bare = new DshRemoteClient({ baseUrl, timeoutMs });
  const evidence = { timeline: [], assistantFrames: [], userMessage: null, assistantMessage: null, snapshots: [], sseFrames: [], eventCounts: {}, rawUserMessage: null, rawAssistantMessage: null, injectedUserMessage: null, hello: null };
  const ctx = { client, bare, baseUrl, code: args.code || pairing.code, device: null, hostId: null, sessionId: null, snapshot: null, sse: null, lastFrames: [] };

  const recordFrame = (f) => {
    evidence.eventCounts[f.event] = (evidence.eventCounts[f.event] || 0) + 1;
    if (f.event === 'hello' && !evidence.hello) evidence.hello = compactValue(f.dataJson, 1500);
    const item = { at: new Date(f.receivedAt).toISOString(), id: f.id, event: f.event, size: f.data ? f.data.length : 0 };
    if (f.dataJson && f.event !== 'ping') {
      if (f.event === 'session.assistant') evidence.assistantFrames.push({ at: item.at, frame: compactValue(f.dataJson.frame, 400) });
      if (f.event === 'session.event') {
        const ev = f.dataJson.event || {};
        evidence.timeline.push({ at: item.at, type: ev.type, seq: ev.seq, summary: compactValue(ev.data, 300) });
        if (ev.type === 'user/message') {
          const rawData = ev.data && typeof ev.data === 'object' ? ev.data : {};
          const src = rawData.source;
          const sourceKind = src && typeof src === 'object' ? src.kind : (typeof src === 'string' ? src : undefined);
          const isGeniuneUser = sourceKind === 'user';
          if (isGeniuneUser && !evidence.rawUserMessage) {
            evidence.userMessage = { seq: ev.seq, sourceKind, text: textOfEvent(ev).slice(0, 500) };
            evidence.rawUserMessage = compactValue(ev.data, 6000);
          } else if (!isGeniuneUser && !evidence.injectedUserMessage) {
            evidence.injectedUserMessage = { seq: ev.seq, sourceKind: sourceKind === undefined ? null : sourceKind, text: textOfEvent(ev).slice(0, 400), raw: compactValue(ev.data, 3000) };
          }
        }
        if (ev.type === 'assistant/message') {
          evidence.assistantMessage = { seq: ev.seq, text: textOfEvent(ev).slice(0, 800) };
          if (!evidence.rawAssistantMessage) evidence.rawAssistantMessage = compactValue(ev.data, 6000);
        }
      }
      if (f.event === 'session.snapshot') evidence.snapshots.push({ at: item.at, subscriptionId: f.dataJson.subscriptionId, records: (f.dataJson.records || []).length });
    }
    if (evidence.sseFrames.length < 500) evidence.sseFrames.push(item);
  };

  // ------------------------------------------------------------------
  // 1. pre-pair: health + local pair page
  // ------------------------------------------------------------------
  await step('health.public', async () => {
    const r = await bare.request('GET', '/v1/health');
    assertEqual(r.status, 200, 'health status');
    assertEqual(r.body.ok, true, 'health.ok');
    assertEqual(r.body.protocol, 1, 'health.protocol');
    assertType(r.body.hostId, 'string', 'health.hostId');
    ctx.hostId = r.body.hostId;
    ctx.health = r.body;
    return { hostId: r.body.hostId, dshVersion: r.body.dshVersion, pluginVersion: r.body.pluginVersion, pairingRequired: r.body.pairingRequired };
  }, { skip: fatal });

  await step('pair-page.loopback-html', async () => {
    const r = await bare.request('GET', '/pair');
    assertEqual(r.status, 200, 'pair page status');
    assert(/text\/html/i.test(String(r.contentType)), 'pair page content-type must be text/html, got ' + r.contentType);
    assert(r.bodyText.length > 100, 'pair page HTML looks empty');
    assert(/\d{6}/.test(r.bodyText) || /pair/i.test(r.bodyText), 'pair page must contain the pairing code or a pair marker');
    return { contentType: r.contentType, bytes: r.bodyText.length };
  }, { skip: fatal, severity: 'warn' });

  // ------------------------------------------------------------------
  // 2. pairing
  // ------------------------------------------------------------------
  await step('pair.succeeds', async () => {
    if (!ctx.client.token) {
      assert(ctx.code, 'no device token and no pairing code (pass --code or --pairing-json)');
      const r = await ctx.client.pair({ code: String(ctx.code), deviceName: 'verifier-e2e', platform: 'android', appVersion: '0.1.0' });
      assertEqual(r.status, 200, 'pair status');
      assertEqual(r.body.protocol, 1, 'pair.protocol');
      assert(/^[0-9a-f]{64}$/i.test(String(r.body.token || '')), 'pair.token must be 64 hex chars');
      assertType(r.body.deviceId, 'string', 'pair.deviceId');
      assert(r.body.host && typeof r.body.host === 'object', 'pair.host missing');
      ctx.device = { deviceId: r.body.deviceId, host: r.body.host };
    } else {
      ctx.device = { deviceId: ctx.client.deviceId || null, host: null };
    }
    return { mode: ctx.client.token && args.token ? 'token' : 'pair', deviceId: ctx.device.deviceId, host: ctx.device.host, token: mask(ctx.client.token) };
  }, { skip: fatal, fatal: true });

  // ------------------------------------------------------------------
  // 3. auth negative
  // ------------------------------------------------------------------
  await step('auth.missing-token-401', async () => {
    const r = await bare.request('GET', '/v1/sessions');
    assertEqual(r.status, 401, 'status');
    assertEqual(r.body.error && r.body.error.code, 'unauthorized', 'error.code');
    return { status: r.status, code: r.body.error.code };
  }, { skip: fatal });

  await step('auth.sse-bad-token-401', async () => {
    const bad = new DshRemoteClient({ baseUrl, token: 'f'.repeat(64), timeoutMs });
    const sse = bad.events();
    let caught = null;
    try { await sse.connect(); } catch (e) { caught = e; }
    assert(caught, 'SSE with bad token must fail');
    assertEqual(caught.status, 401, 'SSE bad-token status');
    assertEqual(caught.code, 'unauthorized', 'SSE bad-token code');
    await sse.close();
    return { status: caught.status, code: caught.code };
  }, { skip: fatal });

  // ------------------------------------------------------------------
  // 4. authenticated host/session contracts
  // ------------------------------------------------------------------
  await step('host.shape', async () => {
    const r = await ctx.client.request('GET', '/v1/host');
    assertEqual(r.status, 200, 'host status');
    assertEqual(r.body.protocol, 1, 'host.protocol');
    assertEqual(r.body.hostId, ctx.hostId, 'host.hostId === health.hostId');
    assertType(r.body.name, 'string', 'host.name');
    const caps = r.body.capabilities;
    assert(caps && typeof caps === 'object', 'capabilities missing');
    assertType(caps.assistantStream, 'boolean', 'capabilities.assistantStream');
    assertType(caps.approvals, 'boolean', 'capabilities.approvals');
    assertArray(r.body.devices, 'host.devices');
    assert(!JSON.stringify(r.body).includes(ctx.client.token), 'host response leaks device token');
    return { name: r.body.name, platform: r.body.platform, capabilities: caps, devices: r.body.devices.length };
  }, { skip: fatal });

  await step('sessions.list.structure', async () => {
    const r = await ctx.client.request('GET', '/v1/sessions?limit=30');
    assertEqual(r.status, 200, 'sessions status');
    assertArray(r.body.items, 'items');
    for (const item of r.body.items) {
      assertType(item.sessionId, 'string', 'item.sessionId');
      assertType(item.createdAt, 'number', 'item.createdAt');
      assertType(item.running, 'boolean', 'item.running');
      assertType(item.active, 'boolean', 'item.active');
      assertType(item.blank, 'boolean', 'item.blank');
      assertType(item.agentAvailable, 'boolean', 'item.agentAvailable');
    }
    return { count: r.body.items.length, nextCursor: r.body.nextCursor, sample: r.body.items[0] ? { sessionId: r.body.items[0].sessionId, title: r.body.items[0].title } : null };
  }, { skip: fatal });

  await step('sessions.create', async () => {
    let r = await ctx.client.request('POST', '/v1/sessions', { body: { agentPreset: 'standard' } });
    if (r.status !== 200 && r.status !== 201) r = await ctx.client.request('POST', '/v1/sessions', { body: {} });
    assert(r.status === 200 || r.status === 201, 'create status: expected 200/201, got ' + r.status + ' (body=' + String(r.bodyText).slice(0, 200) + ')');
    assertType(r.body.sessionId, 'string', 'create.sessionId');
    ctx.sessionId = r.body.sessionId;
    return { sessionId: r.body.sessionId, agentPreset: r.body.agentPreset };
  }, { skip: fatal, fatal: true });

  await step('session.detail', async () => {
    const r = await ctx.client.request('GET', '/v1/sessions/' + encodeURIComponent(ctx.sessionId));
    assertEqual(r.status, 200, 'detail status');
    assertEqual(r.body.sessionId, ctx.sessionId, 'detail.sessionId');
    assert(r.body.header && typeof r.body.header === 'object', 'detail.header missing');
    assert(r.body.state && typeof r.body.state === 'object', 'detail.state missing');
    assertType(r.body.state.running, 'boolean', 'state.running');
    return { title: r.body.title, state: r.body.state };
  }, { skip: fatal });

  await step('models.catalog', async () => {
    const r = await ctx.client.request('GET', '/v1/models');
    assertEqual(r.status, 200, 'models status');
    assertArray(r.body.groups, 'models.groups');
    return { groups: r.body.groups.length, default: r.body.default };
  }, { skip: fatal, severity: 'warn' });

  // ------------------------------------------------------------------
  // 5. SSE + open + snapshot
  // ------------------------------------------------------------------
  await step('sse.hello', async () => {
    ctx.sse = ctx.client.events();
    ctx.sse.onFrame(recordFrame);
    await ctx.sse.connect();
    const hello = await ctx.sse.waitForEvent('hello', { timeoutMs: eventTimeout });
    assertEqual(hello.dataJson.protocol, 1, 'hello.protocol');
    assertEqual(hello.dataJson.hostId, ctx.hostId, 'hello.hostId');
    assertType(hello.dataJson.serverTime, 'number', 'hello.serverTime');
    return { protocol: hello.dataJson.protocol, subscriptions: hello.dataJson.subscriptions };
  }, { skip: fatal, fatal: true });

  await step('open.snapshot', async () => {
    const open = await ctx.client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/open', {
      body: { maxMessages: 60, turnWindow: { minMessages: 40, minTurns: 1 }, assistantStream: true },
    });
    assertEqual(open.status, 200, 'open status');
    const subId = open.body.subscriptionId;
    assertType(subId, 'string', 'open.subscriptionId');
    const snap = await ctx.sse.waitFor((f) => f.event === 'session.snapshot' && f.dataJson && f.dataJson.subscriptionId === subId, { timeoutMs: eventTimeout });
    assertEqual(snap.dataJson.sessionId, ctx.sessionId, 'snapshot.sessionId');
    assert(snap.dataJson.header && typeof snap.dataJson.header === 'object', 'snapshot.header missing');
    assertArray(snap.dataJson.records, 'snapshot.records');
    assertType(snap.dataJson.hasMore, 'boolean', 'snapshot.hasMore');
    ctx.snapshot = snap.dataJson;
    return { subscriptionId: subId, records: snap.dataJson.records.length, hasMore: snap.dataJson.hasMore, cursor: snap.dataJson.cursor };
  }, { skip: fatal, fatal: true });

  // ------------------------------------------------------------------
  // 6. prompt -> user/message + assistant stream + assistant/message
  // ------------------------------------------------------------------
  let promptMarker = null;
  await step('prompt.user-message', async () => {
    promptMarker = 'verifier-e2e-' + randomUUID().slice(0, 8);
    const requestId = randomUUID();
    const text = '你好，这是端到端验证消息 ' + promptMarker + '。请用一句话回复确认。';
    const prompt = await ctx.client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/prompt', {
      body: { requestId, mode: 'queue', content: [{ type: 'text', text }], clientTimeZone: 'Asia/Shanghai' },
    });
    assertEqual(prompt.status, 200, 'prompt status');
    assertEqual(prompt.body.accepted, true, 'prompt.accepted');
    assertEqual(prompt.body.requestId, requestId, 'prompt.requestId echo');
    const ev = await ctx.sse.waitFor((f) => f.event === 'session.event' && f.dataJson && f.dataJson.sessionId === ctx.sessionId
      && f.dataJson.event && f.dataJson.event.type === 'user/message' && textOfEvent(f.dataJson.event).includes(promptMarker), { timeoutMs: eventTimeout });
    ctx.lastPromptRequestId = requestId;
    const data = (ev.dataJson.event && ev.dataJson.event.data) || {};
    const source = data.source && typeof data.source === 'object' ? data.source : null;
    ctx.lastUserMessageRpcId = source && typeof source.rpcId === 'string' ? source.rpcId : null;
    ctx.lastUserMessageSourceKind = source ? source.kind : (typeof data.source === 'string' ? data.source : undefined);
    return {
      requestId, seq: ev.dataJson.event.seq, text: textOfEvent(ev.dataJson.event).slice(0, 200),
      sourceKind: ctx.lastUserMessageSourceKind, rpcId: ctx.lastUserMessageRpcId,
    };
  }, { skip: fatal, fatal: true });

  await step('prompt.optimistic-dedupe-key', async () => {
    assert(ctx.lastUserMessageRpcId, 'user/message has no data.source.rpcId; App optimistic bubbles cannot be confirmed (protocol §9.2 / §6.4)');
    assertEqual(ctx.lastUserMessageSourceKind, 'user', 'user/message data.source.kind (protocol §9.2)');
    assertEqual(ctx.lastUserMessageRpcId, ctx.lastPromptRequestId, 'user/message source.rpcId must equal the prompt requestId for optimistic dedupe');
    return { requestId: ctx.lastPromptRequestId, rpcId: ctx.lastUserMessageRpcId, sourceKind: ctx.lastUserMessageSourceKind };
  }, { skip: fatal, severity: 'warn' });

  await step('assistant.stream-frames', async () => {
    const first = await ctx.sse.waitFor((x) => x.event === 'session.assistant', { timeoutMs: assistantTimeout });
    const frames = ctx.sse.frames.filter((f) => f.event === 'session.assistant');
    assert(frames.length > 0, 'no session.assistant frames received');
    const sample = first.dataJson || {};
    assert(sample.frame || sample.delta || sample.attempt !== undefined || sample.type, 'assistant frame payload has no recognizable fields: ' + compactValue(sample, 300));
    return { frames: frames.length, sample: compactValue(frames.slice(0, 3).map((f) => f.dataJson), 800) };
  }, { skip: fatal, fatal: true });

  await step('assistant.stream-chunk', async () => {
    let chunk = null;
    try {
      chunk = await ctx.sse.waitFor((f) => {
        if (f.event !== 'session.assistant' || !f.dataJson) return false;
        const raw = JSON.stringify(f.dataJson);
        return /"chunk"|"delta"|"text"|"reasoning"/.test(raw);
      }, { timeoutMs: 30000 });
    } catch (e) {
      chunk = null;
    }
    assert(chunk, 'no incremental assistant chunk/delta frame observed within 30s (streaming may be non-incremental)');
    return { observed: true, sample: compactValue(chunk.dataJson, 600) };
  }, { skip: fatal, severity: 'warn' });

  await step('assistant.message', async () => {
    const ev = await ctx.sse.waitFor((f) => f.event === 'session.event' && f.dataJson && f.dataJson.event
      && f.dataJson.event.type === 'assistant/message', { timeoutMs: assistantTimeout });
    const text = textOfEvent(ev.dataJson.event);
    assert(text.length > 0, 'assistant/message has no text content: ' + compactValue(ev.dataJson.event.data, 400));
    assert(ev.dataJson.event.seq > 0, 'assistant/message seq missing');
    return { seq: ev.dataJson.event.seq, text: text.slice(0, 300), length: text.length };
  }, { skip: fatal, fatal: true });

  await step('session.state-after-turn', async () => {
    const r = await ctx.client.request('GET', '/v1/sessions/' + encodeURIComponent(ctx.sessionId));
    assertEqual(r.status, 200, 'state detail status');
    assertType(r.body.state.running, 'boolean', 'state.running');
    return { running: r.body.state.running, active: r.body.state.active, queue: r.body.state.queue };
  }, { skip: fatal });

  // ------------------------------------------------------------------
  // 7. cancel semantics
  // ------------------------------------------------------------------
  await step('cancel.effective', async () => {
    const requestId = randomUUID();
    const marker = 'verifier-cancel-' + randomUUID().slice(0, 8);
    const longText = marker + ' 请写一篇不少于 500 字的长文，分多段详细展开：' + '请尽量长、不要省略。'.repeat(6);
    const baselineFrames = ctx.sse.frames.length;
    const prompt = await ctx.client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/prompt', {
      body: { requestId, mode: 'queue', content: [{ type: 'text', text: longText }] },
    });
    assertEqual(prompt.status, 200, 'cancel-test prompt status');
    assertEqual(prompt.body.accepted, true, 'cancel-test prompt accepted');
    // Wait until THIS turn actually starts streaming (new assistant frame) or state running=true.
    let started = false;
    const waitStartUntil = Date.now() + 30000;
    while (Date.now() < waitStartUntil && !started) {
      const det = await ctx.client.request('GET', '/v1/sessions/' + encodeURIComponent(ctx.sessionId));
      if (det.body && det.body.state && det.body.state.running === true) { started = true; break; }
      const newAssistant = ctx.sse.frames.slice(baselineFrames).some((f) => f.event === 'session.assistant');
      if (newAssistant) { started = true; break; }
      await sleep(300);
    }
    const beforeFrames = ctx.sse.frames.length;
    const cancel = await ctx.client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/cancel', { body: {} });
    assertEqual(cancel.status, 200, 'cancel status');
    assertEqual(cancel.body.accepted, true, 'cancel.accepted');
    const cancelAt = Date.now();
    // wait for running=false either via REST or session.state event
    let stopped = false;
    while (Date.now() - cancelAt < 8000) {
      const det = await ctx.client.request('GET', '/v1/sessions/' + encodeURIComponent(ctx.sessionId));
      if (det.body && det.body.state && det.body.state.running === false) { stopped = true; break; }
      await sleep(250);
    }
    assert(stopped, 'session still running 8s after cancel');
    await sleep(cancelGrace);
    const lateAssistant = ctx.sse.frames.slice(beforeFrames).filter((f) => f.event === 'session.event'
      && f.dataJson && f.dataJson.event && f.dataJson.event.type === 'assistant/message');
    const detail = { started, stopped, cancelLatencyMs: Date.now() - cancelAt, lateAssistantMessages: lateAssistant.length };
    if (lateAssistant.length > 0) {
      throw new E2eFailure('cancel did not prevent a final assistant/message: ' + compactValue(lateAssistant.map((f) => f.dataJson.event.seq), 200), detail);
    }
    if (!started) {
      throw new E2eFailure('turn finished before cancel could be applied (cancel effectiveness not observed)', detail);
    }
    return detail;
  }, { skip: fatal, severity: 'warn' });

  // ------------------------------------------------------------------
  // 8. SSE reconnect + re-open snapshot
  // ------------------------------------------------------------------
  await step('sse.reconnect-reopen', async () => {
    const oldSub = ctx.snapshot ? ctx.snapshot.subscriptionId : null;
    await ctx.sse.close();
    ctx.sse = ctx.client.events();
    ctx.sse.onFrame(recordFrame);
    await ctx.sse.connect();
    const hello = await ctx.sse.waitForEvent('hello', { timeoutMs: eventTimeout });
    assertEqual(hello.dataJson.protocol, 1, 'reconnect hello.protocol');
    const open = await ctx.client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/open', {
      body: { maxMessages: 60, assistantStream: true },
    });
    assertEqual(open.status, 200, 're-open status');
    const subId = open.body.subscriptionId;
    assertType(subId, 'string', 're-open subscriptionId');
    if (oldSub) assert(subId !== oldSub, 're-open should create a new subscriptionId');
    const snap = await ctx.sse.waitFor((f) => f.event === 'session.snapshot' && f.dataJson && f.dataJson.subscriptionId === subId, { timeoutMs: eventTimeout });
    assertArray(snap.dataJson.records, 'reconnect snapshot.records');
    assertEqual(snap.dataJson.sessionId, ctx.sessionId, 'reconnect snapshot.sessionId');
    return { oldSubscriptionId: oldSub, newSubscriptionId: subId, records: snap.dataJson.records.length, replayed: false };
  }, { skip: fatal, fatal: true });

  // ------------------------------------------------------------------
  // 9. rename + history + devices
  // ------------------------------------------------------------------
  await step('session.rename', async () => {
    const title = 'verifier-e2e-' + randomUUID().slice(0, 6);
    const r = await ctx.client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/rename', { body: { title } });
    assertEqual(r.status, 200, 'rename status');
    assertEqual(r.body.title, title, 'rename.title');
    assertType(r.body.seq, 'number', 'rename.seq');
    return { title: r.body.title, seq: r.body.seq };
  }, { skip: fatal, severity: 'warn' });

  await step('history.ascending', async () => {
    const r = await ctx.client.request('GET', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/history?maxMessages=20');
    assertEqual(r.status, 200, 'history status');
    assertArray(r.body.records, 'history.records');
    let last = -Infinity;
    for (const rec of r.body.records) {
      assert(rec.event && typeof rec.event.seq === 'number', 'history record event.seq missing');
      assert(rec.event.seq > last, 'history records not strictly ascending');
      last = rec.event.seq;
    }
    return { count: r.body.records.length, hasMore: r.body.hasMore, cursor: r.body.cursor };
  }, { skip: fatal, severity: 'warn' });

  await step('devices.list-current', async () => {
    const r = await ctx.client.request('GET', '/v1/devices');
    assertEqual(r.status, 200, 'devices status');
    assertArray(r.body.items, 'devices.items');
    const current = r.body.items.find((d) => d.current === true);
    assert(current, 'devices list must contain current=true');
    assert(!JSON.stringify(r.body).includes(ctx.client.token), 'devices response leaks token');
    return { count: r.body.items.length, currentDeviceId: current.deviceId };
  }, { skip: fatal });

  // ------------------------------------------------------------------
  // 10. device revocation -> 401 (must be last: invalidates our token)
  // ------------------------------------------------------------------
  await step('device.revoke-self-401', async () => {
    const me = await ctx.client.request('GET', '/v1/devices');
    const current = (me.body.items || []).find((d) => d.current === true);
    assert(current, 'cannot find current device to revoke');
    const del = await ctx.client.request('DELETE', '/v1/devices/' + encodeURIComponent(current.deviceId));
    assertEqual(del.status, 200, 'delete self status');
    assertEqual(del.body.removed, true, 'delete self removed');
    const after = await ctx.client.request('GET', '/v1/sessions');
    assertEqual(after.status, 401, 'post-revocation status');
    assertEqual(after.body.error && after.body.error.code, 'unauthorized', 'post-revocation error.code');
    const sseAfter = ctx.client.events();
    let caught = null;
    try { await sseAfter.connect(); } catch (e) { caught = e; }
    assert(caught, 'SSE after revocation must fail');
    assertEqual(caught.status, 401, 'post-revocation SSE status');
    return { revokedDeviceId: current.deviceId, status: after.status, code: after.body.error.code, sseStatus: caught.status };
  }, { skip: fatal, fatal: true });

  // ------------------------------------------------------------------
  // report
  // ------------------------------------------------------------------
  await ctx.sse.close().catch(() => {});
  await ctx.client.closeAllStreams().catch(() => {});
  if (child) {
    if (args['kill-on-exit']) {
      log('[teardown] killing host pid ' + child.pid);
      try {
        if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        else child.kill('SIGTERM');
      } catch (e) { log('[teardown] kill failed: ' + e.message); }
    }
  }

  const finishedAt = new Date();
  const counts = { pass: 0, fail: 0, warn: 0, skip: 0 };
  for (const r of RESULTS) counts[r.status] += 1;
  const ok = counts.fail === 0;
  const report = {
    tool: 'run-e2e.mjs',
    protocol: 1,
    command: [process.execPath, ...process.argv.slice(1)].join(' '),
    node: process.version,
    platform: process.platform + ' ' + process.arch,
    target: { baseUrl, mode: args['start-cmd'] ? 'spawn' : 'reuse', dshHome: args['dsh-home'] ? resolve(args['dsh-home']) : null, pairingSource: pairing.source, pairingPath: pairing.path, hostLogs },
    host: { hostId: ctx.hostId, dshVersion: ctx.health ? ctx.health.dshVersion : null, pluginVersion: ctx.health ? ctx.health.pluginVersion : null, deviceId: ctx.device ? ctx.device.deviceId : null, token: mask(ctx.client.token), sessionId: ctx.sessionId },
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Date.now() - startedMs,
    counts,
    ok,
    results: RESULTS,
    evidence: {
      timeline: evidence.timeline.slice(-60),
      assistantFrames: evidence.assistantFrames.slice(-20),
      snapshots: evidence.snapshots,
      userMessage: evidence.userMessage,
      assistantMessage: evidence.assistantMessage,
      sseFrameCount: evidence.sseFrames.length,
      eventCounts: evidence.eventCounts,
      rawUserMessage: evidence.rawUserMessage,
      rawAssistantMessage: evidence.rawAssistantMessage,
      injectedUserMessage: evidence.injectedUserMessage,
      hello: evidence.hello,
      requestLog: client.requestLog.map((e) => ({ method: e.method, path: e.path, status: e.status, durationMs: e.durationMs, error: e.error })),
    },
  };

  const jsonPath = resolve(args['json-out']);
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
  const reportPath = resolve(args.report);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, renderMarkdown(report));
  console.log('\n' + JSON.stringify(counts) + ' -> ' + jsonPath + ', ' + reportPath);
  if (!ok) process.exitCode = 1;
  return report;
}

function renderMarkdown(report) {
  const L = [];
  L.push('# DSH Remote 端到端矩阵报告（协议客户端 vs 真实 DSH 宿主）');
  L.push('');
  L.push('- 生成时间：' + report.finishedAt + '（本地 ' + new Date(report.finishedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) + '）');
  L.push('- 目标宿主：' + report.target.baseUrl + '（' + (report.target.mode === 'spawn' ? '由本脚本启动' : '复用 Lead 启动的宿主') + '）');
  if (report.target.dshHome) L.push('- DSH_HOME：' + report.target.dshHome);
  L.push('- 配对信息：' + (report.target.pairingPath ? report.target.pairingPath : '命令行 --code/--token') + (report.target.pairingSource ? '（' + report.target.pairingSource + '）' : ''));
  L.push('- 命 令：' + BT + report.command + BT);
  L.push('- 环境：node ' + report.node + ' / ' + report.platform);
  const dshVersion = (report.host && report.host.dshVersion) || 'unknown';
  const pluginVersion = (report.host && report.host.pluginVersion) || 'unknown';
  L.push('- 真实宿主：DSH ' + dshVersion + '，插件 dsh-remote ' + pluginVersion + (dshVersion === 'unknown' ? '（health.dshVersion 返回 unknown：bridge.hostInfo 未暴露，Lead 已接受；协议 §9 记录 DSH 0.2.2-rc.1）' : ''));
  L.push('- hostId：' + (report.host.hostId || '-') + '，sessionId：' + (report.host.sessionId || '-') + '，deviceId：' + (report.host.deviceId || '-'));
  L.push('- 耗时：' + (report.durationMs / 1000).toFixed(1) + ' s');
  L.push('- 结果：**' + (report.ok ? 'PASS' : 'FAIL') + '** — pass ' + report.counts.pass + ' / fail ' + report.counts.fail + ' / warn ' + report.counts.warn + ' / skip ' + report.counts.skip);
  L.push('');
  L.push('## 断言矩阵');
  L.push('');
  L.push('| # | 断言 | 结果 | 耗时(ms) | 证据 / 说明 |');
  L.push('|---|---|---|---|---|');
  report.results.forEach((r, i) => {
    const detail = r.status === 'skip' ? (r.reason || '') : (r.status === 'pass' ? compact(r.detail, 220) : (r.error || ''));
    L.push('| ' + (i + 1) + ' | ' + BT + r.name + BT + ' | ' + badge(r.status) + ' | ' + (r.durationMs || 0) + ' | ' + escapeCell(detail) + ' |');
  });
  L.push('');
  L.push('## SSE 证据');
  L.push('');
  L.push('- 收到用户消息：' + (report.evidence.userMessage ? BT + compact(report.evidence.userMessage.text, 160) + BT + '（seq ' + report.evidence.userMessage.seq + '）' : '无'));
  L.push('- 收到助手最终消息：' + (report.evidence.assistantMessage ? compact(report.evidence.assistantMessage.text, 240) + '（seq ' + report.evidence.assistantMessage.seq + '）' : '无'));
  L.push('- assistant 流式帧样本数：' + report.evidence.assistantFrames.length + '，SSE 帧总数：' + report.evidence.sseFrameCount);
  L.push('- 快照：' + (report.evidence.snapshots.length ? report.evidence.snapshots.map((s) => s.subscriptionId + ' (' + s.records + ' records)').join('；') : '无'));
  L.push('');
  if (report.evidence.timeline.length) {
    L.push('### 会话事件时间线（末尾 ' + report.evidence.timeline.length + ' 条）');
    L.push('');
    L.push('| 时间 | 类型 | seq | 摘要 |');
    L.push('|---|---|---|---|');
    for (const t of report.evidence.timeline) L.push('| ' + t.at + ' | ' + BT + t.type + BT + ' | ' + (t.seq === undefined ? '-' : t.seq) + ' | ' + escapeCell(compact(t.summary, 140)) + ' |');
    L.push('');
  }
  L.push('## 原始 wire 样本（供 App 协议复核）');
  L.push('');
  L.push('- SSE 事件计数：' + (Object.keys(report.evidence.eventCounts || {}).length ? Object.entries(report.evidence.eventCounts).map(([k, v]) => BT + k + BT + '=' + v).join('，') : '无'));
  L.push('- hello：' + BT + compact(report.evidence.hello, 500) + BT);
  L.push('');
  L.push('### user/message 原始 data');
  L.push('');
  L.push(BT + BT + BT + 'json');
  L.push(String(report.evidence.rawUserMessage || '(none)'));
  L.push(BT + BT + BT);
  L.push('');
  L.push('### assistant/message 原始 data');
  L.push('');
  L.push(BT + BT + BT + 'json');
  L.push(String(report.evidence.rawAssistantMessage || '(none)'));
  L.push(BT + BT + BT);
  L.push('');
  L.push('### session.assistant 帧样本（协议 §9.1）');
  L.push('');
  L.push(BT + BT + BT + 'json');
  L.push((report.evidence.assistantFrames || []).slice(0, 6).map((f) => f.frame).join(String.fromCharCode(10)) || '(none)');
  L.push(BT + BT + BT);
  L.push('');
  if (report.evidence.injectedUserMessage) {
    L.push('### 注入的 user/message 样本（协议 §9.2，App 必须过滤）');
    L.push('');
    L.push('- source.kind = ' + BT + String(report.evidence.injectedUserMessage.sourceKind) + BT + '，seq ' + report.evidence.injectedUserMessage.seq);
    L.push('');
    L.push(BT + BT + BT + 'text');
    L.push(String(report.evidence.injectedUserMessage.text || '').slice(0, 500));
    L.push(BT + BT + BT);
    L.push('');
  }
  L.push('## 请求日志');
  L.push('');
  L.push('| 方法 | 路径 | 状态 | 耗时(ms) |');
  L.push('|---|---|---|---|');
  for (const q of report.evidence.requestLog) L.push('| ' + q.method + ' | ' + BT + q.path + BT + ' | ' + (q.status === undefined ? (q.error ? 'ERR' : '-') : q.status) + ' | ' + (q.durationMs || 0) + ' |');
  L.push('');
  L.push('## 复现命令');
  L.push('');
  L.push(BT + BT + BT + 'bat');
  L.push(report.command);
  L.push(BT + BT + BT);
  L.push('');
  if (!report.ok) {
    L.push('## 失败项');
    L.push('');
    for (const r of report.results.filter((x) => x.status === 'fail')) {
      L.push('### ' + r.name);
      L.push('');
      L.push(BT + BT + BT + 'text');
      L.push(r.error || '');
      L.push(BT + BT + BT);
      L.push('');
    }
  }
  return L.join('\n');
}

function compact(value, maxLen) {
  if (value === undefined) return '';
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  const limit = maxLen || 160;
  return s.length > limit ? s.slice(0, limit - 3) + '...' : s;
}
function escapeCell(s) { return String(s === undefined || s === null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' '); }
function badge(status) {
  if (status === 'pass') return '✅ PASS';
  if (status === 'fail') return '❌ FAIL';
  if (status === 'warn') return '⚠️ WARN';
  return '⏭️ SKIP';
}

main().catch((e) => {
  console.error('fatal: ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
