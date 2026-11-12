# 移动端工作流与本地语音适配

Android 0.1.13 / versionCode 13，插件 0.1.14。保留原有未提交改动，没有提交或推送。隔离测试数据、历史样本、模型、截图及运行日志位于 `D:/Code/dsh-remote.testhome/workflow`，不进入安装包或业务会话。

## 修复与依据

- 长会话改用倒序 FlatList，原生偏移 0 对应最新一行；工具连续分组最多 8 项，避免 PTC 长轮次形成单个巨大视图。移除本地“剩余消息”分批显示，服务端历史分页只有一个入口。
- 真实 DSH 历史中的普通工具结果使用 `data.message.toolCallId / source.callId`，PTC 使用 `subCallId`。按原始标识配对，解析 JSON 参数、错误、图片及网页 meta；工具结果展示 Markdown、来源链接和截断状态。
- 修复服务端漏传正在输出的 assistantStream 基线，以及手机端重连只追加后续 delta 的问题。支持 DSH 的 compact text/reasoning chunks。
- 任务面板读取普通 Todo 与团队任务投影，增量事件按 revision 合并；普通任务随 turn/start 清理并由 todo/write 替换。
- 文件变化通过 DSH workspaceChanges 原始 seq/index 读取 summary/hunks；交付文件、成功写入的文件、工具及回复中的图片和 Markdown 本地文件链接经认证的 workspaceFiles 服务预览、下载及系统分享。权限和作用域由宿主服务执行，原始文件上限 32 MiB。
- 文本读取使用 DSH 从 1 开始的 offset。异步读取必须 `await` 后才能映射 not-found、permission-denied 等宿主错误；回归覆盖异步拒绝。

## 本地语音

检查本机 DSH 已安装代码，其方案为 SenseVoiceSmall INT8 + Silero VAD + sherpa-onnx，16 kHz 单声道 PCM，CPU 识别。Android 用本地 Expo Kotlin 模块移植同一模型流程，录音不上传，识别文字先填入可编辑草稿，点击发送后才作为普通文本交给 DSH。

- 设置提供官方源/国内镜像、下载进度、取消、校验、删除和语言选择；下载总计 241357257 字节。模型校验大小与 SHA-256，成功后原子落盘，APK 不包含权重。
- 支持自动、普通话、粤语、英语、日语和韩语；本轮语音准确性样例仅验证普通话，不将模型语言支持范围等同于逐语言实测。
- 单次最长 90 秒；结束/取消/离开页面释放麦克风，取消后的结果不再填入草稿；再次开始前等待旧采集线程结束。
- 已授权时直接返回权限状态，避免重复打开 Android 权限 Activity。申请权限期间暂停“回到前台后重开会话”的处理，避免录音刚开始就被页面重置取消；真正后台状态禁止开始录音。

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| model.int8.onnx | 239233841 | c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51 |
| tokens.txt | 315894 | f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc |
| silero_vad.onnx | 1807522 | a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28 |
| sherpa-onnx 2.0.1 AAR | 49441341 | a8d09d1d32f3eb8520482c6d3d43fae674681c5b050385967c70a3c2c9bf0ee7 |

运行时准备脚本为 `tools/prepare-sherpa.mjs`，固定版本并验证 AAR 校验和；构建脚本已接入。模型下载源和固定 commit 记录在原生模块，官方运行时资料为 [sherpa-onnx Android](https://k2-fsa.github.io/sherpa/onnx/android/index.html) 与 [2.0.1 release](https://github.com/k2-fsa/sherpa-onnx/releases/tag/v2.0.1)。

## 验证

| 检查 | 结果与证据 |
|---|---|
| App 单元与状态回归 | 140 passed，0 failed / skipped；`app-tests.log` |
| 插件回归 | 100 passed，0 failed / skipped；`plugin-tests.log` |
| App 类型检查和 lint | 均通过；`typecheck.log` / `lint.log` |
| Android 本地识别 | Android instrumentation 测试通过：官方 zh.wav 实际输出包含“时间”“早上9点”“下午5点”；空白 PCM 无识别文字；`voice-instrumentation-final.log` |
| Android 模型管理 | 实际设置界面下载全部 3 个文件、大小与 SHA 校验成功，显示“模型已就绪”；中途取消、删除后重新完整下载均验证；`voice-ready-ui.xml` / `voice-cancel-ui.xml` |
| 麦克风首次授权 | 最终 APK 撤销权限后重新进入会话，允许麦克风后持续录音超过 13 秒，原生 AppOps 确认 running，输入栏显示秒数、取消与完成；`voice-first-grant.png` |
| 录音完成 | 最终 APK 点击完成后释放麦克风，进行本地识别；模拟器静音输入返回“没有识别到语音”，未自动发送；`voice-result-final-ui.xml` |
| 最新消息位置 | 113 条记录的原生会话直接显示“最新消息 203”；图片加载和任务面板展示后仍在最新；`current.png` / `final-chat-ui.xml` |
| 历史与实时消息 | 最早处只有一个加载按钮，加载后无更多时消失；阅读旧记录时新增 204，已有可见行坐标逐项一致；点击“回到最新”后显示 204；`oldest-ui.xml` / `history-loaded-ui.xml` / `history-live-ui.xml` / `live-latest-ui.xml` |
| 原生工作流展示 | 实际展开红绿 diff、交付图片、文件预览及任务 capsules；`diff.png` / `file-ui.xml` |
| 真实宿主文件 API | 已加载的 0.1.12 实例文本读取 200、PNG 200；真实历史样本核对普通/PTC/任务/文件事件。后续异步错误映射及基线修正在 0.1.14 回归通过，待宿主重启后加载，不把旧进程结果当成最新版验收 |
| release | arm64-v8a + x86_64，包含 sherpa 原生库与 RECORD_AUDIO；签名校验通过；权重不打入 APK；`release-verified.log` / `apk-audit.json` |

文件读取的真实宿主检查只读现有会话，没有发起模型调用。网页工具的适配依据真实历史 schema 与隔离 UI 验证；本轮没有另发付费模型请求验证网站抓取效果。模拟器性能不代表用户手机性能，没有在用户手机安装或做实景麦克风准确率测试。

验证配对设备已通过真实宿主 DELETE 撤销；临时认证文件已移除，隔离服务与本轮启动的模拟器已关闭。

## 交付及边界

最终 APK：`dist/dsh-remote-0.1.13-release.apk`；插件：`dist/dsh-remote-harness-0.1.14.tgz`。官方 CLI 已安装插件 0.1.14；当前桌面进程仍加载 0.1.12，需要正常退出并重开 DSH 后生效。后续 Windows 自动化返回 `foreground window did not report a process id`，未强制结束用户进程，原会话保持不变。

最终 APK SHA-256：`de11b681d82428e641204da11170169e9c9e0510feb68d007ec2bb319b5e3d23`。插件 SHA-256：`fa9a7e8ad2a7565245f28bfd748315ab1cd011b674c771fdbaadc9e5997e65a6`。APK 内置 Hermes bundle 与最后一次 Expo Android 导出逐字节一致；最终 release 签名验证通过。

历史 diff 的临时快照若已由 DSH 释放，手机显示明确说明，不用当前文件伪造过去的差异。文件预览展示当前磁盘版本，与原始 diff 区分。桌面自动化配置、插件管理、ask_user_question 回答面板、完整文件编辑/Git 操作等尚未覆盖，不能宣称全部 DSH 功能均已移植。
