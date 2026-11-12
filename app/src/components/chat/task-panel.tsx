import { useMemo, useState } from 'react';
import { Keyboard, Pressable, ScrollView, Text, View } from 'react-native';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { readTodos } from '../../lib/transcript';
import { TaskRows } from './beautiful/task-rows';
export function TaskPanel({ value, teamTasks }: { value: unknown; teamTasks?: unknown[] }) {
  const items = useMemo(() => [...readTodos(value).map(t => ({ ...t, id: "todo-" + t.id })), ...readTodos(teamTasks).map(t => ({ ...t, id: "team-" + t.id }))], [value, teamTasks]);
  const [expanded, setExpanded] = useState(true);
  const keyboardVisible = useKeyboardState(state => state.isVisible);
  const showExpanded = expanded && !keyboardVisible;
  if (!items.length) return null;
  return <View className="shrink-0 overflow-hidden border-t border-border pb-2">
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: showExpanded }} onPress={() => { if (keyboardVisible) { setExpanded(true); Keyboard.dismiss(); } else setExpanded(!expanded); }} className="min-h-11 flex-row items-center justify-between px-4">
      <Text className="text-xs font-medium text-foreground">任务进度 {items.filter(x => x.status === 'completed').length}/{items.length}</Text><Text className="text-xs text-muted">{showExpanded ? '收起 ▾' : '展开 ▸'}</Text>
    </Pressable>
    {showExpanded ? <ScrollView nestedScrollEnabled style={{ maxHeight: 160, flexGrow: 0, overflow: 'hidden' }} contentContainerStyle={{ paddingBottom: 12 }}><TaskRows items={items} showSummary={false} /></ScrollView> : null}
  </View>;
}
