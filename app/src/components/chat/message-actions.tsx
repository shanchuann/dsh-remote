import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Alert, Platform, Pressable, Text, View, type ViewProps } from 'react-native';
import { requireNativeView } from 'expo';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useResolveClassNames } from 'uniwind';
import { useRemoteStore } from '../../lib/store';
import type { MessageFeedback } from '../../lib/types';
import { messageTimeLabel, messageUsageLabel } from '../../lib/message-metadata';
import type { AssistantMessageItem } from './assistant-message';
import { BranchIcon, CheckIcon, CopyIcon, ThumbDownIcon, ThumbUpIcon, UsageIcon, type CommonIconProps } from '../common/icons';

type Rating = 'positive' | 'negative';
type ActionsContext = { onQuote: (text: string) => void; feedback: Record<string, MessageFeedback>; rate: (id: string, rating: Rating) => Promise<void>; ready: boolean };
const Context = createContext<ActionsContext | undefined>(undefined);

export function MessageActionsProvider({ sessionId, onQuote, children }: { sessionId: string; onQuote: (text: string) => void; children: ReactNode }) {
  const actions = useRemoteStore(s => s.actions);
  const supported = useRemoteStore(s => s.host?.capabilities?.messageFeedback === true);
  const [feedback, setFeedback] = useState<Record<string, MessageFeedback>>({});
  const [ready, setReady] = useState(!supported);
  const refresh = useCallback(async () => {
    const items = await actions.loadMessageFeedback(sessionId);
    setFeedback(Object.fromEntries(items.map(item => [item.messageId, item])));
  }, [actions, sessionId]);
  useEffect(() => {
    let active = true;
    if (!supported) return;
    void actions.loadMessageFeedback(sessionId).then(items => {
      if (active) setFeedback(Object.fromEntries(items.map(item => [item.messageId, item])));
    }).catch(() => undefined).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [actions, sessionId, supported]);
  const rate = useCallback(async (id: string, rating: Rating) => {
    if (!supported) throw new Error('请更新电脑端 DSH Remote 插件，并启用 DSH 消息反馈服务。');
    const current = feedback[id];
    const next = current?.rating === rating ? null : rating;
    try {
      const result = await actions.rateMessage(sessionId, id, next, current?.version ?? null);
      setFeedback(all => {
        const copy = { ...all };
        if (next === null) delete copy[id];
        else if (result.version && result.rating) copy[id] = result as MessageFeedback;
        return copy;
      });
    } catch (error) { await refresh().catch(() => undefined); throw error; }
  }, [actions, sessionId, supported, refresh, feedback]);
  const value = useMemo(() => ({ onQuote, feedback, rate, ready }), [onQuote, feedback, rate, ready]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

type SelectionProps = ViewProps & { enabled: boolean; onQuote: (event: { nativeEvent: { text: string } }) => void };
const NativeSelection: ComponentType<SelectionProps> | undefined = Platform.OS === 'android' ? requireNativeView('DshVoice') : undefined;

export function QuotableMessage({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const context = useContext(Context);
  if (!NativeSelection) return <View>{children}</View>;
  return <NativeSelection style={{ width: '100%' }} enabled={enabled && !!context} onQuote={event => context?.onQuote(event.nativeEvent.text)}>{children}</NativeSelection>;
}

function ActionButton({ label, Icon, onPress, selected, disabled }: { label: string; Icon: ComponentType<CommonIconProps>; onPress: () => void; selected?: boolean; disabled?: boolean }) {
  const { color } = useResolveClassNames(selected ? 'text-primary' : 'text-muted');
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} hitSlop={4} className={'h-11 w-9 items-center justify-center rounded-lg active:bg-surface ' + (disabled ? 'opacity-40' : '')}><Icon size={18} color={color} /></Pressable>;
}

export function MessageActions({ item }: { item: AssistantMessageItem }) {
  const context = useContext(Context);
  const sessionId = useRemoteStore(s => s.current.sessionId);
  const actions = useRemoteStore(s => s.actions);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { color: muted } = useResolveClassNames('text-muted');
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!context || item.streaming || !item.text) return null;
  const { feedback, rate, ready } = context;
  const usageLabel = messageUsageLabel(item.usage);
  const timeLabel = messageTimeLabel(item.time);
  const run = async (task: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await task(); } catch (error) { Alert.alert('操作未完成', error instanceof Error ? error.message : String(error)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const fork = async () => {
    if (!sessionId || item.seq === undefined) throw new Error('此消息缺少历史序号，暂不能创建分支。');
    const result = await actions.forkSession(sessionId, item.seq);
    router.push({ pathname: '/session/[id]', params: { id: result.sessionId } });
  };
  return <View className="flex-row flex-wrap items-center py-1">
    <ActionButton label={copied ? '已复制消息' : '复制消息'} Icon={copied ? CheckIcon : CopyIcon} onPress={() => void run(async () => { await Clipboard.setStringAsync(item.text); setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1600); })} />
    <ActionButton label="好的回答" Icon={ThumbUpIcon} selected={feedback[item.id]?.rating === 'positive'} disabled={busy || !ready} onPress={() => void run(() => rate(item.id, 'positive'))} />
    <ActionButton label="坏的回答" Icon={ThumbDownIcon} selected={feedback[item.id]?.rating === 'negative'} disabled={busy || !ready} onPress={() => void run(() => rate(item.id, 'negative'))} />
    <ActionButton label="在新对话中分支" Icon={BranchIcon} disabled={busy || item.seq === undefined} onPress={() => void run(fork)} />
    <View className="min-h-11 flex-row items-center gap-1 px-1"><UsageIcon size={18} color={muted} /><Text className="text-[10px] tabular-nums text-muted">{usageLabel}</Text></View>
    {timeLabel ? <View className="min-h-11 justify-center px-1"><Text className="text-[10px] tabular-nums text-muted">{timeLabel}</Text></View> : null}
  </View>;
}
