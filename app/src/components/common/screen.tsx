import type { ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResolveClassNames } from 'uniwind';

/**
 * Full-screen themed frame with safe-area padding. Screens own their scrolling
 * so pull-to-refresh and keyboard handling stay explicit.
 */
export function ScreenFrame({ children, className = '' }: { children: ReactNode; className?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className={'flex-1 bg-background ' + className}
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      {children}
    </View>
  );
}

/** Big screen title used by the list and settings screens. */
export function ScreenTitle({
  title,
  subtitle,
  right,
  left,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  left?: ReactNode;
}) {
  return (
    <View className="flex-row items-center gap-3 px-4 pb-4 pt-4">
      {left}
      <View className="flex-1">
        <Text className="text-[26px] font-semibold leading-8 text-foreground">{title}</Text>
        {subtitle ? <Text className="mt-1 text-sm text-muted">{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/** Section wrapper with an optional heading and footer. */
export function SectionCard({
  title,
  children,
  footer,
  className = '',
}: {
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <View className={'rounded-2xl border border-border bg-surface ' + className}>
      {title ? (
        <View className="border-b border-border px-4 py-3">
          <Text className="text-xs font-medium uppercase tracking-wide text-muted">{title}</Text>
        </View>
      ) : null}
      <View className="px-4 py-3">{children}</View>
      {footer ? <View className="border-t border-border px-4 py-3">{footer}</View> : null}
    </View>
  );
}

/** Centered spinner with a label, used while restoring a connection. */
export function LoadingView({ label, fill = true }: { label: string; fill?: boolean }) {
  const { color } = useResolveClassNames('text-primary');
  return (
    <View className={(fill ? 'flex-1 ' : '') + 'items-center justify-center gap-3 px-8'}>
      <ActivityIndicator color={typeof color === 'string' ? color : undefined} />
      <Text className="text-sm text-muted">{label}</Text>
    </View>
  );
}
