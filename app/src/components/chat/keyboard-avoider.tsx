import { type ReactNode, useEffect } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useReducedMotionPreference } from "../../hooks/use-reduced-motion";

const ENTER = { duration: 160 };
const EXIT = { duration: 140 };

/**
 * Android with edge-to-edge (Expo SDK 58, API 35+) does not resize the window
 * for the keyboard, and React Native's KeyboardAvoidingView cannot help: under
 * edge-to-edge the reported keyboard screenY equals the visible-frame bottom,
 * so its overlap math resolves to zero. React Native 0.88 does report the IME
 * height itself (IME inset minus system bars), so padding the content by that
 * height puts the composer's content just above the keyboard, while the
 * composer's own bottom safe-area padding stays tucked behind it.
 */
function AndroidKeyboardAvoider({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const reduce = useReducedMotionPreference();
  const padding = useSharedValue(0);

  useEffect(() => {
    const animateTo = (value: number, duration: number) => {
      padding.value = reduce ? value : withTiming(value, { duration });
    };
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      const height = event.endCoordinates?.height ?? 0;
      if (height > 0) animateTo(height, ENTER.duration);
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      animateTo(0, EXIT.duration);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [padding, reduce]);

  const style = useAnimatedStyle(() => ({ paddingBottom: padding.value }));

  return (
    <Animated.View className={className} style={style}>
      {children}
    </Animated.View>
  );
}

/**
 * Keeps the composer above the software keyboard on both platforms: the
 * battle-tested KeyboardAvoidingView on iOS, and an IME-inset-aware wrapper on
 * Android, where edge-to-edge means the window never resizes.
 *
 * onInsetChange reports the keyboard height (0 when hidden) so the screen can
 * keep the newest message in view while the list shrinks.
 */
export function KeyboardAvoider({
  className = "",
  children,
  onInsetChange,
}: {
  className?: string;
  children: ReactNode;
  onInsetChange?: (inset: number) => void;
}) {
  // One listener for the caller, independent of how the content is moved.
  useEffect(() => {
    if (!onInsetChange) return;
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (event) => {
      onInsetChange(event.endCoordinates?.height ?? 0);
    });
    const hide = Keyboard.addListener(hideEvent, () => onInsetChange(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [onInsetChange]);

  if (Platform.OS === "ios") {
    return (
      <KeyboardAvoidingView className={className} behavior="padding">
        {children}
      </KeyboardAvoidingView>
    );
  }
  return (
    <AndroidKeyboardAvoider className={className}>
      {children}
    </AndroidKeyboardAvoider>
  );
}
