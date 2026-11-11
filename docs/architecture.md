# DSH Remote 架构

## 目标

让手机在同一局域网内连接**正在运行的** DeepSeek Harness 桌面版，像用桌面 IDE 一样用手机查看/继续会话、发消息、看流式回复、审批工具调用、切换模型。不引入云端中转，所有流量在局域网内直连。

## 总览

```
┌─────────────────────────── 电脑 (Windows/macOS/Linux) ───────────────────────────┐
│  DeepSeek Harness 桌面版 (Electron)                                             │
│    └─ DSH Host 进程（Cordis 插件树：sessions / agents / sessionController ...）   │
│         └─ @dsh-remote 插件（本仓库 plugin/）                                     │
│              ├─ DshBridge     ← 进程内直调 sessionController + agent 事件          │
│              ├─ HTTP 服务      ← 0.0.0.0:8790（LAN）                             │
│              ├─ SSE Hub       ← /v1/events，事件多路复用                          │
│              ├─ 配对/鉴权      ← 6 位码 + 设备 token（SHA-256 存储）               │
│              └─ /pair 页面     ← 仅 loopback，显示二维码/配对码                   │
└──────────────────────────────────────────────────────────────────────────────────┘
                                   ▲  LAN HTTP + SSE (JSON)
                                   │  Bearer token
┌─────────────────────────── 手机 (Android) ───────────────────────────────────────┐
│  DSH Remote（React Native / Expo，app/）                                         │
│    ├─ RemoteClient（HTTP RPC + SSE 自动重连）                                     │
│    ├─ zustand store（连接/会话/流式/审批/模型）                                   │
│    └─ UI：Expo Router + beUI Native（message/message-scroller/prompt-input/…）     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## 为什么是「Host 插件 + LAN 服务」而不是复用 Web GUI

- 桌面版的 Web 服务绑定 `127.0.0.1`（Electron 渲染进程走 IPC），手机无法直接访问；
- DSH 自带的 Web 客户端协议是 Typert RPC（WebSocket 多路复用 + 生成式类型），在 RN 上复刻成本高、版本耦合强；
- Host 插件能**进程内**调用 `ctx.sessionController` 的 `list/page/events/follow/prompt/cancel/selectModel/modelCatalog/create`，与官方 Web 客户端走同一套业务逻辑，天然支持预设/审批/权限/持久化；
- 自定义的窄协议（HTTP+SSE）易实现、易调试、对网络抖动友好，且不依赖 DSH 内部生成代码的版本。

## 关键设计

### 1. 会话跟随（流式聊天）
`POST /v1/sessions/:id/open` → 插件调用 `sessionController.follow({address, activate:true, assistantStream:true, maxMessages, turnWindow})`：
- 首个 `snapshot` 帧含历史记录 → 转成 `session.snapshot`；
- 后续 `event` 帧 → `session.event`（DSH 原始 SessionEvent，App 侧过滤注入消息）；
- `assistant-stream` 帧（token 级增量）→ `session.assistant`；
- 由 `turn/start`/`turn/end` 合成 `session.state {running}`，App 据此显示停止按钮。
断线重连后 App 重新 open（服务端重新发快照），不做复杂的事件回放。

### 2. 审批
DSH 的审批是 **agent 作用域的 waterfall**（`approval/request`）。插件在 `agent/created` 时给每个 Live Agent 的 `agent.ctx` 注册回答者：
- 有手机 SSE 在线 → 转成 `approval.request` 推给手机并等待回答（`allowed-once`/`rejected`）；
- 无手机在线 / 90s 超时 / 手机断开 → `next()` 交还桌面端回答者；
- 手机回答接口 `POST /v1/approvals/:id`，已过期返回 410。
（用户 profile 若默认 `approval: never`，审批不会出现；该能力为可选。）

### 3. 安全模型
- 仅监听局域网；配对码 6 位、TTL 10 分钟、失败锁定；成功后轮换；
- 设备 token 随机 32 字节，Host 只存 SHA-256；每设备可单独撤销；
- `/pair` 页面只允许 loopback；
- 明文 HTTP（局域网场景）；如需公网需自行加 TLS 反向代理（协议不排斥，但 v1 不内置证书管理）。

### 4. 版本兼容
- 协议带 `protocol: 1`，`/v1/health` 与 SSE `hello` 都返回；未知事件/字段必须忽略；
- 插件通过公开的 Host 服务（`sessionController` 等）与事件集成，不 import DSH 内部实现；DSH 升级时优先看这些服务的 API 是否变化。

## 目录地图

| 路径 | 说明 |
|---|---|
| `plugin/` | DSH Host 插件（零运行时依赖，单目录复制即可用） |
| `plugin/src/dsh/bridge.mjs` | DSH 服务桥接（唯一接触 DSH 内部服务的文件） |
| `plugin/src/net/` | HTTP/SSE 服务器与路由 |
| `plugin/src/auth/` | 配对码与设备 token |
| `plugin/src/pairing/` | 二维码、/pair 页面、pairing.json |
| `plugin/scripts/install.mjs` | 安装到 `~/.dsh/plugins/dsh-remote` 并写入 profile patch |
| `app/` | React Native（Expo）Android 客户端 |
| `app/src/lib/` | 协议类型、HTTP+SSE 客户端、zustand store |
| `app/src/app/` | Expo Router 路由（连接/会话列表/聊天/设置） |
| `app/src/components/<beui>/` | beUI Native 复制进来的组件源码（勿改） |
| `tools/verify/` | 独立协议客户端、mock 宿主、负向测试、e2e |
| `tools/icons/` | 由 deepseek.svg 生成 Android 图标/启动图 |
| `docs/protocol.md` | 移动协议 v1（含真实抓包 §9） |
| `docs/app-architecture.md` | App 文件所有权与 Store/Client 契约 |

## 限制与后续

- v1 只支持文本输入（协议已预留 image content blocks，App 未接图片选择）；
- v1 未做用户问题（`ask_user_question`）的手机端回答面板，审批已支持；
- 未内置 TLS/公网穿透；多设备同时连接受支持（各自独立 token），但每设备一条 SSE；
- 会话列表的 `lastMessage` 暂为 null（Host 列表行不含最近消息文本，后续可按需读取投影）；
- 后续可加：推送通知（审批/完成）、图片/文件上传、会话搜索、子 Agent 视图、PWA 版（复用同一协议）。
