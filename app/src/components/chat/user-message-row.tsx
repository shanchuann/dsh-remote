import { Image, Pressable, Text, View } from "react-native";

import { Message, MessageContent } from "../message";
import { MessageBubble, MessageBubbleText } from "../message-bubble";
import type { TranscriptItem } from "../../lib/transcript";
import { formatClock } from "./format";

export type UserMessageItem = Extract<TranscriptItem, { kind: "user" }>;

/** A real user turn: a solid brand bubble on the trailing edge. */
export function UserMessageRow({
  item,
  onRetry,
}: {
  item: UserMessageItem;
  onRetry?: (text: string) => void;
}) {
  const failed = item.pending === true;
  const time = formatClock(item.time);

  return (
    <Message from="user" animateIn className="w-full px-4">
      <MessageContent className="items-end">
        <MessageBubble
          variant="solid"
          align="end"
          className="max-w-[86%]"
          contentClassName="gap-2 px-3.5 py-2.5"
        >
          {item.images?.map((image, index) => (
            <UserImage key={index} image={image} />
          ))}
          {item.text ? (
            <MessageBubbleText selectable>{item.text}</MessageBubbleText>
          ) : null}
        </MessageBubble>
        {failed ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="发送失败，点按重试"
            hitSlop={6}
            onPress={() => onRetry?.(item.text)}
            className="flex-row items-center gap-1 active:opacity-70"
          >
            <Text className="text-[11px] text-destructive">发送失败，点按重试</Text>
          </Pressable>
        ) : time ? (
          <Text className="text-[10px] text-muted/70">{time}</Text>
        ) : null}
      </MessageContent>
    </Message>
  );
}

function UserImage({ image }: { image: { url?: string; data?: string; mediaType?: string } }) {
  const uri =
    image.url ??
    (image.data ? "data:" + (image.mediaType ?? "image/jpeg") + ";base64," + image.data : undefined);
  if (!uri) {
    return (
      <View className="h-24 w-24 items-center justify-center rounded-xl bg-on-primary/10">
        <Text className="text-[11px] text-on-primary/70">图片</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      accessibilityLabel="用户发送的图片"
      className="h-40 w-52 rounded-xl"
      resizeMode="cover"
    />
  );
}
