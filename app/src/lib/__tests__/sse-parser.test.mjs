import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseSseText, SseParser } from '../sse-parser.ts';

test('parses a single complete frame', () => {
  const messages = parseSseText('id: 42\nevent: session.event\ndata: {"a":1}\n\n');
  assert.deepEqual(messages, [{ id: '42', event: 'session.event', data: '{"a":1}' }]);
});

test('buffers a frame split across chunks', () => {
  const parser = new SseParser();
  assert.deepEqual(parser.push('event: session.ev'), []);
  assert.deepEqual(parser.push('ent\ndata: {"x":'), []);
  assert.deepEqual(parser.push('"y"}\n\n'), [
    { event: 'session.event', data: '{"x":"y"}' },
  ]);
});

test('handles CRLF line endings and multiple events in one chunk', () => {
  const messages = parseSseText(
    'event: ping\r\ndata: {"t":1}\r\n\r\nevent: ping\r\ndata: {"t":2}\r\n\r\n',
  );
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], { event: 'ping', data: '{"t":1}' });
  assert.deepEqual(messages[1], { event: 'ping', data: '{"t":2}' });
});

test('joins multi-line data with newlines', () => {
  const messages = parseSseText('data: line1\ndata: line2\n\n');
  assert.deepEqual(messages, [{ event: 'message', data: 'line1\nline2' }]);
});

test('ignores comments and comments-only heartbeats', () => {
  assert.deepEqual(parseSseText(': keep-alive\n\n'), []);
  const messages = parseSseText(': note\nevent: ping\ndata: {}\n\n');
  assert.deepEqual(messages, [{ event: 'ping', data: '{}' }]);
});

test('keeps last id across events but resets event name', () => {
  const messages = parseSseText('id: 7\nevent: a\ndata: 1\n\ndata: 2\n\n');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].id, '7');
  assert.equal(messages[0].event, 'a');
  // Second frame has no event: -> defaults to message; id persists per spec.
  assert.equal(messages[1].event, 'message');
  assert.equal(messages[1].id, '7');
});

test('strips a leading BOM', () => {
  const messages = parseSseText('\uFEFFevent: hello\ndata: {}\n\n');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].event, 'hello');
});

test('supports bare CR line endings', () => {
  const messages = parseSseText('event: x\rdata: 1\r\r\n');
  assert.deepEqual(messages, [{ event: 'x', data: '1' }]);
});

test('CRLF split across chunks does not dispatch early (P2-1)', () => {
  const parser = new SseParser();
  assert.deepEqual(parser.push('event: session.event\r'), []);
  const messages = parser.push('\ndata: a\r\ndata: b\r\n\r\n');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].event, 'session.event');
  assert.equal(messages[0].data, 'a\nb');
});

test('keeps an incomplete trailing frame in the buffer', () => {
  const parser = new SseParser();
  assert.equal(parser.push('data: partial').length, 0);
  assert.deepEqual(parser.push('\n\n').map((m) => m.data), ['partial']);
});

test('reset clears partial state', () => {
  const parser = new SseParser();
  parser.push('data: partial\n');
  parser.reset();
  assert.deepEqual(parser.push('event: fresh\ndata: ok\n\n'), [{ event: 'fresh', data: 'ok' }]);
});

test('data field without colon yields empty string value', () => {
  const messages = parseSseText('data:\n\n');
  assert.deepEqual(messages, [{ event: 'message', data: '' }]);
});
