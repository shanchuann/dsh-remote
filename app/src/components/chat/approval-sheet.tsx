import { View } from "react-native";
import { ApprovalCard } from "./beautiful/approval-card";

export type PendingApprovalLike = {
  id: string;
  tool?: string;
  displayReason?: string;
  reason?: string;
  callId?: string;
};

export function ApprovalSheet({ approval, submitting = false, pendingCount = 1, onAllow, onReject }: {
  approval: PendingApprovalLike;
  submitting?: boolean;
  pendingCount?: number;
  onAllow: () => void;
  onReject: () => void;
}) {
  return (
    <View className="border-t border-border bg-background px-4 pb-2 pt-3">
      <ApprovalCard key={approval.id} title="是否允许执行工具？"
        description={approval.displayReason ?? approval.reason ?? (approval.tool ? "工具：" + approval.tool : "宿主请求执行工具，请选择是否允许。")}
        pendingCount={pendingCount} submitting={submitting} onAllow={onAllow} onReject={onReject} />
    </View>
  );
}
