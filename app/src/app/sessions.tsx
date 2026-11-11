/**
 * Session list screen (protocol 3.3). Pull to refresh, running indicator,
 * create-session action, and an entry point to settings.
 */

import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useResolveClassNames } from 'uniwind';

import { Button } from '../components/button';
import { AppButton } from '../components/common/app-button';
import { ConnectionBadge } from '../components/common/connection-badge';
import { EmptyState } from '../components/common/empty-state';
import { ErrorBanner } from '../components/common/error-banner';
import { ChatIcon, ChevronRightIcon, PlusIcon, SettingsIcon, WarningIcon } from '../components/common/icons';
import { ScreenFrame, ScreenTitle } from '../components/common/screen';
import { describeError } from '../lib/errors';
import { formatRelativeTime, truncate } from '../lib/format';
import { useRemoteStore } from '../lib/store';
import type { SessionRow } from '../lib/types';

function runningPill() {
  return (
    <View className="flex-row items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5">
      <View className="h-1.5 w-1.5 rounded-full bg-primary" />
      <Text className="text-[10px] font-medium text-primary">运行中</Text>
    </View>
  );
}

export default function SessionsScreen() {
  const sessions = useRemoteStore((state) => state.sessions);
  const sessionsLoading = useRemoteStore((state) => state.sessionsLoading);
  const sessionsError = useRemoteStore((state) => state.sessionsError);
  const connection = useRemoteStore((state) => state.connection);
  const actions = useRemoteStore((state) => state.actions);

  const { color: mutedColor } = useResolveClassNames('text-muted');
  const { color: primaryColor } = useResolveClassNames('text-primary');
  const { color: destructiveColor } = useResolveClassNames('text-destructive');
  const { backgroundColor: surfaceColor } = useResolveClassNames('bg-surface');

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>();

  // Refresh once the link (re)connects so the list is never stale.
  useEffect(() => {
    if (connection.status === 'connected') void actions.refreshSessions();
  }, [actions, connection.status]);

  const openSession = useCallback((row: SessionRow) => {
    router.push({ pathname: '/session/[id]', params: { id: row.sessionId } });
  }, []);

  const createSession = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setCreateError(undefined);
    try {
      const sessionId = await actions.createSession();
      router.push({ pathname: '/session/[id]', params: { id: sessionId } });
    } catch (error) {
      setCreateError(describeError(error));
    } finally {
      setCreating(false);
    }
  }, [actions, creating]);

  const connected = connection.status === 'connected';
  const showEmpty = !sessionsLoading && sessions.length === 0;
  const error = createError ?? sessionsError;

  return (
    <ScreenFrame>
      <ScreenTitle
        title="会话"
        subtitle={sessions.length > 0 ? sessions.length + ' 个会话' : '选择一个会话继续'}
        right={
          <Button
            size="icon"
            variant="ghost"
            icon={SettingsIcon}
            accessibilityLabel="打开设置"
            onPress={() => router.push('/settings')}
          />
        }
      />

      <View className="flex-row items-center justify-between gap-3 px-5 pb-3">
        <ConnectionBadge
          status={connection.status}
          hostName={connection.host?.name ?? connection.baseUrl}
        />
        <Text className="text-[11px] text-muted" numberOfLines={1}>
          {connection.host?.name ? truncate(connection.host.name, 24) : ''}
        </Text>
      </View>

      {connection.needsPairing ? (
        <View className="px-5 pb-3">
          <ErrorBanner
            message="认证已失效，请重新配对"
            retryLabel="去配对"
            onRetry={() => router.replace('/')}
          />
        </View>
      ) : null}

      {error ? (
        <View className="px-5 pb-3">
          <ErrorBanner
            message={error}
            onRetry={() => {
              setCreateError(undefined);
              void actions.refreshSessions();
            }}
            onDismiss={() => setCreateError(undefined)}
          />
        </View>
      ) : null}

      <FlatList
        data={sessions}
        keyExtractor={(item) => item.sessionId}
        contentContainerClassName="px-5 pb-40 pt-1"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={sessionsLoading}
            onRefresh={() => void actions.refreshSessions()}
            tintColor={typeof primaryColor === 'string' ? primaryColor : undefined}
            colors={typeof primaryColor === 'string' ? [primaryColor] : undefined}
            progressBackgroundColor={typeof surfaceColor === 'string' ? surfaceColor : undefined}
          />
        }
        ItemSeparatorComponent={() => <View className="h-3" />}
        ListEmptyComponent={
          showEmpty ? (
            connected ? (
              <EmptyState
                icon={<ChatIcon size={24} color={typeof primaryColor === 'string' ? primaryColor : undefined} />}
                title="还没有会话"
                description="在电脑上开始一个会话，或点下方按钮新建一个。"
              />
            ) : (
              <EmptyState
                icon={
                  <WarningIcon
                    size={24}
                    color={typeof destructiveColor === 'string' ? destructiveColor : undefined}
                  />
                }
                title="尚未连接 Host"
                description="先扫描电脑上的配对二维码，或手动输入地址与配对码。"
                action={<AppButton onPress={() => router.replace('/')}>去配对</AppButton>}
              />
            )
          ) : undefined
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={'打开会话 ' + (item.title ?? '未命名会话')}
            onPress={() => openSession(item)}
            className="rounded-2xl border border-border bg-surface p-4 active:opacity-80"
          >
            <View className="flex-row items-start gap-2">
              <Text className="flex-1 text-[15px] font-medium leading-5 text-foreground" numberOfLines={2}>
                {item.title?.trim() || '未命名会话'}
              </Text>
              {item.running ? runningPill() : null}
            </View>

            {item.lastMessage?.text ? (
              <Text className="mt-1.5 text-xs leading-4 text-muted" numberOfLines={2}>
                {truncate(item.lastMessage.text, 160)}
              </Text>
            ) : null}

            <View className="mt-2.5 flex-row items-center gap-2">
              <Text className="flex-1 text-[11px] text-muted" numberOfLines={1}>
                {formatRelativeTime(item.updatedAt)} · {item.cwd ?? '—'}
              </Text>
              <ChevronRightIcon size={14} color={typeof mutedColor === 'string' ? mutedColor : undefined} />
            </View>
          </Pressable>
        )}
      />

      <View className="absolute inset-x-0 bottom-0 border-t border-border bg-background/95 px-5 pb-4 pt-3">
        {!connected ? (
          <Text className="pb-2 text-center text-[11px] text-muted">
            断线中，连接恢复后可继续操作
          </Text>
        ) : null}
        <AppButton
          loading={creating}
          disabled={!connected}
          startIcon={PlusIcon}
          onPress={() => void createSession()}
        >
          {creating ? '正在创建…' : '新建会话'}
        </AppButton>
      </View>
    </ScreenFrame>
  );
}
