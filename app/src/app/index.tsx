/**
 * Connect / pair screen (protocol 1.2, 1.3).
 *
 * On launch: restore the persisted token (GET /v1/health + GET /v1/host). If
 * that works the user lands on the session list, otherwise they can scan the
 * host QR code or type the address + six digit code by hand.
 */

import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResolveClassNames } from 'uniwind';

import { AppButton } from '../components/common/app-button';
import { ErrorBanner } from '../components/common/error-banner';
import { CloseIcon, ScanIcon, ServerIcon } from '../components/common/icons';
import { LoadingView, ScreenFrame } from '../components/common/screen';
import { Input } from '../components/input';
import { defaultDeviceName, loadConnectionMeta } from '../lib/config';
import { describeError } from '../lib/errors';
import { isValidPairingCode, parsePairingUri, tryNormalizeBaseUrl } from '../lib/pairing';
import { useRemoteStore } from '../lib/store';

function BrandMark({ size = 64 }: { size?: number }) {
  return (
    <View
      className="items-center justify-center overflow-hidden rounded-[22px] border border-border bg-white"
      style={{ width: size, height: size }}
    >
      <Image
        source={require('../../assets/images/deepseek-mark.png')}
        style={{ width: size * 0.66, height: size * 0.66 }}
        resizeMode="contain"
        accessible={false}
      />
    </View>
  );
}

export default function ConnectScreen() {
  const params = useLocalSearchParams<{ u?: string; c?: string; h?: string; n?: string; alt?: string }>();
  const connection = useRemoteStore((state) => state.connection);
  const connect = useRemoteStore((state) => state.actions.connect);
  const { color: mutedColor } = useResolveClassNames('text-muted');

  // A dshremote://pair link lands here with the payload in the route params;
  // read it once during the first render rather than in an effect.
  const initialPairing = useMemo(() => {
    const u = typeof params.u === 'string' ? params.u : undefined;
    if (!u) return null;
    return parsePairingUri(
      'dshremote://pair?u=' +
        encodeURIComponent(u) +
        (typeof params.c === 'string' ? '&c=' + encodeURIComponent(params.c) : ''),
    );
  }, [params.c, params.u]);

  const [phase, setPhase] = useState<'restoring' | 'form'>('restoring');
  const [baseUrl, setBaseUrl] = useState(initialPairing?.baseUrl ?? '');
  const [code, setCode] = useState(initialPairing?.code ?? '');
  const [deviceName, setDeviceName] = useState(defaultDeviceName());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);
  const submittingRef = useRef(false);

  // Restore a saved pairing once per launch.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const restored = await useRemoteStore.getState().actions.restore();
      if (cancelled) return;
      if (restored) {
        router.replace('/sessions');
        return;
      }
      setPhase('form');
      const meta = await loadConnectionMeta();
      if (!cancelled && meta) {
        setBaseUrl((current) => current || meta.baseUrl);
        setDeviceName((current) => current || meta.deviceName);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = useCallback(
    async (override?: { baseUrl?: string; altBaseUrl?: string; code?: string }) => {
      if (submittingRef.current) return;
      const rawBase = (override?.baseUrl ?? baseUrl).trim();
      const rawCode = (override?.code ?? code).trim();
      // A pasted pairing URI carries both the host address and the code.
      const parsed = rawBase.toLowerCase().startsWith('dshremote:') ? parsePairingUri(rawBase) : null;
      const targetBase = parsed?.baseUrl ?? tryNormalizeBaseUrl(rawBase) ?? '';
      const targetAlt = parsed?.altBaseUrl;
      const targetCode = rawCode || parsed?.code || '';
      if (!targetBase) {
        setError('请输入 Host 地址，例如 http://192.168.1.23:8790');
        return;
      }
      if (!isValidPairingCode(targetCode)) {
        setError('请输入 6 位数字配对码');
        return;
      }
      submittingRef.current = true;
      setBusy(true);
      setError(undefined);
      try {
        await connect({ baseUrl: targetBase, altBaseUrl: targetAlt, code: targetCode, deviceName });
        router.replace('/sessions');
      } catch (cause) {
        setError(describeError(cause));
      } finally {
        submittingRef.current = false;
        setBusy(false);
      }
    },
    [baseUrl, code, connect, deviceName],
  );

  // A deep-link pairing payload (forwarded by src/app/pair.tsx) connects
  // immediately, even when this screen was already mounted.
  const autoPairRef = useRef<string | null>(null);
  useEffect(() => {
    const u = typeof params.u === 'string' ? params.u : undefined;
    const c = typeof params.c === 'string' ? params.c : undefined;
    if (!u || !c) return;
    const key = u + '|' + c;
    if (autoPairRef.current === key) return;
    autoPairRef.current = key;
    // Defer so the connect screen can paint before the pairing request starts.
    const timer = setTimeout(() => {
      void submit({ baseUrl: u, altBaseUrl: typeof params.alt === 'string' ? params.alt : undefined, code: c });
    }, 0);
    return () => clearTimeout(timer);
  }, [params.alt, params.c, params.u, submit]);

  const openScanner = useCallback(() => {
    scannedRef.current = false;
    setError(undefined);
    setScannerOpen(true);
    if (!permission?.granted) void requestPermission();
  }, [permission?.granted, requestPermission]);

  const handleBarcode = useCallback(
    (result: BarcodeScanningResult) => {
      if (scannedRef.current) return;
      const info = parsePairingUri(typeof result?.data === 'string' ? result.data : '');
      if (!info) {
        scannedRef.current = true;
        setScannerOpen(false);
        setError('二维码内容无法识别，请扫描 DSH 配对页上的二维码');
        return;
      }
      if (!info.code) {
        scannedRef.current = true;
        setScannerOpen(false);
        setError('二维码里没有配对码，请在电脑上刷新配对页后重试');
        return;
      }
      scannedRef.current = true;
      setBaseUrl(info.baseUrl);
      setCode(info.code);
      setScannerOpen(false);
      void submit({ baseUrl: info.baseUrl, altBaseUrl: info.altBaseUrl, code: info.code });
    },
    [submit],
  );

  if (phase === 'restoring') {
    return (
      <ScreenFrame>
        <View className="flex-1 items-center justify-center gap-5 px-8">
          <BrandMark size={72} />
          <Text className="text-2xl font-semibold text-foreground">DSH Remote</Text>
          <LoadingView label="正在恢复连接…" />
        </View>
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerClassName="px-5 pb-10"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="items-center gap-3 pb-7 pt-10">
            <BrandMark />
            <Text className="text-[28px] font-semibold leading-8 text-foreground">DSH Remote</Text>
            <Text className="max-w-[300px] text-center text-sm leading-5 text-muted">
              用手机连接你的 DeepSeek Harness
            </Text>
          </View>

          <View className="gap-4 rounded-3xl border border-border bg-surface p-4">
            <View className="flex-row items-center gap-2">
              <ServerIcon size={16} color={typeof mutedColor === 'string' ? mutedColor : undefined} />
              <Text className="text-sm font-medium text-foreground">连接 Host</Text>
            </View>

            <Input
              label="Host 地址"
              placeholder="http://192.168.1.23:8790"
              value={baseUrl}
              onChangeText={(value) => {
                setBaseUrl(value);
                if (error) setError(undefined);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="next"
              disabled={busy}
            />

            <Input
              label="配对码"
              placeholder="6 位数字"
              value={code}
              onChangeText={(value) => {
                setCode(value.replace(/[^0-9]/g, '').slice(0, 6));
                if (error) setError(undefined);
              }}
              keyboardType="number-pad"
              maxLength={6}
              returnKeyType="done"
              disabled={busy}
              onSubmitEditing={() => void submit()}
            />

            <Input
              label="设备名称"
              placeholder="在电脑端设备列表里显示的名字"
              value={deviceName}
              onChangeText={setDeviceName}
              autoCapitalize="none"
              disabled={busy}
            />

            {error ?? connection.error ? (
              <ErrorBanner message={error ?? connection.error} />
            ) : null}

            <View className="gap-2 pt-1">
              <AppButton loading={busy} onPress={() => void submit()}>
                {busy ? '连接中…' : '连接'}
              </AppButton>
              <AppButton variant="secondary" startIcon={ScanIcon} disabled={busy} onPress={openScanner}>
                扫描二维码
              </AppButton>
            </View>
          </View>

          <Text className="mt-6 text-center text-[11px] text-muted/70">
            协议 v1 · 局域网直连 · 不经过云端
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={scannerOpen}
        animationType="slide"
        onRequestClose={() => setScannerOpen(false)}
        statusBarTranslucent
      >
        <ScannerOverlay
          permissionGranted={permission?.granted === true}
          onRequestPermission={() => {
            void requestPermission();
          }}
          onClose={() => setScannerOpen(false)}
          onBarcodeScanned={handleBarcode}
        />
      </Modal>
    </ScreenFrame>
  );
}

function ScannerOverlay({
  permissionGranted,
  onRequestPermission,
  onClose,
  onBarcodeScanned,
}: {
  permissionGranted: boolean;
  onRequestPermission: () => void;
  onClose: () => void;
  onBarcodeScanned: (result: BarcodeScanningResult) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-black">
      {permissionGranted ? (
        <>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={onBarcodeScanned}
          />
          <View className="absolute inset-0 items-center justify-center">
            <View className="h-60 w-60 rounded-3xl border-2 border-primary/80" />
            <Text className="mt-6 rounded-full bg-black/50 px-4 py-2 text-sm text-white">
              将电脑上的配对二维码放入框内
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭扫码"
            onPress={onClose}
            className="absolute right-5 h-11 w-11 items-center justify-center rounded-full bg-black/50"
            style={{ top: insets.top + 12 }}
          >
            <CloseIcon size={22} color="#ffffff" />
          </Pressable>
        </>
      ) : (
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <Text className="text-center text-base text-white">需要相机权限才能扫描二维码</Text>
          <Text className="text-center text-sm text-white/70">
            也可以返回上一页，手动输入 Host 地址与配对码。
          </Text>
          <AppButton onPress={onRequestPermission}>允许使用相机</AppButton>
          <AppButton variant="secondary" onPress={onClose}>
            取消
          </AppButton>
        </View>
      )}
    </View>
  );
}