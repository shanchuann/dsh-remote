import { Pressable, Text } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useResolveClassNames } from "uniwind";

import { AlertGlyph, CrossGlyph } from "../../primitives/agent-icons";

/**
 * A floating, dismissible error strip. Tokens keep it readable in both themes:
 * a surface card with a destructive accent, not a loud red block.
 */
export function ErrorToast({
  message,
  onDismiss,
}: {
  message?: string;
  onDismiss: () => void;
}) {
  const { color: destructive } = useResolveClassNames("text-destructive");
  const { color: muted } = useResolveClassNames("text-muted");
  if (!message) return null;
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      className="absolute bottom-24 left-3 right-3 z-10 flex-row items-center gap-2 rounded-2xl border border-destructive/30 bg-surface px-3.5 py-2.5 shadow-lg"
    >
      <AlertGlyph size={16} color={destructive} />
      <Text numberOfLines={3} className="flex-1 text-[12px] leading-4 text-foreground">
        {message}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="关闭提示"
        hitSlop={10}
        onPress={onDismiss}
        className="size-6 items-center justify-center active:opacity-60"
      >
        <CrossGlyph size={13} color={muted} />
      </Pressable>
    </Animated.View>
  );
}
