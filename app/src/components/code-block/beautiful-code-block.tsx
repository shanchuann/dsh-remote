/** Native adaptation of beautifului.dev/r/code-block.json: Code and unified Diff. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import VirtualizedLists from '@react-native/virtualized-lists';
import * as Clipboard from 'expo-clipboard';
import { useResolveClassNames } from 'uniwind';
import { useCodeTokens } from '../../primitives/code-tokens';
import { CheckIcon, DocsIcon } from '../common/icons';
import { parseDiff } from './diff';
import type { CodeBlockProps } from './code-block';

// This code viewport scrolls independently of the surrounding conversation.
const IndependentList = VirtualizedLists.VirtualizedListContextResetter;

export function CodeBlock({ code, language = 'text', filename, status = 'complete', maxHeight = 280, fullHeight = false, wrap: initialWrap = false, showLineNumbers = true, onCopy, className = '', highlightLines = [], ...props }: CodeBlockProps) {
  const [wrap, setWrap] = useState(initialWrap);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const [width, setWidth] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { fontScale } = useWindowDimensions();
  const lineHeight = 21 * fontScale;
  const { color: muted } = useResolveClassNames('text-muted');
  const diff = language === 'diff' || language === 'patch' || /^diff --git |^@@ -\d/m.test(code);
  const rows = useMemo(() => diff ? parseDiff(code) : [], [code, diff]);
  const tokens = useCodeTokens(code, diff ? 'text' : language, status !== 'streaming');
  const indices = useMemo(() => Array.from({ length: diff ? rows.length : tokens.length }, (_, i) => i), [diff, rows.length, tokens.length]);
  const codeList = useRef<FlatList<number>>(null);
  const following = useRef(true);
  const added = rows.filter(r => r.kind === 'add').length, removed = rows.filter(r => r.kind === 'del').length;
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try { if (onCopy) await onCopy(); else await Clipboard.setStringAsync(code); setError(false); setCopied(true); }
    catch { setError(true); }
    clearTimeout(timer.current); timer.current = setTimeout(() => { setCopied(false); setError(false); }, 1600);
  };
  const contentWidth = wrap ? width : code.split('\n').reduce((max, line) => Math.max(max, Array.from(line).reduce((units, char) => units + ((char.codePointAt(0) ?? 0) > 255 ? 13 : 8), 0) * fontScale + (diff ? 88 : 44)), width);
  const numberStyle = { width: diff ? 30 * fontScale : 28 * fontScale, lineHeight, fontSize: 11, textAlign: 'right' as const };
  const textStyle = { lineHeight, fontSize: 12.5, flex: 1, minWidth: 0, paddingHorizontal: 8 };
  const renderLine = (i: number) => {
              const row = rows[i];
              const line = tokens[i];
              return diff ? (
              <View key={i} className={'flex-row border-l-2 py-0.5 ' + (row.kind === 'add' ? 'border-success bg-success/10' : row.kind === 'del' ? 'border-destructive bg-destructive/10' : 'border-transparent')}>
                <Text className="font-mono text-muted" style={numberStyle}>{row.old ?? ''}</Text><Text className="font-mono text-muted" style={numberStyle}>{row.current ?? ''}</Text>
                <Text selectable className="font-mono text-foreground" style={textStyle}>{row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}{row.changed !== undefined ? <>{row.prefix}<Text className={row.kind === 'add' ? 'bg-success/20' : 'bg-destructive/20'}>{row.changed}</Text>{row.suffix}</> : row.text || ' '}</Text>
              </View>
              ) : (
              <View key={i} className={'flex-row py-0.5 ' + (highlightLines.includes(i + 1) ? 'bg-primary/10' : '')}>
                {showLineNumbers ? <Text className="font-mono text-muted" style={numberStyle}>{i + 1}</Text> : null}
                <Text selectable className="font-mono text-foreground" style={textStyle}>{line.map((token, n) => <Text key={n} style={{ color: token.color }}>{token.content || ' '}</Text>)}</Text>
              </View>
              );
            };
  return (
    <View className={'w-full overflow-hidden rounded-2xl border border-border bg-surface ' + className} {...props}>
      <View className="min-h-11 flex-row flex-wrap items-center gap-1 border-b border-border pl-3 pr-1 py-1">
        <DocsIcon size={15} color={muted} />
        <Text numberOfLines={1} className="min-w-0 flex-1 font-mono text-xs text-foreground">{filename || (diff ? 'Diff' : language)}</Text>
        {diff ? <View className="flex-row gap-2 px-1"><Text className="text-xs text-success">+{added}</Text><Text className="text-xs text-destructive">−{removed}</Text></View> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="切换代码换行" accessibilityState={{ selected: wrap }} onPress={() => setWrap(!wrap)} className="min-h-12 justify-center px-2"><Text className={'text-xs ' + (wrap ? 'text-primary' : 'text-muted')}>换行</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="复制代码" onPress={() => void copy()} className="min-h-12 flex-row items-center gap-1 px-2">{copied ? <CheckIcon size={12} color={muted} /> : null}<Text className="text-xs text-muted">{error ? '复制失败' : copied ? '已复制' : '复制'}</Text></Pressable>
      </View>
      <View onLayout={e => setWidth(e.nativeEvent.layout.width)}>
        <ScrollView horizontal scrollEnabled={!wrap} nestedScrollEnabled contentContainerStyle={{ width: contentWidth || undefined }}>
          {fullHeight ? <View style={{ width: contentWidth || width || 1, paddingVertical: 12 }}>{indices.map(renderLine)}</View> : <IndependentList>
          <FlatList
            ref={codeList}
            style={{ width: contentWidth || width || 1, height: Math.min(maxHeight, contentHeight || indices.length * (lineHeight + 4) + 24) }}
            contentContainerStyle={{ paddingVertical: 12 }}
            nestedScrollEnabled
            data={indices}
            keyExtractor={i => String(i)}
            initialNumToRender={16}
            maxToRenderPerBatch={12}
            windowSize={5}
            scrollEventThrottle={64}
            onScroll={({ nativeEvent: e }) => { following.current = e.contentSize.height - e.contentOffset.y - e.layoutMeasurement.height < 48; }}
            onContentSizeChange={(_, height) => {
              setContentHeight(current => current === height ? current : height);
              if (status === 'streaming' && following.current) codeList.current?.scrollToEnd({ animated: false });
            }}
            renderItem={({ item: i }) => renderLine(i)}
          />
          </IndependentList>}
        </ScrollView>
      </View>
    </View>
  );
}
