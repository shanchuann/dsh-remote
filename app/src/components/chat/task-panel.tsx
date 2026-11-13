import { useMemo, useState } from 'react';
import { Keyboard, Pressable, ScrollView, Text, View } from 'react-native';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { useResolveClassNames } from 'uniwind';
import { readTodos } from '../../lib/transcript';
import { TaskRows } from './beautiful/task-rows';
import { ExpandCircleDownIcon, ExpandCircleUpIcon } from '../common/icons';
export function TaskPanel({ value, teamTasks, maxHeight = 300 }: { value: unknown; teamTasks?: unknown[]; maxHeight?: number }) {
  const items = useMemo(() => [...readTodos(value).map(t => ({ ...t, id: "todo-" + t.id })), ...readTodos(teamTasks).map(t => ({ ...t, id: "team-" + t.id }))], [value, teamTasks]);
  const [expanded, setExpanded] = useState(true);
  const keyboardVisible = useKeyboardState(state => state.isVisible);
  const { color: muted } = useResolveClassNames('text-muted');
  const showExpanded = expanded && !keyboardVisible;
  if (!items.length) return null;
  return <View className="shrink-0 pb-1">
    <Pressable accessibilityRole="button" accessibilityLabel={showExpanded ? '收起工作板' : '展开工作板'} accessibilityState={{ expanded: showExpanded }} onPress={() => { if (keyboardVisible) { setExpanded(true); Keyboard.dismiss(); } else setExpanded(!expanded); }} className="min-h-11 flex-row items-center justify-between px-4">
      <Text className="text-xs font-medium text-foreground">任务进度 {items.filter(x => x.status === 'completed').length}/{items.length}</Text>
      <View className="flex-row items-center gap-1.5"><Text className="text-xs text-muted">{showExpanded ? '收起' : '展开'}</Text>{showExpanded ? <ExpandCircleUpIcon size={22} color={muted} /> : <ExpandCircleDownIcon size={22} color={muted} />}</View>
    </Pressable>
    {showExpanded ? <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: Math.max(0, maxHeight - 48), flexGrow: 0 }}><TaskRows items={items} showSummary={false} /></ScrollView> : null}
  </View>;
}
