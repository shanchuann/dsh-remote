import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { SectionCard } from '../common/screen';
import { AppButton } from '../common/app-button';
import { cancelVoiceDownload, downloadVoice, refreshVoice, removeVoice, useVoice, voicePreferences } from '../../lib/voice';

const languages = [['auto', '自动'], ['zh','普通话'], ['yue','粤语'], ['en','英语'], ['ja','日语'], ['ko','韩语']];
export function VoiceSettings() {
  const state = useVoice();
  const [busy, setBusy] = useState(false);
  useEffect(() => { void refreshVoice().catch(() => undefined); }, []);
  const downloading = state.phase === 'downloading' || state.phase === 'verifying';
  const inUse = state.phase === 'recording' || state.phase === 'recognizing';
  const progress = Math.min(1, (state.downloaded ?? 0) / state.bytes);
  return <SectionCard title="本地语音输入">
    <Text className="text-sm leading-6 text-foreground">SenseVoice 本地识别</Text>
    <Text className="mt-1 text-xs leading-5 text-muted">与 DSH 桌面使用同一套识别模型。下载约 241 MB，请预留至少 300 MB；下载后可离线使用。录音留在手机，识别文字经确认后发送。</Text>
    {!state.supported ? <Text className="mt-3 text-xs text-muted">请安装支持本地语音的 Android APK。</Text> : <View className="mt-3 gap-3">
      <Text className="text-sm text-foreground">{state.ready ? '模型已就绪' : downloading ? state.phase === 'verifying' ? '正在校验模型…' : '正在下载 ' + Math.round(progress * 100) + '%' : '模型尚未下载'}</Text>
      {downloading ? <View className="h-1 overflow-hidden rounded-full bg-border"><View className="h-1 bg-primary" style={{ width: `${Math.max(2, progress * 100)}%` }} /></View> : null}
      {state.error ? <Text selectable className="text-xs text-destructive">{state.error}</Text> : null}
      <Text className="text-xs text-muted">下载源</Text>
      <View className="flex-row gap-2">{[['https://huggingface.co','官方源'],['https://hf-mirror.com','国内镜像']].map(([origin,label]) => <Pressable key={origin} disabled={downloading || inUse} onPress={() => void voicePreferences({ origin })} accessibilityRole="radio" accessibilityState={{ checked: state.origin === origin }} className={'min-h-11 flex-1 items-center justify-center rounded-full border ' + (state.origin === origin ? 'border-primary bg-primary/10' : 'border-border')}><Text className="text-xs text-foreground">{label}</Text></Pressable>)}</View>
      <Text className="text-xs text-muted">识别语言</Text>
      <View className="flex-row flex-wrap gap-2">{languages.map(([language,label]) => <Pressable key={language} disabled={inUse} onPress={() => void voicePreferences({ language })} accessibilityRole="radio" accessibilityState={{ checked: state.language === language }} className={'min-h-11 justify-center rounded-full border px-3 ' + (state.language === language ? 'border-primary bg-primary/10' : 'border-border')}><Text className="text-xs text-foreground">{label}</Text></Pressable>)}</View>
      {downloading ? <AppButton variant="secondary" onPress={cancelVoiceDownload}>取消下载</AppButton> : state.ready ? <AppButton variant="secondary" disabled={busy || inUse} onPress={() => Alert.alert('删除语音模型', '删除后需重新下载才能使用语音输入。', [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => { setBusy(true); void removeVoice().catch(e => Alert.alert('删除失败', e.message)).finally(() => setBusy(false)); } }])}>删除模型</AppButton> : <AppButton disabled={inUse} onPress={() => void downloadVoice()}>下载语音模型</AppButton>}
    </View>}
  </SectionCard>;
}
