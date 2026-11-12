import { View } from "react-native";

import { SkeletonBlock, SkeletonGroup } from "../common/skeleton";

/** Quiet placeholder bars while the first snapshot of a session arrives. */
export function ChatSkeleton() {
  return (
    <SkeletonGroup className="flex-1 gap-6 overflow-hidden px-4 pt-6">
      <SkeletonBlock className="h-12 w-2/3 self-end rounded-2xl" />
      <View className="gap-3">
        <SkeletonBlock className="h-3 w-1/3" />
        <SkeletonBlock className="h-3 w-full" />
        <SkeletonBlock className="h-3 w-5/6" />
        <SkeletonBlock className="h-3 w-3/5" />
      </View>
      <View className="gap-3 rounded-2xl border border-border p-4">
        <SkeletonBlock className="h-3 w-2/5" />
        <SkeletonBlock className="h-2 w-5/6" />
        <SkeletonBlock className="h-2 w-2/3" />
      </View>
      <SkeletonBlock className="h-10 w-1/2 self-end rounded-2xl" />
      <View className="gap-3">
        <SkeletonBlock className="h-3 w-full" />
        <SkeletonBlock className="h-3 w-4/5" />
        <SkeletonBlock className="h-3 w-1/2" />
      </View>
    </SkeletonGroup>
  );
}
