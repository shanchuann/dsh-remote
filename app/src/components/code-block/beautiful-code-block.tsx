/** Native adaptation of beautifului.dev/r/code-block.json: Code and unified Diff. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useResolveClassNames } from 'uniwind';
import { useCodeTokens } from '../../primitives/code-tokens';
import { CheckIcon, DocsIcon } from '../common/icons';
import { parseDiff } from './diff';
import type { CodeBlockProps } from './code-block';

export function CodeBlock({ code, language = 'text', filename, status = 'complete', maxHeight = 280, wrap: initialWrap = true, showLineNumbers = true, onCopy, className = '', highlightLines = [], ...props }: CodeBlockProps) {
  const [wrap, setWrap] = useState(initialWrap);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const [width, setWidth] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { fontScale } = useWindowDimensions();
  const lineHeight = 21 * fontScale;
  const { color: muted } = useResolveClassNames('text-muted');
  const diff = language === 'diff' || language === 'patch' || /^diff --git |^@@ -\d/m.test(code);
  const rows = useMemo(() => diff ? parseDiff(code) : [], [code, diff]);
  const tokens = useCodeTokens(code, diff ? 'text' : language, status !== 'streaming');
  const added = rows.filter(r => r.kind === 'add').length, removed = rows.filter(r => r.kind === 'del').length;
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try { if (onCopy) await onCopy(); else await Clipboard.setStringAsync(code); setError(false); setCopied(true); }
    catch { setError(true); }
    clearTimeout(timer.current); timer.current = setTimeout(() => { setCopied(false); setError(false); }, 1600);
  };
  const contentWidth = wrap ? width : Math.max(width, ...code.split('\n').map(line => line.length * 8 * fontScale + (diff ? 88 : 44)));
  const numberStyle = { width: diff ? 30 * fontScale : 28 * fontScale, lineHeight, fontSize: 11, textAlign: 'right' as const };
  const textStyle = { lineHeight, fontSize: 12.5, flex: 1, minWidth: 0, paddingHorizontal: 8 };
  return (
    <View className={'w-full overflow-hidden rounded-2xl border border-border bg-surface ' + className} {...props}>
      <View className="min-h-11 flex-row flex-wrap items-center gap-1 border-b border-border pl-3 pr-1 py-1">
        <DocsIcon size={15} color={muted} />
        <Text numberOfLines={1} className="min-w-0 flex-1 font-mono text-xs text-foreground">{filename || (diff ? 'Diff' : language)}</Text>
        {diff ? <View className="flex-row gap-2 px-1"><Text className="text-xs text-success">+{added}</Text><Text className="text-xs text-destructive">−{removed}</Text></View> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="切换代码换行" accessibilityState={{ selected: wrap }} onPress={() => setWrap(!wrap)} className="min-h-12 justify-center px-2"><Text className={'text-xs ' + (wrap ? 'text-primary' : 'text-muted')}>换行</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="复制代码" onPress={() => void copy()} className="min-h-12 flex-row items-center gap-1 px-2">{copied ? <CheckIcon size={12} color={muted} /> : null}<Text className="text-xs text-muted">{error ? '复制失败' : copied ? '已复制' : '复制'}</Text></Pressable>
      </View>
      <ScrollView nestedScrollEnabled style={{ maxHeight }} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
        <ScrollView horizontal scrollEnabled={!wrap} nestedScrollEnabled contentContainerStyle={{ width: contentWidth || undefined, paddingVertical: 12 }}>
          <View style={{ width: contentWidth || '100%' }}>
            {diff ? rows.map((row, i) => (
              <View key={i} className={'flex-row border-l-2 py-0.5 ' + (row.kind === 'add' ? 'border-success bg-success/10' : row.kind === 'del' ? 'border-destructive bg-destructive/10' : 'border-transparent')}>
                <Text className="font-mono text-muted" style={numberStyle}>{row.old ?? ''}</Text><Text className="font-mono text-muted" style={numberStyle}>{row.current ?? ''}</Text>
                <Text selectable className="font-mono text-foreground" style={textStyle}>{row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}{row.changed !== undefined ? <>{row.prefix}<Text className={row.kind === 'add' ? 'bg-success/20' : 'bg-destructive/20'}>{row.changed}</Text>{row.suffix}</> : row.text || ' '}</Text>
              </View>
            )) : tokens.map((line, i) => (
              <View key={i} className={'flex-row py-0.5 ' + (highlightLines.includes(i + 1) ? 'bg-primary/10' : '')}>
                {showLineNumbers ? <Text className="font-mono text-muted" style={numberStyle}>{i + 1}</Text> : null}
                <Text selectable className="font-mono text-foreground" style={textStyle}>{line.map((token, n) => <Text key={n} style={{ color: token.color }}>{token.content || ' '}</Text>)}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </ScrollView>
    </View>
  );
}
