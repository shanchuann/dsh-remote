import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiff } from '../../components/code-block/diff.ts';
test('diff numbers, metadata and replacement highlights',()=>{
 const rows=parseDiff('--- a/x\n+++ b/x\n@@ -10,2 +20,2 @@\n-old value\n+new value\n context\n@@ -99 +100 @@\n-last\n+next');
 assert.equal(rows[0].kind,'meta'); assert.equal(rows[3].old,10);assert.equal(rows[4].current,20);assert.equal(rows[5].current,21);assert.equal(rows[7].old,99);assert.equal(rows[3].changed,'old');assert.equal(rows[4].suffix,' value');
});
