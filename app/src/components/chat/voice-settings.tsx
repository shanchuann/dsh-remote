import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useResolveClassNames } from 'uniwind';
import { SectionCard } from '../common/screen';
import { AppButton } from '../common/app-button';
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '../menu';
import { ChevronDownGlyph } from '../../primitives/agent-icons';
import { cancelVoiceDownload, downloadVoice, refreshVoice, removeVoice, useVoice, voicePreferences } from '../../lib/voice';

const languages = [['auto', '自动'], ['zh', '普通话'], ['yue', '粤语'], ['en', '英语'], ['ja', '日语'], ['ko', '韩语']];

export function VoiceSettings() {
  const state = useVoice();
  const [busy, setBusy] = useState(false);
  const { color } = useResolveClassNames('text-foreground');
  useEffect(() => { void refreshVoice().catch(() => undefined); }, []);
  const downloading = state.phase === 'downloading' || state.phase === 'verifying';
  const inUse = state.phase === 'recording' || state.phase === 'recognizing';
  const progress = Math.min(1, (state.downloaded ?? 0) / state.bytes);
  const language = languages.find(([value]) => value === state.language)?.[1] ?? '自动';
  const status = state.ready ? '已就绪' : downloading ? state.phase === 'verifying' ? '正在校验' : Math.round(progress * 100) + '%' : '未下载';

  function remove() {
    Alert.alert('删除语音模型', '删除后需重新下载才能使用语音输入。', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => {
        setBusy(true);
        void removeVoice().catch(e => Alert.alert('删除失败', e.message)).finally(() => setBusy(false));
      } },
    ]);
  }

  return <SectionCard title="本地语音输入">
    <View className="flex-row items-center justify-between gap-3">
      <Text className="text-base font-medium text-foreground">SenseVoice</Text>
      <Text className={'text-xs ' + (state.ready ? 'text-success' : 'text-muted')} accessibilityLiveRegion="polite">{status}</Text>
    </View>
    <Text className="mt-2 text-xs leading-5 text-muted">离线识别，录音留在手机。约 241 MB，使用国内镜像下载。</Text>
    {!state.supported ? <Text className="mt-3 text-xs text-muted">请安装支持本地语音的 Android APK。</Text> : <View className="mt-4 gap-3">
      {downloading ? <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }} className="h-1 overflow-hidden rounded-full bg-border"><View className="h-1 bg-primary" style={{ width: `${Math.max(2, progress * 100)}%` }} /></View> : null}
      {state.error ? <Text selectable className="text-xs leading-5 text-destructive">{state.error}</Text> : null}
      <View className="flex-row items-center gap-2">
        <View className="min-w-0 flex-1">
          <AppButton size="md" className="min-h-11" variant={state.ready || downloading ? 'secondary' : 'primary'} disabled={busy || inUse} loading={busy}
            onPress={downloading ? cancelVoiceDownload : state.ready ? remove : () => { void downloadVoice(); }}>
            {downloading ? '取消下载' : state.ready ? '删除模型' : '下载'}
          </AppButton>
        </View>
        <Menu>
          <MenuTrigger disabled={inUse} accessibilityLabel={'识别语言：' + language} className="min-h-11 flex-row items-center justify-center gap-2 rounded-full border border-border px-4">
            <Text className="text-sm text-foreground">{language}</Text>
            <ChevronDownGlyph size={14} color={color} />
          </MenuTrigger>
          <MenuContent align="end">
            <MenuRadioGroup value={state.language} onValueChange={language => { void voicePreferences({ language }).catch(() => Alert.alert('无法保存语言设置')); }}>
              {languages.map(([value, label]) => <MenuRadioItem key={value} value={value}>{label}</MenuRadioItem>)}
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
      </View>
    </View>}
  </SectionCard>;
}
