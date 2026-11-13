/** Native Capsules variant of BeautifulUI TaskRows; all states come from todo/write. */
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useResolveClassNames } from 'uniwind';
import type { TranscriptTodo } from '../../../lib/transcript';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, CloseIcon } from '../../common/icons';
import { useReducedMotionPreference } from '../../../hooks/use-reduced-motion';

const LABELS = { pending: '待处理', 'in-progress': '进行中', completed: '已完成', cancelled: '已取消' };

function TaskCapsule({ item, index }: { item: TranscriptTodo; index: number }) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotionPreference();
  const { color: muted } = useResolveClassNames('text-muted');
  const { color: primary } = useResolveClassNames('text-primary');
  const { color: onPrimary } = useResolveClassNames('text-on-primary');
  const { color: border } = useResolveClassNames('text-border-strong');
  const running = item.status === 'in-progress';
  const done = item.status === 'completed';
  const cancelled = item.status === 'cancelled';
  const progress = typeof item.progress === 'number' && Number.isFinite(item.progress) ? Math.min(100, Math.max(0, item.progress)) : undefined;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={item.title + '，' + LABELS[item.status]}
      onPress={() => setOpen(!open)} className={'gap-2 border border-border bg-surface px-3 py-2 active:opacity-80 ' + (open ? 'rounded-2xl' : 'rounded-[28px]')}>
      <View className="min-h-8 flex-row items-center gap-2.5">
        {done || cancelled ? (
          <View className={'size-6 items-center justify-center rounded-full ' + (done ? 'bg-success' : 'bg-muted')}>
            {done ? <CheckIcon size={14} color={onPrimary} /> : <CloseIcon size={13} color={onPrimary} />}
          </View>
        ) : (
          <View className="size-6 items-center justify-center">
            {running && progress === undefined && !reduce ? <ActivityIndicator size={24} color={typeof primary === 'string' ? primary : undefined} style={{ position: 'absolute' }} /> : (
              <Svg width={24} height={24} viewBox="0 0 24 24" style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
                <Circle cx={12} cy={12} r={10} fill="none" stroke={border} strokeWidth={2} />
                {progress === undefined ? null : <Circle cx={12} cy={12} r={10} fill="none" stroke={primary} strokeWidth={2} strokeDasharray={[62.83 * progress / 100, 62.83]} strokeLinecap="round" />}
              </Svg>
            )}
            <Text className="text-[10px] font-semibold tabular-nums text-foreground">{index + 1}</Text>
          </View>
        )}
        <Text className="min-w-0 flex-1 text-sm font-medium leading-5 text-foreground" numberOfLines={open ? undefined : 2}>{item.title}</Text>
        <Text className={'shrink-0 rounded-full px-2 py-1 text-xs leading-4 ' + (done ? 'bg-success/10 text-success' : running ? 'bg-primary/10 text-primary' : 'text-muted')}>{LABELS[item.status]}</Text>
        {open ? <ChevronUpIcon size={18} color={muted} /> : <ChevronDownIcon size={18} color={muted} />}
      </View>
      {open && progress !== undefined && !done ? (
        <View className="ml-8 gap-2 pb-1 pr-2">
          <Text className="text-xs tabular-nums text-muted">进度 {Math.round(progress)}%</Text>
          <View className="h-1 overflow-hidden rounded-full bg-border"><View className="h-1 rounded-full bg-primary" style={{ width: `${progress}%` }} /></View>
        </View>
      ) : null}
    </Pressable>
  );
}

export function TaskRows({ items, showSummary = true }: { items: readonly TranscriptTodo[]; showSummary?: boolean }) {
  if (items.length === 0) return null;
  return (
    <View className="w-full gap-2 px-4 py-2">
      {showSummary ? <Text className="pb-1 text-xs tabular-nums text-muted">任务 {items.filter((item) => item.status === 'completed').length}/{items.length}</Text> : null}
      {items.map((item, index) => <TaskCapsule key={item.id} item={item} index={index} />)}
    </View>
  );
}
