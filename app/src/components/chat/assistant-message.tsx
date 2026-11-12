import { View } from "react-native";
import type { TranscriptItem } from "../../lib/transcript";
import { RemoteImage } from "./session-files";
import { ReasoningBlock } from "./reasoning-block";
import { StreamingText } from "./beautiful/streaming-text";

export type AssistantMessageItem = Extract<TranscriptItem, { kind: "assistant" }>;

export function AssistantMessage({ item }: { item: AssistantMessageItem }) {
  const streaming = item.streaming === true;
  return (
    <View className="w-full px-4">
      {item.reasoning ? <ReasoningBlock reasoning={item.reasoning} streaming={streaming && item.text.length === 0} /> : null}
      {item.images?.map((image, index) => <RemoteImage key={index} image={image} />)}
      {item.text ? <StreamingText text={item.text} streaming={streaming} /> : null}
    </View>
  );
}
