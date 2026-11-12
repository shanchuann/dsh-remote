import { useEffect, useMemo } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { useReducedMotionPreference } from "../../hooks/use-reduced-motion";
import type { TranscriptItem } from "../../lib/transcript";
import { CodeBlock } from "../code-block";
import { StreamingResponse } from "../streaming-response";
import { ReasoningBlock } from "./reasoning-block";
import { splitFencedCode } from "./format";
import { MarkdownText } from "./markdown";

export type AssistantMessageItem = Extract<TranscriptItem, { kind: "assistant" }>;

/** A small brand-colored caret that keeps time while text streams in. */
function StreamingCaret() {
  const reduce = useReducedMotionPreference();
  const blink = useSharedValue(1);
  useEffect(() => {
    if (reduce) return;
    blink.value = withRepeat(withTiming(0.15, { duration: 520 }), -1, true);
  }, [blink, reduce]);
  const style = useAnimatedStyle(() => ({ opacity: blink.value }));
  return (
    <Animated.View
      style={style}
      className="ml-0.5 h-[16px] w-[2px] self-end rounded-full bg-primary"
    />
  );
}

/** Prose rendered as markdown (headings, lists, emphasis, links, inline code). */

/**
 * One assistant turn: folded reasoning, prose, fenced code blocks and a live
 * caret while the text is still streaming.
 */
export function AssistantMessage({ item }: { item: AssistantMessageItem }) {
  const streaming = item.streaming === true;
  const segments = useMemo(() => splitFencedCode(item.text), [item.text]);
  const reasoningStreaming = streaming && item.text.length === 0;

  return (
    <View className="w-full px-4">
      {item.reasoning ? (
        <ReasoningBlock reasoning={item.reasoning} streaming={reasoningStreaming} />
      ) : null}
      {item.text ? (
        <StreamingResponse
          status={streaming ? "streaming" : "complete"}
          showActions={false}
          announce={false}
          contentClassName="gap-2"
        >
          {segments.map((segment, index) =>
            segment.kind === "code" ? (
              <CodeBlock
                key={"code-" + index}
                code={segment.code}
                language={segment.language}
                status={segment.closed ? "complete" : "streaming"}
                maxHeight={280}
                showLineNumbers={segment.code.split("\n").length > 2}
              />
            ) : (
              <MarkdownText key={"text-" + index} text={segment.text} />
            ),
          )}
          {streaming ? <StreamingCaret /> : null}
        </StreamingResponse>
      ) : null}
    </View>
  );
}