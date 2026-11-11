import { Text, View } from 'react-native';
import { useResolveClassNames } from 'uniwind';

import { AppButton } from './app-button';
import { WarningIcon } from './icons';

/** Inline error strip with optional retry/dismiss actions. */
export function ErrorBanner({
  message,
  onRetry,
  retryLabel = '重试',
  onDismiss,
  className = '',
}: {
  message: string | undefined;
  onRetry?: () => void;
  retryLabel?: string;
  onDismiss?: () => void;
  className?: string;
}) {
  const { color } = useResolveClassNames('text-destructive');
  if (!message) return null;
  return (
    <View className={'rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 ' + className}>
      <View className="flex-row items-start gap-2.5">
        <View className="mt-0.5">
          <WarningIcon size={18} color={typeof color === 'string' ? color : undefined} />
        </View>
        <View className="flex-1">
          <Text className="text-sm leading-5 text-foreground">{message}</Text>
          {onRetry || onDismiss ? (
            <View className="mt-2 flex-row gap-2">
              {onRetry ? (
                <AppButton size="sm" variant="secondary" onPress={onRetry} className="self-start">
                  {retryLabel}
                </AppButton>
              ) : null}
              {onDismiss ? (
                <AppButton size="sm" variant="ghost" onPress={onDismiss} className="self-start">
                  关闭
                </AppButton>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
