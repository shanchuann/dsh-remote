# DSH Remote Android 模拟器安装 / 启动 / 截图报告

- 生成时间：2026-11-11T11:29:21.562Z
- 设备：emulator-5554
- 包名 / 入口：`dev.dsh.remote` / `dev.dsh.remote/.MainActivity`
- APK：`D:\Code\dsh-remote\dist\dsh-remote-0.1.0-release.apk`（67.48 MB）
- 结果：**PASS** — pass 10 / fail 0 / warn 0

## 检查项

| # | 检查 | 结果 | 说明 |
|---|---|---|---|
| 1 | `adb.available` | ✅ PASS | {"adb":"D:\\Android\\Sdk\\platform-tools\\adb.exe"} |
| 2 | `device.connected` | ✅ PASS | {"serial":"emulator-5554","devices":["emulator-5554"],"sdk":"36","model":"sdk_gphone64_x86_64","size":"Physical size: 1080x2400"} |
| 3 | `apk.locate` | ✅ PASS | {"path":"D:\\Code\\dsh-remote\\dist\\dsh-remote-0.1.0-release.apk","bytes":70755633,"mtime":"2026-11-11T11:18:56.580Z"} |
| 4 | `apk.install` | ✅ PASS | {"installOutput":"Performing Streamed Install\r\nSuccess","totalTime":null} |
| 5 | `package.installed` | ✅ PASS | {"package":"dev.dsh.remote","versionName":"0.1.0"} |
| 6 | `app.launch` | ✅ PASS | {"output":"Starting: Intent { cmp=dev.dsh.remote/.MainActivity }\r\nStatus: ok\r\nLaunchState: COLD\r\nActivity: dev.dsh.remote/.MainActivity\r\nTotalTime: 1248\r\nWaitTime: 1280\r\nComplete","totalTime":1248} |
| 7 | `app.running` | ✅ PASS | {"pid":"10243"} |
| 8 | `app.screenshot-pairing` | ✅ PASS | {"path":"docs\\verification\\screenshots\\06-after-connect.png","bytes":177244} |
| 9 | `app.activity-resumed` | ✅ PASS | {"resumed":"topResumedActivity=ActivityRecord{35863739 u0 dev.dsh.remote/.MainActivity t19}"} |
| 10 | `app.logcat-crash-scan` | ✅ PASS | {"crashLines":0,"sample":[""]} |

## 截图

- `D:\Code\dsh-remote\docs\verification\screenshots\06-after-connect.png`（17405 bytes）
---

## 最终 APK 复验（19:2x，verifier；模拟器由 Lead 交回）

### 安装/启动（verifier 实测）

- APK：`dist/dsh-remote-0.1.0-release.apk`（70,755,633 bytes，= D:\a\signed.apk）。
- `adb install -r` → **Success**；`am start -W` 冷启动 **1248ms**；`topResumedActivity` 为 `dev.dsh.remote/.MainActivity`；logcat 无 AndroidRuntime 崩溃（run-emulator-check.mjs **10/10 PASS**）。
- 启动后进入会话列表（17 个会话，Host「山川不念旧 · 已连接」），截图 `screenshots/app-20-final-sessions.png`；打开会话 `UTC Timezone Probe` 正常渲染历史（截图 `06-after-connect.png`）。

### 全链路（Lead 在同一最终包上实测，截图可查）

- 键盘遮挡修复：composer 位于键盘上方（`32-keyboard.png`）。
- 发送 → 流式 → 回复：`32-keyboard.png`（输入区在键盘上方）、`36-progress.png`（工具卡 Completed + 深度思考 + 最终 **PONG**）。
- 结论：**P1（clientTimeZone=GMT 导致发送失败）已闭环**；最终 APK 上发送/流式/回复正常。

### 备注

- verifier 复验时 Lead 已停止测试宿主（8790 connection refused），因此我这边只完成安装/启动/界面检查；发送链路证据采用 Lead 在同一最终 APK 上的截图（时间 11:25–11:27，设备时间）。若需要 verifier 独立再发一条，Host 重新启动后 2 分钟可补。
- 模拟器旧包（18:41）上的失败截图（app-06/09/10）保留作为 P1 现场证据，不代表最终包。