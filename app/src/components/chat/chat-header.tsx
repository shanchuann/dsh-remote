import { type ReactNode, useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResolveClassNames } from "uniwind";

import { useReducedMotionPreference } from "../../hooks/use-reduced-motion";
import { ArrowGlyph, ChevronDownGlyph } from "../../primitives/agent-icons";
import { RunningBar } from "../../primitives/running-bar";

export type ChatHeaderProps = {
  title: string;
  subtitle?: string;
  modelLabel?: string;
  running: boolean;
  /** False while the SSE connection is down: the dot turns muted. */
  connected: boolean;
  onBack: () => void;
  onPressModel: () => void;
  /** Extra control on the trailing edge, such as the overflow menu. */
  trailing?: ReactNode;
};

/** A quiet pulse on the brand dot while a turn runs. */
function RunningDot({ running }: { running: boolean }) {
  const reduce = useReducedMotionPreference();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (!running || reduce) return;
    pulse.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
    return () => {
      pulse.value = 0;
    };
  }, [pulse, reduce, running]);
  const style = useAnimatedStyle(() => ({
    opacity: reduce ? 1 : 0.4 + pulse.value * 0.6,
    transform: [{ scale: reduce ? 1 : 0.85 + pulse.value * 0.15 }],
  }));
  return (
    <Animated.View
      style={style}
      className={running ? "size-2 rounded-full bg-primary" : "size-2 rounded-full bg-muted/40"}
    />
  );
}

/**
 * The chat screen's own header: back, session title (with the working
 * directory underneath), the model chip that opens the model picker and a
 * live status dot. A hairline separates it from the conversation.
 */
export function ChatHeader({
  title,
  subtitle,
  modelLabel,
  running,
  connected,
  onBack,
  onPressModel,
  trailing,
}: ChatHeaderProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotionPreference();
  const { color: foreground } = useResolveClassNames("text-foreground");
  const { color: muted } = useResolveClassNames("text-muted");

  return (
    <View className="bg-background" style={{ paddingTop: insets.top }}>
      <View className="h-14 flex-row items-center gap-1 pl-1 pr-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          hitSlop={8}
          onPress={onBack}
          className="size-10 items-center justify-center rounded-full active:bg-surface"
        >
          <ArrowGlyph back size={21} color={foreground} strokeWidth={2} />
        </Pressable>
        <View className="flex-1 pr-1">
          <Text
            numberOfLines={1}
            accessibilityRole="header"
            className="text-[16px] font-semibold text-foreground"
          >
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} className="text-[11px] text-muted">
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={"切换模型，当前 " + (modelLabel ?? "未知")}
          hitSlop={6}
          onPress={onPressModel}
          className="h-9 flex-row items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 active:opacity-70"
        >
          <RunningDot running={running && connected} />
          <Text
            numberOfLines={1}
            className="max-w-[120px] text-[12px] font-medium text-foreground"
          >
            {modelLabel ?? "模型"}
          </Text>
          <ChevronDownGlyph size={12} color={muted} />
        </Pressable>
        {trailing}
      </View>
      <View className="h-px bg-border" />
      {running && connected ? <RunningBar reduce={reduceMotion} /> : null}
    </View>
  );
}
