import { Text, View } from "react-native";

import type { TranscriptItem } from "../../lib/transcript";
import { formatClock } from "./format";

export type TurnItem = Extract<TranscriptItem, { kind: "turn" }>;

/**
 * A hairline between turns. Turn starts carry no visual weight; a finished
 * turn shows a quiet timestamp, which is enough to read the conversation's
 * rhythm without adding noise.
 */
export function TurnDivider({ item }: { item: TurnItem }) {
  if (item.label === "start") return <View className="h-2" />;
  const time = formatClock(item.time);
  return (
    <View className="flex-row items-center gap-3 px-6 py-3">
      <View className="h-px flex-1 bg-border" />
      <Text className="text-[10px] tracking-wide text-muted/70">
        {time ? "本轮完成 · " + time : "本轮完成"}
      </Text>
      <View className="h-px flex-1 bg-border" />
    </View>
  );
}
