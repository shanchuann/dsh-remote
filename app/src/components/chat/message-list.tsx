import { memo, useMemo, type Ref } from "react";
import { Pressable, Text, View } from "react-native";

import { MessageTyping } from "../message";
import { MessageScroller, type MessageScrollerHandle } from "../message-scroller";
import type { TranscriptItem } from "../../lib/transcript";
import { ApprovalHistoryCard } from "./approval-history";
import { AssistantMessage } from "./assistant-message";
import { TodoBlock } from "./todo-block";
import { ToolCallCard } from "./tool-call-card";
import { TurnDivider } from "./turn-divider";
import { UserMessageRow } from "./user-message-row";

export type MessageListProps = {
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

function sameItem(a: TranscriptItem, b: TranscriptItem): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind || a.id !== b.id) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  switch (a.kind) {
    case "assistant":
      return (
        left.text === right.text &&
        left.reasoning === right.reasoning &&
        left.streaming === right.streaming
      );
    case "user":
      return (
        left.text === right.text &&
        left.pending === right.pending &&
        left.time === right.time &&
        left.images === right.images
      );
    case "tool":
      return (
        left.name === right.name &&
        left.status === right.status &&
        left.result === right.result &&
        left.input === right.input
      );
    case "todo":
      return JSON.stringify(left.todo) === JSON.stringify(right.todo);
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
    item: TranscriptItem;
    onRetryPending?: (text: string) => void;
  }) {
    return renderItem(item, onRetryPending);
  },
  (prev, next) =>
    prev.onRetryPending === next.onRetryPending && sameItem(prev.item, next.item),
);

function renderItem(
  item: TranscriptItem,
  onRetryPending?: (text: string) => void,
) {
  switch (item.kind) {
    case "user":
      return <UserMessageRow key={item.id} item={item} onRetry={onRetryPending} />;
    case "assistant":
      return <AssistantMessage key={item.id} item={item} />;
    case "tool":
      return <ToolCallCard key={item.id} item={item} />;
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
        // Undecided approvals are answered in the blocking sheet above the composer.
        if (item.kind === "approval") return item.approval.outcome !== undefined;
        return true;
      }),
    [items, showTurns],
  );
  const last = visible[visible.length - 1];
  const typing = running && !streaming && !(last?.kind === "assistant" && last.streaming);

  return (
    <MessageScroller
      ref={ref}
      busy={running}
      messageCount={visible.length}
      onFollowChange={onFollowChange}
      label="会话"
      jumpLabel="回到最新"
      contentClassName="pb-3 pt-2"
    >
      {hasMore && onLoadOlder ? (
        <View className="items-center pb-2 pt-1">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="加载更早的消息"
            accessibilityState={{ busy: loadingOlder }}
            disabled={loadingOlder}
            onPress={onLoadOlder}
            className="rounded-full border border-border bg-surface px-3.5 py-1.5 active:opacity-70"
          >
            <Text className="text-[11px] text-muted">
              {loadingOlder ? "正在加载…" : "加载更早的消息"}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {visible.map((item) => (
        <TranscriptRow key={item.id} item={item} onRetryPending={onRetryPending} />
      ))}
      {typing ? (
        <View className="px-4 py-2">
          <MessageTyping label="正在回复" />
        </View>
      ) : null}
    </MessageScroller>
  );
}