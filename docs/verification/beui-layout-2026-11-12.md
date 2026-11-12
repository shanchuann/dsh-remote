# BeUI Native 尺寸与布局适配

本轮依据 BeUI 的 [React Native 组件](https://beui.dev/react-native)与现有 DSH 页面作尺寸校准，保留 DeepSeek 蓝色操作主色和现有数据交互。参考官方 [Button](https://beui.dev/react-native/button)、[Prompt Input](https://beui.dev/react-native/prompt-input)、[Message Bubble](https://beui.dev/react-native/message-bubble) 源码。追加 Markdown 与代码块要求后，通过 Expo install 添加 Marked 和 SDK 58 对应的 expo-clipboard，用于 GFM 词法解析与原生复制。

## 修改范围

- 项目列表、聊天正文、输入框、审批区、连接表单统一 16dp 左右边距。连接页收紧顶部空白并统一卡片圆角。
- 项目列表底部新建按钮进入正常布局，由安全区托底，列表占剩余空间，避免浮动按钮覆盖末行；删除重复显示的宿主名称。
- 聊天顶部保留 48dp 返回、更多选项和子智能体触控区域。子智能体胶囊的可见高度收至约 32dp；窄屏或大字体时改用图标与数量，给标题和路径留出空间。标题栏允许随文字高度增长。
- 新对话首页使用已有 `app/assets/images/deepseek-mark.png` 黑色鲸鱼资源，放在白色底托中；内容最大宽度 480dp，建议行高度至少 48dp，可随换行增高。
- 任务胶囊使用 14dp 标题与 12dp 状态文字，长任务可显示两行并展开；选择卡片使用 16dp 标题、14dp 正文，确认区可换行，确认按钮至少 48dp。
- 模型与子智能体弹层统一标题、关闭区域和顶部拖动提示线；模型列表首次读取改为无可见加载文字的骨架。
- 历史入口保留 48dp 触控高度；保留 BeUI 原生 Prompt Input 的 36dp 可见按钮、22dp 行高和现有触控补偿，避免整体等比放大。

## 验证

App 125 项自动测试通过，失败与跳过均为 0。TypeScript、Expo lint、Android 导出和 release 构建通过。新增图片确认回传、嵌套强调和 diff 行号回归。

Android 36 隔离模拟器已安装最终 APK，并使用独立插件运行时和 FakeBridge 验证：

- 360dp 宽度下，项目展开显示 4 个主会话，子智能体会话不出现在主列表；新对话首页显示现有黑色鲸鱼。
- 含 35 条前置历史样本的会话打开后直接显示末尾验证标记和图片，没有停留在最早消息。另一次在窄屏重入也落在末尾。
- 标题、嵌套粗体/斜体、行内代码和表格实际渲染；diff 显示增删行号、统计、底色及替换片段高亮。点击复制显示“已复制”，系统剪贴板预览包含实际 diff。
- 经系统相册选择图片并点击发送后，消息区保留缩略图。该 FakeBridge 不模拟模型的完整上传确认回传，发送中的截图不能替代真实宿主确认验证；确认回传预览保留由自动测试覆盖。
- 320dp 宽度、1.3 倍系统字体、深色模式下复验项目页与聊天页，子智能体入口自动缩为图标和数量，输入框与图片可见。检查后恢复模拟器字体、尺寸与主题。
- 本轮结束时 `ReactNativeJS:E` 与 `AndroidRuntime:E` 日志为空。首次模拟器启动曾出现 System UI 无响应，选择等待后正常进入应用；这不属于应用运行异常。

截图位于测试目录 `beui-fit/`：`empty-chat.png`、`history-entry.png`、`markdown.png`、`diff-copy.png`、`narrow-dark.png`、`narrow-chat-dark.png`、`image-sent.png`。没有调用真实模型，也未将模拟器检查表述为真机验证。

交付文件：`dist/dsh-remote-0.1.10-release.apk`，包名 `dev.dsh.remote`，versionCode 10，包含 arm64-v8a 与 x86_64。APK 签名校验通过，内置 Hermes bundle 的 SHA-256 与本轮最终导出一致。APK SHA-256：`C637D210DC560B5DEFE5C2B5F8539DF1532C0B8C054AA31B59B0FEA63507B4AF`。

用户追加问题也纳入本轮：发送中的消息携带图片内容，宿主确认回传后保留本次上传预览；支持 attachment.id、image_url 和 base64 source 图片格式。每次进入会话重置消息跟随及列表实例，以最新消息为初始位置。Markdown 使用 Marked 的 GFM 词法解析，行内文字继承所在标题或正文的字号，表格使用固定列宽对齐；回复分享按钮压缩可见占位，保留触控补偿。

代码块和统一 diff 参考用户指定的 `https://www.beautifului.dev/r/code-block.json`，用 React Native 实现行号、语法色、增删统计、增删行及相邻替换片段高亮、横向滚动/换行切换和原生剪贴板复制。接入实际代码及 patch 字符串，未使用参考组件的示例代码或 diff 数据。

本轮独立服务、样例消息、日志、截图及临时构建脚本位于 `D:/Code/dsh-remote.testhome/beui-fit`。样例数据仅用于原生布局复验，不写入正式应用源码。
