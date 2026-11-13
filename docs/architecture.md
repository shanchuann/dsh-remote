# DSH Remote 架构

## 目标

Android App 通过局域网或 Tailscale 连接正在运行的 DeepSeek Harness，查看项目与会话、发送消息、接收流式回复并处理工具审批。Host 插件提供 HTTP/JSON 和 SSE 接口；Tailscale 连接由操作系统客户端管理，插件不启动公网隧道。

## 总览

```
┌─────────────────────────── 电脑 (Windows/macOS/Linux) ───────────────────────────┐
│  DeepSeek Harness 桌面版 (Electron)                                             │
│    └─ DSH Host 进程（Cordis 插件树：sessions / agents / sessionController ...）   │
│         └─ @dsh-remote 插件（本仓库 plugin/）                                     │
│              ├─ DshBridge     ← 进程内直调 sessionController + agent 事件          │
│              ├─ HTTP 服务      ← 0.0.0.0:8790（LAN / Tailscale）                 │
│              ├─ SSE Hub       ← /v1/events，事件多路复用                          │
│              ├─ 配对/鉴权      ← 6 位码 + 设备 token（SHA-256 存储）               │
│              └─ /pair 页面     ← 仅 loopback，显示二维码/配对码                   │
└──────────────────────────────────────────────────────────────────────────────────┘
                                   ▲  LAN / Tailscale HTTP + SSE (JSON)
                                   │  Bearer token
┌─────────────────────────── 手机 (Android) ───────────────────────────────────────┐
│  DSH Remote（React Native / Expo，app/）                                         │
│    ├─ RemoteClient（HTTP RPC + SSE 自动重连）                                     │
│    ├─ zustand store（连接/会话/流式/审批/模型）                                   │
│    └─ UI：Expo Router + beUI Native（message/message-scroller/prompt-input/…）     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## Host 服务桥接

- 桌面版的 Web 服务绑定 `127.0.0.1`（Electron 渲染进程走 IPC），手机无法直接访问；
- DSH 自带的 Web 客户端协议是 Typert RPC（WebSocket 多路复用 + 生成式类型），在 RN 上复刻成本高、版本耦合强；
- Host 插件在进程内调用 `ctx.sessionController` 的 `list/page/events/follow/prompt/cancel/selectModel/modelCatalog/create`，复用宿主的会话、审批与持久化服务；
- App 使用 HTTP/JSON 和 SSE，不依赖 DSH 内部生成的 RPC 客户端代码。

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
- 默认监听 `0.0.0.0:8790`，接受局域网及 Tailscale 网卡请求，实际可达范围由系统网络与防火墙决定；配对码为六位数字，有效期十分钟，连续失败锁定，成功后轮换；
- 设备 token 随机 32 字节，Host 只存 SHA-256；每设备可单独撤销；
- `/pair` 页面只允许 loopback；
- 局域网使用 HTTP；远程访问使用系统 Tailscale 加密网络，Host 自动发现 Tailscale IPv4，二维码优先使用该地址并携带局域网备用地址。

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
| `tools/icons/` | 由 app/assets/images/deepseek-whale.png 生成 Android 图标/启动图 |
| `docs/protocol.md` | 移动协议 v1（含真实抓包 §9） |
| `docs/app-architecture.md` | App 文件所有权与 Store/Client 契约 |

## 安装与更新

Host 插件通过 `dsh.bundle` 声明组合包，通过 `dsh.client` 向桌面设置页注入远程控制界面。npm registry 安装的依赖可由 DSH 插件页检测和更新；本地文件、离线包与脚本安装不参与该检测。安装来源及迁移步骤见 [npm 发布说明](publishing-npm.md)。

## 功能边界

- App 支持文字、图片及 Android 本地语音转文字；语音识别在手机完成，再将文字草稿发送至 Host；
- v1 未做用户问题（`ask_user_question`）的手机端回答面板，审批已支持；
- 不内置 VPN 或公网隧道进程管理；远程连接依赖电脑和手机已连接 Tailscale；多设备同时连接受支持（各自独立 token），但每设备一条 SSE；
- 会话列表的 `lastMessage` 暂为 null（Host 列表行不含最近消息文本，后续可按需读取投影）；
- 项目分组、子智能体、任务面板及文件与图片预览已接入；完整文件编辑、Git 操作、会话搜索与推送通知未提供。

页面示例见[界面说明](screenshots.md)，操作与网络排查见[远程访问](remote-access.md)。
