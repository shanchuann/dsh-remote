import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdownBlocks, parseInlineMarkdown, tableCells } from '../../components/chat/markdown-parse.ts';

test('parses an ASCII GFM table', () => {
  const blocks = parseMarkdownBlocks('| 问题 | 表现 |\n|---|---|\n| A | B |\n| C | D |');
  assert.equal(blocks.length, 1);
  const table = blocks[0];
  assert.equal(table.type, 'table');
  assert.deepEqual(table.headers, ['问题', '表现']);
  assert.deepEqual(table.rows, [['A', 'B'], ['C', 'D']]);
});

test('parses a table that uses full-width pipes', () => {
  const blocks = parseMarkdownBlocks('｜列一｜列二｜\n｜---｜---｜\n｜x｜y｜');
  assert.equal(blocks[0].type, 'table');
  assert.deepEqual(blocks[0].headers, ['列一', '列二']);
  assert.deepEqual(blocks[0].rows, [['x', 'y']]);
});

test('table cells trim surrounding pipes', () => {
  assert.deepEqual(tableCells('| a | b |'), ['a', 'b']);
  assert.deepEqual(tableCells('｜a｜b｜'), ['a', 'b']);
});

test('parses task lists and images', () => {
  const blocks = parseMarkdownBlocks('- [ ] todo\n- [x] done');
  assert.equal(blocks[0].type, 'list');
  assert.deepEqual(blocks[0].items, [
    { text: 'todo', checked: false },
    { text: 'done', checked: true },
  ]);
  const inline = parseInlineMarkdown('![图](https://example.com/a.png) **粗**');
  assert.equal(inline[0].image, 'https://example.com/a.png');
  assert.equal(inline.some((span) => span.bold === true), true);
});

test('keeps fences out and plain paragraphs intact', () => {
  const blocks = parseMarkdownBlocks('第一段\n\n# 标题\n\n> 引用');
  assert.deepEqual(blocks.map((block) => block.type), ['paragraph', 'heading', 'quote']);
});

test('nested emphasis, escaped syntax, ordered starts and code fences', () => {
 const spans=parseInlineMarkdown('**粗体与 *斜体***，file_name.ts');
 assert.ok(spans.some(x=>x.bold&&x.italic));
 assert.ok(spans.map(x=>x.text).join('').includes('file_name.ts'));
 assert.equal(parseMarkdownBlocks('3. third\n4. fourth')[0].start,3);
 assert.equal(parseMarkdownBlocks('~~~diff\n-old\n+new\n~~~')[0].type,'code');
});
