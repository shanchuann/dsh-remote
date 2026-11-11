# 构建 Android APK

Release APK 已在本地 Windows 环境验证构建（Expo SDK 58 / RN 0.88 / JDK 21 / Android SDK 36）。

## 环境

| 组件 | 本机验证值 |
|---|---|
| Node | v24.9.0 |
| JDK | Android Studio JBR 21（`C:\Program Files\Android\Android Studio\jbr`） |
| Android SDK | `D:\Android\Sdk`（platform 36 / build-tools 36.0.0；AGP 会按需装 37 与 NDK 27.1） |
| Gradle | 9.4.1（wrapper 自动下载，缓存目录 `D:\gradle`） |

## 一步构建

```powershell
# 若在本地代理后面（本机 127.0.0.1:7890），务必给 Gradle 也设置代理，
# 否则首次下载 react-android-0.88.1-release.aar（171MB）会静默卡住：
powershell -ExecutionPolicy Bypass -File tools/dev/build-apk.ps1 -Abis "x86_64,arm64-v8a" -ProxyHost 127.0.0.1
```

产物：`app/android/app/build/outputs/apk/release/app-release.apk`

脚本内部等价于：

```bash
cd app
npx expo prebuild --platform android --clean --no-install
cd android
./gradlew assembleRelease --console=plain \
  -PreactNativeArchitectures=x86_64,arm64-v8a \
  -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7890
```

## 关键坑（本机踩过）

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
# 真机：http://<电脑局域网IP>:8790
```
## 本机 Windows 额外坑（2026-11-11 实测）

### 1. Windows MAX_PATH 260：升级 ninja

失败形态：`:app:buildCMakeRelWithDebInfo[arm64-v8a]` →
`ninja: error: Stat(...RNGestureHandlerDetectorShadowNode.cpp.o): Filename longer than 260 characters`

修法（无需改项目）：
1. 用 ninja **1.12.1** 替换 SDK 自带 1.10.2：
   `D:\Android\Sdk\cmake\3.22.1\bin\ninja.exe`（原文件备份为 `ninja-1.10.2.exe.bak`）；
2. 在短路径副本里构建（本机用 `D:\a\app`，`node_modules` 用 junction 指回原目录），
   路径长度从 345 → ~295，配合 ninja 1.12 可过。
`LongPathsEnabled=1` 对 ninja 1.10 不够，必须升级 ninja。

### 2. Gradle JS bundle 任务退出崩溃（0xC0000005）

现象：Metro 已输出 `Android Bundled ... Done writing bundle output`，随后
`:app:createBundleReleaseJsAndAssets FAILED`，报 `Process 'command 'cmd'' finished with non-zero exit value -1073741819 (NTSTATUS 0xC0000005)`。
这是本机 Metro/Node 进程退出时的访问冲突（bundle 内容已正确生成）。

当前等价出包路径（把最新 JS 打进已构建好的 release APK）：
```powershell
cd app
npx expo export --platform android --output-dir dist-export --clear
# 1) 取 dist-export/_expo/static/js/android/entry-*.hbc
# 2) 用 .NET ZipArchive 更新旧 release APK 的 assets/index.android.bundle
# 3) zipalign -f -p 4 + apksigner sign（debug keystore: android/app/debug.keystore, 密码 android, alias androiddebugkey）
adb install -r signed.apk
```
本次交付 APK 即用该路径生成（native 部分来自 18:41 的 `assembleRelease`）。

### 3. Metro 缓存并发

不要同时跑 `expo export` 与 gradle build（会命中 `%TEMP%\metro-cache` 的
ENOTEMPTY / 清理竞态）。构建前可 `Remove-Item $env:TEMP\metro-cache -Recurse -Force`。
