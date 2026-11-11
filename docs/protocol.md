# DSH Remote 移动协议 v1（草案，实现契约）

> 状态：**v1 冻结**（2026-11-11）。插件端与 App 端都按本文件实现；任何变更先改本文件并通知两端。
> 传输：局域网 HTTP/1.1 + JSON + SSE（Server-Sent Events），无外部运行时依赖。

## 0. 术语

- **Host**：运行 DeepSeek Harness 的电脑；插件 `dsh-remote` 以 Cordis 插件形式跑在 DSH 主进程内。
- **App**：手机端 React Native（Expo）应用，包名 `dev.dsh.remote`。
- **Device**：完成配对的一个 App 实例，持有长期 bearer token。
- **Session**：DSH 会话（`~/.dsh/sessions` 中的一份会话日志），由 Host 端 Agent 驱动。
- **Subscription**：App 对某个 session 打开的实时跟随流，服务端基于 DSH `sessionController.follow()` 实现。

## 1. 发现与配对

### 1.1 Host 启动

插件在 Host 上监听 `0.0.0.0:<port>`（默认 **8790**，可用配置 `port` 覆盖）。监听成功后：

1. 写 `<DSH_HOME>/plugins/dsh-remote/pairing.json`：`{ hostId, hostName, protocol: 1, port, addresses: [...], pairingCode, pairingExpiresAt, updatedAt }`（不含 device token）。
2. 生成 `<DSH_HOME>/plugins/dsh-remote/pairing.png`（二维码）与 `pairing.txt`（便于 CLI 查看/复制）。
3. 通过 `ctx.logger.info` 打印：`dsh remote: http://<lan-ip>:8790 (pair code 123456)`。
4. 在 loopback 提供配对页：`http://127.0.0.1:8790/pair`（只允许 loopback 访问；显示二维码/验证码/设备列表）。

### 1.2 二维码负载

URI scheme，便于 App 扫码直接解析：

```
dshremote://pair?u=http%3A%2F%2F192.168.1.23%3A8790&c=123456&h=<hostId>&n=<hostName>
```

- `u`：Host 基地址（URL 编码），App 之后再拼 `/v1/...`。
- `c`：一次性配对码（6 位数字，TTL 10 分钟，配对成功即轮换）。
- `h`：hostId（稳定 UUID，用于识别同一台电脑）。
- `n`：可选，Host 显示名。

### 1.3 配对接口

`POST /v1/pair`（无需认证）

```json
{ "code": "123456", "deviceId": "optional-client-generated-uuid", "deviceName": "Pixel 9", "platform": "android", "appVersion": "0.1.0" }
```

成功 `200`：

```json
{
  "protocol": 1,
  "token": "<64-hex device token>",
  "deviceId": "<uuid>",
  "host": { "id": "<hostId>", "name": "DESKTOP-XXX", "platform": "win32", "dshVersion": "0.2.2-rc.1", "pluginVersion": "0.1.0" }
}
```

失败：`401 pairing-invalid` / `429 pairing-locked`（连续 5 次失败锁定 5 分钟）。

### 1.4 鉴权

除 `GET /v1/health`、`POST /v1/pair`、`GET /pair` 外，所有接口要求：

```
Authorization: Bearer <token>
```

SSE 与图片/附件下载额外允许 `?token=<token>`（EventSource 无法自定义 header）。token 持久化在 Host 的 `<DSH_HOME>/plugins/dsh-remote/devices.json`（只存 SHA-256）。

失败统一 `401 unauthorized`。

## 2. 通用约定

- Content-Type：`application/json; charset=utf-8`。
- 时间：毫秒 Unix 时间戳（number）。
- 错误响应：

```json
{ "error": { "code": "session-not-found", "message": "human readable", "details": {} } }
```

错误码：`invalid-argument`、`unauthorized`、`pairing-invalid`、`pairing-locked`、`protocol-unsupported`、`session-not-found`、`session-unavailable`、`stream-unavailable`、`approval-gone`、`rate-limited`、`internal`。
- 幂等：`POST .../prompt` 带客户端生成的 `requestId`（uuid），重复请求返回同样 accepted，不重复入队。

## 3. 接口

### 3.1 `GET /v1/health`

无需认证。

```json
{ "ok": true, "name": "dsh-remote", "protocol": 1, "pluginVersion": "0.1.0", "dshVersion": "0.2.2-rc.1", "hostId": "...", "pairingRequired": true, "time": 1763000000000 }
```

### 3.2 `GET /v1/host`

```json
{
  "hostId": "...", "name": "DESKTOP", "platform": "win32", "dshVersion": "0.2.2-rc.1", "pluginVersion": "0.1.0",
  "protocol": 1,
  "capabilities": { "assistantStream": true, "approvals": true, "models": true, "problemQuestions": false, "attachments": false, "images": true },
  "defaultCwd": "D:\\Code\\demo",
  "devices": [ { "deviceId": "...", "name": "Pixel 9", "platform": "android", "createdAt": 1763000000000, "lastSeenAt": 1763000000000, "current": true } ]
}
```

### 3.3 会话列表

`GET /v1/sessions?limit=30&cursor=<opaque>`

```json
{
  "items": [{
    "sessionId": "session-...",
    "title": "修复登录 bug",
    "createdAt": 1763000000000,   // 冷会话可能为 0（Host 列表未携带创建时间）
    "updatedAt": 1763000005000,
    "cwd": "D:\\Code\\demo",
    "running": true,
    "active": true,
    "blank": false,
    "agentAvailable": true,
    "model": { "provider": "opencode-go", "model": "deepseek-v4.1-flash", "reasoningEffort": "high" },
    "lastMessage": null,          // 当前实现未计算（可空）；App 必须容错
    "parentSessionId": null,
    "origin": null,
    "agentPreset": "standard"
  }],
  "nextCursor": null
}
```

映射：DSH `sessionController.list()` 的行；`title` 取行内 projection title 或 `session/title` 事件；`lastMessage` 为最佳努力的最近一条用户/助手文本摘要（Host 端截断到 200 字符）。

### 3.4 新建会话

`POST /v1/sessions`

```json
{ "cwd": "D:\\Code\\demo", "agentPreset": "standard" }
```

→ `{ "sessionId": "session-...", "agentPreset": "standard" }`

### 3.5 会话详情（一次性快照）

`GET /v1/sessions/:id`

```json
{
  "sessionId": "...",
  "title": "...",
  "header": { "id": "...", "createdAt": 0, "cwd": "...", "agentPreset": "standard" },
  "state": { "active": true, "running": true, "queue": [], "pendingInput": [] },
  "projections": { "modelSelection": { "next": { "provider": "x", "model": "y" } } }
}
```

### 3.6 历史分页

`GET /v1/sessions/:id/history?beforeSeq=<n>&maxMessages=100`

```json
{ "records": [ { "type": "event", "event": { "type": "user/message", "seq": 12, "time": 1763000000000, "data": {} } } ], "cursor": 3, "hasMore": true }
```

- 记录顺序：**按 seq 升序**。
- `cursor` 是本次页面的**包含式**边界（DSH `events` 语义）；继续向前翻页时传 `beforeSeq = cursor - 1`。
- `event.data` 是 DSH 原始事件数据（见 §5）。

### 3.7 打开实时跟随流（App 进入聊天页时调用）

`POST /v1/sessions/:id/open`

```json
{ "maxMessages": 60, "turnWindow": { "minMessages": 40, "minTurns": 1 }, "assistantStream": true }
```

→ `{ "subscriptionId": "sub_...", "sessionId": "..." }`

随后在 `GET /v1/events` SSE 连接上收到：
1. `session.snapshot`（完整开场快照，含历史记录）
2. 之后持续：`session.event`、`session.assistant`、`session.state` …
3. 断开/重连后由 App 重新 `open`（服务端会重新发快照；不做增量回放）。同一 App 对同一 session 重复 open 会替换旧订阅。

`POST /v1/sessions/:id/close` → `{ "closed": true }`（幂等）。

### 3.8 发送消息

`POST /v1/sessions/:id/prompt`

```json
{
  "requestId": "uuid",
  "mode": "queue",
  "content": [ { "type": "text", "text": "帮我看看这个报错" } ],
  "clientTimeZone": "Asia/Shanghai"
}
```

→ `{ "accepted": true, "requestId": "uuid" }`；`mode` 可为 `queue`（下一轮）或 `steer`（当前轮插话）。

图片（可选，需 `capabilities.images`）：`{ "type": "image", "mediaType": "image/jpeg", "data": "<base64>", "name": "photo.jpg" }`（≤ 5 MB/张，最多 4 张）。

### 3.9 取消 / 重命名 / 选模型

- `POST /v1/sessions/:id/cancel` → `{ "accepted": true }`
- `POST /v1/sessions/:id/rename` `{ "title": "..." }` → `{ "title": "...", "seq": 42 }`
- `POST /v1/sessions/:id/model` `{ "provider": "...", "model": "...", "reasoningEffort": "high" }` → `{ "selected": { ... } }`
- `GET /v1/models` → DSH `modelCatalog` 原样：`{ default, routableProviders, groups: [{ id, name, models: [...] }], failures: [] }`

### 3.10 审批（可选能力）

当 Host 需要用户批准敏感工具调用时：

- REST 列表：`GET /v1/approvals` → `{ items: [Approval] }`
- SSE 推送：`approval.request` / `approval.resolved`
- 回答：`POST /v1/approvals/:approvalId` `{ "decision": "allow" | "reject" }`
  → `{ "resolved": true, "outcome": "allowed" | "rejected" }`；已过期/已由桌面回答 → `410 approval-gone`。

`Approval`：

```json
{ "id": "apr_...", "sessionId": "...", "tool": "pwsh", "callId": "call_...", "reason": "run command", "displayReason": "执行命令：npm install", "requestedAt": 1763000000000, "expiresAt": null }
```

### 3.11 设备管理

- `GET /v1/devices` → `{ items: [{ deviceId, name, platform, createdAt, lastSeenAt, current }] }`
- `DELETE /v1/devices/:deviceId` → `{ "removed": true }`（当前设备可删除自己；删除后 token 立即失效）

### 3.12 本地配对页

`GET /pair`（仅 loopback）：HTML 页面，展示二维码（QR 由插件生成，内联 SVG）、6 位配对码、有效期、已配对设备。中英文文案。

## 4. SSE 事件流 `GET /v1/events`

- Headers：`Content-Type: text/event-stream`、`Cache-Control: no-cache`、`Connection: keep-alive`。
- 心跳：每 15s 发送 `event: ping`，`data: {"t":<ms>}`。
- 帧格式（标准 SSE）：

```
id: 42
event: session.event
data: {"subscriptionId":"sub_...","sessionId":"...","event":{...}}

```

- 线程语义：所有事件均带 `subscriptionId`（全局事件如 `session.added` 除外）。
- 连接上限：每设备 1 条 SSE；重复连接会关闭旧连接（`event: connection.replaced`）。
- 事件类型：

| event | data |
|---|---|
| `hello` | `{ protocol, serverTime, hostId, subscriptions: [] }` |
| `session.snapshot` | `{ subscriptionId, sessionId, header, records, hasMore, cursor, projections }` |
| `session.event` | `{ subscriptionId, sessionId, event: SessionEvent }` |
| `session.assistant` | `{ subscriptionId, sessionId, frame: AssistantStreamFrame }` |
| `session.state` | `{ subscriptionId, sessionId, state: { active, running, queue, pendingInput } }` |
| `session.other` | 前向未知的 follow 帧，`{ subscriptionId, sessionId, frame }`，App 可忽略 |
| `subscription.closed` | `{ subscriptionId, sessionId, reason }` |
| `session.added` | `{ row: SessionRow }` |
| `session.removed` | `{ sessionId }` |
| `session.status` | `{ sessionId, running, active }` |
| `approval.request` | Approval |
| `approval.resolved` | `{ id, outcome }` |
| `error` | `{ code, message }`（连接级） |

## 5. 会话事件子集（App 必须渲染）

所有 `records[].event` / `session.event.event` 都是 DSH 原始 `SessionEvent`：`{ type, seq, time, data, surfaceOp?, sourceEventSeqs?, ignorable? }`。

App 渲染以下子集，其他类型忽略（可折叠显示）：

| type | data 关键字段 | App 展示 |
|---|---|---|
| `user/message` | `data = { role:"user", content:[{type:"text",text}|{type:"image",...}], source }` | 用户气泡 |
| `assistant/message` | `data = { message: { role:"assistant", content:[...] }, ... }` | 助手气泡（text/reasoning/tool-call 块） |
| `tool/call` | `{ callId, name, input }`（以实际为准） | 工具调用卡片 |
| `tool/result` | `data = { callId?, message:{ role:"tool", content:[...] }, isError }` | 工具结果（代码/文本/错误） |
| `turn/start` / `turn/end` | 边界数据 | 轮次分隔/停止按钮状态 |
| `session/title` | `{ title }` | 更新标题 |
| `model/selection` | `{ provider, model, reasoningEffort? }` | 顶部模型标签 |
| `working-directory/change` | `{ cwd }` | 顶部路径标签 |
| `compaction/*` | — | “上下文压缩”提示（可忽略） |
| `approval/asked` / `approval/decided` | `{ requestId, tool, outcome? }` | 审批卡片状态 |
| `todo/write` | todo 数组 | 可选：任务清单 |

`AssistantStreamFrame`（来自 follow 的 `assistantStream` 帧）：`{ type:"assistant-stream", ... }`，Host 端原样转发；包含 attempt 级 start/chunk/end 帧，chunk 携带增量文本/推理。App 用 `code-block`/`streaming-response` 组件渲染增量，收到 `assistant/message` 事件后用最终消息替换流式内容（按 seq/attempt 对齐）。

> 精确字段以 Host 端真实样本为准：集成时 Lead 会把真实抓包补到 `docs/wire-events.md`。App 端必须对缺失字段容错。

## 6. App 行为要求

1. **连接**：启动时若保存了 token，先 `GET /v1/health` + `GET /v1/host` 校验；失败进入配对页。
2. **重连**：SSE 断开按指数退避（1s/2s/4s… 最大 30s）重连，成功后对当前打开的会话重新 `open`，UI 显示“重连中”状态。
3. **前台/后台**：App 进入后台时保留 SSE 连接；若系统挂起，回到前台必须重新校验并恢复订阅。
4. **乐观消息**：发送后立即显示用户气泡（`pending` 状态），收到 `user/message`（同 `requestId` 或文本匹配）后转正；失败显示重试。
5. **审批**：收到 `approval.request` 时弹出底部审批卡（beUI `approval-card`/`tool-approval`），回答后立即关闭并显示结果。
6. **停止**：`running` 时输入框发送按钮变停止按钮，点击调用 cancel。
7. **安全**：token 存 `expo-secure-store`；明文 HTTP 仅限局域网；设置页显示当前 Host 并支持“断开/重新配对”。

## 7. 版本与兼容

- 协议版本 `1`。服务端在 `hello`/`health` 返回 `protocol`；App 只接受 `1`，否则提示升级。
- 未知 SSE 事件/未知 session 事件类型必须忽略而不是崩溃。
- 未知 JSON 字段必须容忍（向前兼容）。

## 8. 错误与限流（实现提示）

- 单设备请求限流 30 req/s（突发 60），超限 `429 rate-limited`。
- 会话 prompt 在 Host 端是串行队列，`accepted` 只代表入队成功；运行态以 `session.state`/事件为准。
- SSE 连接在 token 失效时发 `error unauthorized` 后关闭。

## 9. 真实宿主验证记录（2026-11-11，DSH 0.2.2-rc.1）

以下字段来自真实桌面版 DSH 宿主（隔离 DSH_HOME）抓包，两端实现以本节为准（与上文冲突时本节胜出）。

### 9.1 AssistantStreamFrame（SSE `session.assistant` 的 frame）

```json
{ "type": "start",   "attemptId": "session-...:1", "revision": 1, "turn": 1, "step": 1, "startedAfterSeq": 13 }
{ "type": "chunk",   "attemptId": "...", "revision": 2, "index": 0, "time": 1794388809188,
  "chunk": { "type": "block-start", "index": 0, "blockType": "text" } }
{ "type": "chunk",   "attemptId": "...", "revision": 3, "index": 1, "time": 1794388809189,
  "chunk": { "type": "text-delta", "index": 0, "text": "PONG" } }
{ "type": "chunk",   "chunk": { "type": "block-end", "index": 0, "block": { "type": "text", "text": "PONG" } } }
{ "type": "chunk",   "chunk": { "type": "usage", "usage": { "inputTokens": 9314, "outputTokens": 4 } } }
{ "type": "end",     "attemptId": "..." }
```

- App 只渲染 `chunk.type === "text-delta"`（追加 `chunk.text`）与 `chunk.type === "block-start"`（新块，可忽略）；其他 chunk 忽略。
- `attemptId` 用于把流式文本归入当前 assistant 气泡；收到 `assistant/message` 事件后用最终消息替换。

### 9.2 需要过滤的注入消息

`user/message` 事件的 `data.source.kind` 取值：

| source.kind | 含义 | App 处理 |
|---|---|---|
| `user` | 真实用户输入（含 `rpcId`） | **显示为用户气泡**，用 `rpcId` 匹配乐观消息 |
| `runtime-context` | 运行时上下文（工作目录/沙箱/审批策略/技能目录等） | 隐藏 |
| 其他（如 `user-question-reply`） | 系统注入 | 隐藏或只显示正文 |

因此 App 的 transcript 只渲染：`user/message` (source.kind === "user")、`assistant/message`、`tool/call`、`tool/result`、可选的 `turn/start|end` 分隔、`session/title`、`approval/asked|decided`、`todo/write`。

### 9.3 事件 data 结构（真实样本）

```json
// user/message
{ "content": [{ "type": "text", "text": "帮我看看这个报错" }],
  "source": { "kind": "user", "rpcId": "uuid", "clientTimeZone": "Asia/Shanghai" },
  "role": "user", "id": "uuid" }

// assistant/message
{ "turn": 1, "step": 1,
  "message": { "role": "assistant",
    "content": [{ "type": "text", "text": "PONG" }],
    "source": { "kind": "model", "provider": "opencode-go", "model": "deepseek-v4.1-flash" },
    "id": "uuid" },
  "usage": { "inputTokens": 9314, "outputTokens": 4 },
  "stream": [ ... ] }

// turn/start
{ "turn": 1 }
// turn/end
{ "turn": 1, "reason": { "kind": "completed" } }
// session/title
{ "title": "Exact PONG Reply Request", "messageSeqs": [8], "source": { "kind": "fallback" } }
```

### 9.4 follow 快照形状

```json
{ "type": "snapshot",
  "header": { "version": 4, "id": "session-...", "createdAt": 1794388800904, "cwd": "D:\\...", "isSeeded": false, "agentPreset": "standard" },
  "cursor": 19,
  "records": [ { "type": "event", "event": { "type": "user/message", "seq": 8, "time": ..., "data": {} } } ],
  "hasMore": false,
  "projections": { "asOfSeq": 19, "values": { "title": "...", "modelSelection": { "next": { "provider": "...", "model": "..." } } } },
  "assistantStream": null }
```

### 9.5 会话列表行（Host 侧映射后）

- `title` 来自 `projections.values.title`（LLM/fallback 生成），可能为 null。
- `model` 来自 `projections.values.modelSelection.next ?? lastUsed`。
- `cwd` 来自行 `cwd` 或 `projections.values.workingDirectory`。
- 列表行不含 `createdAt`（返回 0）、不含最近消息文本（`lastMessage` 返回 null）。

### 9.6 Host 端行为（App 依赖）

- `POST /v1/sessions/:id/open` 的 `session.snapshot` 包含 `maxMessages` 范围内的**全部**历史记录（含 system/message、注入的 user/message、request/header 等）；App 必须自行过滤渲染（§9.2）。
- turn 开始时连接会先收到 `session.state {running:true}`，结束后 `session.state {running:false}`（Host 由 turn/start、turn/end 合成）。
- `approval.request` 使用 90s 超时；超时后 Host 回退给桌面端回答者，App 端会收到 `approval.resolved`（outcome 可能为 `rejected`）。
