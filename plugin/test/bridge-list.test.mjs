import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DshBridge } from '../src/dsh/bridge.mjs';

test('bridge pagination includes main sessions beyond the first 100 child tasks', async () => {
  const bridge = new DshBridge({ get: () => undefined }, {});
  bridge.controller = { list: async () => ({ items: Array.from({ length: 105 }, (_, i) => ({
    sessionId: String(i), parentSessionId: i < 100 ? '104' : null,
    origin: i < 100 ? 'subagent' : null,
  })) }) };
  const first = await bridge.listSessions({ limit: 100 });
  assert.equal(first.items.length, 100);
  assert.equal(first.items[0].origin, 'subagent');
  assert.equal(first.items[0].parentSessionId, '104');
  assert.equal(first.nextCursor, '100');
  const second = await bridge.listSessions({ limit: 100, cursor: first.nextCursor });
  assert.deepEqual(second.items.map((row) => row.sessionId), ['100', '101', '102', '103', '104']);
  assert.equal(second.nextCursor, null);
  await assert.rejects(() => bridge.listSessions({ cursor: '-1' }), { code: 'invalid-argument' });
});
