import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DshBridge } from '../src/dsh/bridge.mjs';
import { pairDevice, request, startHarness } from './helpers/harness.mjs';

function bridge(services = {}) {
  const b = new DshBridge({ get: key => services[key] }, {});
  b.controller = { list: async () => ({ items: [{ sessionId: 's', cwd: 'D:/project' }] }) };
  return b;
}
test('workspace files use DSH scoped backend and preserve byte data, not raw filesystem reads', async () => {
  const calls = [];
  const b = bridge({ workspaceFiles: {
    stat: async (...args) => { calls.push(['stat',...args]); return { size: 4 }; },
    readBytes: async (...args) => { calls.push(['bytes',...args]); return { data: new Uint8Array([1,2,3,4]), path: 'D:/project/a.png' }; },
    read: async (...args) => { calls.push(['text',...args]); return { text: 'native', eof: true }; },
  } });
  assert.deepEqual((await b.readFile('s', 'a.png', 'bytes')).data, Buffer.from([1,2,3,4]));
  assert.deepEqual(calls[0][1], { sessionId: 's', workspaceRoot: 'D:/project' });
  assert.equal(calls[1][2], 'a.png'); assert.ok(calls[1][4] instanceof AbortSignal);
  assert.equal((await b.readFile('s','a.ts','text')).text, 'native');
  assert.deepEqual(calls[2][3], { offset: 1, limit: 3000 });
  await assert.rejects(b.readFile('missing','a','bytes'), { code: 'session-not-found' });
});
test('file caps stop oversized reads and host permission errors remain explicit', async () => {
  let read = false;
  const b = bridge({ workspaceFiles: { stat: async () => ({ bytes: 33 * 1024 * 1024 }), readBytes: () => { read = true; } } });
  await assert.rejects(b.readFile('s','a','bytes'), { code: 'invalid-argument' }); assert.equal(read, false);
  const denied = bridge({ workspaceFiles: { read: async () => { throw Object.assign(new Error('denied'),{code:'fs/permission-denied'}); } } });
  await assert.rejects(denied.readFile('s','a','text'), { code: 'forbidden' });
  const missing = bridge({ workspaceFiles: { read: async () => { throw Object.assign(new Error('no entry'),{code:'workspace-file/not-found'}); } } });
  await assert.rejects(missing.readFile('s','a','text'), { code: 'not-found' });
  await assert.rejects(bridge().readFile('s','a','text'), { code: 'feature-unavailable' });
});
test('changes use the original recorded event sequence and report disposed snapshots honestly', async () => {
  const calls = [];
  const b = bridge({ workspaceChanges: { summary: async (...args) => { calls.push(args); }, diff: async (...args) => { calls.push(args); return { kind:'text',hunks:[] }; } } });
  assert.equal((await b.changes('s', 42)).unavailable, true);
  assert.equal((await b.changes('s',42,3)).kind, 'text');
  assert.deepEqual(calls[0], ['s',42]); assert.deepEqual(calls[1].slice(0,3), ['s',42,3]);
});
test('file and diff HTTP endpoints require auth, forward validated input and emit real image bytes', async () => {
  const h = await startHarness();
  try {
    const p = await pairDevice(h); const token = p.token; const calls = [];
    h.bridge.changes = async (...args) => { calls.push(args); return { total: 1, files: [] }; };
    h.bridge.readFile = async (...args) => { calls.push(args); return args[2] === 'text' ? { text: 'hello', eof: true } : { data: Buffer.from([137,80,78,71,13,10,26,10]) }; };
    for (const url of ['/v1/sessions/s/file?path=a.png','/v1/sessions/s/changes/42/0']) assert.equal((await request(h.baseUrl,url)).status,401);
    const summary = await request(h.baseUrl,'/v1/sessions/s/changes/42/0',{token});
    assert.equal(summary.status,200); assert.deepEqual(calls.at(-1),['s',42,0]);
    const text = await request(h.baseUrl,'/v1/sessions/s/file?path=dir%2Fa%20b.ts&format=text',{token});
    assert.equal(text.body.text,'hello'); assert.deepEqual(calls.at(-1),['s','dir/a b.ts','text']);
    const image = await fetch(h.baseUrl+'/v1/sessions/s/file?path=a.png',{headers:{Authorization:'Bearer '+token}});
    assert.equal(image.headers.get('content-type'),'image/png'); assert.equal(image.headers.get('cache-control'),'no-store');
    assert.equal((await image.arrayBuffer()).byteLength,8);
    assert.equal((await request(h.baseUrl,'/v1/sessions/s/file?path=%00',{token})).status,400);
    assert.equal((await request(h.baseUrl,'/v1/sessions/s/file',{token})).status,400);
  } finally { await h.close(); }
});
