import { type ReactNode, useEffect } from "react";
import { Keyboard, Platform } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

/**
 * Keeps the composer above the software keyboard. Under Android 16 edge-to-edge
 * the window no longer resizes, so keyboard-controller's native IME tracking is
 * used on both platforms; it applies the inset before/while the keyboard opens
 * instead of waiting for a late keyboardDidShow event.
 *
 * onInsetChange reports keyboard height (0 when hidden) so the screen can keep
 * the newest message in view while the list shrinks.
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

  return (
    <KeyboardAvoidingView behavior="padding" className={className}>
      {children}
    </KeyboardAvoidingView>
  );
}
