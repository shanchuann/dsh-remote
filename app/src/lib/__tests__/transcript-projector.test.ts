import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTranscript, createTranscriptProjector, type SessionEventLike } from '../transcript.ts';

const event = (seq: number, text: string): SessionEventLike => ({ seq, time: seq, type: 'assistant/message', data: { message: { id: 'a' + seq, content: [{ type: 'text', text }] } } });

test('streaming projector preserves transcript semantics and completed row identity across deltas', () => {
  const project = createTranscriptProjector();
  const events = [event(1, '历史消息')];
  const options = { pending: [{ requestId: 'pending', text: '待确认', time: 10 }] };
  const first = project(events, { text: '新回复', active: true }, options);
  for (const text of ['新回复正在输出', '新回复正在输出更多内容']) {
    const stream = { text, reasoning: '思考内容', active: true };
    const next = project(events, stream, options);
    assert.deepEqual(next, buildTranscript(events, stream, options));
    assert.equal(next[0], first[0]);
  }
  const finished = [...events, event(2, '新回复')];
  assert.deepEqual(project(finished, { text: '新回复', active: false }), buildTranscript(finished, { text: '新回复', active: false }));
  assert.deepEqual(project([], null), []);
});

test('history is not read again for live frames; image preview changes invalidate it', () => {
  let reads = 0;
  const value = event(1, '历史');
  const tracked = new Proxy(value, { get(target, key, receiver) { reads++; return Reflect.get(target, key, receiver); } });
  const events = [tracked];
  const project = createTranscriptProjector();
  project(events, null);
  const initialReads = reads;
  for (let n = 0; n < 100; n++) project(events, { text: 'x'.repeat(n), active: true });
  assert.equal(reads, initialReads);
  project(events, null, { imagePreviews: {} });
  assert.ok(reads > initialReads);
});
