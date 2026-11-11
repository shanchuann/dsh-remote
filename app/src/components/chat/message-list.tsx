import type { Ref } from "react";
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
  const visible = items.filter((item) => {
    if (item.kind === "turn") return showTurns;
    // Undecided approvals are answered in the blocking sheet above the composer.
    if (item.kind === "approval") return item.approval.outcome !== undefined;
    return true;
  });
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
      {visible.map((item) => renderItem(item, onRetryPending))}
      {typing ? (
        <View className="px-4 py-2">
          <MessageTyping label="正在回复" />
        </View>
      ) : null}
    </MessageScroller>
  );
}
