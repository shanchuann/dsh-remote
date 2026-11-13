import { memo, useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useResolveClassNames } from 'uniwind';

import type { MarkdownBlock, MarkdownInline } from './markdown-parse';
import { parseInlineMarkdown, parseMarkdownBlocks, sameMarkdownBlock } from './markdown-parse';
import { RemoteImage, useSessionFiles } from './session-files';
import { StreamingSpan } from './beautiful/streaming-span';
import { CodeBlock } from '../code-block';
import { toCodeLanguage } from './format';

function InlineSpans({ spans, muted, linkColor, streaming = false }: { spans: MarkdownInline[]; muted: boolean; linkColor: string; streaming?: boolean }) {
  const { open } = useSessionFiles();
  return (
    <>
      {spans.map((span, index) => {
        if (span.image !== undefined) {
          return (
            <RemoteImage key={index} image={{ url: span.image, name: span.text }} />
          );
        }
        const classes = [
          span.code ? 'font-mono bg-border' : '',
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
        return (
          <StreamingSpan
            key={index}
            className={classes}
            style={style}
            onPress={span.href ? () => open(span.href as string) : undefined}
            text={span.text}
            streaming={streaming}
          />
        );
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
export function MarkdownText({ text, muted = false, streaming = false, fullHeightCode = false }: { text: string; muted?: boolean; streaming?: boolean; fullHeightCode?: boolean }) {
  const blocks = useMemo(() => parseMarkdownBlocks(text), [text]);
  const { color: linkColor } = useResolveClassNames('text-primary');
  const link = typeof linkColor === 'string' ? linkColor : '#4D6BFE';

  return (
    <View className="gap-3">
      {blocks.map((block, index) => <MarkdownBlockView key={index} block={block} muted={muted} link={link} fullHeightCode={fullHeightCode} streaming={streaming && index === blocks.length - 1} />)}

    </View>
  );
}

const MarkdownBlockView = memo(function MarkdownBlockView({ block, muted, link, streaming, fullHeightCode }: { block: MarkdownBlock; muted: boolean; link: string; streaming: boolean; fullHeightCode: boolean }) {

  if (block.type === 'code') return <CodeBlock code={block.text} language={toCodeLanguage(block.language)} fullHeight={fullHeightCode} />;
  if (block.type === 'heading') {
    return (
      <Text selectable className={HEADING_CLASSES[Math.min(block.level, 6) - 1]}>
        <InlineSpans spans={parseInlineMarkdown(block.text)} muted={false} linkColor={link} streaming={streaming} />
      </Text>
    );
  }
  if (block.type === 'hr') return <View className="my-1 h-px w-full bg-border" />;
  if (block.type === 'quote') {
    return (
      <View className="border-l-2 border-border pl-3">
        <Text selectable className="text-[14px] leading-6 text-muted">
          <InlineSpans spans={parseInlineMarkdown(block.text)} muted linkColor={link} streaming={streaming} />
        </Text>
      </View>
    );
  }
  if (block.type === 'table') {
    return (
      <ScrollView  horizontal showsHorizontalScrollIndicator={false} className="my-1">
        <View className="overflow-hidden rounded-xl border border-border">
          <View className="flex-row bg-surface">
            {block.headers.map((cell, cellIndex) => (
              <Text
                key={cellIndex}
                style={{ width: 160 }} className="border-r border-border px-3 py-2 text-sm leading-5 font-semibold text-foreground"
              >
                <InlineSpans spans={parseInlineMarkdown(cell)} muted={false} linkColor={link} />
              </Text>
            ))}
          </View>
          {block.rows.map((row, rowIndex) => (
            <View key={rowIndex} className="flex-row border-t border-border">
              {block.headers.map((_, cellIndex) => (
                <Text
                  key={cellIndex}
                  style={{ width: 160 }} className="border-r border-border px-3 py-2 text-sm leading-5 text-foreground"
                >
                  <InlineSpans spans={parseInlineMarkdown(row[cellIndex] ?? '')} muted={false} linkColor={link} />
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    );
  }
  if (block.type === 'list') {
    return (
      <View className="gap-1">
        {block.items.map((item, itemIndex) => (
          item.children ? <View key={itemIndex} className="pl-4"><MarkdownText text={item.text} muted={muted} streaming={streaming} fullHeightCode={fullHeightCode} /></View> :
          <View key={itemIndex} className="flex-row gap-2 pr-1">
            <Text className={muted ? 'text-[13px] leading-5 text-muted' : 'text-[15px] leading-[24px] text-muted'}>
              {item.checked === undefined ? (block.ordered ? (block.start ?? 1) + itemIndex + '.' : '•') : item.checked ? '☑' : '☐'}
            </Text>
            <Text selectable className={muted ? 'flex-1 text-[13px] leading-5 text-muted' : 'flex-1 text-[15px] leading-[24px] text-foreground'}>
              <InlineSpans spans={parseInlineMarkdown(item.text)} muted={muted} linkColor={link} streaming={streaming && itemIndex === block.items.length - 1} />
            </Text>
          </View>
        ))}
      </View>
    );
  }
  const spans = parseInlineMarkdown(block.text);
  const hasImage = spans.some((span) => span.image !== undefined);
  if (hasImage) {
    return (
      <View className="gap-2">
        {spans.map((span, i) => span.image !== undefined ? <RemoteImage key={i} image={{ url: span.image, name: span.text }} /> : <Text key={i} selectable className="text-[15px] leading-6 text-foreground"><InlineSpans spans={[span]} muted={muted} linkColor={link} /></Text>)}
      </View>
    );
  }
  return (
    <Text selectable className={muted ? 'text-[13px] leading-5 text-muted' : 'text-[15px] leading-[24px] text-foreground'}>
      <InlineSpans spans={spans} muted={muted} linkColor={link} streaming={streaming} />
    </Text>
  );

}, (prev, next) => prev.fullHeightCode === next.fullHeightCode && prev.muted === next.muted && prev.link === next.link && prev.streaming === next.streaming && sameMarkdownBlock(prev.block, next.block));
