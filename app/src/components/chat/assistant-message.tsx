import { memo } from "react";
import { View } from "react-native";
import type { TranscriptItem } from "../../lib/transcript";
import { RemoteImage } from "./session-files";
import { ReasoningBlock } from "./reasoning-block";
import { StreamingText } from "./beautiful/streaming-text";
import { MessageActions, QuotableMessage } from './message-actions';

export type AssistantMessageItem = Extract<TranscriptItem, { kind: "assistant" }>;
const StableReasoningBlock = memo(ReasoningBlock);

export function AssistantMessage({ item }: { item: AssistantMessageItem }) {
  const streaming = item.streaming === true;
  return (
    <View className="w-full px-4">
      {item.reasoning ? <StableReasoningBlock reasoning={item.reasoning} streaming={streaming && item.text.length === 0} /> : null}
      {item.images?.map((image, index) => <RemoteImage key={index} image={image} />)}
      {item.text ? <QuotableMessage enabled={!streaming}><StreamingText text={item.text} streaming={streaming} /></QuotableMessage> : null}
      <MessageActions item={item} />
    </View>
  );
}
