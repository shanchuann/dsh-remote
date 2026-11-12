import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStore } from 'zustand/vanilla';
import { sourceLoader } from './load-source.mjs';

const load = sourceLoader();
const { RemoteClient } = load('client');
const { SseConnection } = load('sse');
const { ApiError } = load('errors');
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const event = (seq, type = 'assistant/message', data = {}) => ({ type, seq, data });
const records = (...seqs) => seqs.map((seq) => ({ type: 'event', event: event(seq) }));

function harness() {
  let token = 'saved-token';
  let meta = { baseUrl: 'http://localhost:18890', deviceId: 'phone', deviceName: '测试手机' };
  class FakeClient {
    static latest;
    static healthError;
    constructor() { FakeClient.latest = this; this.handlers = new Map(); this.closed = []; this.opened = []; }
    on(kind, callback) { const list = this.handlers.get(kind) ?? new Set(); list.add(callback); this.handlers.set(kind, list); return () => list.delete(callback); }
    emit(kind, data) { for (const callback of this.handlers.get(kind) ?? []) callback(data); }
    async health() { if (FakeClient.healthError) throw FakeClient.healthError; return { protocol: 1 }; }
    async host() { return { name: 'fixture', hostId: 'host' }; }
    async listSessions() { return { items: [{ sessionId: 'a', cwd: 'D:/old', active: true }, { sessionId: 'b', cwd: 'D:/other' }] }; }
    async models() { return {}; }
    async getSession() { return { header: { cwd: 'D:/old' }, state: { active: false, running: false } }; }
    async openSession(id) { this.opened.push(id); }
    async closeSession(id) { this.closed.push(id); }
    async answerApproval() { return { resolved: true }; }
    async history() { return { records: [], hasMore: false }; }
    connectEvents() {}
    disconnect() { this.disconnected = true; }
  }
  const config = {
    loadToken: async () => token, clearToken: async () => { token = null; }, saveToken: async (value) => { token = value; },
    loadConnectionMeta: async () => meta, clearConnectionMeta: async () => { meta = null; }, saveConnectionMeta: async (value) => { meta = value; },
    defaultDeviceName: () => '测试手机', appVersion: () => 'test', platformName: () => 'android', getClientTimeZone: () => 'UTC',
  };
  const { useRemoteStore: store, getActiveToken } = sourceLoader({
    './client': { RemoteClient: FakeClient }, './config': config,
    zustand: { create: () => (init) => createStore(init) },
  })('store');
  return { store, actions: store.getState().actions, FakeClient, token: () => token, getActiveToken };
}

test('HTTP deadline covers a stalled response body for REST and pairing', async () => {
  let aborted = 0;
  const fetchImpl = async (_url, options) => {
    options.signal.addEventListener('abort', () => aborted++);
    return { ok: true, status: 200, text: () => new Promise(() => {}) };
  };
  const client = new RemoteClient({ baseUrl: 'http://localhost', fetchImpl, timeoutMs: 20 });
  await assert.rejects(client.health(), (error) => error.code === 'timeout');
  await assert.rejects(RemoteClient.pair('http://localhost', '123456', 'phone', { fetchImpl, timeoutMs: 20 }), (error) => error.code === 'timeout');
  assert.equal(aborted, 2);
});

test('HTTP auth rejection is announced before a stalled error body', async () => {
  const client = new RemoteClient({ baseUrl: 'http://localhost', timeoutMs: 20,
    fetchImpl: async () => ({ status: 401, ok: false, text: () => new Promise(() => {}) }) });
  let unauthorized = 0;
  client.on('unauthorized', () => unauthorized++);
  await assert.rejects(client.host(), (error) => error.code === 'unauthorized' && error.status === 401);
  assert.equal(unauthorized, 1);
});

test('SSE jitter never exceeds the configured maximum', () => {
  const delays = [];
  const connection = new SseConnection({ url: 'http://localhost', onMessage() {}, randomFn: () => 1,
    setTimeoutFn: (_callback, delay) => { delays.push(delay); return 1; }, clearTimeoutFn() {} });
  for (let i = 0; i < 15; i++) connection.scheduleReconnect();
  assert.equal(Math.max(...delays), 30000);
  assert.equal(delays[0], 1200);
  connection.close();
});

test('client forwards subscription closure with its session identity', () => {
  const client = new RemoteClient({ baseUrl: 'http://localhost' });
  let closed;
  client.on('subscriptionClosed', (payload) => { closed = payload; });
  client.dispatchSseMessage({ event: 'subscription.closed', data: JSON.stringify({ sessionId: 'a', subscriptionId: 'sub-a', reason: 'stream-error' }) });
  assert.equal(closed.sessionId, 'a');
  assert.equal(closed.reason, 'stream-error');
});

test('restore clears an invalid token and requests pairing', async () => {
  const h = harness();
  h.FakeClient.healthError = new ApiError(401, 'unauthorized');
  assert.equal(await h.actions.restore(), false);
  assert.equal(h.token(), null);
  assert.equal(h.getActiveToken(), null);
  assert.equal(h.store.getState().connection.needsPairing, true);
});

test('refresh stores the complete project catalog with all session pages and clears it on disconnect or legacy host', async () => {
  const h = harness();
  await h.actions.restore();
  const client = h.FakeClient.latest;
  const workspaces = Array.from({ length: 17 }, (_, i) => ({ id: 'w' + i, path: 'D:/project-' + i }));
  const cursors = [];
  client.listSessions = async ({ cursor }) => {
    cursors.push(cursor);
    return cursor ? { items: [{ sessionId: 'last', workspaceId: 'w16' }], nextCursor: null }
      : { items: [{ sessionId: 'first', workspaceId: 'w0' }], nextCursor: '100', workspaces };
  };
  await h.actions.refreshSessions();
  assert.deepEqual(cursors, [undefined, '100']);
  assert.deepEqual(h.store.getState().workspaces, workspaces);
  assert.deepEqual(h.store.getState().sessions.map((row) => row.sessionId), ['first', 'last']);
  client.listSessions = async () => ({ items: [] });
  await h.actions.refreshSessions();
  assert.equal(h.store.getState().workspaces, undefined);
  client.listSessions = async () => ({ items: [], workspaces });
  await h.actions.refreshSessions();
  await h.actions.disconnect();
  assert.equal(h.store.getState().workspaces, undefined);
  assert.deepEqual(h.store.getState().sessions, []);
});

test('opening gets current active state; cwd/title events update both chat and project rows', async () => {
  const h = harness(); await h.actions.restore(); await h.actions.openSession('a');
  const client = h.FakeClient.latest;
  assert.equal(h.store.getState().current.active, false);
  client.emit('event', { sessionId: 'a', event: event(2, 'working-directory/change', { cwd: 'D:/new-project' }) });
  client.emit('event', { sessionId: 'a', event: event(3, 'session/title', { title: '新标题' }) });
  assert.equal(h.store.getState().current.cwd, 'D:/new-project');
  assert.equal(h.store.getState().sessions[0].cwd, 'D:/new-project');
  assert.equal(h.store.getState().sessions[0].title, '新标题');
});

test('history starts before the oldest snapshot record and progresses without gaps', async () => {
  const h = harness(); await h.actions.restore(); await h.actions.openSession('a');
  const client = h.FakeClient.latest;
  client.emit('snapshot', { sessionId: 'a', records: records(100, 101, 102), cursor: 102, hasMore: true });
  client.history = async (_id, options) => {
    assert.equal(options.beforeSeq, 99);
    return { records: records(97, 98, 99), cursor: 99, hasMore: true };
  };
  await h.actions.loadOlderHistory();
  assert.equal(h.store.getState().current.cursor, 97);
  assert.deepEqual(h.store.getState().current.events.map((event) => event.seq), [97, 98, 99, 100, 101, 102]);
});

test('late history response cannot enter another session or a reopened instance', async () => {
  const h = harness(); await h.actions.restore(); await h.actions.openSession('a');
  const client = h.FakeClient.latest;
  client.emit('snapshot', { sessionId: 'a', records: records(100), hasMore: true });
  const wait = deferred(); client.history = () => wait.promise;
  const older = h.actions.loadOlderHistory();
  await h.actions.openSession('b'); await h.actions.openSession('a');
  wait.resolve({ records: records(1), hasMore: false }); await older;
  assert.equal(h.store.getState().current.events.length, 0);
});

test('late detail response cannot reopen a session after navigating away', async () => {
  const h = harness(); await h.actions.restore();
  const client = h.FakeClient.latest; const wait = deferred(); client.getSession = () => wait.promise;
  const opening = h.actions.openSession('a'); await h.actions.closeSession();
  wait.resolve({}); await opening;
  assert.deepEqual(client.opened, []);
});

test('unexpected subscription closure stops busy state without deleting content', async () => {
  const h = harness(); await h.actions.restore(); await h.actions.openSession('a');
  const client = h.FakeClient.latest;
  client.emit('assistant', { sessionId: 'a', frame: { type: 'chunk', chunk: { type: 'text-delta', text: '保留回复' } } });
  client.emit('subscriptionClosed', { sessionId: 'a', subscriptionId: 's', reason: 'stream-error' });
  const state = h.store.getState().current;
  assert.equal(state.streaming.text, '保留回复'); assert.equal(state.streaming.active, false);
  assert.equal(state.loading, false); assert.equal(state.running, false);
  assert.ok(state.error);
});

test('resolved approvals leave both global and current queues without requiring SSE echo', async () => {
  const h = harness(); await h.actions.restore(); await h.actions.openSession('a');
  h.FakeClient.latest.emit('approval', { id: 'ask', sessionId: 'a' });
  await h.actions.answerApproval('ask', 'allow');
  assert.equal(h.store.getState().approvals.length, 0);
  await h.actions.closeSession(); await h.actions.openSession('a');
  assert.equal(h.store.getState().current.pendingApprovals.length, 0);
});

test('a final state frame flushes buffered assistant deltas before stopping the stream', async () => {
  const h = harness(); await h.actions.restore(); await h.actions.openSession('a');
  h.FakeClient.latest.emit('assistant', { sessionId: 'a', frame: { type: 'chunk', chunk: { type: 'text-delta', text: '完整尾句' } } });
  h.FakeClient.latest.emit('state', { sessionId: 'a', state: { running: false } });
  const current = h.store.getState().current;
  assert.equal(current.streaming.text, '完整尾句');
  assert.equal(current.streaming.active, false);
  assert.equal(current.active, false);
});


test('task projections survive a truncated snapshot and receive real team/todo updates', async () => {
  const h = harness(); await h.actions.restore(); await h.actions.openSession('a');
  const c = h.FakeClient.latest;
  c.emit('snapshot', { sessionId: 'a', records: records(100), projections: { values: {
    todos: [{ content: '执行验证', status: 'in_progress' }],
    agentTeam: { tasks: [{ id: 'task-1', subject: '适配手机端', status: 'pending', revision: 2 }] },
  } } });
  assert.equal(h.store.getState().current.todos[0].content, '执行验证');
  assert.equal(h.store.getState().current.teamTasks.length, 1);
  c.emit('event', { sessionId: 'a', event: event(101, 'team/task', { task: { id: 'task-1', subject: '适配手机端', status: 'completed', revision: 3 } }) });
  c.emit('event', { sessionId: 'a', event: event(102, 'team/task', { task: { id: 'task-1', subject: '过期消息', status: 'pending', revision: 1 } }) });
  assert.equal(h.store.getState().current.teamTasks[0].status, 'completed');
  c.emit('event', { sessionId: 'a', event: event(103, 'todo/write', { todos: [] }) });
  assert.deepEqual(h.store.getState().current.todos, { todos: [] });
  c.emit('event', { sessionId: 'a', event: event(104, 'turn/start') });
  assert.equal(h.store.getState().current.todos, undefined);
  assert.equal(h.store.getState().current.teamTasks.length, 1);
  await h.actions.disconnect();
});
