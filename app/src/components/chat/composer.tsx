import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PromptInput } from "../prompt-input";

export type ComposerProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  running: boolean;
  disabled?: boolean;
  placeholder?: string;
};

/**
 * The chat composer: text only for v1, a send arrow that becomes a stop
 * button while a turn runs. A trailing newline sends, so the keyboard's
 * return key behaves like a send button.
 */
export function Composer({
  value,
  onValueChange,
  onSend,
  onStop,
  running,
  disabled = false,
  placeholder = "给 DSH 发消息…",
}: ComposerProps) {
  const insets = useSafeAreaInsets();

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
  };

  const handleChange = (next: string) => {
    if (next.endsWith("\n") && next.trim().length > 0 && !running && !disabled) {
      onValueChange("");
      send(next);
      return;
    }
    onValueChange(next);
  };

  return (
    <View
      className="bg-background px-2 pt-1.5"
      style={{ paddingBottom: Math.max(insets.bottom, 6) + 4 }}
    >
      <PromptInput
        value={value}
        onValueChange={handleChange}
        onSubmit={(text) => send(text)}
        loading={running}
        onStop={onStop}
        disabled={disabled}
        placeholder={placeholder}
        maxRows={5}
        restoreOnStop
        className="border border-border"
      />
    </View>
  );
}
