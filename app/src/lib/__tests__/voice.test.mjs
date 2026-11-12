import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceLoader } from './load-source.mjs';

function setup() {
  let permission;
  let recorded = 0;
  let downloadError;
  const app = { currentState: 'active' };
  const native = {
    addListener() {},
    requestPermission: () => new Promise(resolve => { permission = resolve; }),
    startRecording: async () => { recorded++; },
    prepare: async () => { if (downloadError) throw new Error(downloadError); },
  };
  const voice = sourceLoader({
    expo: { requireOptionalNativeModule: () => native },
    'react-native': { AppState: app },
    '@react-native-async-storage/async-storage': {},
  })('voice');
  return { voice, app, grant: value => permission({ granted: value }), recorded: () => recorded,
    failDownload: value => { downloadError = value; } };
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

test('cancelled speech downloads stay quiet and native failures show their useful explanation', async () => {
  const s = setup();
  s.failDownload("Call to function 'DshVoice.prepare' has been rejected.\n→ Caused by: java.lang.IllegalStateException: 下载已取消");
  await s.voice.downloadVoice(); assert.equal(s.voice.useVoice.getState().error, undefined);
  s.failDownload("Call failed.\n→ Caused by: java.lang.IllegalStateException: 模型完整性校验失败，请重试或更换下载源");
  await s.voice.downloadVoice(); assert.equal(s.voice.useVoice.getState().error, '模型完整性校验失败，请重试或更换下载源');
});
