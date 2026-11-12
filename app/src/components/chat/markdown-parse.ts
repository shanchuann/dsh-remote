/** Pure markdown parsing shared by the React renderer and node tests. */
export type MarkdownInline = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  href?: string;
  image?: string;
};

export type MarkdownListItem = { text: string; checked?: boolean };

export type MarkdownBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; ordered: boolean; items: MarkdownListItem[] }
  | { type: 'quote'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'hr' };

const SPECIAL = /[*`_[~!]/;
const TABLE_PIPE = /[|\uFF5C]/; // | or full-width ｜

function pushInline(out: MarkdownInline[], span: MarkdownInline) {
  if (span.text.length > 0 || span.image !== undefined) out.push(span);
}

export function parseInlineMarkdown(text: string): MarkdownInline[] {
  const out: MarkdownInline[] = [];
  let index = 0;
  while (index < text.length) {
    const rest = text.slice(index);
    let match: RegExpExecArray | null;
    if ((match = /^`([^`\n]+)`/.exec(rest)) !== null) {
      pushInline(out, { text: match[1] ?? '', code: true });
      index += match[0].length;
      continue;
    }
    if ((match = /^!\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest)) !== null) {
      pushInline(out, { text: match[1] ?? '', image: match[2] });
      index += match[0].length;
      continue;
    }
    if ((match = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest)) !== null) {
      pushInline(out, { text: match[1] ?? '', href: match[2] });
      index += match[0].length;
      continue;
    }
    if ((match = /^\*\*([^*]+)\*\*/.exec(rest)) !== null || (match = /^__([^_]+)__/.exec(rest)) !== null) {
      pushInline(out, { text: match[1] ?? '', bold: true });
      index += match[0].length;
      continue;
    }
    if ((match = /^~~([^~]+)~~/.exec(rest)) !== null) {
      pushInline(out, { text: match[1] ?? '', strike: true });
      index += match[0].length;
      continue;
    }
    if ((match = /^\*([^*\n]+)\*/.exec(rest)) !== null || (match = /^_([^_\n]+)_/.exec(rest)) !== null) {
      pushInline(out, { text: match[1] ?? '', italic: true });
      index += match[0].length;
      continue;
    }
    let next = index + 1;
    while (next < text.length && !SPECIAL.test(text[next] ?? '')) next += 1;
    pushInline(out, { text: text.slice(index, next) });
    index = next;
  }
  return out;
}

const TABLE_SEPARATOR = /^\s*[|\uFF5C]?\s*:?-{2,}:?\s*([|\uFF5C]\s*:?-{2,}:?\s*)*[|\uFF5C]?\s*$/;

export function tableCells(line: string): string[] {
  let body = line.trim();
  if (TABLE_PIPE.test(body[0] ?? '')) body = body.slice(1);
  if (TABLE_PIPE.test(body[body.length - 1] ?? '')) body = body.slice(0, -1);
  return body.split(TABLE_PIPE).map((cell) => cell.trim());
}

export function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: MarkdownListItem[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
    paragraph = [];
  };
  const flushList = () => {
    if (list === null) return;
    blocks.push({ type: 'list', ordered: list.ordered, items: list.items });
    list = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim().length === 0) {
      flushParagraph();
      flushList();
      continue;
    }
    // GFM table: header row followed by a |---| separator row (ASCII or full-width pipes).
    if (TABLE_PIPE.test(line) && TABLE_SEPARATOR.test(lines[index + 1] ?? '')) {
      flushParagraph();
      flushList();
      const headers = tableCells(line);
      const rows: string[][] = [];
      let cursor = index + 2;
      while (cursor < lines.length && TABLE_PIPE.test(lines[cursor] ?? '')) {
        rows.push(tableCells(lines[cursor] ?? ''));
        cursor += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      index = cursor - 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', level: (heading[1] ?? '#').length, text: heading[2] ?? '' });
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'hr' });
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote !== null) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'quote', text: quote[1] ?? '' });
      continue;
    }
    const task = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (task !== null) {
      flushParagraph();
      if (list === null || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push({ text: task[2] ?? '', checked: (task[1] ?? ' ').toLowerCase() === 'x' });
      continue;
    }
    const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item !== null) {
      flushParagraph();
      const ordered = !/^[-*+]$/.test(item[1] ?? '-');
      if (list === null || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push({ text: item[2] ?? '' });
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}
