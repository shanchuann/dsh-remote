import { useMemo } from 'react';
import { Image, Linking, ScrollView, Text, View } from 'react-native';
import { useResolveClassNames } from 'uniwind';

import type { MarkdownInline } from './markdown-parse';
import { parseInlineMarkdown, parseMarkdownBlocks } from './markdown-parse';

function InlineSpans({ spans, muted, linkColor }: { spans: MarkdownInline[]; muted: boolean; linkColor: string }) {
  return (
    <>
      {spans.map((span, index) => {
        if (span.image !== undefined) {
          return (
            <Image
              key={index}
              source={{ uri: span.image }}
              accessibilityLabel={span.text || '图片'}
              resizeMode="contain"
              style={{ width: '100%', height: 180, borderRadius: 10, marginVertical: 4 }}
            />
          );
        }
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
        return (
          <Text
            key={index}
            className={classes}
            style={style}
            onPress={span.href ? () => void Linking.openURL(span.href as string).catch(() => undefined) : undefined}
          >
            {span.text}
          </Text>
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
        if (block.type === 'hr') return <View key={index} className="my-1 h-px w-full bg-border" />;
        if (block.type === 'quote') {
          return (
            <View key={index} className="border-l-2 border-border pl-3">
              <Text selectable className="text-[14px] leading-6 text-muted">
                <InlineSpans spans={parseInlineMarkdown(block.text)} muted linkColor={link} />
              </Text>
            </View>
          );
        }
        if (block.type === 'table') {
          return (
            <ScrollView key={index} horizontal showsHorizontalScrollIndicator={false} className="my-1">
              <View className="overflow-hidden rounded-xl border border-border">
                <View className="flex-row bg-surface">
                  {block.headers.map((cell, cellIndex) => (
                    <Text
                      key={cellIndex}
                      className="min-w-[92px] flex-1 border-r border-border px-2.5 py-2 text-[12px] font-semibold text-foreground"
                    >
                      {cell}
                    </Text>
                  ))}
                </View>
                {block.rows.map((row, rowIndex) => (
                  <View key={rowIndex} className="flex-row border-t border-border">
                    {row.map((cell, cellIndex) => (
                      <Text
                        key={cellIndex}
                        className="min-w-[92px] flex-1 border-r border-border px-2.5 py-2 text-[12px] leading-4 text-foreground/90"
                      >
                        {cell}
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
            <View key={index} className="gap-1">
              {block.items.map((item, itemIndex) => (
                <View key={itemIndex} className="flex-row gap-2 pr-1">
                  <Text className={muted ? 'text-[13px] leading-5 text-muted' : 'text-[15px] leading-[24px] text-muted'}>
                    {item.checked === undefined ? (block.ordered ? itemIndex + 1 + '.' : '•') : item.checked ? '☑' : '☐'}
                  </Text>
                  <Text selectable className={muted ? 'flex-1 text-[13px] leading-5 text-muted' : 'flex-1 text-[15px] leading-[24px] text-foreground'}>
                    <InlineSpans spans={parseInlineMarkdown(item.text)} muted={muted} linkColor={link} />
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
            <View key={index} className="gap-2">
              <InlineSpans spans={spans} muted={muted} linkColor={link} />
            </View>
          );
        }
        return (
          <Text key={index} selectable className={muted ? 'text-[13px] leading-5 text-muted' : 'text-[15px] leading-[24px] text-foreground'}>
            <InlineSpans spans={spans} muted={muted} linkColor={link} />
          </Text>
        );
      })}
    </View>
  );
}