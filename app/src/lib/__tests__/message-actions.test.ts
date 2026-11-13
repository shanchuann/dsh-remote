import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTranscript } from '../transcript.ts';
import { messageTimeLabel, messageUsageLabel } from '../message-metadata.ts';

test('usage labels preserve zero counts, prefer the recorded total, and distinguish missing telemetry', () => {
  assert.equal(messageUsageLabel({ totalTokens: 13_600_000 }), '用量 13.6M tok');
  assert.equal(messageUsageLabel({ totalTokens: 1088, inputTokens: 1, outputTokens: 2 }), '用量 1.1K tok');
  assert.equal(messageUsageLabel({ inputTokens: 1024, outputTokens: 64 }), '用量 1.1K tok');
  assert.equal(messageUsageLabel({ totalTokens: 0 }), '用量 0 tok');
  assert.equal(messageUsageLabel({ inputTokens: 1024 }), '用量未记录');
  assert.equal(messageUsageLabel(), '用量未记录');
});

test('visible timestamps show only local hours and minutes and omit invalid values', () => {
  assert.equal(messageTimeLabel(new Date(2026, 10, 6, 19, 28).getTime()), '19:28');
  assert.equal(messageTimeLabel(0), undefined);
  assert.equal(messageTimeLabel(NaN), undefined);
});

test('message actions retain exact event cuts, timestamps and real usage only', () => {
  const rows = buildTranscript([{ type: 'assistant/message', seq: 42, time: 1234567, data: {
    message: { id: 'answer', content: [{ type: 'text', text: '回复' }] },
    usage: { inputTokens: 200, outputTokens: 0, cacheReadTokens: 15, invalid: -1, strange: '7' },
  } }]);
  const answer = rows[0];
  assert.equal(answer.kind, 'assistant');
  if (answer.kind !== 'assistant') return;
  assert.equal(answer.seq, 42);
  assert.equal(answer.time, 1234567);
  assert.deepEqual(answer.usage, { inputTokens: 200, outputTokens: 0, cacheReadTokens: 15 });
  const unknown = buildTranscript([{ type: 'assistant/message', seq: 43, data: { message: { content: [{ type: 'text', text: '无计量' }] } } }])[0];
  if (unknown.kind === 'assistant') assert.equal(unknown.usage, undefined);
});
