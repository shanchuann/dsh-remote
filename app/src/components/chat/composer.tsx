import { type ComponentRef, type RefObject, useEffect, useRef, useState } from "react";
import { Alert, AppState, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import { useUniwind } from "uniwind";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboardState } from "react-native-keyboard-controller";

import { router } from "expo-router";
import { cancelVoice, refreshVoice, startVoice, stopVoice, useVoice, voicePermissionPending } from "../../lib/voice";
import { PromptInput } from "../prompt-input";
import { ImageIcon } from "../common/icons";
import type { PromptImage } from "../../lib/types";

export type ComposerProps = {
  blurTarget: RefObject<ComponentRef<typeof View> | null>;
  value: string;
  onValueChange: (value: string) => void;
  onSend: (text: string, images?: PromptImage[]) => void;
  onStop: () => void;
  running: boolean;
  disabled?: boolean;
  placeholder?: string;
};

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function base64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

/**
 * The chat composer: text plus image attachments that ride above the field as
 * removable chips. Images are sent as protocol 3.8 image content blocks.
 */
export function Composer({
  blurTarget,
  value,
  onValueChange,
  onSend,
  onStop,
  running,
  disabled = false,
  placeholder = "给 DSH 发消息…",
}: ComposerProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useUniwind();
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const voice = useVoice();
  const valueRef = useRef(value);
  const voiceTicket = useRef(0);
  const voiceStarting = useRef(false);
  useEffect(() => { valueRef.current = value; }, [value]);
  const recording = voice.phase === 'recording';
  const recognizing = voice.phase === 'recognizing';
  useEffect(() => {
    void refreshVoice().catch(() => undefined);
    const sub = AppState.addEventListener('change', state => { if (state !== 'active' && !voicePermissionPending()) { voiceTicket.current++; cancelVoice(); } });
    const invalidateVoice = () => { voiceTicket.current++; cancelVoice(); };
    return () => { sub.remove(); invalidateVoice(); };
  }, []);
  const beginVoice = async () => {
    if (disabled || voiceStarting.current || recognizing || recording) return;
    if (!voice.ready) { Alert.alert('本地语音输入', '请先在设置页下载并校验语音模型。', [{ text: '取消', style: 'cancel' }, { text: '去设置', onPress: () => router.push('/settings') }]); return; }
    voiceStarting.current = true;
    const ticket = ++voiceTicket.current;
    try { await startVoice(); if (ticket !== voiceTicket.current) cancelVoice(); }
    catch (error) { Alert.alert('无法开始录音', error instanceof Error ? error.message : String(error)); }
    finally { voiceStarting.current = false; }
  };
  const finishVoice = async () => {
    const ticket = ++voiceTicket.current;
    try {
      const text = await stopVoice();
      if (ticket !== voiceTicket.current) return;
      if (text.trim()) onValueChange([valueRef.current.trimEnd(), text.trim()].filter(Boolean).join(' '));
      else Alert.alert('没有识别到语音', '请靠近麦克风后重试。');
    } catch (error) { if (ticket === voiceTicket.current) Alert.alert('识别失败', error instanceof Error ? error.message : String(error)); }
  };
  const [images, setImages] = useState<PromptImage[]>([]);

  const pickImages = async () => {
    if (disabled) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("需要相册权限", "允许访问相册后才能选择图片附件。");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: MAX_IMAGES,
        quality: 0.6,
        base64: true,
      });
      if (result.canceled) return;
      const picked: PromptImage[] = [];
      for (const asset of result.assets) {
        const data = asset.base64;
        if (typeof data !== "string" || data.length === 0) continue;
        if (base64Bytes(data) > MAX_IMAGE_BYTES) {
          Alert.alert("图片太大", "单张图片需小于 5MB，请选择更小的图片。");
          continue;
        }
        picked.push({
          id: Date.now() + "-" + picked.length,
          name: asset.fileName ?? "image.jpg",
          mediaType: asset.mimeType ?? "image/jpeg",
          data,
          uri: asset.uri,
        });
      }
      if (picked.length > 0) setImages((current) => [...current, ...picked].slice(0, MAX_IMAGES));
    } catch (error) {
      Alert.alert("选择图片失败", error instanceof Error ? error.message : String(error));
    }
  };

  const send = (text: string) => {
    const trimmed = text.trim();
    if ((!trimmed && images.length === 0) || disabled) return;
    onSend(trimmed, images.length > 0 ? images : undefined);
    setImages([]);
  };

  // Multiline text and dictated text stay editable; only the send button submits.
  const handleChange = onValueChange;

  const attachments = images.map((image) => ({
    id: image.id,
    label: image.name ?? "图片",
    icon: (
      <Image
        source={{ uri: "data:" + image.mediaType + ";base64," + image.data }}
        style={{ width: 16, height: 16, borderRadius: 4 }}
      />
    ),
  }));

  return (
    <View
      pointerEvents="box-none"
      className="shrink-0 bg-transparent px-4 pt-3"
      style={{ paddingBottom: (keyboardVisible ? 0 : insets.bottom) + 12 }}
    >
      {recording || recognizing ? <View className="mb-2 flex-row items-center gap-2 rounded-2xl border border-primary/30 bg-primary/5 px-3 py-2">
        <View className="flex-1"><Text className="text-sm text-foreground">{recognizing ? '正在本地识别…' : '正在聆听 ' + (voice.seconds ?? 0) + ' 秒'}</Text><Text className="mt-1 text-xs text-muted">{recognizing ? '结果将填入输入框' : '最多 90 秒，完成后可编辑'}</Text></View>
        <Pressable accessibilityRole="button" onPress={() => { voiceTicket.current++; cancelVoice(); }} className="min-h-12 justify-center px-2"><Text className="text-muted">取消</Text></Pressable>
        {recording ? <Pressable accessibilityRole="button" onPress={() => void finishVoice()} className="min-h-12 justify-center px-2"><Text className="font-medium text-primary">完成</Text></Pressable> : null}
      </View> : null}
      <PromptInput
        value={value}
        onValueChange={handleChange}
        onSubmit={(text) => send(text)}
        loading={running}
        onStop={onStop}
        disabled={disabled || recording || recognizing}
        onVoice={voice.supported ? () => void beginVoice() : undefined}
        placeholder={placeholder}
        maxRows={5}
        layout="capsule"
        backdrop={<View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <BlurView blurTarget={blurTarget} blurMethod="dimezisBlurViewSdk31Plus" intensity={90} tint={theme === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: theme === 'dark' ? 'rgba(23,25,35,0.9)' : 'rgba(250,250,250,0.9)' }]} />
        </View>}
        restoreOnStop
        className="border border-border-strong"
        actions={[
          {
            value: "image",
            label: "添加图片",
            description: "最多 4 张，单张 ≤ 5MB",
            icon: ImageIcon,
          },
        ]}
        onAction={(action) => {
          if (action === "image") void pickImages();
        }}
        attachments={attachments}
        onRemoveAttachment={(id) => setImages((current) => current.filter((image) => image.id !== id))}
      />
    </View>
  );
}
