import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useResolveClassNames } from "uniwind";

import { useReducedMotionPreference } from "../../hooks/use-reduced-motion";
import { ChevronDownGlyph } from "../../primitives/agent-icons";
import { Disclosure } from "../../primitives/disclosure";

/**
 * The assistant's reasoning, folded away: a quiet row that springs open to the
 * thought text. It starts open while the thought is still arriving and folds
 * itself once the reply begins.
 */
export function ReasoningBlock({
  reasoning,
  streaming,
}: {
  reasoning: string;
  streaming: boolean;
}) {
  const reduce = useReducedMotionPreference();
  // While a thought streams it starts open; once the reply begins it folds
  // away, unless the reader has opened it by hand.
  const [manualOpen, setManualOpen] = useState<boolean | undefined>(undefined);
  const open = manualOpen ?? streaming;
  const { color: muted } = useResolveClassNames("text-muted");
  const turn = useSharedValue(streaming ? 1 : 0);

  useEffect(() => {
    turn.value = reduce ? (open ? 1 : 0) : withTiming(open ? 1 : 0, { duration: 160 });
  }, [open, reduce, turn]);

  const chevron = useAnimatedStyle(() => ({
    transform: [{ rotate: String(turn.value * 180) + "deg" }],
  }));

  return (
    <View className="mb-1.5">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? "收起思考过程" : "展开思考过程"}
        hitSlop={6}
        onPress={() => setManualOpen(!open)}
        className="flex-row items-center gap-1 self-start rounded-full bg-surface px-2.5 py-1 active:opacity-70"
      >
        <Text className="text-[12px] font-medium text-muted">
          {streaming ? "深度思考中…" : "思考过程"}
        </Text>
        <Animated.View style={chevron}>
          <ChevronDownGlyph size={12} color={muted} />
        </Animated.View>
      </Pressable>
      <Disclosure open={open} reduce={reduce} style={{ marginTop: 6 }}>
        <View className="border-l-2 border-border-strong pl-3">
          <Text selectable className="text-[13px] leading-5 text-muted">
            {reasoning}
          </Text>
        </View>
      </Disclosure>
    </View>
  );
}
