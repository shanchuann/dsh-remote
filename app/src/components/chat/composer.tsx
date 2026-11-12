import { useState } from "react";
import { Alert, Image, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PromptInput } from "../prompt-input";
import { ImageIcon } from "../common/icons";
import type { PromptImage } from "../../lib/types";

export type ComposerProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSend: (text: string, images?: PromptImage[]) => void;
  onStop: () => void;
  running: boolean;
  disabled?: boolean;
  placeholder?: string;
};

const MAX_IMAGES = 5;
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
  value,
  onValueChange,
  onSend,
  onStop,
  running,
  disabled = false,
  placeholder = "给 DSH 发消息…",
}: ComposerProps) {
  const insets = useSafeAreaInsets();
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

  const handleChange = (next: string) => {
    if (next.endsWith("\n") && (next.trim().length > 0 || images.length > 0) && !running && !disabled) {
      onValueChange("");
      send(next);
      return;
    }
    onValueChange(next);
  };

  const attachments = images.map((image) => ({
    id: image.id,
    label: image.name ?? "图片",
    icon: image.uri ? (
      <Image source={{ uri: image.uri }} style={{ width: 16, height: 16, borderRadius: 4 }} />
    ) : (
      <View style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: "#d1d5db" }} />
    ),
  }));

  return (
    <View
      className="bg-background px-2 pt-1.5"
      style={{ paddingBottom: Math.max(insets.bottom, 6) + 4 }}
    >
      <PromptInput
        value={value}
        onValueChange={handleChange}
        onSubmit={(text) => send(text)}
        loading={running}
        onStop={onStop}
        disabled={disabled}
        placeholder={placeholder}
        maxRows={5}
        restoreOnStop
        className="border border-border"
        actions={[
          {
            value: "image",
            label: "添加图片",
            description: "最多 5 张，单张 ≤ 5MB",
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