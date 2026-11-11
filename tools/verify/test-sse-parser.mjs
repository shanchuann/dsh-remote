#!/usr/bin/env node
/**
 * Unit tests for the hand-written SSE parser in protocol-client.mjs.
 * No network, no dependencies:  node tools/verify/test-sse-parser.mjs
 */

import assert from 'node:assert/strict';
import { createSseParser } from './protocol-client.mjs';

let passed = 0;
const failures = [];

function case_(name, fn) {
  try { fn(); passed += 1; console.log('PASS ' + name); }
  catch (e) { failures.push({ name, error: e }); console.log('FAIL ' + name + ' :: ' + (e && e.message ? e.message : e)); }
}

function collect() {
  const frames = [];
  const parser = createSseParser((f) => frames.push(f));
  return { frames, parser };
}

// 1. basic frame
case_('basic event + json data', () => {
  const { frames, parser } = collect();
  parser.push('event: hello\ndata: {"protocol":1}\n\n');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, 'hello');
  assert.deepEqual(frames[0].dataJson, { protocol: 1 });
  assert.equal(frames[0].data, '{"protocol":1}');
});

// 2. default event name is "message"
case_('default event name is message', () => {
  const { frames, parser } = collect();
  parser.push('data: {"x":1}\n\n');
  assert.equal(frames[0].event, 'message');
});

// 3. multi-line data joined with newline
case_('multi-line data joined with \\n', () => {
  const { frames, parser } = collect();
  parser.push('event: x\ndata: a\ndata: b\ndata: c\n\n');
  assert.equal(frames[0].data, 'a\nb\nc');
});

// 4. CRLF line endings
case_('CRLF line endings', () => {
  const { frames, parser } = collect();
  parser.push('event: ping\r\ndata: {"t":1}\r\n\r\n');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, 'ping');
  assert.deepEqual(frames[0].dataJson, { t: 1 });
});

// 5. lone CR line endings
case_('lone CR line endings', () => {
  const { frames, parser } = collect();
  parser.push('event: ping\rdata: {"t":2}\r\r');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, 'ping');
});

// 6. one byte at a time (split across arbitrary chunk boundaries)
case_('byte-by-byte chunks produce same frames', () => {
  const { frames, parser } = collect();
  const wire = 'id: 7\nevent: session.event\r\ndata: {"a":"b"}\n\n';
  for (const ch of wire) parser.push(ch);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].id, '7');
  assert.equal(frames[0].event, 'session.event');
  assert.deepEqual(frames[0].dataJson, { a: 'b' });
});

// 7. comment lines ignored
case_('comment lines ignored', () => {
  const { frames, parser } = collect();
  parser.push(': keep-alive\n\n');
  parser.push('event: e\ndata: 1\n\n');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, 'e');
});

// 8. BOM stripped
case_('leading BOM stripped', () => {
  const { frames, parser } = collect();
  parser.push('\uFEFFevent: e\ndata: 1\n\n');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, 'e');
});

// 9. frame without data does not dispatch
case_('frame without data does not dispatch', () => {
  const { frames, parser } = collect();
  parser.push('event: nope\n\n');
  assert.equal(frames.length, 0);
  parser.push('data: ok\n\n');
  assert.equal(frames.length, 1);
});

// 10. id persists across frames; retry parsed
case_('id persists, retry parsed', () => {
  const { frames, parser } = collect();
  parser.push('id: 42\nretry: 3000\nevent: a\ndata: 1\n\n');
  assert.equal(frames[0].id, '42');
  assert.equal(frames[0].retry, 3000);
  parser.push('event: b\ndata: 2\n\n');
  assert.equal(frames[1].id, '42');
});

// 11. unknown fields ignored, space stripping single
case_('unknown fields ignored / one space stripped', () => {
  const { frames, parser } = collect();
  parser.push('foo: bar\nevent: e\ndata:  spaced\n\n');
  assert.equal(frames[0].data, ' spaced');
});

// 12. field without colon counts as empty value (data -> dispatch empty string)
case_('bare data field yields empty data dispatch', () => {
  const { frames, parser } = collect();
  parser.push('data\n\n');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].data, '');
});

// 13. trailing incomplete line flushed on end()
case_('end() flushes final unterminated line', () => {
  const { frames, parser } = collect();
  parser.push('event: e\ndata: last');
  assert.equal(frames.length, 0);
  parser.end();
  assert.equal(frames.length, 1);
  assert.equal(frames[0].data, 'last');
});

// 14. multiple frames in one chunk
case_('multiple frames in one chunk', () => {
  const { frames, parser } = collect();
  parser.push('event: a\ndata: 1\n\nevent: b\ndata: 2\n\n');
  assert.equal(frames.length, 2);
  assert.equal(frames[0].event, 'a');
  assert.equal(frames[1].event, 'b');
});

// 15. JSON data that is not valid JSON still delivered raw
case_('invalid JSON data delivered with parseError', () => {
  const { frames, parser } = collect();
  parser.push('event: e\ndata: not-json\n\n');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].data, 'not-json');
  assert.equal(frames[0].dataJson, undefined);
  assert.ok(frames[0].parseError);
});

// 16. CRLF split exactly between \r and \n
case_('CRLF split between CR and LF', () => {
  const { frames, parser } = collect();
  parser.push('event: e\r');
  parser.push('\ndata: 1\r');
  parser.push('\n\r');
  parser.push('\n');
  assert.equal(frames.length, 1);
});

console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
for (const f of failures) console.log('  FAILED: ' + f.name + ' -> ' + (f.error && f.error.stack ? f.error.stack.split('\n').slice(0, 3).join(' | ') : f.error));
process.exitCode = failures.length === 0 ? 0 : 1;
