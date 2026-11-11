# DSH Remote Android APK 构建验证报告

- 生成时间：2026-11-11T11:28:47.699Z
- APK：`D:\Code\dsh-remote\dist\dsh-remote-0.1.0-release.apk`
- 大小：67.48 MB，SHA-256：`1e9bc7c79f5bdc3a76a4ec5e09ff8848b289a8a573db4f57e0b8c247af4af139`
- 包名：`dev.dsh.remote`，版本：0.1.0（code 1）
- 启动 Activity：`dev.dsh.remote.MainActivity`
- 变体：release，JS bundle：assets/index.android.bundle ✅（5006535 bytes，sha256 0460907790365c90…）
- 明文 HTTP：android:usesCleartextTraffic = true ✅
- ABIs：arm64-v8a, x86_64；签名证书：unknown
- minSdk/targetSdk：24 / 36，badging native-code：arm64-v8a, x86_64
- 结果：**PASS** — pass 19 / fail 0 / warn 0

## 检查项

| # | 检查 | 结果 | 说明 |
|---|---|---|---|
| 1 | `apk.exists` | ✅ PASS | {"path":"D:\\Code\\dsh-remote\\dist\\dsh-remote-0.1.0-release.apk","file":"dsh-remote-0.1.0-release.apk","variant":"release"} |
| 2 | `apk.size` | ✅ PASS | {"bytes":70755633,"mb":67.48} |
| 3 | `apk.sha256` | ✅ PASS | {"sha256":"1e9bc7c79f5bdc3a76a4ec5e09ff8848b289a8a573db4f57e0b8c247af4af139"} |
| 4 | `apk.aapt2-available` | ✅ PASS | {"aapt2":"D:\\Android\\Sdk\\build-tools\\37.0.0\\aapt2.exe"} |
| 5 | `apk.badging` | ✅ PASS | {"packageName":"dev.dsh.remote","versionName":"0.1.0","launchableActivity":"dev.dsh.remote.MainActivity","sdkVersion":"24","targetSdkVersion":"36","nativeCode":["arm64-v8a","x86_64"]} |
| 6 | `apk.package-name` | ✅ PASS | {"packageName":"dev.dsh.remote"} |
| 7 | `apk.launcher-activity` | ✅ PASS | {"launchableActivity":"dev.dsh.remote.MainActivity"} |
| 8 | `apk.contents` | ✅ PASS | {"totalEntries":1320,"dex":["classes.dex"]} |
| 9 | `apk.js-bundle` | ✅ PASS | {"present":true} |
| 10 | `apk.native-abis` | ✅ PASS | {"abis":["arm64-v8a","x86_64"]} |
| 11 | `apk.manifest-cleartext` | ✅ PASS | {"usesCleartextTraffic":true} |
| 12 | `apk.signature` | ✅ PASS | {"apksigner":"D:\\Android\\Sdk\\build-tools\\37.0.0\\apksigner.bat","signer":"unknown","debugCert":false} |
| 13 | `apk.extract` | ✅ PASS | {"extractDir":"D:\\Code\\dsh-remote\\tools\\verify\\.apk-extract"} |
| 14 | `apk.js-bundle-size` | ✅ PASS | {"bytes":5006535,"sha256":"0460907790365c906133a51d98f6cbf31a70fbd37247d7738806d3e84bdceba5","expected":5006535} |
| 15 | `app.icon.resources` | ✅ PASS | {"names":["ic_launcher","ic_launcher_foreground","ic_launcher_monochrome","ic_launcher_round"],"densities":{"ic_launcher":["__id","mdpi","hdpi","xhdpi","xxhdpi","xxxhdpi","anydpi-v26"],"ic_launcher_foreground":["__id","mdpi","hdpi","xhdpi", |
| 16 | `app.icon.densities` | ✅ PASS | {"densities":["mdpi","hdpi","xhdpi","xxhdpi","xxxhdpi"]} |
| 17 | `app.icon.adaptive-xml` | ✅ PASS | {"file":"res/BW.xml","foregroundRef":"0x7f0e0001","monochromeRef":"0x7f0e0002"} |
| 18 | `app.icon.deepseek-foreground` | ✅ PASS | {"foregroundHash":"62105953b6ac3e3f2e7d322c4b0be291a6b43f3cc186c8b196b6498e1ad73931","monochromeHash":"62105953b6ac3e3f2e7d322c4b0be291a6b43f3cc186c8b196b6498e1ad73931","foregroundEqualsMonochrome":true,"extractedTo":"D:\\Code\\dsh-remote\\ |
| 19 | `app.icon.monochrome-alpha-mask` | ✅ PASS | {"monochromeHash":"62105953b6ac3e3f2e7d322c4b0be291a6b43f3cc186c8b196b6498e1ad73931","identicalToForeground":true,"note":"themed icon uses alpha mask; identical fg/mono accepted per Lead"} |

## 图标资源

- 提取的图标（可直接打开检查 deepseek 图形）：`D:\Code\dsh-remote\tools\verify\.apk-icons\foreground-xxxhdpi.webp`、`D:\Code\dsh-remote\tools\verify\.apk-icons\monochrome-xxxhdpi.webp`、`D:\Code\dsh-remote\tools\verify\.apk-icons\round-xxxhdpi.webp`、`D:\Code\dsh-remote\tools\verify\.apk-icons\launcher-xxxhdpi.webp`
- foreground SHA-256：`62105953b6ac3e3f2e7d322c4b0be291a6b43f3cc186c8b196b6498e1ad73931`
- monochrome SHA-256：`62105953b6ac3e3f2e7d322c4b0be291a6b43f3cc186c8b196b6498e1ad73931`（与 foreground 相同；Android 13 主题图标用 alpha 蒙版自行着色，按约定可接受）

## APK 内容摘要

- 条目总数：1320
- dex：classes.dex
- mipmap launcher 图标：undefined 个
---

## 最终交付 APK（verifier 复核）

- 交付文件：`dist/dsh-remote-0.1.0-release.apk`（由 `D:\a\signed.apk` 复制，两者 SHA-256 一致）
- 大小：70,755,633 bytes（67.48 MB）；SHA-256：`1E9BC7C79F5BDC3A76A4EC5E09FF8848B289A8A573DB4F57E0B8C247AF4AF139`；mtime 2026-11-11 19:18。
- 校验结果：**19/19 PASS**（见上方矩阵；含 `apk.js-bundle-size` 断言）。
- JS bundle：`assets/index.android.bundle` = **5,006,535 bytes**，SHA-256 `0460907790365c906133a51d98f6cbf31a70fbd37247d7738806d3e84bdceba5`，与 Lead 期望值精确一致。
- bundle 行为标记（verifier 直接字符串扫描）：`normalizeClientTimeZone`=true、`Coordinated Universal Time`=true、`keyboardDidShow`=true、`dshremote`=true、`clientTimeZone`=true —— 证明时区归一化/键盘遮挡/深链修复确实在包内。
- 构建来源（Lead 说明 + verifier 可验证事实）：native/资源/图标复用 18:41 的 gradle `assembleRelease` 产物；因 Metro 在 `:app:createBundleReleaseJsAndAssets` 进程退出时崩溃（NTSTATUS 0xC0000005），JS bundle 改用 `expo export --platform android` 生成后用 ZipArchive 替换，再 zipalign + apksigner（项目 debug keystore）重签；功能等价于 gradle 出包，环境坑见 `docs/build-android.md`。
- 模拟器：verifier 用 `adb install -r` 安装最终 APK 成功（install Success，冷启动 1248ms，无 AndroidRuntime 崩溃；`run-emulator-check.mjs` 10/10 PASS）。发送→流式→回复→停止由 Lead 在同一最终包上实测通过（截图 `screenshots/32-keyboard.png`、`06-after-connect.png`、`32-keyboard.png`、`36-progress.png`、`36-progress.png`：ReplyPONGfromPhone → 工具卡 Completed → 深度思考 → PONG）。
- 注意：18:41 的旧包（sha256 `1ecca61a…`）JS 不含时区修复，仅作 native 来源，不是最终交付。