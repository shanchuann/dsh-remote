import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupSessionProjects, isSubagentSession, readAllSessions, readSessionCatalog, sessionSubagents } from '../projects.ts';
import type { SessionRow } from '../types.ts';

test('groups main conversations by directory, normalizing Windows paths only', () => {
  const rows: SessionRow[] = [
    { sessionId: 'a', cwd: 'D:\\Code\\Demo', updatedAt: 1 },
    { sessionId: 'b', cwd: 'd:/code/demo/', updatedAt: 4 },
    { sessionId: 'other', cwd: 'E:/Code/Demo', updatedAt: 2 },
    { sessionId: 'child', cwd: 'D:/Code/Demo', parentSessionId: 'a', updatedAt: 5 },
    { sessionId: 'orphan', origin: 'subagent', updatedAt: 6 },
    { sessionId: 'unknown' },
    { sessionId: 'posix-a', cwd: '/home/Demo' },
    { sessionId: 'posix-b', cwd: '/home/demo' },
  ];
  const groups = groupSessionProjects(rows);
  assert.equal(groups.length, 5);
  assert.deepEqual(groups[0].sessions.map((row) => row.sessionId), ['b', 'a']);
  assert.equal(groups[1].cwd, 'E:/Code/Demo');
  assert.equal(groups.find((group) => group.id === '')?.name, '未指定项目');
  assert.equal(groups.some((group) => group.sessions.some((row) => isSubagentSession(row))), false);
});

test('does not infer child status from a title', () => {
  assert.equal(isSubagentSession({ sessionId: 'a', title: '你是 app-chat' }), false);
  assert.equal(isSubagentSession({ sessionId: 'b', origin: { kind: 'subagent' } }), true);
});

test('desktop Workspace membership overrides cwd and preserves renamed projects', () => {
  const groups = groupSessionProjects([
    { sessionId: 'member', cwd: 'D:/Code/demo', workspaceId: 'w1', workspaceTitle: '我的项目', workspacePath: 'D:/Code/demo' },
    { sessionId: 'ungrouped-same-path', cwd: 'D:/Code/demo', workspaceId: null },
    { sessionId: 'ungrouped-desktop', cwd: 'C:/Users/test/Desktop', workspaceId: null },
    { sessionId: 'child', workspaceId: 'w1', parentSessionId: 'member' },
  ]);
  assert.equal(groups.length, 2);
  const project = groups.find((group) => group.workspaceId === 'w1')!;
  assert.equal(project.name, '我的项目');
  assert.equal(project.cwd, 'D:/Code/demo');
  assert.deepEqual(project.sessions.map((row) => row.sessionId), ['member']);
  const ungrouped = groups.find((group) => group.id === '')!;
  assert.equal(ungrouped.name, '未分组');
  assert.equal(ungrouped.cwd, undefined);
  assert.deepEqual(ungrouped.sessions.map((row) => row.sessionId), ['ungrouped-same-path', 'ungrouped-desktop']);
});

test('finds nested descendants out of order, excludes unrelated agents and tolerates cycles', () => {
  const rows = [
    { sessionId: 'nested', parentSessionId: 'child' },
    { sessionId: 'other', parentSessionId: 'different' },
    { sessionId: 'child', parentSessionId: 'main', running: true },
    { sessionId: 'main', parentSessionId: 'nested' },
  ];
  assert.deepEqual(sessionSubagents(rows, 'main').map((row) => row.sessionId), ['child', 'nested']);
  assert.deepEqual(sessionSubagents(rows, undefined), []);
});

test('reads all pages and deduplicates sessions crossing page boundaries', async () => {
  const cursors: (string | undefined)[] = [];
  const rows = await readAllSessions(async (cursor) => {
    cursors.push(cursor);
    return cursor
      ? { items: [{ sessionId: 'a' }, { sessionId: 'b' }], nextCursor: null }
      : { items: [{ sessionId: 'a' }], nextCursor: 'next' };
  });
  assert.deepEqual(cursors, [undefined, 'next']);
  assert.deepEqual(rows.map((row) => row.sessionId), ['a', 'b']);
});

test('stops a broken host from looping the same cursor forever', async () => {
  await assert.rejects(() => readAllSessions(async () => ({ items: [], nextCursor: 'same' })), /分页异常/);
});

test('all 17 desktop projects remain visible with only seven populated, preserving desktop order and empty project identity', () => {
  const workspaces = Array.from({ length: 17 }, (_, i) => ({ id: 'w' + i, title: '项目 ' + i, path: 'D:/project-' + i }));
  const rows: SessionRow[] = workspaces.slice(0, 7).map((workspace, i) => ({ sessionId: 's' + i, workspaceId: workspace.id, updatedAt: i }));
  rows.push({ sessionId: 'child', workspaceId: 'w16', updatedAt: 100, parentSessionId: 's0' });
  const projects = groupSessionProjects(rows, workspaces);
  assert.equal(projects.length, 17);
  assert.deepEqual(projects.map((project) => project.workspaceId), workspaces.map((workspace) => workspace.id));
  assert.equal(projects.reduce((count, project) => count + project.sessions.length, 0), 7);
  assert.deepEqual(projects[16], { id: 'workspace:w16', name: '项目 16', cwd: 'D:/project-16', workspaceId: 'w16', sessions: [] });
  assert.equal(groupSessionProjects([], workspaces).length, 17);
});

test('Ungrouped stays separate from the complete catalog and a refreshed catalog replaces renamed or removed empty projects', () => {
  const row = { sessionId: 'loose', workspaceId: null, cwd: 'D:/registered' };
  const before = groupSessionProjects([row], [{ id: 'w', title: '原名', path: 'D:/registered' }]);
  assert.equal(before.length, 2);
  assert.equal(before[1].name, '未分组');
  assert.equal(before[1].cwd, undefined);
  assert.equal(groupSessionProjects([], [{ id: 'w', title: '新名', path: 'D:/registered' }])[0].name, '新名');
  assert.deepEqual(groupSessionProjects([], []), []);
});

test('catalog reading crosses the 100-row boundary without losing projects or main sessions hidden behind agents', async () => {
  const workspaces = Array.from({ length: 17 }, (_, i) => ({ id: 'w' + i, path: 'D:/project-' + i }));
  const cursors: (string | undefined)[] = [];
  const catalog = await readSessionCatalog(async (cursor) => {
    cursors.push(cursor);
    return cursor
      ? { items: workspaces.map((workspace, i) => ({ sessionId: 'main' + i, workspaceId: workspace.id })), nextCursor: null }
      : { items: Array.from({ length: 100 }, (_, i) => ({ sessionId: 'child' + i, parentSessionId: 'main0' })), nextCursor: '100', workspaces };
  });
  assert.deepEqual(cursors, [undefined, '100']);
  assert.equal(catalog.sessions.length, 117);
  assert.deepEqual(catalog.workspaces, workspaces);
  const projects = groupSessionProjects(catalog.sessions, catalog.workspaces);
  assert.equal(projects.length, 17);
  assert.equal(projects.every((project) => project.sessions.length === 1), true);
  assert.equal((await readSessionCatalog(async () => ({ items: [], workspaces: [] }))).workspaces?.length, 0);
  assert.equal((await readSessionCatalog(async () => ({ items: [] }))).workspaces, undefined);
});
