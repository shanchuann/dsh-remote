import { type ComponentProps, type ComponentRef, type ComponentType, type ReactNode, type RefObject, useEffect } from "react";
import { type LayoutChangeEvent, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResolveClassNames, useUniwind } from "uniwind";

import { useReducedMotionPreference } from "../../hooks/use-reduced-motion";
import { ChevronDownGlyph } from "../../primitives/agent-icons";
import { RunningBar } from "../../primitives/running-bar";
import { BackIcon, UsersIcon } from "../common/icons";

// MaskedView 0.3 still types its ref using NativeMethods, removed in RN 0.88.
const HeaderMask = MaskedView as unknown as ComponentType<ComponentProps<typeof View> & { maskElement: ReactNode }>;

export type ChatHeaderProps = {
  blurTarget: RefObject<ComponentRef<typeof View> | null>;
  onLayout: (event: LayoutChangeEvent) => void;
  title: string;
  subtitle?: string;
  subagentCount: number;
  subagentsRunning: boolean;
  running: boolean;
  /** False while the SSE connection is down: the dot turns muted. */
  connected: boolean;
  onBack: () => void;
  onPressSubagents: () => void;
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
 * directory underneath), the subagent entry and a
 * live status dot. The native backdrop fades into the scrolling transcript.
 */
export function ChatHeader({
  blurTarget,
  onLayout,
  title,
  subtitle,
  subagentCount,
  subagentsRunning,
  running,
  connected,
  onBack,
  onPressSubagents,
  trailing,
}: ChatHeaderProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useUniwind();
  const dark = theme === "dark";
  const { width, fontScale } = useWindowDimensions();
  const compact = width / fontScale < 360;
  const reduceMotion = useReducedMotionPreference();
  const { color: foreground } = useResolveClassNames("text-foreground");
  const { color: muted } = useResolveClassNames("text-muted");
  const { backgroundColor } = useResolveClassNames("bg-background");

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
      <View pointerEvents="box-none" onLayout={onLayout} className="bg-background" style={{ paddingTop: insets.top }}>
      <View className="min-h-14 flex-row items-center gap-1 px-1 py-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          onPress={onBack}
          className="size-12 items-center justify-center rounded-full active:bg-surface"
        >
          <BackIcon size={24} color={foreground} />
        </Pressable>
        <View className="min-w-0 flex-1 gap-0.5 pr-1">
          <Text
            numberOfLines={1}
            accessibilityRole="header"
            className="text-base font-semibold leading-[22px] text-foreground"
          >
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} className="text-xs leading-4 text-muted">
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={"查看子智能体，共 " + subagentCount + " 个"}
          onPress={onPressSubagents}
          className="min-h-12 justify-center active:opacity-70"
        >
          <View className="min-h-8 flex-row items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1.5">
            <RunningDot running={subagentsRunning && connected} />
            {compact ? <UsersIcon size={16} color={foreground} /> : null}
            <Text
              numberOfLines={1}
              className="text-[13px] font-medium leading-[18px] text-foreground"
            >
              {compact ? subagentCount : '子智能体' + (subagentCount > 0 ? ' ' + subagentCount : '')}
            </Text>
            <ChevronDownGlyph size={12} color={muted} />
          </View>
        </Pressable>
        {trailing}
      </View>
      {running && connected ? <RunningBar reduce={reduceMotion} /> : null}
      </View>
      {/* Keep the fade inside the header bounds so Android does not clip it. */}
      <HeaderMask
        pointerEvents="none"
        style={{ height: 40 }}
        maskElement={<LinearGradient colors={["black", "black", "transparent"]} locations={[0, 0.2, 1]} style={StyleSheet.absoluteFill} />}
      >
        <BlurView
          blurTarget={blurTarget}
          blurMethod="dimezisBlurViewSdk31Plus"
          intensity={100}
          blurReductionFactor={2}
          tint={dark ? "dark" : "light"}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient colors={[backgroundColor ?? (dark ? '#0e0f13' : '#fcfcfc'), "transparent"]} style={StyleSheet.absoluteFill} />
      </HeaderMask>
    </View>
  );
}
