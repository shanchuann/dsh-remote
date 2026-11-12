import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResolveClassNames } from 'uniwind';

import { CrossGlyph } from '../../primitives/agent-icons';
import type { SessionRow } from '../../lib/types';
import { formatRelativeTime } from '../../lib/format';
import { ChevronRightIcon } from '../common/icons';
import { SkeletonBlock, SkeletonGroup } from '../common/skeleton';

export function SubagentSheet({ visible, agents, loading, error, onClose, onOpen, onRefresh }: {
  visible: boolean;
  agents: readonly SessionRow[];
  loading: boolean;
  error?: string;
  onClose: () => void;
  onOpen: (id: string) => void;
  onRefresh: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { color } = useResolveClassNames('text-muted');
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <Pressable className="absolute inset-0 bg-black/45" accessibilityRole="button" accessibilityLabel="关闭子智能体列表" onPress={onClose} />
        <View className="max-h-[78%] overflow-hidden rounded-t-3xl bg-background" style={{ paddingBottom: insets.bottom + 8 }}>
          <View className="mb-1 mt-3 h-1 w-8 self-center rounded-full bg-border-strong" />
          <View className="flex-row items-center px-4 pt-3">
            <Text className="flex-1 text-base font-semibold leading-6 text-foreground">子智能体{agents.length > 0 ? ' (' + agents.length + ')' : ''}</Text>
            <Pressable className="size-12 items-center justify-center rounded-full active:bg-surface" accessibilityRole="button" accessibilityLabel="关闭" onPress={onClose}>
              <CrossGlyph size={18} color={color} />
            </Pressable>
          </View>
          <Text className="px-4 pb-3 text-xs leading-[18px] text-muted">当前对话派生的任务与运行状态</Text>
          <ScrollView contentContainerClassName="pb-3" keyboardShouldPersistTaps="handled">
            {error ? (
              <View className="gap-2 px-4 py-3">
                <Text className="text-sm text-destructive">{error}</Text>
                <Pressable accessibilityRole="button" onPress={onRefresh} className="min-h-12 justify-center"><Text className="text-sm text-primary">重新获取</Text></Pressable>
              </View>
            ) : null}
            {loading && agents.length === 0 ? (
              <SkeletonGroup className="gap-4 px-4 py-4">
                {[0, 1, 2].map((id) => <View key={id} className="gap-2"><SkeletonBlock className="h-4 w-4/5" /><SkeletonBlock className="h-3 w-1/3" /></View>)}
              </SkeletonGroup>
            ) : agents.length === 0 && !error ? (
              <Text className="px-4 py-10 text-center text-sm text-muted">当前对话还没有子智能体</Text>
            ) : agents.map((agent) => (
              <Pressable key={agent.sessionId} accessibilityRole="button" accessibilityLabel={'查看子智能体 ' + (agent.title || '未命名任务')}
                onPress={() => onOpen(agent.sessionId)} className="min-h-16 flex-row items-center gap-3 border-t border-border px-4 py-3 active:bg-surface">
                <View className={'size-2 rounded-full ' + (agent.running ? 'bg-primary' : 'bg-muted/40')} />
                <View className="flex-1 gap-1">
                  <Text className="text-sm font-medium leading-5 text-foreground" numberOfLines={2}>{agent.title || '未命名任务'}</Text>
                  <Text className="text-xs text-muted">{agent.running ? '运行中' : '未运行'}　{formatRelativeTime(agent.updatedAt)}</Text>
                </View>
                <ChevronRightIcon size={16} color={color} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
