import { View } from "react-native";

import { ThinkingShimmer } from "../loading-states";

/** Quiet placeholder bars while the first snapshot of a session arrives. */
export function ChatSkeleton() {
  return (
    <View className="flex-1 justify-center gap-3 px-4">
      <View className="h-10 w-2/3 self-end rounded-2xl bg-surface" />
      <View className="h-6 w-5/6 self-start rounded-xl bg-surface" />
      <View className="h-6 w-3/5 self-start rounded-xl bg-surface" />
      <View className="mt-2 items-center">
        <ThinkingShimmer className="text-xs text-muted">正在载入会话…</ThinkingShimmer>
      </View>
    </View>
  );
}
