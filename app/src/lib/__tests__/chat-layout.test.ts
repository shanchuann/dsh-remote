import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskPanelMaxHeight } from '../chat-layout.ts';

test('floating task board adapts to the viewport and reserves space for messages and controls', () => {
  const normal = taskPanelMaxHeight(800, 80, 100);
  assert.ok(normal >= 226, 'three normal task capsules fit without the old 160dp crop');
  assert.ok(taskPanelMaxHeight(1200, 80, 100) > normal);
  assert.ok(taskPanelMaxHeight(560, 80, 100) < normal);
  for (const controls of [80, 160, 240]) {
    const board = taskPanelMaxHeight(700, 80, controls);
    assert.ok(board + controls + 80 + 96 <= 700);
  }
  assert.equal(taskPanelMaxHeight(240, 80, 180), 48);
  assert.ok(taskPanelMaxHeight(3000, 80, 100) <= 400);
});
