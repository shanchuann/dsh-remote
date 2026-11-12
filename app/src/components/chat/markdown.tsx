import { useMemo } from 'react';
import { Linking, Text, View } from 'react-native';
import { useResolveClassNames } from 'uniwind';

/** One inline span (bold/italic/code/link/strike) inside a block of prose. */
export type MarkdownInline = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  href?: string;
};

/** One block-level markdown node; fenced code is split out before this parser. */
export type MarkdownBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'hr' };

const SPECIAL = /[*`_[~]/;

function pushInline(out: MarkdownInline[], span: MarkdownInline) {
  if (span.text.length > 0) out.push(span);
}

/** Parse common inline markdown into styled spans. */
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
    if ((match = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest)) !== null) {
      pushInline(out, { text: match[1] ?? '', href: match[2] });
      index += match[0].length;
      continue;
    }
    if ((match = /^\*([^*\n]+)\*/.exec(rest)) !== null || (match = /^_([^_\n]+)_/.exec(rest)) !== null) {
      pushInline(out, { text: match[1] ?? '', italic: true });
      index += match[0].length;
      continue;
    }
    // Plain span: consume until the next character that could open a marker.
    let next = index + 1;
    while (next < text.length && !SPECIAL.test(text[next] ?? '')) next += 1;
    pushInline(out, { text: text.slice(index, next) });
    index = next;
  }
  return out;
}

/** Parse block-level markdown: headings, lists, quotes, rules and paragraphs. */
export function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

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

  for (const line of lines) {
    if (line.trim().length === 0) {
      flushParagraph();
      flushList();
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
    const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item !== null) {
      flushParagraph();
      const ordered = !/^[-*+]$/.test(item[1] ?? '-');
      if (list === null || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(item[2] ?? '');
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

function InlineSpans({
  spans,
  muted,
  linkColor,
}: {
  spans: MarkdownInline[];
  muted: boolean;
  linkColor: string;
}) {
  return (
    <>
      {spans.map((span, index) => {
        const classes = [
          muted ? 'text-[13px] leading-5 text-muted' : 'text-[15px] leading-[24px] text-foreground',
          span.code ? 'font-mono text-[13px] text-foreground/90' : '',
          span.href ? 'underline' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const style = {
          ...(span.bold ? { fontWeight: '600' as const } : null),
          ...(span.italic ? { fontStyle: 'italic' as const } : null),
          ...(span.strike ? { textDecorationLine: 'line-through' as const } : null),
          ...(span.href ? { color: linkColor } : null),
        };
        const content = (
          <Text
            key={index}
            className={classes}
            style={style}
            onPress={span.href ? () => void Linking.openURL(span.href as string).catch(() => undefined) : undefined}
          >
            {span.text}
          </Text>
        );
        return content;
      })}
    </>
  );
}

const HEADING_CLASSES = [
  'text-[22px] leading-8 font-semibold text-foreground',
  'text-[20px] leading-7 font-semibold text-foreground',
  'text-[18px] leading-7 font-semibold text-foreground',
  'text-[16px] leading-6 font-semibold text-foreground',
  'text-[15px] leading-6 font-semibold text-foreground',
  'text-[15px] leading-6 font-semibold text-foreground',
];

/** Render markdown prose (assistant replies) with native Text views. */
export function MarkdownText({ text, muted = false }: { text: string; muted?: boolean }) {
  const blocks = useMemo(() => parseMarkdownBlocks(text), [text]);
  const { color: linkColor } = useResolveClassNames('text-primary');
  const link = typeof linkColor === 'string' ? linkColor : '#4D6BFE';

  return (
    <View className="gap-2">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <Text key={index} selectable className={HEADING_CLASSES[Math.min(block.level, 6) - 1]}>
              <InlineSpans spans={parseInlineMarkdown(block.text)} muted={false} linkColor={link} />
            </Text>
          );
        }
        if (block.type === 'hr') {
          return <View key={index} className="my-1 h-px w-full bg-border" />;
        }
        if (block.type === 'quote') {
          return (
            <View key={index} className="border-l-2 border-border pl-3">
              <Text selectable className="text-[14px] leading-6 text-muted">
                <InlineSpans spans={parseInlineMarkdown(block.text)} muted linkColor={link} />
              </Text>
            </View>
          );
        }
        if (block.type === 'list') {
          return (
            <View key={index} className="gap-1">
              {block.items.map((item, itemIndex) => (
                <View key={itemIndex} className="flex-row gap-2 pr-1">
                  <Text className={muted ? 'text-[13px] leading-5 text-muted' : 'text-[15px] leading-[24px] text-muted'}>
                    {block.ordered ? itemIndex + 1 + '.' : '•'}
                  </Text>
                  <Text selectable className={muted ? 'flex-1 text-[13px] leading-5 text-muted' : 'flex-1 text-[15px] leading-[24px] text-foreground'}>
                    <InlineSpans spans={parseInlineMarkdown(item)} muted={muted} linkColor={link} />
                  </Text>
                </View>
              ))}
            </View>
          );
        }
        return (
          <Text key={index} selectable className={muted ? 'text-[13px] leading-5 text-muted' : 'text-[15px] leading-[24px] text-foreground'}>
            <InlineSpans spans={parseInlineMarkdown(block.text)} muted={muted} linkColor={link} />
          </Text>
        );
      })}
    </View>
  );
}
