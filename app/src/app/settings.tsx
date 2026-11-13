/**
 * Settings screen: host identity, paired devices (protocol 3.11), and the
 * disconnect / re-pair actions required by protocol 6.7.
 */

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { useResolveClassNames } from 'uniwind';

import { VoiceSettings } from '../components/chat/voice-settings';
import { Button } from '../components/button';
import { AppButton } from '../components/common/app-button';
import { ConnectionBadge } from '../components/common/connection-badge';
import { ErrorBanner } from '../components/common/error-banner';
import { PowerIcon, RefreshIcon, ScanIcon, TrashIcon } from '../components/common/icons';
import { ScreenFrame, ScreenTitle, SectionCard } from '../components/common/screen';
import { appVersion } from '../lib/config';
import { describeError } from '../lib/errors';
import { formatPlatform, formatRelativeTime } from '../lib/format';
import { displayBaseUrl } from '../lib/pairing';
import { useRemoteStore } from '../lib/store';
import { PROTOCOL_VERSION, type Device } from '../lib/types';

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between gap-4 py-1.5">
      <Text className="text-sm text-muted">{label}</Text>
      <Text className="flex-shrink text-right text-sm text-foreground" numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

export default function SettingsScreen() {
  const connection = useRemoteStore((state) => state.connection);
  const host = useRemoteStore((state) => state.host);
  const devices = useRemoteStore((state) => state.devices);
  const actions = useRemoteStore((state) => state.actions);

  const { color: mutedColor } = useResolveClassNames('text-muted');
  const { color: destructiveColor } = useResolveClassNames('text-destructive');

  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    let refreshing = false;
    const refreshMetadata = async () => {
      if (refreshing || AppState.currentState !== 'active' ||
          useRemoteStore.getState().connection.status !== 'connected') return;
      refreshing = true;
      try {
        await Promise.all([actions.refreshHost(), actions.refreshDevices()]);
      } finally {
        refreshing = false;
      }
    };
    void refreshMetadata();
    const timer = setInterval(() => void refreshMetadata(), 15000);
    return () => clearInterval(timer);
  }, [actions]));

  const disconnect = useCallback(() => {
    Alert.alert('断开连接', '断开后会清除本机保存的 token，需要重新扫描二维码配对。', [
      { text: '取消', style: 'cancel' },
      {
        text: '断开',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await actions.disconnect();
            router.replace('/');
          })();
        },
      },
    ]);
  }, [actions]);

  const rePair = useCallback(() => {
    Alert.alert('重新配对', '将断开当前连接并返回配对页。', [
      { text: '取消', style: 'cancel' },
      {
        text: '重新配对',
        onPress: () => {
          void (async () => {
            await actions.disconnect();
            router.replace('/');
          })();
        },
      },
    ]);
  }, [actions]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      await actions.refreshHost();
      await actions.refreshDevices();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }, [actions]);

  const removeDevice = useCallback(
    (device: Device) => {
      const isCurrent = device.current === true;
      Alert.alert(
        '移除设备',
        '确定从 Host 移除「' + (device.name ?? '未知设备') + '」吗？' + (isCurrent ? '\n当前设备会立即断开连接。' : ''),
        [
          { text: '取消', style: 'cancel' },
          {
            text: '移除',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                setBusy(true);
                setError(undefined);
                try {
                  await actions.removeDevice(device.deviceId);
                  if (isCurrent) router.replace('/');
                } catch (cause) {
                  setError(describeError(cause));
                } finally {
                  setBusy(false);
                }
              })();
            },
          },
        ],
      );
    },
    [actions],
  );

  const protocol = host?.protocol;
  const protocolMismatch = typeof protocol === 'number' && protocol !== PROTOCOL_VERSION;
  const canAct = connection.status === 'connected';

  return (
    <ScreenFrame>
      <ScreenTitle title="设置" subtitle="连接、设备与版本信息" />

      <ScrollView contentContainerClassName="gap-4 px-5 pb-12" showsVerticalScrollIndicator={false}>
        {connection.needsPairing ? (
          <ErrorBanner
            message="认证已失效，请重新配对"
            retryLabel="去配对"
            onRetry={() => router.replace('/')}
            onDismiss={() => actions.clearError()}
          />
        ) : connection.error ? (
          <ErrorBanner
            message={connection.error}
            onRetry={() => {
              void (async () => {
                setBusy(true);
                try {
                  await actions.resume();
                } finally {
                  setBusy(false);
                }
              })();
            }}
            onDismiss={() => actions.clearError()}
          />
        ) : null}

        {error ? <ErrorBanner message={error} onDismiss={() => setError(undefined)} /> : null}

        <View className="flex-row items-center justify-between">
          <ConnectionBadge status={connection.status} hostName={host?.name ?? connection.baseUrl} />
          <Button
            size="sm"
            variant="ghost"
            startIcon={RefreshIcon}
            disabled={busy || !canAct}
            onPress={() => void refresh()}
          >
            刷新
          </Button>
        </View>

        <VoiceSettings />
        <SectionCard title="Host">
          <InfoRow label="名称" value={host?.name ?? '—'} />
          <InfoRow label="地址" value={displayBaseUrl(connection.baseUrl)} />
          <InfoRow label="平台" value={formatPlatform(host?.platform)} />
          <InfoRow label="DSH 版本" value={host?.dshVersion ?? '—'} />
          <InfoRow label="插件版本" value={host?.pluginVersion ?? '—'} />
          <InfoRow label="协议版本" value={'v' + (typeof protocol === 'number' ? protocol : PROTOCOL_VERSION) + (protocolMismatch ? '（不兼容）' : '')} />
          <InfoRow label="默认目录" value={host?.defaultCwd ?? '—'} />
        </SectionCard>

        {protocolMismatch ? (
          <ErrorBanner message={'Host 协议版本为 v' + protocol + '，App 只支持 v' + PROTOCOL_VERSION + '，请升级其中一端。'} />
        ) : null}

        <SectionCard
          title={'已配对设备（' + devices.length + '）'}
          footer={
            <View className="flex-row justify-between gap-2">
              <AppButton
                size="sm"
                variant="secondary"
                startIcon={RefreshIcon}
                disabled={busy || !canAct}
                onPress={() => void refresh()}
                className="flex-1"
              >
                刷新设备
              </AppButton>
            </View>
          }
        >
          {devices.length === 0 ? (
            <Text className="py-2 text-sm text-muted">暂无设备列表</Text>
          ) : (
            <View className="gap-3">
              {devices.map((device) => (
                <View key={device.deviceId} className="flex-row items-center gap-3">
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2">
                      <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                        {device.name ?? '未知设备'}
                      </Text>
                      {device.current ? (
                        <View className="rounded-full bg-primary/15 px-2 py-0.5">
                          <Text className="text-[10px] font-medium text-primary">本机</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text className="mt-0.5 text-[11px] text-muted">
                      {formatPlatform(device.platform)} · 最近活跃 {formatRelativeTime(device.lastSeenAt)}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={'移除设备 ' + (device.name ?? '')}
                    hitSlop={10}
                    disabled={busy || !canAct}
                    onPress={() => removeDevice(device)}
                    className="h-10 w-10 items-center justify-center rounded-full"
                  >
                    <TrashIcon
                      size={18}
                      color={typeof destructiveColor === 'string' ? destructiveColor : undefined}
                    />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </SectionCard>

        <SectionCard title="连接">
          <View className="gap-2 py-1">
            <AppButton
              variant="secondary"
              startIcon={ScanIcon}
              disabled={busy}
              onPress={rePair}
            >
              重新配对
            </AppButton>
            <AppButton variant="ghost" disabled={busy} onPress={disconnect}>
              断开连接
            </AppButton>
          </View>
        </SectionCard>

        <SectionCard title="关于">
          <InfoRow label="App" value={'DSH Remote ' + appVersion()} />
          <InfoRow label="协议" value={'DSH Remote 移动协议 v' + PROTOCOL_VERSION} />
          <InfoRow label="连接方式" value="局域网 / Tailscale · HTTP + SSE" />
          <View className="mt-2 flex-row items-center gap-2">
            <PowerIcon size={14} color={typeof mutedColor === 'string' ? mutedColor : undefined} />
            <Text className="text-[11px] text-muted">
              安全提示：明文 HTTP 仅用于局域网，请勿在公共网络使用。
            </Text>
          </View>
        </SectionCard>
      </ScrollView>
    </ScreenFrame>
  );
}
