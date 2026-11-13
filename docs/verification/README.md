# DSH Remote 验证记录索引

## 近期记录

| 记录 | 范围 |
|---|---|
| [Android 0.1.24 连接恢复](reconnect-2026-11-13.md) | 失败重试、Host 插件版本刷新、设置入口及 APK 发布核对 |
| [文档与示例更新](documentation-2026-11-13.md) | 四张示例图片、文档检查及 npm 候选包 |
| [界面示例](../screenshots.md) | 2026-11-13 用户提供的四张 Android 实机图片，用于产品操作说明 |
| [Tailscale 迁移](tailscale-2026-11-13.md) | 网络地址发现、协议字段、测试与本机插件更新 |
| [输入菜单定位](menu-anchor-2026-11-13.md) | 键盘展开时的输入区菜单位置 |
| [聊天布局](chat-chrome-2026-11-13.md) | 输入区、安全区和任务面板 |
| [移动工作流](mobile-workflow-2026-11-12.md) | 本地语音、工具结果、文件与图片预览 |
| [项目清单](project-catalog-2026-11-12.md) | 项目目录与会话归属 |

产品示例图位于 `docs/screenshots/`。历史测试截图位于本目录的 `screenshots/`，保留对应测试时的状态。各验证报告只说明其标明版本和环境下的检查结果。

## 2026-11-11 基线验证

- 更新时间：2026-11-11 19:15（Asia/Shanghai）
- 验证对象：协议 v1 独立客户端 vs 真实 DSH 宿主（隔离 `DSH_HOME=D:\Code\dsh-remote\.testhome`，profile remote-dev，插件端口 8790）+ Android release APK
- 协议基线：`docs/protocol.md`（394 行，含 §9 真实宿主抓包）

## 结果汇总

| 验证项 | 结果 | 报告 |
|---|---|---|
| 协议 v1 独立客户端 + SSE 解析器单测 | **16/16 PASS** | 本文档 + `tools/verify/test-sse-parser.mjs` |
| 真实宿主 e2e 矩阵（24 断言） | **24/24 PASS** | `e2e-report.md` |
| 真实宿主负向/契约（36 用例） | **36 PASS / 0 FAIL / 2 SKIP** | `negative-real-host.md` |
| mock 参考宿主负向（基线） | **36/36 PASS** | `negative-report.md` |
| App 协议符合性复核（只读） | P0=0；P1=3（均已在源码修复）、P2=6（4 修 2 留）、P3 若干 | `app-protocol-review.md` |
| App 静态检查（tsc/单测） | tsc 0 error；app 单测 85+ 全绿（verifier 独立跑） | `app-static-check.md` |
| APK 结构/签名/图标校验 | **19/19 PASS**（最终交付 `dist/dsh-remote-0.1.0-release.apk`，67.48MB，dev.dsh.remote，cleartext=true，arm64-v8a+x86_64，JS bundle 5,006,535 bytes） | `app-build-report.md` |
| 模拟器安装/启动/截图/logcat | 最终 APK 安装/冷启动/无崩溃通过；会话列表/历史/设置正常；发送→流式→回复→停止由 Lead 在同一最终包实测通过（P1 时区 bug 已闭环） | `app-emulator-report.md` |

## 关键缺陷（全部已修复/已验证）

| 端 | 缺陷 | 级别 | 状态 |
|---|---|---|---|
| plugin | 未知 session 的 prompt/cancel 返回 500 internal、open 返回 200+订阅（应 404） | P1 | 已修真机验证（负向 3 用例转 PASS） |
| plugin | prompt 重复 requestId 不幂等 | P1 | 已修（负向用例验证仅 1 条 user/message） |
| plugin | 审批 outcome 返回 allowed-once 而非 allowed / session.status.active 恒 false | P1 | 已修（代码复核；e2e 覆盖服务器主路径） |
| plugin | selectModel 未知 provider/model → 500 internal（应 400） | P2 | 已修并新增负向用例 PASS |
| plugin | prompt clientTimeZone="GMT" → 500 internal（应 400） | P2 | 已修并 probe/负向用例验证（GMT→400，UTC→200） |
| app | SSE HTTP 401 无限重连不转重新配对 | P1 | 已修（源码复核） |
| app | 快照不回填乐观消息（pending 残留） | P1 | 已修（源码复核 + app 单测） |
| app | 手写 SSE 解析器 CRLF 跨 chunk 丢事件名 | P2 | 已修（源码复核） |
| app | 审批无打开会话时丢弃 / 切会话不关旧订阅 / 401 不清 token | P2 | 已修（源码复核） |
| app | clientTimeZone 未归一化，GMT 设备上所有 prompt 失败（模拟器实测） | P1 | 已修（verifier 直接加载 timezone.ts 16/16；待新 APK 端到端复验） |

## 复现命令

```bat
:: SSE 解析器单测
node tools\verify\test-sse-parser.mjs

:: 真实宿主 e2e（24 断言）
node tools\verify\run-e2e.mjs --url http://127.0.0.1:8790 --dsh-home D:\Code\dsh-remote\.testhome

:: 真实宿主负向（36 用例；锁定测试跳过）
node tools\verify\run-negative.mjs --url http://127.0.0.1:8790 --dsh-home D:\Code\dsh-remote\.testhome --skip-lockout --report docs\verification\negative-real-host.md

:: mock 基线负向
node tools\verify\run-negative.mjs --mock --include-rate-limit

:: 错误映射探针（时区 / 模型 / 未知会话）
node tools\verify\probe-timezone.mjs
node tools\verify\probe-session-prompt.mjs
node tools\verify\probe-app-timezone.mjs

:: APK 校验 + 模拟器安装/启动/截图
node tools\verify\verify-apk.mjs --apk D:\a\app\android\app\build\outputs\apk\release\app-release.apk
node tools\verify\run-emulator-check.mjs --serial emulator-5554 --apk D:\a\app\android\app\build\outputs\apk\release\app-release.apk

:: 抓包代理（可选；App 配到 http://10.0.2.2:8791）
node tools\verify\logging-proxy.mjs
```

## 文件所有权与边界

- 本目录所有工具/报告由 verifier 维护（`tools/verify/**`、`docs/verification/**`），未修改 `plugin/**`、`app/**`、`docs/protocol.md`。
- 真实宿主/模拟器由 Lead 管理；模拟器独占期间 verifier 不操作 adb。
- 截图：`docs/verification/screenshots/`（app-01 启动 … app-12 配对、聊天、设置；新 APK 复验后补最终截图）。
