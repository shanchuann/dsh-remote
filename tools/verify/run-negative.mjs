#!/usr/bin/env node
/**
 * DSH Remote protocol v1 — negative / contract test suite.
 *
 * Targets either:
 *   --mock                     start tools/verify/mock-server.mjs in-process (default)
 *   --url <baseUrl> --code <c>  run against a real (isolated) DSH host
 *   --url <baseUrl> --token <t> reuse an existing device token
 *
 * Usage:
 *   node tools/verify/run-negative.mjs --mock
 *   node tools/verify/run-negative.mjs --url http://127.0.0.1:8790 --code 123456 --skip-lockout
 *   node tools/verify/run-negative.mjs --mock --include-rate-limit --json tools/verify/.negative.json
 *
 * Outputs a JSON report and a markdown report (default docs/verification/negative-report.md).
 * Exit code 0 only when no hard failures.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DshRemoteClient, ProtocolError, sleep } from './protocol-client.mjs';
import { startMockServer } from './mock-server.mjs';

class AssertionFailure extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'AssertionFailure';
    this.detail = detail;
  }
}

function assert(cond, message, detail) {
  if (!cond) throw new AssertionFailure(message, detail);
}

function assertEqual(actual, expected, label) {
  if (!Object.is(actual, expected)) {
    throw new AssertionFailure(label + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual), { expected, actual });
  }
}

function assertArray(value, label) {
  assert(Array.isArray(value), label + ': expected an array, got ' + typeof value, { actual: value });
}

function assertType(value, type, label) {
  assert(typeof value === type, label + ': expected type ' + type + ', got ' + typeof value, { actual: value });
}

const results = [];
async function runTest(name, fn, opts = {}) {
  if (opts.skip) {
    results.push({ name, status: 'skip', reason: opts.skip, durationMs: 0 });
    console.log('SKIP ' + name + ' :: ' + opts.skip);
    return;
  }
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, status: 'pass', detail, durationMs: Date.now() - started });
    console.log('PASS ' + name);
  } catch (e) {
    const status = opts.severity === 'warn' ? 'warn' : 'fail';
    results.push({
      name, status,
      error: e && e.message ? e.message : String(e),
      detail: e && e.detail !== undefined ? e.detail : undefined,
      durationMs: Date.now() - started,
    });
    console.log((status === 'fail' ? 'FAIL ' : 'WARN ') + name + ' :: ' + (e && e.message ? e.message : e));
    if (opts.verbose && e && e.stack) console.log(e.stack);
  }
}

function assertApiError(r, options = {}) {
  const status = options.status;
  const code = options.code;
  const where = options.label || (r && r.path) || 'request';
  const allowed = status === undefined ? null : (Array.isArray(status) ? status : [status]);
  if (allowed) {
    assert(allowed.includes(r.status), where + ': expected HTTP ' + allowed.join('/') + ', got ' + r.status + ' (body=' + String(r.bodyText).slice(0, 300) + ')', { expectedStatus: allowed, actualStatus: r.status });
  }
  assert(r.body && typeof r.body === 'object', where + ': response is not JSON (body=' + String(r.bodyText).slice(0, 300) + ')');
  assert(r.body.error && typeof r.body.error === 'object', where + ': missing error envelope, body=' + JSON.stringify(r.body).slice(0, 300));
  assertType(r.body.error.code, 'string', where + '.error.code');
  assertType(r.body.error.message, 'string', where + '.error.message');
  if (code) assertEqual(r.body.error.code, code, where + '.error.code');
  assert(!/\bat\s+\S+\.m?js:\d+/.test(r.bodyText) && !/"stack"\s*:/.test(r.bodyText), where + ': error response leaks a stack trace');
  return r.body.error;
}

function textOfEvent(event) {
  if (!event || typeof event !== 'object') return '';
  const data = event.data || {};
  const parts = [];
  const walk = (content) => {
    if (!Array.isArray(content)) return;
    for (const c of content) if (c && typeof c.text === 'string') parts.push(c.text);
  };
  if (event.type === 'user/message') walk(data.content);
  else if (event.type === 'assistant/message') walk(data.message && data.message.content);
  return parts.join('\n');
}

async function waitUntil(fn, timeoutMs = 5000, intervalMs = 50) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      mock: { type: 'boolean', default: false },
      url: { type: 'string' },
      port: { type: 'string' },
      code: { type: 'string' },
      code2: { type: 'string' },
      token: { type: 'string' },
      'pairing-json': { type: 'string' },
      'dsh-home': { type: 'string' },
      json: { type: 'string', default: 'tools/verify/.negative-report.json' },
      report: { type: 'string', default: 'docs/verification/negative-report.md' },
      'skip-lockout': { type: 'boolean', default: false },
      'skip-heartbeat': { type: 'boolean', default: false },
      'skip-prompt-side-effects': { type: 'boolean', default: false },
      'include-revoke': { type: 'boolean', default: false },
      'include-rate-limit': { type: 'boolean', default: false },
      'oversize-bytes': { type: 'string', default: '26214400' },
      timeout: { type: 'string', default: '20000' },
      'heartbeat-timeout': { type: 'string', default: '20000' },
      'turn-wait': { type: 'string', default: '5000' },
      verbose: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  const startedAt = new Date();
  const startedMs = Date.now();
  const log = args.quiet ? () => {} : (...a) => console.log(...a);

  function readPairing() {
    const candidates = [];
    if (args['pairing-json']) candidates.push(resolve(args['pairing-json']));
    if (args['dsh-home']) candidates.push(resolve(args['dsh-home'], 'plugins', 'dsh-remote', 'pairing.json'));
    for (const p of candidates) {
      if (!existsSync(p)) continue;
      try {
        const j = JSON.parse(readFileSync(p, 'utf8'));
        return { path: p, code: typeof j.pairingCode === 'string' ? j.pairingCode : null, port: typeof j.port === 'number' ? j.port : null };
      } catch { /* try next */ }
    }
    return { path: null, code: null, port: null };
  }
  const pairing = readPairing();
  const pairingCodePath = args['pairing-json'] ? resolve(args['pairing-json']) : (args['dsh-home'] ? resolve(args['dsh-home'], 'plugins', 'dsh-remote', 'pairing.json') : null);

  let mock = null;
  let baseUrl;
  let pairCode = args.code || pairing.code;
  if (args.mock) {
    if (!pairCode) pairCode = '246810';
    mock = await startMockServer({ port: 0, code: pairCode, heartbeatMs: 300, assistantDelayMs: 25, quiet: true });
    baseUrl = mock.baseUrl;
    log('[setup] mock host at ' + baseUrl + ' code=' + pairCode);
  } else {
    baseUrl = args.url || (args.port ? 'http://127.0.0.1:' + args.port : null) || (pairing.port ? 'http://127.0.0.1:' + pairing.port : '');
    assert(baseUrl, 'either --mock or --url/--port/--pairing-json is required');
    log('[setup] target host at ' + baseUrl);
  }

  const timeoutMs = Number(args.timeout);
  const client = new DshRemoteClient({ baseUrl, token: args.token || '', timeoutMs });
  const bare = new DshRemoteClient({ baseUrl, timeoutMs });
  const oversizeBytes = Number(args['oversize-bytes']);
  const turnWait = Number(args['turn-wait']);
  const heartbeatTimeout = Number(args['heartbeat-timeout']);

  const ctx = { client, bare, baseUrl, pairCode, mock, timeoutMs, sessionId: null, health: null, host: null, deviceId: null };

  const setup = { startedAt: new Date().toISOString(), steps: [] };
  try {
    const health = await client.health();
    ctx.health = health.body;
    setup.steps.push({ step: 'health', ok: health.status === 200 });
    if (!client.token) {
      assert(pairCode, 'no --token and no --code: cannot pair');
      const pair = await client.pair({ code: pairCode, deviceName: 'verifier-negative', platform: 'android', appVersion: '0.1.0' });
      ctx.deviceId = pair.body.deviceId;
      setup.steps.push({ step: 'pair', ok: pair.status === 200, deviceId: pair.body.deviceId });
    }
    const host = await client.host();
    ctx.host = host.body;
    setup.steps.push({ step: 'host', ok: host.status === 200 });
    let created = await client.request('POST', '/v1/sessions', { body: { agentPreset: 'standard' } });
    if (created.status !== 200 && created.status !== 201) created = await client.request('POST', '/v1/sessions', { body: {} });
    assert((created.status === 200 || created.status === 201) && created.body && typeof created.body.sessionId === 'string',
      'setup: POST /v1/sessions failed (HTTP ' + created.status + '): ' + String(created.bodyText).slice(0, 300));
    ctx.sessionId = created.body.sessionId;
    setup.steps.push({ step: 'create-session', ok: true, sessionId: ctx.sessionId });
    setup.ok = true;
  } catch (e) {
    setup.ok = false;
    setup.error = e && e.message ? e.message : String(e);
    console.error('[setup] FAILED: ' + setup.error);
  }

  const skipAll = setup.ok ? null : 'setup failed: ' + setup.error;

  await runTest('health.public', async () => {
    const r = await bare.request('GET', '/v1/health');
    assertEqual(r.status, 200, 'health status');
    assertEqual(r.body.ok, true, 'health.ok');
    assertEqual(r.body.protocol, 1, 'health.protocol');
    assertType(r.body.hostId, 'string', 'health.hostId');
    assertType(r.body.time, 'number', 'health.time');
    assertType(r.body.pluginVersion, 'string', 'health.pluginVersion');
    assertType(r.body.dshVersion, 'string', 'health.dshVersion');
    assert(/application\/json/.test(String(r.contentType)), 'health content-type must be JSON, got ' + r.contentType);
    return { hostId: r.body.hostId, pluginVersion: r.body.pluginVersion, dshVersion: r.body.dshVersion, pairingRequired: r.body.pairingRequired };
  }, { skip: skipAll });

  await runTest('host.shape-and-no-token-leak', async () => {
    const r = await client.request('GET', '/v1/host');
    assertEqual(r.status, 200, 'host status');
    assertEqual(r.body.protocol, 1, 'host.protocol');
    assertEqual(r.body.hostId, ctx.health.hostId, 'host.hostId matches health');
    assertType(r.body.name, 'string', 'host.name');
    assertArray(r.body.devices, 'host.devices');
    assert(r.body.devices.length > 0, 'host.devices must include at least the current device');
    const current = r.body.devices.find((d) => d.current === true);
    assert(current, 'host.devices must contain an entry with current=true');
    const caps = r.body.capabilities;
    assert(caps && typeof caps === 'object', 'host.capabilities missing');
    for (const key of ['assistantStream', 'approvals', 'models', 'images']) {
      assertType(caps[key], 'boolean', 'capabilities.' + key);
    }
    const serialized = JSON.stringify(r.body);
    assert(!serialized.includes(client.token), 'GET /v1/host leaks the device token');
    return { hostId: r.body.hostId, capabilities: caps, devices: r.body.devices.length };
  }, { skip: skipAll });

  await runTest('sessions.list.shape', async () => {
    const r = await client.request('GET', '/v1/sessions?limit=30');
    assertEqual(r.status, 200, 'sessions status');
    assertArray(r.body.items, 'sessions.items');
    assert(r.body.nextCursor === null || typeof r.body.nextCursor === 'string', 'nextCursor must be null or string');
    for (const item of r.body.items) {
      assertType(item.sessionId, 'string', 'item.sessionId');
      assertType(item.createdAt, 'number', 'item.createdAt');
      assertType(item.updatedAt, 'number', 'item.updatedAt');
      for (const key of ['running', 'active', 'blank', 'agentAvailable']) {
        assertType(item[key], 'boolean', 'item.' + key);
      }
      assert(item.model === null || typeof item.model === 'object', 'item.model must be null or object');
      assert(item.lastMessage === null || typeof item.lastMessage === 'object', 'item.lastMessage must be null or object');
    }
    return { count: r.body.items.length, nextCursor: r.body.nextCursor };
  }, { skip: skipAll });

  await runTest('session.detail.shape', async () => {
    const r = await client.request('GET', '/v1/sessions/' + encodeURIComponent(ctx.sessionId));
    assertEqual(r.status, 200, 'session status');
    assertEqual(r.body.sessionId, ctx.sessionId, 'session.sessionId');
    assert(r.body.header && typeof r.body.header === 'object', 'session.header missing');
    assert(r.body.state && typeof r.body.state === 'object', 'session.state missing');
    assertType(r.body.state.active, 'boolean', 'state.active');
    assertType(r.body.state.running, 'boolean', 'state.running');
    assert(Array.isArray(r.body.state.queue), 'state.queue must be an array');
    assert(Array.isArray(r.body.state.pendingInput), 'state.pendingInput must be an array');
    return { title: r.body.title, state: r.body.state, hasProjections: !!r.body.projections };
  }, { skip: skipAll });

  await runTest('history.shape-ascending', async () => {
    const r = await client.request('GET', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/history?maxMessages=10');
    assertEqual(r.status, 200, 'history status');
    assertArray(r.body.records, 'history.records');
    assertType(r.body.hasMore, 'boolean', 'history.hasMore');
    assert(r.body.cursor === null || typeof r.body.cursor === 'number', 'history.cursor must be null or number');
    let lastSeq = -Infinity;
    for (const rec of r.body.records) {
      assertEqual(rec.type, 'event', 'record.type');
      assert(rec.event && typeof rec.event === 'object', 'record.event missing');
      assertType(rec.event.type, 'string', 'event.type');
      assertType(rec.event.seq, 'number', 'event.seq');
      assertType(rec.event.time, 'number', 'event.time');
      assert(rec.event.seq > lastSeq, 'history records must be strictly ascending by seq');
      lastSeq = rec.event.seq;
    }
    return { count: r.body.records.length, hasMore: r.body.hasMore, cursor: r.body.cursor };
  }, { skip: skipAll });

  await runTest('devices.shape-no-token', async () => {
    const r = await client.request('GET', '/v1/devices');
    assertEqual(r.status, 200, 'devices status');
    assertArray(r.body.items, 'devices.items');
    const current = r.body.items.find((d) => d.current === true);
    assert(current, 'devices must contain current=true');
    assertType(current.deviceId, 'string', 'device.deviceId');
    assertType(current.name, 'string', 'device.name');
    assertType(current.createdAt, 'number', 'device.createdAt');
    assertType(current.lastSeenAt, 'number', 'device.lastSeenAt');
    assert(!JSON.stringify(r.body).includes(client.token), 'GET /v1/devices leaks the device token');
    return { count: r.body.items.length };
  }, { skip: skipAll });

  await runTest('models.catalog.shape', async () => {
    const r = await client.request('GET', '/v1/models');
    assertEqual(r.status, 200, 'models status');
    assert(r.body && typeof r.body === 'object', 'models must be an object');
    assertArray(r.body.groups, 'models.groups');
    assertArray(r.body.routableProviders, 'models.routableProviders');
    assert(r.body.default === null || typeof r.body.default === 'object', 'models.default must be null or object');
    assertArray(r.body.failures, 'models.failures');
    return { groups: r.body.groups.length, providers: r.body.routableProviders.length };
  }, { skip: skipAll });

  await runTest('auth.missing-token-401', async () => {
    const r = await bare.request('GET', '/v1/sessions');
    assertApiError(r, { status: 401, code: 'unauthorized', label: 'GET /v1/sessions without token' });
    return { status: r.status, code: r.body.error.code };
  }, { skip: skipAll });

  await runTest('auth.bad-token-401', async () => {
    const bad = new DshRemoteClient({ baseUrl, token: 'a'.repeat(64), timeoutMs });
    const r = await bad.request('GET', '/v1/host');
    assertApiError(r, { status: 401, code: 'unauthorized', label: 'GET /v1/host with bogus token' });
    return { status: r.status, code: r.body.error.code };
  }, { skip: skipAll });

  await runTest('auth.sse-bad-token-401', async () => {
    const bad = new DshRemoteClient({ baseUrl, token: 'b'.repeat(64), timeoutMs });
    const sse = bad.events();
    let caught = null;
    try { await sse.connect(); } catch (e) { caught = e; }
    assert(caught, 'SSE connect with bad token must fail');
    assertEqual(caught.status, 401, 'SSE bad-token status');
    assertEqual(caught.code, 'unauthorized', 'SSE bad-token code');
    await sse.close();
    return { status: caught.status, code: caught.code };
  }, { skip: skipAll });

  await runTest('auth.sse-query-token-only', async () => {
    const sse = client.events({ tokenInQuery: true, authHeader: false });
    await sse.connect();
    const hello = await sse.waitForEvent('hello', { timeoutMs: 8000 });
    assertEqual(hello.dataJson.protocol, 1, 'hello.protocol');
    await sse.close();
    return { protocol: hello.dataJson.protocol };
  }, { skip: skipAll });

  await runTest('json.malformed-prompt', async () => {
    const r = await client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/prompt', {
      body: '{"requestId": ',
      headers: { 'Content-Type': 'application/json' },
    });
    assertApiError(r, { status: 400, code: 'invalid-argument', label: 'malformed JSON prompt' });
    return { status: r.status, code: r.body.error.code };
  }, { skip: skipAll });

  await runTest('json.malformed-open', async () => {
    const r = await client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/open', {
      body: 'not-json-at-all',
      headers: { 'Content-Type': 'application/json' },
    });
    assertApiError(r, { status: 400, code: 'invalid-argument', label: 'malformed JSON open' });
    return { status: r.status, code: r.body.error.code };
  }, { skip: skipAll });

  await runTest('body.too-large-rejected', async () => {
    const filler = 'a'.repeat(Math.max(1024, oversizeBytes));
    const body = '{"requestId":"' + randomUUID() + '","content":[{"type":"text","text":"' + filler + '"}]}';
    const r = await client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/prompt', {
      body,
      headers: { 'Content-Type': 'application/json' },
      timeoutMs: Math.max(timeoutMs, 60000),
    });
    const allowedStatus = [400, 413, 414, 431];
    assert(allowedStatus.includes(r.status), 'oversized body: expected HTTP 400/413/414/431, got ' + r.status + ' (body=' + String(r.bodyText).slice(0, 200) + ')');
    if (r.body && r.body.error) {
      assertType(r.body.error.code, 'string', 'oversized.error.code');
      assertEqual(r.body.error.code, 'invalid-argument', 'oversized.error.code');
    }
    const health = await client.request('GET', '/v1/health');
    assertEqual(health.status, 200, 'host still healthy after oversized body');
    return { status: r.status, sentBytes: body.length };
  }, { skip: skipAll });

  await runTest('prompt.content-empty-rejected', async () => {
    const r = await client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/prompt', {
      body: { requestId: randomUUID(), content: [] },
    });
    assertApiError(r, { status: 400, code: 'invalid-argument', label: 'empty content' });
    return { status: r.status, code: r.body.error.code };
  }, { skip: skipAll });

  await runTest('prompt.text-not-string-rejected', async () => {
    const r = await client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/prompt', {
      body: { requestId: randomUUID(), content: [{ type: 'text', text: 42 }] },
    });
    assertApiError(r, { status: 400, code: 'invalid-argument', label: 'text part non-string' });
    return { status: r.status, code: r.body.error.code };
  }, { skip: skipAll });

  await runTest('prompt.mode-invalid-rejected', async () => {
    const r = await client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/prompt', {
      body: { requestId: randomUUID(), mode: 'bogus-mode', content: [{ type: 'text', text: 'x' }] },
    });
    assertApiError(r, { status: 400, code: 'invalid-argument', label: 'invalid mode' });
    return { status: r.status, code: r.body.error.code };
  }, { skip: skipAll });

  const missingId = 'session-verifier-missing-' + randomUUID();
  await runTest('session.unknown-get-404', async () => {
    const r = await client.request('GET', '/v1/sessions/' + encodeURIComponent(missingId));
    assertApiError(r, { status: 404, code: 'session-not-found', label: 'GET unknown session' });
    return { status: r.status, code: r.body.error.code };
  }, { skip: skipAll });

  await runTest('session.unknown-prompt-404', async () => {
    const r = await client.request('POST', '/v1/sessions/' + encodeURIComponent(missingId) + '/prompt', {
      body: { requestId: randomUUID(), content: [{ type: 'text', text: 'hello?' }] },
    });
    assertApiError(r, { status: 404, code: 'session-not-found', label: 'prompt unknown session' });
    return { status: r.status, code: r.body.error.code };
  }, { skip: skipAll });

  await runTest('session.unknown-open-404', async () => {
    const r = await client.request('POST', '/v1/sessions/' + encodeURIComponent(missingId) + '/open', { body: { maxMessages: 10 } });
    assertApiError(r, { status: 404, code: 'session-not-found', label: 'open unknown session' });
    return { status: r.status, code: r.body.error.code };
  }, { skip: skipAll });

  await runTest('session.unknown-cancel-404', async () => {
    const r = await client.request('POST', '/v1/sessions/' + encodeURIComponent(missingId) + '/cancel', { body: {} });
    assertApiError(r, { status: 404, code: 'session-not-found', label: 'cancel unknown session' });
    return { status: r.status, code: r.body.error.code };
  }, { skip: skipAll });

  await runTest('prompt.invalid-timezone-400', async () => {
    // Agreed 2026-11-11: DSH's clientTimeZone validation error is client input
    // error -> 400 invalid-argument (this exact value used to break the App on
    // devices whose Intl timezone is "GMT").
    const r = await client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/prompt', {
      body: { requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: 'timezone-probe ' + Date.now() }], clientTimeZone: 'GMT' },
    });
    assertApiError(r, { status: 400, code: 'invalid-argument', label: 'prompt clientTimeZone=GMT' });
    const ok = await client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/prompt', {
      body: { requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: 'timezone-probe-utc ' + Date.now() }], clientTimeZone: 'UTC' },
    });
    assertEqual(ok.status, 200, 'valid clientTimeZone=UTC still accepted');
    assertEqual(ok.body.accepted, true, 'valid clientTimeZone=UTC accepted');
    await client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/cancel', { body: {} }).catch(() => {});
    return { status: r.status, code: r.body.error.code, utcStatus: ok.status };
  }, { skip: skipAll ? skipAll : (args.mock ? 'mock does not validate clientTimeZone' : null) });

  await runTest('model.unknown-provider-400', async () => {
    // Agreed 2026-11-11: DSH's "Select an available model" validation error is
    // client input error -> 400 invalid-argument (not 500 internal).
    const r = await client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/model', {
      body: { provider: 'verifier-no-such-provider', model: 'no-such-model' },
    });
    assertApiError(r, { status: 400, code: 'invalid-argument', label: 'selectModel unknown provider' });
    const detail = await client.request('GET', '/v1/sessions/' + encodeURIComponent(ctx.sessionId));
    assertEqual(detail.status, 200, 'session still readable after rejected model selection');
    return { status: r.status, code: r.body.error.code };
  }, { skip: skipAll ? skipAll : (args.mock ? 'mock does not validate the model catalog' : null) });

  await runTest('approval.unknown-410', async () => {
    const r = await client.request('POST', '/v1/approvals/apr_missing_' + randomUUID(), { body: { decision: 'allow' } });
    assertApiError(r, { status: 410, code: 'approval-gone', label: 'answer unknown approval' });
    return { status: r.status, code: r.body.error.code };
  }, { skip: skipAll });

  await runTest('route.unknown-404-envelope', async () => {
    const r = await client.request('GET', '/v1/definitely-not-a-route');
    assert([404, 405].includes(r.status), 'unknown route: expected 404/405, got ' + r.status);
    assertApiError(r, { label: 'unknown route' });
    return { status: r.status, code: r.body.error.code };
  }, { skip: skipAll });

  await runTest('method.not-allowed-envelope', async () => {
    const r = await client.request('DELETE', '/v1/sessions');
    assert([404, 405].includes(r.status), 'DELETE /v1/sessions: expected 404/405, got ' + r.status);
    assertApiError(r, { label: 'DELETE /v1/sessions' });
    return { status: r.status, code: r.body.error.code };
  }, { skip: skipAll });

  await runTest('sse.hello-shape', async () => {
    const sse = client.events();
    await sse.connect();
    const hello = await sse.waitForEvent('hello', { timeoutMs: 8000 });
    assertEqual(hello.dataJson.protocol, 1, 'hello.protocol');
    assertEqual(hello.dataJson.hostId, ctx.health.hostId, 'hello.hostId');
    assertType(hello.dataJson.serverTime, 'number', 'hello.serverTime');
    assertArray(hello.dataJson.subscriptions, 'hello.subscriptions');
    await sse.close();
    return { protocol: hello.dataJson.protocol, subscriptions: hello.dataJson.subscriptions.length };
  }, { skip: skipAll });

  await runTest('sse.snapshot-on-open', async () => {
    const sse = client.events();
    await sse.connect();
    try {
      await sse.waitForEvent('hello', { timeoutMs: 8000 });
      const open = await client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/open', {
        body: { maxMessages: 20, assistantStream: true },
      });
      assertEqual(open.status, 200, 'open status');
      const subId = open.body.subscriptionId;
      assertType(subId, 'string', 'open.subscriptionId');
      const snap = await sse.waitFor((f) => f.event === 'session.snapshot' && f.dataJson && f.dataJson.subscriptionId === subId, { timeoutMs: 10000 });
      assertEqual(snap.dataJson.sessionId, ctx.sessionId, 'snapshot.sessionId');
      assert(snap.dataJson.header && typeof snap.dataJson.header === 'object', 'snapshot.header missing');
      assertArray(snap.dataJson.records, 'snapshot.records');
      assertType(snap.dataJson.hasMore, 'boolean', 'snapshot.hasMore');
      return { subscriptionId: subId, records: snap.dataJson.records.length };
    } finally {
      await client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/close', { body: {} }).catch(() => {});
      await sse.close();
    }
  }, { skip: skipAll });

  await runTest('sse.connection-replaced', async () => {
    const first = client.events();
    await first.connect();
    await first.waitForEvent('hello', { timeoutMs: 8000 });
    const second = client.events();
    await second.connect();
    try {
      const replaced = await first.waitForEvent('connection.replaced', { timeoutMs: 10000 });
      assert(replaced.dataJson !== undefined || replaced.data !== '', 'connection.replaced payload missing');
      const closed = await waitUntil(() => first.closed, 5000);
      assert(closed, 'old SSE connection must be closed by the server after replacement');
      const hello2 = await second.waitForEvent('hello', { timeoutMs: 8000 });
      assertEqual(hello2.dataJson.protocol, 1, 'second hello.protocol');
      return { replacedPayload: replaced.dataJson ?? replaced.data };
    } finally {
      await first.close().catch(() => {});
      await second.close().catch(() => {});
    }
  }, { skip: skipAll });

  await runTest('sse.heartbeat-ping', async () => {
    const sse = client.events();
    await sse.connect();
    try {
      const ping = await sse.waitForEvent('ping', { timeoutMs: heartbeatTimeout });
      assertType(ping.dataJson.t, 'number', 'ping.t');
      return { intervalHintMs: heartbeatTimeout, pingAt: new Date(ping.receivedAt).toISOString() };
    } finally {
      await sse.close();
    }
  }, { skip: args['skip-heartbeat'] ? '--skip-heartbeat' : skipAll });

  await runTest('session.close-idempotent', async () => {
    const a = await client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/close', { body: {} });
    const b = await client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/close', { body: {} });
    assertEqual(a.status, 200, 'first close status');
    assertEqual(a.body.closed, true, 'first close.closed');
    assertEqual(b.status, 200, 'second close status');
    assertEqual(b.body.closed, true, 'second close.closed');
    return { first: a.body, second: b.body };
  }, { skip: skipAll });

  await runTest('cancel.idle-idempotent', async () => {
    const create = await client.request('POST', '/v1/sessions', { body: {} });
    assert(create.status === 200 || create.status === 201, 'create session status: expected 200/201, got ' + create.status);
    const id = create.body.sessionId;
    const a = await client.request('POST', '/v1/sessions/' + encodeURIComponent(id) + '/cancel', { body: {} });
    const b = await client.request('POST', '/v1/sessions/' + encodeURIComponent(id) + '/cancel', { body: {} });
    assertEqual(a.status, 200, 'cancel status');
    assertEqual(a.body.accepted, true, 'cancel.accepted');
    assertEqual(b.status, 200, 'second cancel status');
    assertEqual(b.body.accepted, true, 'second cancel.accepted');
    return { accepted: a.body.accepted };
  }, { skip: skipAll });

  await runTest('prompt.idempotent-requestId', async () => {
    const sse = client.events();
    await sse.connect();
    try {
      await sse.waitForEvent('hello', { timeoutMs: 8000 });
      await client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/open', { body: { maxMessages: 5, assistantStream: true } });
      const rid = randomUUID();
      const text = 'verifier-idempotency-probe-' + rid;
      const body = { requestId: rid, mode: 'queue', content: [{ type: 'text', text }] };
      const r1 = await client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/prompt', { body });
      const r2 = await client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/prompt', { body });
      assertEqual(r1.status, 200, 'first prompt status');
      assertEqual(r2.status, 200, 'duplicate prompt status');
      assertEqual(r1.body.accepted, true, 'first prompt accepted');
      assertEqual(r2.body.accepted, true, 'duplicate prompt accepted');
      assertEqual(r2.body.requestId, rid, 'duplicate prompt echoes requestId');
      await sleep(turnWait);
      const matches = sse.frames.filter((f) => f.event === 'session.event' && f.dataJson && f.dataJson.event
        && f.dataJson.event.type === 'user/message' && textOfEvent(f.dataJson.event).includes(text));
      assertEqual(matches.length, 1, 'duplicate requestId must enqueue exactly one prompt (user/message count)');
      return { requestId: rid, userMessageEvents: matches.length };
    } finally {
      await sse.close();
    }
  }, { skip: args['skip-prompt-side-effects'] ? '--skip-prompt-side-effects' : skipAll });

  await runTest('prompt.unknown-fields-tolerated', async () => {
    const rid = randomUUID();
    const text = 'verifier-forward-compat-' + rid;
    const r = await client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/prompt', {
      body: {
        requestId: rid, mode: 'queue', content: [{ type: 'text', text }],
        clientTimeZone: 'Asia/Shanghai', someUnknownField: { nested: [1, 2, 3] }, anotherOne: 'x',
      },
    });
    assertEqual(r.status, 200, 'forward-compat prompt status');
    assertEqual(r.body.accepted, true, 'forward-compat prompt accepted');
    await client.request('POST', '/v1/sessions/' + encodeURIComponent(ctx.sessionId) + '/cancel', { body: {} }).catch(() => {});
    return { status: r.status, requestId: r.body.requestId };
  }, { skip: args['skip-prompt-side-effects'] ? '--skip-prompt-side-effects' : skipAll });

  function currentPairingCode() {
    if (args.code2) return args.code2;
    if (mock) return mock.pairingCode();
    if (!pairingCodePath || !existsSync(pairingCodePath)) return null;
    try {
      const j = JSON.parse(readFileSync(pairingCodePath, 'utf8'));
      return typeof j.pairingCode === 'string' ? j.pairingCode : null;
    } catch { return null; }
  }
  await runTest('device.revoke-invalidates-token', async () => {
    const revokeCode = currentPairingCode();
    assert(revokeCode, 'no second pairing code available');
    const victim = new DshRemoteClient({ baseUrl, timeoutMs });
    const pair = await victim.pair({ code: revokeCode, deviceName: 'verifier-revoke-victim', platform: 'android', appVersion: '0.1.0' });
    assertEqual(pair.status, 200, 'second pair status');
    const victimDeviceId = pair.body.deviceId;
    const before = await victim.request('GET', '/v1/sessions');
    assertEqual(before.status, 200, 'victim token works before revocation');
    const del = await client.request('DELETE', '/v1/devices/' + encodeURIComponent(victimDeviceId));
    assertEqual(del.status, 200, 'delete device status');
    assertEqual(del.body.removed, true, 'delete device removed');
    const after = await victim.request('GET', '/v1/sessions');
    assertApiError(after, { status: 401, code: 'unauthorized', label: 'revoked token request' });
    const list = await client.request('GET', '/v1/devices');
    assert(!list.body.items.some((d) => d.deviceId === victimDeviceId), 'revoked device must disappear from GET /v1/devices');
    const owner = await client.request('GET', '/v1/sessions');
    assertEqual(owner.status, 200, 'owner token still works after revoking another device');
    return { victimDeviceId, revokedStatus: after.status };
  }, {
    skip: skipAll ? skipAll
      : (!args['include-revoke'] && !mock && !args.code2 && !pairingCodePath) ? 'no --code2/--pairing-json and --include-revoke not set'
      : null,
  });

  const actualCode = pairCode || (mock ? mock.code : null);
  await runTest('pair.wrong-code-401', async () => {
    const wrong = actualCode ? String((Number(actualCode) + 1) % 1000000).padStart(6, '0') : '000000';
    const r = await bare.request('POST', '/v1/pair', { body: { code: wrong, deviceName: 'verifier-wrong-code', platform: 'android' } });
    assertApiError(r, { status: 401, code: 'pairing-invalid', label: 'pair with wrong code' });
    return { status: r.status, code: r.body.error.code };
  }, { skip: skipAll });

  await runTest('pair.lockout-429', async () => {
    const wrong = '000001';
    let last = null;
    for (let i = 0; i < 4; i++) {
      last = await bare.request('POST', '/v1/pair', { body: { code: wrong, deviceName: 'verifier-lockout', platform: 'android' } });
      if (last.status === 429) break;
    }
    assertApiError(last, { status: 429, code: 'pairing-locked', label: 'pair lockout' });
    return { status: last.status, code: last.body.error.code };
  }, { skip: skipAll ? skipAll : (args['skip-lockout'] ? '--skip-lockout' : null) });

  await runTest('rate.limit-429', async () => {
    const rlMock = await startMockServer({ port: 0, code: '246810', rateLimit: true, quiet: true });
    try {
      const c = new DshRemoteClient({ baseUrl: rlMock.baseUrl, timeoutMs });
      await c.pair({ code: '246810', deviceName: 'verifier-rate', platform: 'android' });
      const responses = await Promise.all(Array.from({ length: 80 }, () => c.request('GET', '/v1/sessions')));
      const limited = responses.filter((x) => x.status === 429);
      assert(limited.length > 0, 'expected at least one 429 under 80-request burst (got ' + responses.map((x) => x.status).join(',') + ')');
      assertApiError(limited[0], { status: 429, code: 'rate-limited', label: 'rate limited request' });
      return { burst: responses.length, limited: limited.length };
    } finally {
      await rlMock.close();
    }
  }, { skip: skipAll ? skipAll : (!args.mock ? 'mock-only test' : (!args['include-rate-limit'] ? '--include-rate-limit not set' : null)) });

  const finishedAt = new Date();
  const counts = { pass: 0, fail: 0, warn: 0, skip: 0 };
  for (const r of results) counts[r.status] += 1;
  const report = {
    tool: 'run-negative.mjs',
    protocol: 1,
    target: { mode: args.mock ? 'mock' : 'host', baseUrl, sessionId: ctx.sessionId, hostId: ctx.health ? ctx.health.hostId : null },
    command: [process.execPath, ...process.argv.slice(1)].join(' '),
    node: process.version,
    platform: process.platform + ' ' + process.arch,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Date.now() - startedMs,
    setup,
    counts,
    ok: counts.fail === 0 && !!setup.ok,
    results,
  };

  const jsonPath = resolve(args.json);
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
  const reportPath = resolve(args.report);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, renderMarkdown(report));
  console.log('\n' + JSON.stringify(counts) + ' -> ' + jsonPath + ', ' + reportPath);
  if (!report.ok) process.exitCode = 1;

  if (mock) await mock.close();
  return report;
}

const BT = String.fromCharCode(96);

function renderMarkdown(report) {
  const L = [];
  L.push('# DSH Remote 负向 / 协议契约测试报告');
  L.push('');
  L.push('- 生成时间：' + report.finishedAt + '（本地 ' + new Date(report.finishedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) + '）');
  L.push('- 目标：' + (report.target.mode === 'mock' ? 'mock 参考宿主' : '真实 DSH 宿主') + ' ' + report.target.baseUrl);
  L.push('- 命令：' + BT + report.command + BT);
  L.push('- 环境：node ' + report.node + ' / ' + report.platform);
  L.push('- 耗时：' + (report.durationMs / 1000).toFixed(1) + ' s');
  L.push('- 结果：**' + (report.ok ? 'PASS' : 'FAIL') + '** — pass ' + report.counts.pass + ' / fail ' + report.counts.fail + ' / warn ' + report.counts.warn + ' / skip ' + report.counts.skip);
  L.push('');
  L.push('## 用例结果');
  L.push('');
  L.push('| # | 用例 | 结果 | 耗时(ms) | 说明 |');
  L.push('|---|---|---|---|---|');
  report.results.forEach((r, i) => {
    const detail = r.status === 'skip' ? (r.reason || '') : (r.status === 'pass' ? compact(r.detail) : (r.error || ''));
    L.push('| ' + (i + 1) + ' | ' + BT + r.name + BT + ' | ' + badge(r.status) + ' | ' + (r.durationMs || 0) + ' | ' + escapeCell(detail) + ' |');
  });
  L.push('');
  L.push('## 说明');
  L.push('');
  L.push('- 断言目标为 docs/protocol.md（协议 v1）语义；mock 为一比一参考实现，真实宿主结果以本表为准。');
  L.push('- 错误响应必须为 { error: { code, message } } 且 code 在协议错误码表内；本套件同时断言错误响应不泄露堆栈。');
  L.push('- 超大体按实现允许 400/413/414/431，但若返回 JSON 错误体则 code 必须为 invalid-argument。');
  L.push('- pair.lockout-429 会锁定配对 5 分钟：真实宿主默认跳过（--skip-lockout），mock 默认执行。');
  L.push('- device.revoke-invalidates-token 需要第二个配对码（mock 自动取轮换后的 code；真实宿主用 --code2）。');
  L.push('');
  L.push('## 复现命令');
  L.push('');
  L.push(BT + BT + BT + 'bat');
  L.push(report.command);
  L.push(BT + BT + BT);
  L.push('');
  return L.join('\n');
}

function compact(value) {
  if (value === undefined) return '';
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > 160 ? s.slice(0, 157) + '...' : s;
}

function escapeCell(s) {
  return String(s === undefined || s === null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

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
