import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DshBridge } from '../src/dsh/bridge.mjs';

function harness(registry) {
  const calls = [];
  const bridge = new DshBridge({ get: (key) => key === 'workspaceRegistry' ? registry : undefined }, {});
  bridge.controller = {
    create: async (request) => { calls.push(request); return { sessionId: 'created' }; },
    list: async () => ({ items: [{ sessionId: 'member', cwd: 'D:/Code/demo' }, { sessionId: 'loose', cwd: 'D:/Code/demo' }] }),
  };
  return { bridge, calls };
}

test('legacy mobile cwd resolves a registered desktop Workspace before creation', async () => {
  const paths = [];
  const { bridge, calls } = harness({ resolveByPath: async (path) => { paths.push(path); return { id: 'desktop-project' }; } });
  await bridge.createSession({ cwd: 'd:\\Code\\Demo\\', agentPreset: 'coding' });
  assert.deepEqual(paths, ['d:\\Code\\Demo\\']);
  assert.deepEqual(calls, [{ workspaceId: 'desktop-project', agentPreset: 'coding' }]);
});

test('explicit project identity is forwarded without cwd and rejects ambiguous creation', async () => {
  const { bridge, calls } = harness({ resolveByPath: () => { throw new Error('must not resolve'); } });
  await bridge.createSession({ workspaceId: 'chosen' });
  assert.deepEqual(calls, [{ workspaceId: 'chosen' }]);
  await assert.rejects(() => bridge.createSession({ workspaceId: 'chosen', cwd: 'D:/Code/demo' }), { code: 'invalid-argument' });
  assert.equal(calls.length, 1);
});

test('unregistered directories and older hosts keep cwd creation, registry errors never silently create ungrouped sessions', async () => {
  for (const registry of [undefined, { resolveByPath: async () => undefined }]) {
    const { bridge, calls } = harness(registry);
    await bridge.createSession({ cwd: 'D:/unregistered' });
    assert.deepEqual(calls, [{ cwd: 'D:/unregistered' }]);
  }
  const { bridge, calls } = harness({ resolveByPath: async () => { throw new Error('unreadable directory'); } });
  await assert.rejects(() => bridge.createSession({ cwd: 'D:/gone' }), /unreadable directory/);
  assert.equal(calls.length, 0);
});

test('session list reports real membership, title and path without inferring ownership from cwd', async () => {
  const { bridge } = harness({ list: () => [{ id: 'workspace', title: '重命名的项目', path: 'D:/Code/demo', sessionIds: ['member'] }] });
  const { items } = await bridge.listSessions();
  assert.equal(items[0].workspaceId, 'workspace');
  assert.equal(items[0].workspaceTitle, '重命名的项目');
  assert.equal(items[1].workspaceId, null);
  const legacy = await harness(undefined).bridge.listSessions();
  assert.equal(Object.hasOwn(legacy.items[0], 'workspaceId'), false);
});

test('each session page includes the complete desktop catalog, including empty and child-only projects', async () => {
  const workspaces = Array.from({ length: 17 }, (_, i) => ({
    id: 'w' + i, title: '项目 ' + i, path: 'D:/project-' + i, sessionIds: i === 0 ? ['member'] : []
  }));
  let reads = 0;
  const { bridge } = harness({ list: () => { reads++; return workspaces; } });
  const first = await bridge.listSessions({ limit: 1 });
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].workspaceId, 'w0');
  assert.equal(first.nextCursor, '1');
  assert.equal(first.workspaces.length, 17);
  assert.deepEqual(first.workspaces[16], { id: 'w16', title: '项目 16', path: 'D:/project-16' });
  assert.equal(reads, 1);
  const second = await bridge.listSessions({ limit: 1, cursor: '1' });
  assert.deepEqual(second.workspaces, first.workspaces);
  bridge.controller.list = async () => ({ items: [] });
  assert.equal((await bridge.listSessions()).workspaces.length, 17);
  assert.equal(Object.hasOwn(await harness(undefined).bridge.listSessions(), 'workspaces'), false);
});
