import { type ColorValue, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResolveClassNames } from "uniwind";

import { ThinkingShimmer } from "../loading-states";
import { CheckGlyph, CrossGlyph } from "../../primitives/agent-icons";
import type { ModelChoice, ModelGroup, ModelSelectionLike } from "./models";
import { selectionKey } from "./models";

export type ModelPickerProps = {
  visible: boolean;
  groups: readonly ModelGroup[];
  selected: ModelSelectionLike | undefined;
  loading?: boolean;
  error?: string;
  onSelect: (selection: ModelSelectionLike) => void;
  onClose: () => void;
};

/**
 * A bottom sheet listing the host's model catalog, grouped by provider.
 * Choices are only enabled when the host exposes a routable model catalog.
 */
export function ModelPicker({
  visible,
  groups,
  selected,
  loading = false,
  error,
  onSelect,
  onClose,
}: ModelPickerProps) {
  const insets = useSafeAreaInsets();
  const { color: primary } = useResolveClassNames("text-primary");
  const { color: muted } = useResolveClassNames("text-muted");
  const currentKey = selectionKey(selected);
  const empty = groups.length === 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭模型选择"
          onPress={onClose}
          className="absolute inset-0 bg-black/45"
        />
        <View
          className="max-h-[78%] overflow-hidden rounded-t-3xl bg-background"
          style={{ paddingBottom: insets.bottom + 8 }}
        >
          <View className="flex-row items-center px-4 pb-1 pt-3">
            <Text className="flex-1 text-[15px] font-semibold text-foreground">
              选择模型
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭"
              hitSlop={10}
              onPress={onClose}
              className="size-8 items-center justify-center rounded-full active:bg-surface"
            >
              <CrossGlyph size={16} color={muted} />
            </Pressable>
          </View>
          <View className="mx-4 mb-2 h-px bg-border" />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerClassName="pb-2"
          >
            {loading && empty ? (
              <View className="items-center py-10">
                <ThinkingShimmer className="text-sm text-muted">
                  正在读取模型列表…
                </ThinkingShimmer>
              </View>
            ) : empty ? (
              <View className="px-4 py-8">
                <Text className="text-center text-sm text-muted">
                  {error ?? "宿主没有提供可切换的模型"}
                </Text>
              </View>
            ) : (
              groups.map((group) => (
                <View key={group.id} className="pb-1">
                  <Text className="px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-muted">
                    {group.name}
                  </Text>
                  {group.choices.map((choice) => (
                    <ModelRow
                      key={choice.key}
                      choice={choice}
                      selected={selectionKey(choice) === currentKey}
                      primary={primary}
                      onSelect={() => onSelect(choice)}
                    />
                  ))}
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ModelRow({
  choice,
  selected,
  primary,
  onSelect,
}: {
  choice: ModelChoice;
  selected: boolean;
  primary: ColorValue | undefined;
  onSelect: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={choice.label}
      onPress={onSelect}
      className="min-h-[52px] flex-row items-center gap-3 px-4 py-2.5 active:bg-surface"
    >
      <View className="flex-1">
        <Text
          numberOfLines={1}
          className={
            selected
              ? "text-[15px] font-medium text-primary"
              : "text-[15px] font-medium text-foreground"
          }
        >
          {choice.label}
        </Text>
        {choice.description ? (
          <Text numberOfLines={1} className="mt-0.5 text-[12px] text-muted">
            {choice.description}
          </Text>
        ) : null}
      </View>
      {selected ? <CheckGlyph size={18} color={primary} strokeWidth={2.25} /> : null}
    </Pressable>
  );
}
