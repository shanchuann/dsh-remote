import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { useResolveClassNames } from "uniwind";

import { ChevronRightIcon } from "../common/icons";

const SUGGESTIONS = [
  "解释一下这段报错是什么意思",
  "跑一下测试，把失败的修掉",
  "看看这个目录里都放了什么",
];

/** The blank-session welcome: one line of purpose and a few first moves. */
export function EmptyChat({ onPick }: { onPick: (text: string) => void }) {
  const { color: muted } = useResolveClassNames("text-muted");
  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingVertical: 24 }}
      keyboardShouldPersistTaps="handled"
    >
      <View className="w-full max-w-[480px] self-center px-4">
        <View className="items-center gap-3 px-4 pb-8">
          <View className="size-20 items-center justify-center rounded-3xl border border-border bg-white">
            <Image source={require('../../../assets/images/deepseek-mark.png')} className="size-14" resizeMode="contain" accessibilityLabel="DeepSeek" />
          </View>
          <Text className="mt-1 text-center text-[22px] font-semibold leading-8 text-foreground">
            今天想让 DSH 做什么？
          </Text>
          <Text className="max-w-[300px] text-center text-sm leading-[22px] text-muted">
            消息会转发到电脑上正在运行的 DeepSeek Harness，由桌面端的 Agent 完成。
          </Text>
        </View>
        <View className="gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <Pressable
              key={suggestion}
              accessibilityRole="button"
              accessibilityLabel={suggestion}
              onPress={() => onPick(suggestion)}
              className="min-h-12 flex-row items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 active:opacity-70"
            >
              <Text className="min-w-0 flex-1 text-sm leading-[22px] text-foreground">{suggestion}</Text>
              <ChevronRightIcon size={16} color={muted} />
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
