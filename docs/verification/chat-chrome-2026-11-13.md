# 聊天页顶部与输入框布局

## 改动

- 顶部采用 Expo SDK 58 的 BlurTargetView / BlurView，渐变遮罩向下淡出。控制按钮独立渲染，装饰遮罩不接收触摸。
- 顶部高度由实际布局测量，历史列表预留对应空间，保持倒置列表的最新消息定位。
- 聊天输入框使用胶囊布局，多行时按钮仍在文本两侧；输入框、任务和审批区域均占用正常布局空间。
- 关闭键盘时底部间距为安全区加 12dp，键盘显示时为 12dp。
- 输入时任务面板临时显示摘要，关闭键盘后恢复用户此前的展开状态；点击摘要可关闭键盘并展开任务。

## 验证

- TypeScript、Expo lint、现有 140 项应用测试通过；差异空白检查通过（按仓库 CRLF 设置）。
- Android 36 模拟器，720×1600、密度 2，使用隔离的 113 条消息测试服务，无真实模型请求。
- 实际安装 release APK，核对浅色 / 深色模式、手势 / 三键导航、单行 / 多行输入以及键盘开关。
- 多行输入时最新消息、任务摘要及发送按钮均可见。关闭键盘后任务面板恢复展开，输入框底边完整显示。
- 最终画面保存在测试目录 workflow/capsule-final-gesture.png 和 workflow/capsule-final-keyboard.png；三键导航底部安全区为 96px，胶囊底边与安全区间距为 24px（12dp）。
- APK 签名、包名、版本和 ABI 已核对，包内 Hermes 字节码与本次构建文件一致。

## 产物与边界

- APK：dist/dsh-remote-0.1.14-release.apk，versionCode 14，arm64-v8a / x86_64。
- SHA-256：41deded98e3e57419f5cfffe01d393a7736ab0be0ebbdbf47f4c7a54f484a3c1。
- 本轮未在用户的小米实体手机上安装验证；未更改插件或桌面会话数据。

## 0.1.15 发布修正

- 去掉输入区外层底色和胶囊填充色，仅保留对比更清晰的胶囊框线。
- 任务列表设置独立裁切边界与底部滚动留白，面板与输入框间保留至少 20dp；胶囊尺寸变化直接参与布局，避免布局动画短暂越界。
- README 一级标题改为“手机直连你的 DeepSeek Harness”，品牌名称使用 DSH Remote 文本。
- 本轮 App 140 项、插件 100 项测试通过，TypeScript 与 Expo lint 通过。
- 最终 Android 36 模拟器覆盖安装成功，核对任务列表滚到底部、单行与多行输入、键盘弹出与关闭。末条任务完整位于输入框上方，输入时最新回复和任务摘要可见。证据在隔离测试目录的 release015-task-bottom.png、release015-keyboard.png。
- 仍使用既有签名，包内 Hermes bundle 与本轮独立导出逐字节一致。Windows Metro 进程出现原生退出后，采用单独导出并交由完整 Gradle release 构建打包，未复用旧 APK 外壳。
- APK：dist/dsh-remote-0.1.15-release.apk，versionCode 15，arm64-v8a / x86_64。
- SHA-256：94ca54dd65b5fa17a24225bde52c2d9c57c3f1fc0b5b0a62dcaff63f64845218。
- 配套插件为 0.1.14；Android 发布使用 android-v0.1.15 标签。APK 和插件压缩包作为发布附件分发，模型权重与原生依赖缓存保留在 Git 之外。
- 未在用户的小米实体手机上覆盖安装，本轮未改变桌面业务会话。
