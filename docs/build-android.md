# 构建 Android APK

本文记录 Windows 下的 Android 构建方法及已遇到的问题。项目使用 Expo SDK 58 和 React Native 0.88；本机构建环境为 JDK 21 和 Android SDK 36。界面示例见[页面说明](screenshots.md)，已公开的安装包见 [GitHub Releases](https://github.com/shanchuann/dsh-remote/releases/latest)。

## 环境

| 组件 | 本机验证值 |
|---|---|
| Node | v24.9.0 |
| JDK | Android Studio JBR 21（`C:\Program Files\Android\Android Studio\jbr`） |
| Android SDK | `D:\Android\Sdk`（platform 36 / build-tools 36.0.0；AGP 会按需装 37 与 NDK 27.1） |
| Gradle | 9.4.1（wrapper 自动下载，缓存目录 `D:\gradle`） |

## 构建

先在仓库根目录安装 App 依赖，再使用 PowerShell 7 执行构建脚本。脚本包含 PowerShell 7 语法，不适用于系统自带的 Windows PowerShell 5.1。

```powershell
npm --prefix app ci
pwsh -File tools/dev/build-apk.ps1 -Abis "x86_64,arm64-v8a"
# 需要本地代理时，增加 -ProxyHost 127.0.0.1 -ProxyPort 7890
```

产物：`app/android/app/build/outputs/apk/release/app-release.apk`

脚本先下载并校验固定版本的原生语音依赖，再重新生成 Android 工程并调用 Gradle。手动执行时：

```bash
cd app
npm run voice:prepare
npx expo prebuild --platform android --clean --no-install
cd android
./gradlew assembleRelease --console=plain \
  -PreactNativeArchitectures=x86_64,arm64-v8a
```

语音模型由用户在 App 设置中下载，不打入 APK。原生配置写入 `app.json` 或配置插件，生成的 `android/` 目录不作为配置源。

## 构建注意事项

1. **明文 HTTP**：App 访问局域网 `http://<ip>:8790`，Android 9+ 默认禁止明文流量。
   `app.json` 已通过 `expo-build-properties` 写入 `usesCleartextTraffic: true`；
   如果 `android/` 是在该配置之前生成的，可重新 prebuild，或确认
   `android/app/src/main/AndroidManifest.xml` 的 `<application>` 带
   `android:usesCleartextTraffic="true"`（本仓库已应用）。
2. **Gradle 下载静默卡死**：无代理时 Gradle 可能卡在 `checkReleaseDuplicateClasses` /
   `configureCMakeRelWithDebInfo` 前的 artifact 解析（日志无进展、CPU 平坦）。
   给 Gradle 设置 `-Dhttps.proxyHost/-Dhttps.proxyPort` 后正常；或用
   `--offline` 快速暴露缺失的 artifact。
3. **首次构建慢**：RN 0.88 新架构会编译 C++（reanimated/worklets/screens），
   2 ABI 首次约 10–20 分钟；后续增量构建 2–5 分钟。只给模拟器调试可用
   `-Abis x86_64`。
4. **签名**：Expo 模板的 release 使用 debug keystore 本地签名，可直接 side-load；
   正式分发需在 `android/app/build.gradle` 配置自己的 signingConfig。
5. **ABI**：真机一般 arm64-v8a；模拟器 x86_64。需要第三方分发时可在
   `app.json` 的 `expo-build-properties` 中开启 `enableMinifyInReleaseBuilds` 等优化。

## 安装到模拟器 / 真机

```bash
adb install -r app/android/app/build/outputs/apk/release/app-release.apk
# 模拟器内访问电脑上的插件：
#   http://10.0.2.2:8790  (10.0.2.2 是 Android 模拟器里的宿主 loopback)
# 实机：使用电脑的局域网 IP 或 Tailscale IPv4，端口为 8790
```

## 发布版本

Android 与 npm 插件使用独立版本号。推送 npm 的 `v*` 标签只发布插件，不会构建或上传 APK。

Android 发布前应完成类型检查、lint、单元测试和 APK 验证，再将对应源码提交打上 `android-v<版本号>` 标签。创建同名 GitHub Release，上传 `dsh-remote-<版本号>-release.apk` 与 `SHA256SUMS.txt`，并更新 README 中的下载版本。发布说明应记录源码提交、测试范围及签名方式。

本机 Gradle 缓存位于 `D:\gradle`，构建前设置 `$env:GRADLE_USER_HOME = 'D:\gradle'` 可复用已有依赖。

## Windows 问题记录（2026-11-11）

以下记录对应当时的本机环境与构建产物，不代表所有 Windows 环境都会出现相同问题。

### 1. Windows MAX_PATH 260：升级 ninja

失败形态：`:app:buildCMakeRelWithDebInfo[arm64-v8a]` →
`ninja: error: Stat(...RNGestureHandlerDetectorShadowNode.cpp.o): Filename longer than 260 characters`

当时采用的处理方法：
1. 用 ninja **1.12.1** 替换 SDK 自带 1.10.2：
   `D:\Android\Sdk\cmake\3.22.1\bin\ninja.exe`（原文件备份为 `ninja-1.10.2.exe.bak`）；
2. 在短路径副本里构建（本机用 `D:\a\app`，`node_modules` 用 junction 指回原目录），
   路径长度从 345 → ~295，配合 ninja 1.12 可过。
`LongPathsEnabled=1` 对 ninja 1.10 不够，必须升级 ninja。

### 2. Gradle JS bundle 任务退出崩溃（0xC0000005）

现象：Metro 已输出 `Android Bundled ... Done writing bundle output`，随后
`:app:createBundleReleaseJsAndAssets FAILED`，报 `Process 'command 'cmd'' finished with non-zero exit value -1073741819 (NTSTATUS 0xC0000005)`。
这是本机 Metro/Node 进程退出时的访问冲突（bundle 内容已正确生成）。

当时的临时处理路径是将新导出的 JS bundle 写入已构建的 release APK，再重新对齐并签名：
```powershell
cd app
npx expo export --platform android --output-dir dist-export --clear
# 1) 取 dist-export/_expo/static/js/android/entry-*.hbc
# 2) 用 .NET ZipArchive 更新旧 release APK 的 assets/index.android.bundle
# 3) zipalign -f -p 4 + apksigner sign（debug keystore: android/app/debug.keystore, 密码 android, alias androiddebugkey）
adb install -r signed.apk
```
该方法只适用于原生依赖与配置未变化的情况。涉及原生模块、权限或构建配置变更时，必须重新构建原生工程。

### 3. Metro 缓存并发

不要同时跑 `expo export` 与 gradle build（会命中 `%TEMP%\metro-cache` 的
ENOTEMPTY / 清理竞态）。构建前可 `Remove-Item $env:TEMP\metro-cache -Recurse -Force`。
