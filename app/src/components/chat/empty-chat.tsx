import { Pressable, ScrollView, Text, View } from "react-native";
import { useResolveClassNames } from "uniwind";

import { SparkleGlyph } from "../../primitives/agent-icons";

const SUGGESTIONS = [
  "解释一下这段报错是什么意思",
  "跑一下测试，把失败的修掉",
  "看看这个目录里都放了什么",
];

/** The blank-session welcome: one line of purpose and a few first moves. */
export function EmptyChat({ onPick }: { onPick: (text: string) => void }) {
  const { color: onPrimary } = useResolveClassNames("text-on-primary");
  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
      keyboardShouldPersistTaps="handled"
    >
      <View className="items-center gap-3 px-8 pb-12">
        <View className="size-14 items-center justify-center rounded-2xl bg-primary">
          <SparkleGlyph size={26} color={onPrimary} strokeWidth={1.8} />
        </View>
        <Text className="mt-1 text-center text-[22px] font-semibold text-foreground">
          今天想让 DSH 做什么？
        </Text>
        <Text className="max-w-[300px] text-center text-[13px] leading-5 text-muted">
          消息会转发到电脑上正在运行的 DeepSeek Harness，由桌面端的 Agent 完成。
        </Text>
      </View>
      <View className="gap-2 px-5 pb-6">
        {SUGGESTIONS.map((suggestion) => (
          <Pressable
            key={suggestion}
            accessibilityRole="button"
            accessibilityLabel={suggestion}
            onPress={() => onPick(suggestion)}
            className="rounded-2xl border border-border bg-surface px-4 py-3.5 active:opacity-70"
          >
            <Text className="text-[14px] leading-5 text-foreground">{suggestion}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
