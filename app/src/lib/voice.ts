import { requireOptionalNativeModule, type NativeModule } from 'expo';
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

export type VoiceState = { phase: string; ready: boolean; bytes: number; downloaded?: number; seconds?: number; error?: string };
type VoiceEvents = { state: (state: VoiceState) => void };
type VoiceModule = InstanceType<NativeModule<VoiceEvents>> & {
  status(): Promise<VoiceState>;
  prepare(origin: string): Promise<void>;
  cancelDownload(): void;
  removeModels(): Promise<void>;
  requestPermission(): Promise<{ granted: boolean }>;
  startRecording(): Promise<void>;
  stopRecording(language: string): Promise<string>;
  cancelRecording(): void;
};
const native = requireOptionalNativeModule<VoiceModule>('DshVoice');
export const useVoice = create<VoiceState & { language: string; origin: string; supported: boolean }>(() => ({
  phase: 'idle', ready: false, bytes: 241357257, language: 'auto', origin: 'https://huggingface.co', supported: !!native,
}));
native?.addListener('state', (state: VoiceState) => useVoice.setState({ ...state, error: state.error }));
let initialized = false;
export async function refreshVoice() {
  if (!initialized) {
    initialized = true;
    const raw = await AsyncStorage.getItem('dsh-voice-preferences').catch(() => null);
    if (raw) try { const prefs = JSON.parse(raw); useVoice.setState({
      language: ['auto','zh','en','yue','ja','ko'].includes(prefs.language) ? prefs.language : 'auto',
      origin: prefs.origin === 'https://hf-mirror.com' ? prefs.origin : 'https://huggingface.co',
    }); } catch { /* Invalid optional preferences use safe defaults. */ }
  }
  if (native) useVoice.setState(await native.status());
}
export async function voicePreferences(patch: { language?: string; origin?: string }) {
  useVoice.setState(patch);
  const { language, origin } = useVoice.getState();
  await AsyncStorage.setItem('dsh-voice-preferences', JSON.stringify({ language, origin }));
}
export async function downloadVoice() {
  if (!native) throw new Error('请安装支持本地语音的 Android APK');
  useVoice.setState({ error: undefined, phase: 'verifying', downloaded: 0 });
  try { await native.prepare(useVoice.getState().origin); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const detail = message.split(/Caused by:\s*(?:[\w.]+:\s*)?/).pop()?.trim() || '模型下载失败，请重试';
    useVoice.setState({ phase: 'idle', error: message.includes('下载已取消') ? undefined : detail });
  }
}
export function cancelVoiceDownload() { native?.cancelDownload(); }
export async function removeVoice() { await native?.removeModels(); }
let permissionPending = false;
export function voicePermissionPending() { return permissionPending; }
export async function startVoice() {
  if (!native) throw new Error('此版本不支持本地语音');
  permissionPending = true;
  try {
    if (!(await native.requestPermission()).granted) throw new Error('请在系统设置中允许麦克风权限');
  } finally { permissionPending = false; }
  if (AppState.currentState !== 'active') throw new Error('请回到对话页面后开始录音');
  await native.startRecording();
}
export async function stopVoice() { return await native?.stopRecording(useVoice.getState().language) ?? ''; }
export function cancelVoice() { native?.cancelRecording(); }
