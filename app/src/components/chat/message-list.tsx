import { memo, useCallback, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { FlatList, Pressable, Text, View } from "react-native";

import type { MessageScrollerHandle } from "../message-scroller";
import type { TranscriptItem } from "../../lib/transcript";
import { ApprovalHistoryCard } from "./approval-history";
import { AssistantMessage } from "./assistant-message";
import { WorkspaceChanges } from "./workspace-changes";
import { Deliverables } from "./deliverables";
import { TodoBlock } from "./todo-block";
import { ToolCallCard } from "./tool-call-card";
import { TurnDivider } from "./turn-divider";
import { UserMessageRow } from "./user-message-row";
import { LoadingState } from "./beautiful/loading-state";
import { ToolChips } from "./beautiful/tool-chips";
import { groupToolRuns, type DisplayItem } from "./beautiful/transcript-groups";

export type MessageListProps = {
  topInset?: number;
  bottomInset?: number;
  items: readonly TranscriptItem[];
  running: boolean;
  /** True while assistant text is arriving, which replaces the typing dots. */
  streaming: boolean;
  /** Turn separators are an opt-in reading aid. */
  showTurns?: boolean;
  /** True while the host says earlier history exists (protocol 3.6). */
  hasMore?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  /** Reports whether the list is pinned to the newest message. */
  onFollowChange?: (following: boolean) => void;
  onRetryPending?: (text: string) => void;
  ref?: Ref<MessageScrollerHandle>;
};

function sameItem(a: DisplayItem, b: DisplayItem): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind || a.id !== b.id) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  switch (a.kind) {
    case "assistant":
      return (
        left.text === right.text &&
        left.reasoning === right.reasoning &&
        left.streaming === right.streaming && left.images === right.images && left.seq === right.seq && left.time === right.time && JSON.stringify(left.usage) === JSON.stringify(right.usage)
      );
    case "user":
      return (
        left.text === right.text &&
        left.pending === right.pending &&
        left.failed === right.failed &&
        left.time === right.time &&
        left.images === right.images
      );
    case "tool":
      return (
        left.name === right.name &&
        left.status === right.status &&
        left.result === right.result &&
        left.input === right.input && left.images === right.images && left.meta === right.meta
      );
    case "deliverables":
      return JSON.stringify(left.files) === JSON.stringify(right.files);
    case "todo":
      return JSON.stringify(left.items) === JSON.stringify(right.items);
    case "tools": {
      if (b.kind !== 'tools') return false;
      return a.items.length === b.items.length && a.items.every((item, index) => sameItem(item, b.items[index]));
    }
    case "approval":
      return (
        (left.approval as { outcome?: unknown })?.outcome ===
          (right.approval as { outcome?: unknown })?.outcome &&
        (left.approval as { decision?: unknown })?.decision ===
          (right.approval as { decision?: unknown })?.decision
      );
    default:
      return left.time === right.time;
  }
}

const TranscriptRow = memo(
  function TranscriptRow({
    item,
    onRetryPending,
  }: {
    item: DisplayItem;
    onRetryPending?: (text: string) => void;
  }) {
    return renderItem(item, onRetryPending);
  },
  (prev, next) =>
    prev.onRetryPending === next.onRetryPending && sameItem(prev.item, next.item),
);

function renderItem(
  item: DisplayItem,
  onRetryPending?: (text: string) => void,
) {
  switch (item.kind) {
    case "user":
      return <UserMessageRow key={item.id} item={item} onRetry={onRetryPending} />;
    case "assistant":
      return <AssistantMessage key={item.id} item={item} />;
    case "tool":
      return <ToolCallCard key={item.id} item={item} />;
    case "tools":
      return <ToolChips key={item.id} items={item.items} />;
    case "changes":
      return <WorkspaceChanges key={item.id} seq={item.seq} />;
    case "deliverables":
      return <Deliverables key={item.id} files={item.files} title={item.title} />;
    case "todo":
      return <TodoBlock key={item.id} item={item} />;
    case "approval":
      return <ApprovalHistoryCard key={item.id} item={item} />;
    case "turn":
      return <TurnDivider key={item.id} item={item} />;
    default:
      return null;
  }
}

/**
 * The conversation: it follows new output to the bottom, lets go the moment
 * you drag up, and offers a pill back to the newest message.
 */
export function MessageList({
  topInset = 0,
  bottomInset = 0,
  items,
  running,
  streaming,
  showTurns = false,
  hasMore = false,
  loadingOlder = false,
  onLoadOlder,
  onFollowChange,
  onRetryPending,
  ref,
}: MessageListProps) {
  const visible = useMemo(
    () =>
      items.filter((item) => {
        if (item.kind === "turn") return showTurns;
        if (item.kind === "todo") return false; // The current task board stays above the composer.
        // Undecided approvals are answered in the blocking sheet above the composer.
        if (item.kind === "approval") return item.approval.outcome !== undefined;
        return true;
      }),
    [items, showTurns],
  );
  // Native offset zero is always the newest row. This does not depend on
  // timers or measuring every image/code block before a scrollToEnd call.
  const grouped = useMemo(() => groupToolRuns(visible).reverse(), [visible]);
  const list = useRef<FlatList<DisplayItem>>(null);
  const following = useRef(true);
  const [atLatest, setAtLatest] = useState(true);
  const jumpToLatest = useCallback((animated = false) => {
    following.current = true;
    setAtLatest(true);
    onFollowChange?.(true);
    list.current?.scrollToOffset({ offset: 0, animated });
  }, [onFollowChange]);
  useImperativeHandle(ref, () => ({ scrollToEnd: jumpToLatest }), [jumpToLatest]);
  const last = visible[visible.length - 1];
  const typing = running && !streaming && !(last?.kind === "assistant" && last.streaming);

  return (
    <View className="flex-1">
    <FlatList
      ref={list}
      inverted
      data={grouped}
      keyExtractor={(item) => item.id}
      accessibilityLabel="会话"
      keyboardShouldPersistTaps="handled"
      initialNumToRender={10}
      maxToRenderPerBatch={8}
      windowSize={9}
      removeClippedSubviews={false}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      contentContainerStyle={{ paddingTop: bottomInset + 8, paddingBottom: topInset + 8 }}
      scrollIndicatorInsets={{ top: topInset }}
      scrollEventThrottle={32}
      onScroll={(event) => {
        const next = event.nativeEvent.contentOffset.y <= 56;
        if (next !== following.current) {
          following.current = next;
          setAtLatest(next);
          onFollowChange?.(next);
        }
      }}
      onContentSizeChange={() => {
        if (following.current) list.current?.scrollToOffset({ offset: 0, animated: false });
      }}
      renderItem={({ item }) => <TranscriptRow item={item} onRetryPending={onRetryPending} />}
      ListFooterComponent={hasMore && onLoadOlder ? (
        <View className="items-center pb-2 pt-1">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="加载更早的消息"
            accessibilityState={{ busy: loadingOlder }}
            disabled={loadingOlder}
            onPress={onLoadOlder}
            className="min-h-12 justify-center rounded-full px-3.5 py-2 active:bg-surface"
          >
            <Text className="text-xs leading-4 text-muted">
              {loadingOlder ? "正在加载…" : "加载更早的消息"}
            </Text>
          </Pressable>
        </View>
      ) : undefined}
      ListHeaderComponent={typing ? (
        <View className="px-4 py-2">
          <LoadingState />
        </View>
      ) : undefined}
    />
    {!atLatest ? <View pointerEvents="box-none" className="absolute left-0 right-0 items-center" style={{ bottom: bottomInset + 12 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="回到最新消息" onPress={() => jumpToLatest(false)} className="min-h-11 justify-center rounded-full border border-border bg-background px-4">
        <Text className="text-xs font-medium text-foreground">回到最新</Text>
      </Pressable>
    </View> : null}
    </View>
  );
}
