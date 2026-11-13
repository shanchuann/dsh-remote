import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceLoader } from './load-source.mjs';

function setup() {
  let permission;
  let recorded = 0;
  let downloadError;
  let downloadOrigin;
  const app = { currentState: 'active' };
  const native = {
    addListener() {},
    requestPermission: () => new Promise(resolve => { permission = resolve; }),
    startRecording: async () => { recorded++; },
    prepare: async origin => { downloadOrigin = origin; if (downloadError) throw new Error(downloadError); },
    status: async () => ({ phase: 'idle', ready: false }),
  };
  const voice = sourceLoader({
    expo: { requireOptionalNativeModule: () => native },
    'react-native': { AppState: app },
    '@react-native-async-storage/async-storage': { getItem: async () => JSON.stringify({ origin: 'https://huggingface.co', language: 'yue' }), setItem: async () => {} },
  })('voice');
  return { voice, app, grant: value => permission({ granted: value }), recorded: () => recorded,
    failDownload: value => { downloadError = value; }, downloadOrigin: () => downloadOrigin };
}

test('microphone permission activity is marked pending and recording requires foreground consent', async () => {
  const s = setup();
  const first = s.voice.startVoice();
  assert.equal(s.voice.voicePermissionPending(), true);
  assert.equal(s.recorded(), 0);
  s.grant(true); await first;
  assert.equal(s.voice.voicePermissionPending(), false); assert.equal(s.recorded(), 1);
  const background = s.voice.startVoice(); s.app.currentState = 'background'; s.grant(true);
  await assert.rejects(background, /回到对话/); assert.equal(s.recorded(), 1);
  const denied = s.voice.startVoice(); s.grant(false);
  await assert.rejects(denied, /允许麦克风/); assert.equal(s.voice.voicePermissionPending(), false);
});

test('new installs and saved official-source preferences use the domestic mirror while keeping language', async () => {
  const s = setup();
  assert.equal(s.voice.useVoice.getState().origin, 'https://hf-mirror.com');
  await s.voice.refreshVoice();
  assert.equal(s.voice.useVoice.getState().language, 'yue');
  await s.voice.downloadVoice();
  assert.equal(s.downloadOrigin(), 'https://hf-mirror.com');
});

test('cancelled speech downloads stay quiet and native failures show their useful explanation', async () => {
  const s = setup();
  s.failDownload("Call to function 'DshVoice.prepare' has been rejected.\n→ Caused by: java.lang.IllegalStateException: 下载已取消");
  await s.voice.downloadVoice(); assert.equal(s.voice.useVoice.getState().error, undefined);
  s.failDownload("Call failed.\n→ Caused by: java.lang.IllegalStateException: 模型完整性校验失败，请重试或更换下载源");
  await s.voice.downloadVoice(); assert.equal(s.voice.useVoice.getState().error, '模型完整性校验失败，请重试或更换下载源');
});
