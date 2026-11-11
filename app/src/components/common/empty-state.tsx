import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

/** Friendly empty state with an optional action button. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <View className="items-center justify-center gap-3 px-8 py-16">
      {icon ? (
        <View className="h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface">
          {icon}
        </View>
      ) : null}
      <Text className="text-center text-base font-medium text-foreground">{title}</Text>
      {description ? (
        <Text className="max-w-[280px] text-center text-sm leading-5 text-muted">{description}</Text>
      ) : null}
      {action ? <View className="mt-2 w-full max-w-[260px]">{action}</View> : null}
    </View>
  );
}
