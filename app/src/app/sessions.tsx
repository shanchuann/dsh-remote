/**
 * Session list screen (protocol 3.3). Pull to refresh, running indicator,
 * create-session action, and an entry point to settings.
 */

import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useResolveClassNames } from 'uniwind';

import { Button } from '../components/button';
import { AppButton } from '../components/common/app-button';
import { ConnectionBadge } from '../components/common/connection-badge';
import { EmptyState } from '../components/common/empty-state';
import { ErrorBanner } from '../components/common/error-banner';
import { ChatIcon, ChevronUpIcon, ChevronRightIcon, FolderIcon, FolderOpenIcon, SettingsIcon, WarningIcon } from '../components/common/icons';
import { ScreenFrame, ScreenTitle } from '../components/common/screen';
import { SkeletonBlock, SkeletonGroup } from '../components/common/skeleton';
import { describeError } from '../lib/errors';
import { formatRelativeTime } from '../lib/format';
import { useRemoteStore } from '../lib/store';
import { groupSessionProjects } from '../lib/projects';
import type { CreateSessionOptions, SessionRow } from '../lib/types';

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
  const workspaces = useRemoteStore((state) => state.workspaces);
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
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const projects = useMemo(() => groupSessionProjects(sessions, workspaces), [sessions, workspaces]);
  const mainSessionCount = projects.reduce((total, project) => total + project.sessions.length, 0);

  // Refresh once the link (re)connects so the list is never stale.
  useEffect(() => {
    if (connection.status === 'connected') void actions.refreshSessions();
  }, [actions, connection.status]);

  const openSession = useCallback((row: SessionRow) => {
    router.push({ pathname: '/session/[id]', params: { id: row.sessionId } });
  }, []);

  const createSession = useCallback(async (options?: CreateSessionOptions) => {
    if (creating) return;
    setCreating(true);
    setCreateError(undefined);
    try {
      const sessionId = await actions.createSession(options);
      router.push({ pathname: '/session/[id]', params: { id: sessionId } });
    } catch (error) {
      setCreateError(describeError(error));
    } finally {
      setCreating(false);
    }
  }, [actions, creating]);

  const connected = connection.status === 'connected';
  const showEmpty = !sessionsLoading && projects.length === 0;
  const error = createError ?? sessionsError;

  return (
    <ScreenFrame>
      <ScreenTitle
        title="项目"
        subtitle={projects.length > 0 ? projects.length + ' 个项目，' + mainSessionCount + ' 个对话' : '展开项目，继续对话'}
        right={
          <Button
            size="icon"
            variant="ghost"
            icon={({ color }) => <SettingsIcon size={24} color={color} />}
            style={{ width: 48, height: 48 }}
            hitSlop={0}
            accessibilityLabel="打开设置"
            onPress={() => router.push('/settings')}
          />
        }
      />

      <View className="flex-row items-center px-4 pb-4">
        <ConnectionBadge
          status={connection.status}
          hostName={connection.host?.name ?? connection.baseUrl}
        />
      </View>

      {connection.needsPairing ? (
        <View className="px-4 pb-3">
          <ErrorBanner
            message="认证已失效，请重新配对"
            retryLabel="去配对"
            onRetry={() => router.replace('/')}
          />
        </View>
      ) : null}

      {error ? (
        <View className="px-4 pb-3">
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
        data={projects}
        className="flex-1"
        extraData={expanded}
        keyExtractor={(item) => item.id}
        contentContainerClassName="px-4 pb-4"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={sessionsLoading && projects.length > 0}
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
          ) : sessionsLoading ? (
            <SkeletonGroup className="gap-3">
              {[0, 1, 2, 3].map((key) => (
                <View key={key} className="gap-3 rounded-2xl border border-border p-4">
                  <SkeletonBlock className="h-5 w-1/2" />
                  <SkeletonBlock className="h-3 w-4/5" />
                  <SkeletonBlock className="h-3 w-1/3" />
                </View>
              ))}
            </SkeletonGroup>
          ) : undefined
        }
        renderItem={({ item }) => (
          <View className="overflow-hidden rounded-2xl border border-border bg-surface">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={'项目 ' + item.name + '，' + item.sessions.length + ' 个对话'}
              accessibilityState={{ expanded: expanded.has(item.id) }}
              onPress={() => setExpanded((current) => {
                const next = new Set(current);
                if (next.has(item.id)) next.delete(item.id);
                else next.add(item.id);
                return next;
              })}
              className="gap-2 p-4 active:opacity-80"
            >
              <View className="flex-row items-center gap-3">
                {expanded.has(item.id) ? <FolderOpenIcon size={20} /> : <FolderIcon size={20} />}
                <Text className="flex-1 text-base font-semibold text-foreground" numberOfLines={1}>{item.name}</Text>
                {item.sessions.some((row) => row.running) ? runningPill() : null}
                {expanded.has(item.id)
                  ? <ChevronUpIcon size={18} color={typeof mutedColor === 'string' ? mutedColor : undefined} />
                  : <ChevronRightIcon size={16} color={typeof mutedColor === 'string' ? mutedColor : undefined} />}
              </View>
              <Text className="text-xs leading-[18px] text-muted" numberOfLines={2}>{item.cwd ?? '未指定工作目录'}</Text>
              <Text className="text-xs leading-4 text-muted">{item.sessions.length} 个对话</Text>
            </Pressable>
            {expanded.has(item.id) ? (
              <View className="border-t border-border bg-background">
                {item.sessions.map((row) => (
                  <Pressable key={row.sessionId} accessibilityRole="button" accessibilityLabel={'打开对话 ' + (row.title || '未命名对话')}
                    onPress={() => openSession(row)} className="min-h-16 flex-row items-center gap-3 border-b border-border px-4 py-3 active:bg-surface">
                    <ChatIcon size={16} color={typeof mutedColor === 'string' ? mutedColor : undefined} />
                    <View className="flex-1 gap-1">
                      <Text className="text-sm font-medium leading-5 text-foreground" numberOfLines={2}>{row.title?.trim() || '未命名对话'}</Text>
                      <Text className="text-xs leading-4 text-muted">{formatRelativeTime(row.updatedAt)}</Text>
                    </View>
                    {row.running ? runningPill() : null}
                    <ChevronRightIcon size={14} color={typeof mutedColor === 'string' ? mutedColor : undefined} />
                  </Pressable>
                ))}
                <Pressable accessibilityRole="button" accessibilityLabel={'在项目 ' + item.name + ' 中新建对话'}
                  disabled={creating || !connected} onPress={() => void createSession(item.workspaceId ? { workspaceId: item.workspaceId } : item.cwd ? { cwd: item.cwd } : {})}
                  className="min-h-12 flex-row items-center justify-center gap-2 px-4 py-3 active:bg-surface disabled:opacity-50">
                  <Text className="text-sm font-medium text-primary">新建对话</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        )}
      />

      <View className="border-t border-border bg-background px-4 pb-3 pt-3">
        {!connected ? (
          <Text className="pb-2 text-center text-[11px] text-muted">
            断线中，连接恢复后可继续操作
          </Text>
        ) : null}
        <AppButton
          loading={creating}
          disabled={!connected}
          onPress={() => void createSession()}
        >
          {creating ? '正在创建…' : '新建会话'}
        </AppButton>
      </View>
    </ScreenFrame>
  );
}
