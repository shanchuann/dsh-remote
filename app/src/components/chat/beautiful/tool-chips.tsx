/** Native BeautifulUI ToolChips, with expandable real inputs and outputs. */
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useResolveClassNames } from 'uniwind';
import type { TranscriptItem } from '../../../lib/transcript';
import { useReducedMotionPreference } from '../../../hooks/use-reduced-motion';
import { ChevronDownGlyph } from '../../../primitives/agent-icons';
import { Disclosure } from '../../../primitives/disclosure';
import { CheckIcon, CloseIcon, DocsIcon, SearchIcon, TerminalIcon } from '../../common/icons';
import { CodeBlock } from '../../code-block';
import { toolCode, toolKind, toolLabel, toolTarget } from '../format';
import { MarkdownText } from '../markdown';
import { RemoteImage } from '../session-files';
import { DotsGrid } from './loading-state';

export type ToolChipItem = Extract<TranscriptItem, { kind: 'tool' }>;

function ToolRow({ item }: { item: ToolChipItem }) {
  const [manualOpen, setManualOpen] = useState<boolean | undefined>();
  const open = manualOpen ?? item.status === 'error';
  const reduce = useReducedMotionPreference();
  const { color: muted } = useResolveClassNames('text-muted');
  const { color: statusColor } = useResolveClassNames(item.status === 'error' ? 'text-destructive' : 'text-success');
  const code = useMemo(() => toolCode(item.name, item.input), [item.name, item.input]);
  const fallbackInput = useMemo(() => {
    if (item.input === undefined || code) return undefined;
    try { return JSON.stringify(item.input, null, 2); } catch { return String(item.input); }
  }, [code, item.input]);
  const meta = item.meta && typeof item.meta === "object" ? item.meta as Record<string, unknown> : undefined;
  const sources = Array.isArray(meta?.sources) ? meta.sources.filter((s): s is { url: string; title?: string; snippet?: string } => !!s && typeof s === "object" && typeof s.url === "string" && /^https?:/i.test(s.url)) : [];
  const target = toolTarget(item.name, item.input) || item.name;
  const kind = toolKind(item.name);
  const Icon = kind === 'terminal' ? TerminalIcon : kind === 'request' ? SearchIcon : DocsIcon;
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={toolLabel(item.name) + '，' + (item.status === 'running' ? '运行中' : item.status === 'error' ? '失败' : '完成')}
        onPress={() => setManualOpen(!open)} className="min-h-12 flex-row items-center gap-2 rounded-lg py-2 active:bg-surface">
        <Icon size={15} color={muted} />
        <Text className="max-w-[38%] text-sm font-medium leading-5 text-foreground" numberOfLines={1}>{toolLabel(item.name)}</Text>
        <View className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1">
          <Text className="text-xs leading-4 text-muted" numberOfLines={1}>{target}</Text>
        </View>
        {item.status === 'running' ? <DotsGrid /> : item.status === 'error' ? <CloseIcon size={14} color={statusColor} /> : <CheckIcon size={14} color={statusColor} />}
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}><ChevronDownGlyph size={12} color={muted} /></View>
      </Pressable>
      <Disclosure open={open} reduce={reduce}>
        <View className="mb-2 ml-2 gap-2 border-l border-border pl-4">
          {code ? <CodeBlock code={code.code} language={code.language} status="complete" fullHeight wrap={false} /> : fallbackInput ? <CodeBlock code={fallbackInput} language="json" status="complete" fullHeight wrap={false} /> : null}
          {sources.length ? <MarkdownText text={sources.map(s => '- [' + (s.title ?? s.url) + '](' + s.url + ')' + (s.snippet ? ' '+ s.snippet : '')).join('\n')} muted /> : null}
          {typeof meta?.url === 'string' && /^https?:/i.test(meta.url) ? <MarkdownText text={'[打开原网页](' + meta.url + ')'} muted /> : null}
          {meta?.truncated === true ? <Text className="text-xs text-muted">网页内容已截取，可打开原网页阅读完整内容。</Text> : null}
          {item.images?.map((image, index) => <RemoteImage key={index} image={image} />)}
          {item.result ? (
            <MarkdownText text={item.result} muted fullHeightCode />
          ) : <Text className="py-1 text-xs text-muted">{item.status === 'running' ? '执行中' : '无输出'}</Text>}
        </View>
      </Disclosure>
    </View>
  );
}

export function ToolChips({ items }: { items: readonly ToolChipItem[] }) {
  const [open, setOpen] = useState(true);
  const reduce = useReducedMotionPreference();
  const { color } = useResolveClassNames('text-muted');
  return (
    <View className="w-full px-4 py-1">
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={open ? '收起工具调用' : '展开工具调用'}
        onPress={() => setOpen(!open)} className="min-h-12 flex-row items-center gap-2 self-start rounded-lg pr-3 active:bg-surface">
        <View style={{ transform: [{ rotate: open ? '0deg' : '-90deg' }] }}><ChevronDownGlyph size={13} color={color} /></View>
        <Text className="text-xs tabular-nums text-muted">{items.length} 次工具调用</Text>
      </Pressable>
      <Disclosure open={open} reduce={reduce}>
        {items.map((item) => <ToolRow key={item.callId || item.id} item={item} />)}
      </Disclosure>
    </View>
  );
}
