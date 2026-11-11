import { Text, View } from "react-native";

import { ToolApproval } from "../tool-approval";

/** The subset of protocol 3.10 Approval the sheet needs. */
export type PendingApprovalLike = {
  id: string;
  tool?: string;
  displayReason?: string;
  reason?: string;
  callId?: string;
};

/**
 * The blocking approval surface: it sits above the composer the moment the
 * host asks, and reports allow/reject straight back to the store.
 */
export function ApprovalSheet({
  approval,
  submitting = false,
  pendingCount = 1,
  onAllow,
  onReject,
}: {
  approval: PendingApprovalLike;
  submitting?: boolean;
  pendingCount?: number;
  onAllow: () => void;
  onReject: () => void;
}) {
  return (
    <View className="border-t border-border bg-background px-3 pb-1 pt-2.5">
      {pendingCount > 1 ? (
        <Text className="mb-1.5 px-1 text-[11px] text-muted">
          还有 {pendingCount - 1} 个请求等待确认
        </Text>
      ) : null}
      <ToolApproval
        tool={approval.tool ?? "tool"}
        title="需要你的确认"
        description={
          approval.displayReason ??
          approval.reason ??
          "宿主上的 Agent 请求执行这个工具，允许后会立即运行。"
        }
        status={submitting ? "approving" : "pending"}
        risk="normal"
        confirm="tap"
        defaultOpen
        onApprove={onAllow}
        onDeny={onReject}
      />
    </View>
  );
}
