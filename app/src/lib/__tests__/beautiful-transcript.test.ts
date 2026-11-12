import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupToolRuns } from '../../components/chat/beautiful/transcript-groups.ts';
import type { TranscriptItem } from '../transcript.ts';

const call = (id: string, status: 'running' | 'ok' | 'error' = 'running'): TranscriptItem => ({
  kind: 'tool', id, callId: id, name: 'shell', status, time: 1,
});

test('groups only adjacent calls and keeps messages, tasks and approvals in order', () => {
  const user: TranscriptItem = { kind: 'user', id: 'user', text: '运行检查', time: 1 };
  const approval: TranscriptItem = { kind: 'approval', id: 'approval', approval: { id: 'approve' } };
  const tasks: TranscriptItem = { kind: 'todo', id: 'tasks', items: [], time: 1 };
  const input = [user, call('a'), call('b'), approval, call('c'), tasks, call('d')];
  const before = JSON.stringify(input);
  const grouped = groupToolRuns(input);
  assert.deepEqual(grouped.map((item) => item.kind), ['user', 'tools', 'approval', 'tools', 'todo', 'tools']);
  assert.equal(grouped[1].kind, 'tools');
  if (grouped[1].kind === 'tools') assert.deepEqual(grouped[1].items.map((item) => item.id), ['a', 'b']);
  assert.equal(JSON.stringify(input), before);
});

test('status updates retain group identity and carry the latest real output', () => {
  const first = groupToolRuns([call('a'), call('b')]);
  const last = groupToolRuns([{ ...call('a', 'error'), result: 'permission denied' } as TranscriptItem, call('b', 'ok')]);
  assert.equal(first[0].id, last[0].id);
  if (last[0].kind === 'tools') {
    assert.equal(last[0].items[0].result, 'permission denied');
    assert.equal(last[0].items[0].status, 'error');
    assert.equal(last[0].items[1].status, 'ok');
  }
});


test('long tool-only turns stay in bounded native rows without dropping calls', () => {
  const grouped = groupToolRuns(Array.from({ length: 73 }, (_, i) => call(String(i))));
  assert.equal(grouped.length, 10);
  assert.equal(grouped.reduce((n, group) => n + (group.kind === 'tools' ? group.items.length : 0), 0), 73);
  assert.ok(grouped.every(group => group.kind === 'tools' && group.items.length <= 8));
});
