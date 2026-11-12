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