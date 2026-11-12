import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appendEvent,
  applyAssistantFrame,
  applySessionStatus,
  applySessionEventToRows,
  historyBoundary,
  emptyStreaming,
  streamingFromSnapshot,
  filterPendingByEvents,
  mergeEventLists,
  mergeApproval,
  modelFromEvent,
  modelFromProjections,
  removeApproval,
  removeConfirmedPending,
  removeSessionRow,
  replaceEvents,
  runningFromEvent,
  titleFromEvent,
  titleFromProjections,
  upsertSessionRow,
} from '../state-updates.ts';

const ev = (type, seq, data) => ({ type, seq, time: 1763000000000, data });

test('joining a running DSH attempt restores its compact prefix before subsequent deltas', () => {
  const baseline = { activeAttempt: { attemptId: 'a', nextIndex: 5, stream: [
    { type: 'chunk', chunk: { type: 'block-start' } },
    { type: 'reasoning-chunks', texts: ['思考', '过程'] },
    { type: 'text-chunks', texts: ['已经', '输出'] },
  ] } };
  const prefix = streamingFromSnapshot(baseline);
  assert.equal(prefix.reasoning, '思考过程'); assert.equal(prefix.text, '已经输出');
  assert.equal(applyAssistantFrame(prefix, { type: 'chunk', attemptId: 'a', chunk: { type: 'text-delta', text: '后续' } }).text, '已经输出后续');
  assert.deepEqual(streamingFromSnapshot({ revision: 0 }), emptyStreaming());
});

test('partial status frames preserve omitted flags and cwd/model updates stay session-scoped', () => {
  const rows = [{ sessionId: 'a', active: false, running: true }, { sessionId: 'b', active: true }];
  assert.equal(applySessionStatus(rows, { sessionId: 'a' })[0].active, false);
  assert.equal(applySessionStatus(rows, { sessionId: 'a' })[0].running, true);
  const model = { provider: 'p', model: 'm' };
  const next = applySessionEventToRows(rows, 'a', ev('model/selection', 1, { next: model }));
  assert.deepEqual(next[0].model, model);
  assert.equal(next[1], rows[1]);
  assert.equal(historyBoundary([ev('x', 10), ev('x', 5)], 10), 5);
});

/* ------------------------------------------------------------- events */

test('appendEvent appends new seq and drops duplicates', () => {
  const first = ev('user/message', 1, {});
  const second = ev('assistant/message', 2, {});
  const events = appendEvent(appendEvent([], first), second);
  assert.equal(events.length, 2);
  const deduped = appendEvent(events, first);
  assert.equal(deduped, events, 'duplicate seq returns the same array');
  const deduped2 = appendEvent(events, ev('user/message', 2, {}));
  assert.equal(deduped2, events, 'replayed seq 2 is dropped');
});

test('appendEvent keeps out-of-order events with a new seq', () => {
  const events = [ev('user/message', 5, {})];
  const next = appendEvent(events, ev('assistant/message', 3, {}));
  assert.equal(next.length, 2);
});

test('appendEvent tolerates malformed values', () => {
  const events = [];
  assert.equal(appendEvent(events, null).length, 0);
  assert.equal(appendEvent(events, {}).length, 0);
  assert.equal(appendEvent(events, { type: 'user/message', seq: 1 }).length, 1);
});

test('replaceEvents keeps event records, sorts by seq and de-duplicates', () => {
  const records = [
    { type: 'event', event: ev('assistant/message', 9, {}) },
    { type: 'event', event: ev('user/message', 2, {}) },
    { type: 'event', event: ev('user/message', 2, {}) },
    { type: 'system/message', data: {} },
    null,
    { type: 'event' },
  ];
  const events = replaceEvents(records);
  assert.deepEqual(events.map((event) => event.seq), [2, 9]);
  assert.deepEqual(replaceEvents(undefined), []);
  assert.deepEqual(replaceEvents('nope'), []);
});

/* ---------------------------------------------------------- assistant */

test('real host frames: start, text-delta chunks, block-start, end', () => {
  const frame = (chunk, type = 'chunk') => ({
    type,
    attemptId: 'session:1',
    revision: 1,
    chunk,
  });
  let streaming = emptyStreaming();
  streaming = applyAssistantFrame(streaming, { type: 'start', attemptId: 'session:1' });
  assert.deepEqual(streaming, { attemptId: 'session:1', text: '', reasoning: '', active: true });
  streaming = applyAssistantFrame(streaming, frame({ type: 'block-start', index: 0, blockType: 'text' }));
  assert.equal(streaming.text, '');
  streaming = applyAssistantFrame(streaming, frame({ type: 'text-delta', index: 0, text: 'PO' }));
  streaming = applyAssistantFrame(streaming, frame({ type: 'text-delta', index: 0, text: 'NG' }));
  assert.equal(streaming.text, 'PONG');
  assert.equal(streaming.active, true);
  streaming = applyAssistantFrame(streaming, { type: 'end', attemptId: 'session:1' });
  assert.equal(streaming.active, false);
  assert.equal(streaming.text, 'PONG', 'text survives turn end for the final message swap');
});

test('reference mock frames: assistant-stream phases with delta text', () => {
  let streaming = emptyStreaming();
  streaming = applyAssistantFrame(streaming, { type: 'assistant-stream', phase: 'start', attempt: 'attempt-1' });
  assert.equal(streaming.attemptId, 'attempt-1');
  streaming = applyAssistantFrame(streaming, {
    type: 'assistant-stream',
    phase: 'chunk',
    attempt: 'attempt-1',
    delta: { text: 'Mock ' },
  });
  streaming = applyAssistantFrame(streaming, {
    type: 'assistant-stream',
    phase: 'chunk',
    attempt: 'attempt-1',
    delta: { text: 'reply' },
  });
  assert.equal(streaming.text, 'Mock reply');
  assert.equal(streaming.active, true);
  streaming = applyAssistantFrame(streaming, { type: 'assistant-stream', phase: 'end', attempt: 'attempt-1' });
  assert.equal(streaming.active, false);
});

test('reasoning deltas accumulate separately and unknown frames are ignored', () => {
  let streaming = emptyStreaming();
  streaming = applyAssistantFrame(streaming, {
    type: 'chunk',
    attemptId: 'a',
    chunk: { type: 'reasoning-delta', text: 'think' },
  });
  assert.equal(streaming.reasoning, 'think');
  assert.equal(streaming.text, '');
  const unchanged = applyAssistantFrame(streaming, { type: 'usage', chunk: { type: 'usage' } });
  assert.equal(unchanged.text, '');
  assert.equal(applyAssistantFrame(null, null).active, false);
});

/* ------------------------------------------------------ optimistic user */

test('drops pending bubbles confirmed by a matching rpcId', () => {
  const pending = [
    { requestId: 'rpc-1', text: 'one', time: 1, status: 'sending' },
    { requestId: 'rpc-2', text: 'two', time: 2, status: 'failed' },
  ];
  const event = ev('user/message', 3, { source: { kind: 'user', rpcId: 'rpc-1' } });
  assert.deepEqual(removeConfirmedPending(pending, event).map((item) => item.requestId), ['rpc-2']);
});

test('keeps pending bubbles for injected messages and unrelated events', () => {
  const pending = [{ requestId: 'rpc-1', text: 'one', time: 1, status: 'sending' }];
  assert.equal(removeConfirmedPending(pending, ev('user/message', 1, { source: { kind: 'runtime-context' } })).length, 1);
  assert.equal(removeConfirmedPending(pending, ev('assistant/message', 2, {})).length, 1);
  assert.equal(removeConfirmedPending(pending, null).length, 1);
});

test('snapshot history fills in pending bubbles (P1-2)', () => {
  const pending = [
    { requestId: 'rpc-1', text: 'confirmed', time: 1, status: 'sending' },
    { requestId: 'rpc-2', text: 'still pending', time: 2, status: 'failed' },
  ];
  const events = [
    ev('user/message', 1, { source: { kind: 'user', rpcId: 'rpc-1' } }),
    ev('user/message', 2, { source: { kind: 'runtime-context' } }),
  ];
  assert.deepEqual(filterPendingByEvents(pending, events).map((item) => item.requestId), ['rpc-2']);
  assert.equal(filterPendingByEvents(pending, []).length, 2);
});

test('history paging merges events by seq without duplicates', () => {
  const older = [ev('user/message', 1, {}), ev('assistant/message', 2, {})];
  const newer = [ev('assistant/message', 2, {}), ev('user/message', 3, {})];
  const merged = mergeEventLists(older, newer);
  assert.deepEqual(merged.map((event) => event.seq), [1, 2, 3]);
  assert.deepEqual(mergeEventLists([], []), []);
});

/* ----------------------------------------------------------- approvals */

test('approvals are upserted and removable', () => {
  let list = [];
  list = mergeApproval(list, { id: 'apr_1', tool: 'pwsh' });
  assert.equal(list.length, 1);
  list = mergeApproval(list, { id: 'apr_1', displayReason: '执行命令' });
  assert.equal(list.length, 1);
  assert.equal(list[0].displayReason, '执行命令');
  assert.equal(mergeApproval(list, null).length, 1);
  assert.deepEqual(removeApproval(list, 'apr_1'), []);
});

/* ------------------------------------------------------------ sessions */

test('session rows upsert at the top and stay unique', () => {
  const rows = [{ sessionId: 'b' }, { sessionId: 'a' }];
  const added = upsertSessionRow(rows, { sessionId: 'c', title: 'C' });
  assert.deepEqual(added.map((row) => row.sessionId), ['c', 'b', 'a']);
  const updated = upsertSessionRow(rows, { sessionId: 'a', title: 'A2' });
  assert.deepEqual(updated.map((row) => row.sessionId), ['b', 'a']);
  assert.equal(updated[1].title, 'A2');
  assert.deepEqual(removeSessionRow(rows, 'b').map((row) => row.sessionId), ['a']);
});

test('session.status updates only the matching row', () => {
  const rows = [
    { sessionId: 'a', running: false, active: true },
    { sessionId: 'b', running: false, active: true },
  ];
  const next = applySessionStatus(rows, { sessionId: 'b', running: true, active: false });
  assert.equal(next[0].running, false);
  assert.equal(next[1].running, true);
  assert.equal(next[1].active, false);
  assert.equal(applySessionStatus(rows, null), rows);
});

/* --------------------------------------------------------- projections */

test('reads title and model from snapshot projections', () => {
  const projections = {
    values: {
      title: '修复登录 bug',
      modelSelection: { next: { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' } },
    },
  };
  assert.equal(titleFromProjections(projections), '修复登录 bug');
  assert.deepEqual(modelFromProjections(projections), {
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
    reasoningEffort: 'high',
  });
  assert.equal(titleFromProjections(null), undefined);
  assert.equal(modelFromProjections({ values: { title: 'x' } }), undefined);
});

test('reads model from the reference host projection shape', () => {
  const projections = { modelSelection: { next: { provider: 'p', model: 'm' } } };
  assert.deepEqual(modelFromProjections(projections), { provider: 'p', model: 'm' });
});

test('reads title/model/running hints from session events', () => {
  assert.equal(titleFromEvent(ev('session/title', 4, { title: 'T' })), 'T');
  assert.deepEqual(modelFromEvent(ev('model/selection', 5, { provider: 'p', model: 'm' })), {
    provider: 'p',
    model: 'm',
  });
  assert.equal(modelFromEvent(ev('model/selection', 5, { next: { provider: 'p', model: 'm' } })).provider, 'p');
  assert.equal(runningFromEvent(ev('turn/start', 6, { turn: 1 })), true);
  assert.equal(runningFromEvent(ev('turn/end', 7, { turn: 1 })), false);
  assert.equal(runningFromEvent(ev('assistant/message', 8, {})), undefined);
});
