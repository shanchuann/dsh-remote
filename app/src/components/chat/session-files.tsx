import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { Alert, Image, Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getActiveToken, useRemoteStore } from '../../lib/store';
import type { TranscriptImage } from '../../lib/transcript';
import { desktopPath, isImagePath, workspaceFileUrl } from '../../lib/session-files';
import { CodeBlock } from '../code-block';
import { toCodeLanguage } from './format';

const FilesContext = createContext<{ sessionId?: string; open: (path: string) => void }>({ open: () => undefined });
export function useSessionFiles() { return useContext(FilesContext); }

export function SessionFilesProvider({ sessionId, children }: { sessionId?: string; children: ReactNode }) {
  const base = useRemoteStore(s => s.connection.baseUrl);
  const actions = useRemoteStore(s => s.actions);
  const [preview, setPreview] = useState<{ path: string; text?: string; error?: string; loading?: boolean }>();
  const [sharing, setSharing] = useState(false);
  const request = useRef(0);
  const insets = useSafeAreaInsets();
  const close = () => { request.current++; setPreview(undefined); };
  const open = async (value: string) => {
    if (/^(https?:|mailto:|tel:)/i.test(value)) {
      try { await Linking.openURL(value); } catch { Alert.alert('无法打开链接'); }
      return;
    }
    const path = desktopPath(value);
    if (!path || !sessionId) { Alert.alert('无法打开此文件链接'); return; }
    const ticket = ++request.current;
    setPreview({ path, loading: !isImagePath(path) });
    if (isImagePath(path)) return;
    try {
      const file = await actions.readFile(sessionId, path);
      if (ticket === request.current) setPreview({ path, text: file.text + (file.eof === false ? '\n\n…预览仅展示前 3000 行，请下载完整文件。' : '') });
    } catch (error) { if (ticket === request.current) setPreview({ path, error: error instanceof Error ? error.message : String(error) }); }
  };
  const share = async () => {
    if (!preview || !base || !sessionId || sharing) return;
    setSharing(true);
    try {
      if (!await Sharing.isAvailableAsync()) throw new Error('此设备不支持系统分享');
      const name = preview.path.split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._\u4e00-\u9fff-]/g, '_') || 'file';
      const target = new File(Paths.cache, Date.now() + '-' + name);
      const file = await File.downloadFileAsync(workspaceFileUrl(base, sessionId, preview.path), target, { headers: { Authorization: 'Bearer ' + getActiveToken() } });
      try { await Sharing.shareAsync(file.uri); } finally { if (file.exists) file.delete(); }
    } catch (error) { Alert.alert('下载失败', error instanceof Error ? error.message : String(error)); }
    finally { setSharing(false); }
  };
  return <FilesContext value={{ sessionId, open: value => void open(value) }}>
    {children}
    <Modal visible={!!preview} animationType="slide" onRequestClose={close}>
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View className="min-h-14 flex-row items-center gap-2 border-b border-border px-4">
          <Pressable onPress={close} accessibilityRole="button" className="min-h-12 justify-center px-2"><Text className="text-primary">关闭</Text></Pressable>
          <Text className="flex-1 text-sm text-foreground" numberOfLines={2}>{preview?.path.split(/[\\/]/).pop()}</Text>
          <Pressable disabled={sharing} onPress={() => void share()} accessibilityRole="button" className="min-h-12 justify-center px-2"><Text className="text-primary">{sharing ? '下载中…' : '下载 / 分享'}</Text></Pressable>
        </View>
        <ScrollView contentContainerClassName="p-4 gap-3">
          {preview?.loading ? <Text className="text-muted">正在读取文件…</Text> : preview?.error ? <Text selectable className="text-destructive">{preview.error}</Text> : preview && isImagePath(preview.path) ? <RemoteImage image={{ url: preview.path }} /> : preview?.text !== undefined ? <CodeBlock code={preview.text} language={toCodeLanguage(preview.path.split('.').pop())} filename={preview.path.split(/[\\/]/).pop()} maxHeight={650} /> : null}
        </ScrollView>
      </View>
    </Modal>
  </FilesContext>;
}

export function RemoteImage({ image }: { image: TranscriptImage }) {
  const { sessionId, open } = useSessionFiles();
  const base = useRemoteStore(s => s.connection.baseUrl);
  const [failed, setFailed] = useState(false);
  const path = image.url ? desktopPath(image.url) : undefined;
  const uri = image.data ? (image.data.startsWith('data:') ? image.data : 'data:' + (image.mediaType ?? 'image/jpeg') + ';base64,' + image.data) :
    image.attachmentId && base ? base.replace(/\/+$/, '') + '/v1/attachments/' + encodeURIComponent(image.attachmentId) :
    path && base && sessionId ? workspaceFileUrl(base, sessionId, path) : /^https?:|^data:/i.test(image.url ?? '') ? image.url : undefined;
  const authenticated = !!uri && !!base && (uri.startsWith(base.replace(/\/+$/, '') + '/v1/'));
  return <Pressable onPress={path ? () => open(path) : undefined} accessibilityRole={path ? 'button' : 'image'} accessibilityLabel={image.name ?? '图片'} className="my-1 overflow-hidden rounded-xl bg-surface">
    {!uri || failed ? <Text className="p-4 text-xs text-muted">图片暂不可用{path ? '，点按重试预览' : ''}</Text> : <Image source={{ uri, ...(authenticated ? { headers: { Authorization: 'Bearer ' + getActiveToken() } } : {}) }} resizeMode="contain" style={{ width: '100%', height: 220 }} onError={() => setFailed(true)} />}
  </Pressable>;
}
