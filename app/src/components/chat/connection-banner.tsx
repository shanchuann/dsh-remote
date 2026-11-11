import { Pressable, Text, View } from "react-native";

import { useReducedMotionPreference } from "../../hooks/use-reduced-motion";
import { RunningBar } from "../../primitives/running-bar";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

/**
 * A slim strip that explains why live updates stopped and that the app is
 * reconnecting on its own. Hidden while the connection is healthy.
 */
export function ConnectionBanner({
  status,
  error,
  needsPairing = false,
  onRepair,
}: {
  status: ConnectionStatus;
  error?: string;
  /** True when the host revoked this device's token: reconnecting will not help. */
  needsPairing?: boolean;
  onRepair?: () => void;
}) {
  const reduceMotion = useReducedMotionPreference();
  if (status === "connected" && !needsPairing) return null;
  const reconnecting = !needsPairing && (status === "connecting" || status === "error");
  const label = needsPairing
    ? "认证已失效，需要重新配对"
    : status === "connecting"
      ? "正在连接电脑上的 DSH…"
      : status === "error"
        ? "连接已断开，正在自动重连…"
        : "尚未连接";
  return (
    <View className="mx-3 mt-2 overflow-hidden rounded-xl border border-border bg-surface px-3 py-2">
      <View className="flex-row items-center gap-2">
        <View
          className={
            status === "error"
              ? "size-1.5 rounded-full bg-warning"
              : "size-1.5 rounded-full bg-primary"
          }
        />
        <Text numberOfLines={1} className="flex-1 text-[12px] text-muted">
          {label}
          {error && !needsPairing ? "（" + error + "）" : ""}
        </Text>
        {needsPairing && onRepair ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="重新配对"
            hitSlop={6}
            onPress={onRepair}
            className="rounded-full bg-primary px-2.5 py-1 active:opacity-70"
          >
            <Text className="text-[12px] font-medium text-on-primary">重新配对</Text>
          </Pressable>
        ) : null}
      </View>
      {reconnecting ? <RunningBar reduce={reduceMotion} /> : null}
    </View>
  );
}
