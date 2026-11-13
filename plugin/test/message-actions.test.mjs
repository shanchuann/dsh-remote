import test from 'node:test';
import assert from 'node:assert/strict';
import { DshBridge } from '../src/dsh/bridge.mjs';
import { pairDevice, request, startHarness } from './helpers/harness.mjs';

test('authenticated forks preserve the exact cut and are idempotent across double taps', async () => {
  const h = await startHarness();
  try {
    const calls = [];
    h.bridge.forkSession = async (id, options) => { calls.push({ id, options }); return { sessionId: 'branch' }; };
    const p = await pairDevice(h);
    const body = { atSeq: 42, requestId: 'one-tap' };
    const send = (payload = body, token = p.token) => request(h.baseUrl, '/v1/sessions/session-1/fork', { method: 'POST', token, body: payload });
    assert.equal((await send(body, 'invalid-token')).status, 401);
    const results = await Promise.all([send(), send()]);
    assert.ok(results.every(r => r.status === 200 && r.body.sessionId === 'branch'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.atSeq, 42);
    assert.equal((await send({ ...body, atSeq: 1.5 })).status, 400);
    assert.equal((await send({ ...body, atSeq: -1 })).status, 400);
  } finally { await h.close(); }
});

test('feedback forwards version checks, retraction and committed errors', async () => {
  const calls = [];
  const feedback = {
    list: async () => ({ ok: true, value: { items: [{ messageId: 'a', rating: 'positive', version: 'v1' }] } }),
    put: async body => { calls.push(body); return { ok: true, value: { ...body, version: 'v2' } }; },
    delete: async body => { calls.push(body); return { ok: false, error: { code: 'version-conflict' } }; },
  };
  const bridge = new DshBridge({ get: name => name === 'messageFeedback' ? feedback : undefined }, {});
  const h = await startHarness();
  h.bridge.messageFeedback = bridge.messageFeedback.bind(bridge);
  try {
    const p = await pairDevice(h);
    const path = '/v1/sessions/session-1/feedback';
    assert.equal((await request(h.baseUrl, path, { token: p.token })).body.items[0].version, 'v1');
    const body = { messageId: 'a', rating: 'negative', ifVersion: 'v1' };
    assert.equal((await request(h.baseUrl, path, { method: 'POST', token: p.token, body })).body.version, 'v2');
    assert.deepEqual(calls[0], { sessionId: 'session-1', ...body });
    const conflict = await request(h.baseUrl, path, { method: 'POST', token: p.token, body: { ...body, rating: null } });
    assert.equal(conflict.status, 409);
    assert.equal((await request(h.baseUrl, path, { method: 'POST', token: p.token, body: { ...body, rating: 'fake' } })).status, 400);
  } finally { await h.close(); }
});
