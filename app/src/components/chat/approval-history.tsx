import { View } from "react-native";

import type { ToolApprovalStatus } from "../tool-approval";
import { ToolApproval } from "../tool-approval";
import type { TranscriptItem } from "../../lib/transcript";

export type ApprovalItem = Extract<TranscriptItem, { kind: "approval" }>;

function statusOf(outcome: string | undefined): ToolApprovalStatus {
  if (outcome === "allowed") return "approved";
  if (outcome === "rejected") return "denied";
  return "pending";
}

/** A decided approval, folded into the conversation as a compact result card. */
export function ApprovalHistoryCard({ item }: { item: ApprovalItem }) {
  const approval = item.approval;
  const status = statusOf(approval.outcome);
  const allowed = status === "approved";
  const decided = approval.outcome !== undefined;

  return (
    <View className="w-full px-4 py-1">
      <ToolApproval
        tool={approval.tool ?? "tool"}
        title={decided ? (allowed ? "已允许本次工具运行" : "已拒绝本次工具运行") : "工具调用待确认"}
        description={approval.displayReason ?? approval.reason}
        status={status}
        result={decided ? (allowed ? "允许一次" : "已拒绝") : undefined}
        confirm="tap"
        defaultOpen={false}
      />
    </View>
  );
}
