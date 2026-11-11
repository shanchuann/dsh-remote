import { Text, View } from 'react-native';

import type { ConnectionStatus } from '../../lib/types';

const LABELS: Record<ConnectionStatus, string> = {
  idle: '未连接',
  connecting: '连接中…',
  connected: '已连接',
  error: '连接异常',
};

const DOT: Record<ConnectionStatus, string> = {
  idle: 'bg-muted',
  connecting: 'bg-warning',
  connected: 'bg-success',
  error: 'bg-destructive',
};

/** Small connection pill: colored dot + host name + status text. */
export function ConnectionBadge({
  status,
  hostName,
  compact = false,
}: {
  status: ConnectionStatus;
  hostName?: string;
  compact?: boolean;
}) {
  const label = LABELS[status];
  return (
    <View className="flex-row items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5">
      <View className={'h-2 w-2 rounded-full ' + DOT[status]} />
      <Text className="text-xs text-muted" numberOfLines={1}>
        {compact ? label : hostName ? hostName + ' · ' + label : label}
      </Text>
    </View>
  );
}
