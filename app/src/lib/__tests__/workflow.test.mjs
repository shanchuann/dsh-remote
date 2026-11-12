import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceLoader } from './load-source.mjs';
const load = sourceLoader();
const { buildTranscript } = load('transcript');
const { desktopPath, workspaceFileUrl, unifiedDiff } = load('session-files');
const e = (seq, type, data) => ({ seq, type, data });

test('DSH nested result identity pairs parallel tools, parses JSON input and respects errors', () => {
  const items = buildTranscript([
    e(1, 'tool/call', { callId: 'a', name: 'web_fetch', arguments: '{"url":"https://example.com"}' }),
    e(2, 'tool/call', { callId: 'b', name: 'read', arguments: '{"path":"x.ts"}' }),
    e(3, 'tool/result', { message: { toolCallId: 'a', isError: true, content: [{ type: 'text', text: 'HTTP 403' }] } }),
    e(4, 'tool/result', { message: { source: { callId: 'b' }, content: [{ type: 'text', text: 'content' }] } }),
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].input, { url: 'https://example.com' });
  assert.equal(items[0].status, 'error'); assert.equal(items[0].result, 'HTTP 403');
  assert.equal(items[1].status, 'ok'); assert.equal(items[1].result, 'content');
});
test('PTC nested tools preserve web sources, images, dispatch states and generated files', () => {
  const items = buildTranscript([
    e(1, 'tool/ptc-dispatch-start', { subCallId: 'root:ptc:1', name: 'web_search', arguments: { queries: ['docs'] } }),
    e(2, 'tool/ptc-dispatch', { subCallId: 'root:ptc:1', name: 'web_search', arguments: { queries: ['docs'] }, content: [{ type: 'text', text: '[Docs](https://example.com)' }], meta: { sources: [{ url: 'https://example.com' }] } }),
    e(3, 'tool/ptc-dispatch', { subCallId: 'root:ptc:2', name: 'read_image', arguments: { path: 'a.png' }, content: [{ type: 'image', data: 'aGVsbG8=', mediaType: 'image/png' }] }),
    e(4, 'tool/ptc-dispatch', { subCallId: 'root:ptc:3', name: 'edit', arguments: { path: 'a.ts' }, content: [{ type: 'text', text: 'ok' }] }),
    e(5, 'turn/end', {}),
  ]);
  assert.equal(items[0].status, 'ok'); assert.equal(items[0].meta.sources[0].url, 'https://example.com');
  assert.equal(items[1].images[0].data, 'aGVsbG8='); assert.equal(items[1].result, '');
  assert.equal(items[3].kind, 'deliverables'); assert.equal(items[3].files[0].path, 'a.ts');
});
test('assistant images, presented files and independent change events are retained', () => {
  const items = buildTranscript([
    e(1, 'assistant/message', { message: { content: [{ type: 'image', url: 'D:/image.png' }] } }),
    e(2, 'workspace/changes', { turn: 1 }),
    e(3, 'deliverables/presented', { files: [{ path: 'D:/image.png', description: '预览' }] }),
  ]);
  assert.equal(items[0].images[0].url, 'D:/image.png');
  assert.equal(items[1].seq, 2); assert.equal(items[2].files[0].label, '预览');
});
test('desktop links remain scoped to their session and do not turn unsafe schemes into files', () => {
  assert.equal(desktopPath('D:\\项目\\main.ts#L24'), 'D:\\项目\\main.ts');
  assert.equal(desktopPath('file:///C:/My%20File.png'), 'C:/My File.png');
  assert.equal(desktopPath('https://example.com/file.png'), undefined);
  assert.equal(desktopPath('javascript:alert(1)'), undefined);
  const u = new URL(workspaceFileUrl('http://localhost/', 'session/id', '../a b.png'));
  assert.equal(u.pathname, '/v1/sessions/session%2Fid/file'); assert.equal(u.searchParams.get('path'), '../a b.png');
});
test('diff uses the recorded hunk line numbers and does not invent released snapshots', () => {
  assert.equal(unifiedDiff({ unavailable: true }), '');
  assert.match(unifiedDiff({ kind: 'text', path: 'a.ts', hunks: [{ oldStart: 12, oldLines: 1, newStart: 12, newLines: 2, lines: ['-old','+new','+next'] }] }), /@@ -12,1 \+12,2 @@\n-old\n\+new/);
});
