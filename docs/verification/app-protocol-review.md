# DSH Remote — App 客户端协议符合性复核（只读，不改代码）

- 复核人：verifier（独立验证者）
- 复核时间：2026-11-11 17:5x（Asia/Shanghai），代码快照来自工作区当前文件
- 协议基线：`docs/protocol.md`（394 行，含 §9「真实宿主验证记录」，DSH 0.2.2-rc.1）
- 复核方式：只读静态审查 + 与协议逐条对照；运行期行为以 `tools/verify/run-e2e.mjs` 对真实宿主的结果为准（另见 e2e-report.md）
- 范围：`app/src/lib/client.ts`（465 行）与 `app/src/lib/store.ts`（743 行）为主；为判定协议行为同时审查了 `sse.ts`、`sse-parser.ts`、`state-updates.ts`、`types.ts`、`pairing.ts`、`config.ts`。
- 未覆盖：`app/src/app/**` 路由/页面在本报告生成时尚未落地（`app/src` 下只有 components/hooks/lib/primitives/styles），§6.3 前后台、§3.6 历史翻页、§6.5 审批卡 UI 等页面级行为待页面落地后补充复核。

## 结论摘要

| 级别 | 数量 | 说明 |
|---|---|---|
| P0（阻断：协议不可用/数据错误） | 0 | 未发现 |
| P1（功能缺陷：真实场景下协议行为错误） | 2（**18:10 复核：2/2 已修复**） | SSE 401 无限重连；快照不回填乐观消息 |
| P2（契约/健壮性缺口，影响体验或边界场景） | 6（**18:10 复核：4 已修，2 仍存在**） | 见下与「修复复核」一节 |
| P3（改进项/待页面落地确认） | 7 | 见下 |

整体判断：客户端与 store 对协议 v1 主路径（配对/鉴权/REST/SSE/重连/乐观消息/审批/取消/token 存储）覆盖完整，字段容错与 §9 真实样本对齐良好；上述 P1 建议在真实 e2e 前/后尽快修。

## P1 问题（建议修）

### P1-1 SS E HTTP 401 会无限重连，不会转入“重新配对”

- 位置：`app/src/lib/sse.ts:143-148`（readyState 4 时只把 status>=400 包成普通 Error）、`app/src/lib/sse.ts:225-241`（`handleDrop` 只有 `fatal` 才停止重连）、`app/src/lib/client.ts:450-455`（只有 `event: error` 帧才会 emit unauthorized）。
- 协议依据：§1.4「失败统一 401 unauthorized」；§6.1「启动时校验失败进入配对页」；§8「SSE 连接在 token 失效时发 error unauthorized 后关闭」。
- 期望：SSE 连接收到 HTTP 401/403 时视为致命错误，停止重连、通知 store 清除 token 并进入配对/重连引导。
- 实际：HTTP 401 被当作普通断线，`willReconnect=true` 并永久指数退避重连（1s→30s），connection.status 停在 connecting/error，用户得不到“需要重新配对”的明确状态。
- 触发：设备被撤销后 App 冷启动 restore（先 health/host 401 会兜底进入配对），或运行中断线重连时收到 401 JSON（插件对未认证 SSE 返回 JSON 401 而非 SSE 帧）。
- 建议：`SseConnection` 在 HTTP 401/403 时置 `fatal=true` 并 `onClose({willReconnect:false, unauthorized:true})`；`client.connectEvents` 增加 `onUnauthorized` 回调，store 监听后清理 token/meta 并切到配对页。可用 `createXhr` 测试缝构造 fake XHR(status=401) 单测。

### P1-2 重连/重新 open 后，快照不回填乐观消息（pendingUser 残留）

- 位置：`app/src/lib/store.ts:182-203`（`applySnapshot` 只替换 events/streaming 等，未处理 pendingUser）对比 `app/src/lib/store.ts:205-228`（只有实时 `session.event` 才调用 `removeConfirmedPending`）。
- 协议依据：§6.4「发送后立即显示用户气泡（pending），收到 user/message（同 requestId 或文本匹配）后转正」；§9.2「用 rpcId 匹配乐观消息」。
- 期望：重连后服务端重新发 session.snapshot（§3.7），历史 records 中已包含刚发出的 user/message；快照应用后该 pending 气泡应转正。
- 实际：快照只替换事件数组；若之后没有新的 user/message 实时帧，pending 气泡会一直停在 sending，用户看到重复气泡。
- 建议：`applySnapshot` 中在算出 `events` 后遍历回调 `removeConfirmedPending(state.current.pendingUser, event)`（或统一抽一个 `reconcilePending(pending, events)` 函数），并补单测：先 pending，再 applySnapshot 含同一 rpcId 记录 → pending 清空。

## P2 问题（契约/健壮性缺口）

### P2-1 手写 SSE 解析器在 CRLF 跨 chunk 拆分时丢失事件名

- 位置：`app/src/lib/sse-parser.ts:58-74`：遇到缓冲末尾的 `\r` 时直接当作行结束消费，下一 chunk 起始的 `\n` 会被当成空行触发 dispatch 并重置 `eventName`。
- 复现（可直接加进 `app/src/lib/__tests__/sse-parser.test.mjs`）：`parser.push('event: x\r'); parser.push('\ndata: 1\r\n\r\n')`，期望得到 `event="x"`，实际得到 `event="message"`。
- 影响：插件当前只发 LF（`plugin/src/net/sse.ts` encodeFrame 用 \n），线上暂不触发；但契约要求标准 SSE，以后加代理/换实现会静默丢事件类型。
- 建议：增加 `swallowLF` 状态（真实宿主验证客户端在 `tools/verify/protocol-client.mjs` 中就是这么处理的），并补跨 chunk 的 CRLF 单测。

### P2-2 审批在无打开会话时被丢弃

- 位置：`app/src/lib/store.ts:273-283`：`applyApprovalRequest` 在 `!state.current.sessionId` 时直接 return。
- 协议依据：§6.5「收到 approval.request 时弹出底部审批卡」，§4 approval.request 为全局事件（不带 subscriptionId）。
- 影响：用户在会话列表/设置页时 Host 触发审批，App 丢弃该审批；90s 后 Host 回退给桌面端（§9.6），手机上完全看不到。
- 建议：把 pendingApprovals 提升为与 current 解耦的全局队列（或在无 current 时缓存，打开会话后合并），并且只按 approval.sessionId 过滤而不是丢弃。

### P2-3 会话切换时未关闭旧订阅

- 位置：`app/src/lib/store.ts:556-578`：`openSession` 直接覆盖 current 并 open 新会话，未先 `closeSession()` 旧 sessionId。
- 协议依据：§3.7「同一 App 对同一 session 重复 open 会替换旧订阅」（只保证同 session）；§3.7 close 幂等。
- 影响：App 内切换 N 个会话后 Host 端保留 N-1 个跟随订阅（`plugin/src/net/service.mjs` 按 deviceId+sessionId 保存），增加 Host 事件转发与内存开销，直到 App 断开 SSE。
- 建议：打开新会话前，若 current.sessionId 存在且不同，先 best-effort `client.closeSession(prev)`。

### P2-4 401 只提示错误，不清理 token/不迁移状态

- 位置：`app/src/lib/client.ts:166`（401 emit unauthorized）、`app/src/lib/store.ts:368-372`（只 setConnectionError）。
- 协议依据：§1.4 / §6.1（鉴权失败进入配对）。
- 影响：token 已被撤销时 App 停在错误横幅，SSE 仍可能在重连（见 P1-1），用户需手动“断开/重新配对”。
- 建议：unauthorized 处理器统一执行 `clearToken()+clearConnectionMeta()+detachClient()` 并置 connection.status=idle/error 引导配对页。

### P2-5 历史分页未接线（§3.6）

- 位置：`app/src/lib/store.ts:118-133` 保存了 `hasMore/cursor`（`applySnapshot` 写入），但 `RemoteActions` 没有 loadMoreHistory 之类的动作，`client.history()` 在 store 中从未被调用。
- 协议依据：§3.6（beforeSeq 分页）+ §3.7 open 的 maxMessages 上限。
- 影响：长会话只能看到快照窗口内的消息，无法上翻历史（页面若自行调用 client 需绕过 store，注意类型）。建议页面落地后确认是否由 chat 页直接使用 `client.history`；若没有，补 store action。

### P2-6 工作目录变化事件未消费（§5）

- 位置：`app/src/lib/store.ts` 无 `working-directory/change` 分支（`state-updates.ts` 也未提供提取函数）；仅 `applySessionEvent` 里处理 title/model。
- 协议依据：§5 要求顶部路径标签随 `working-directory/change` 更新。
- 影响：会话中途切换工作目录时，聊天页路径标签可能滞后（取决于 chat-header 用 session row 还是事件）。建议在 store 增加 current.cwd 并消费该事件。

## P3 改进项 / 待页面确认

| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| 1 | `app/src/lib/sse.ts:247-250` | 退避 jitter 在 30s 上限之后再乘 1.0~1.2，最大可达 36s，超出 §6.2「最大 30s」 | cap 放在 jitter 之后，或 jitter 用 `base * (0.8+0.4*rand)` 且不超过 max |
| 2 | `app/src/lib/client.ts:145-168` | 请求超时只包裹 fetch() 调用，response.text() 读取不受超时约束；服务端半开连接时可能挂住 | 用 `AbortSignal.timeout` 包到 body 读完，或用 Promise.race |
| 3 | `app/src/lib/client.ts:457-462` | `subscription.closed` 被忽略；服务端因 session 移除/replace 关闭订阅后，loading/streaming 清理依赖其他帧 | 解析该事件并 emit，store 清理 loading/streaming/error |
| 4 | `app/src/lib/store.ts:566-568` | `openSession` 未设置 active 来源（快照不含 state），active 可能沿用列表旧值 | 打开后可用 `GET /v1/sessions/:id` 取一次 state，或等待 session.state 帧 |
| 5 | `app/src/lib/store.ts:469-480` | restore() 遇到 401 只返回 false，不清 token/meta；下次启动继续用坏 token 重试 | 凭 401 清理持久化并返回 false |
| 6 | `app/src/lib/pairing.ts:91-96` | normalizeBaseUrl 只剥离尾部 /v1、/pair，粘贴 `http://host/foo` 会保留 /foo 导致所有请求 404 | 非根路径直接视为非法或丢弃路径 |
| 7 | `app/src/lib/config.ts:21-33` | web 端 token 落在 AsyncStorage（非 SecureStore） | 仅 web 兜底可接受，但建议设置页标注 web 不安全 |
| 8 | `app/src/lib/state-updates.ts:169-179` | `session.status.active === undefined` 时按 true 处理 | 协议 §4 要求字段存在；插件已修，建议 App 也按缺省保留旧值而非 true |
| 9 | `app/src/lib/store.ts:205-228` | 实时 session/title、model/selection 只更新 current，不同步更新 sessions 列表行 | 同步 upsert 列表行，避免返回列表时标题/模型滞后 |

## 协议覆盖矩阵（静态复核）

| 协议条目 | App 实现 | 结论 |
|---|---|---|
| §1.2 二维码 payload（u/c/h/n） | `pairing.ts:parsePairingUri` | ✅ 支持 URI/JSON/裸 URL，code 6 位校验 |
| §1.3 POST /v1/pair 字段 | `client.ts:198-251`、`store.ts:378-433` | ✅ code/deviceId/deviceName/platform/appVersion；校验 protocol/token |
| §1.4 Bearer / ?token= | `client.ts:145-193`、`sse.ts:299-302` | ✅ JSON 用 header，SSE 用 query token |
| §2 错误 envelope + 错误码 | `client.ts:169-186`、`errors.ts` | ✅ 解析 error.code/message/details，中文映射 |
| §3.1 health / §3.2 host | `client.ts:256-263`、`store.ts:restore/resume` | ✅ 启动/前台校验 protocol/host |
| §3.3 sessions list | `client.ts:266-271`、`state-updates.ts:upsertSessionRow/applySessionStatus` | ✅ 字段容错；lastMessage 可空（§9.5） |
| §3.4 create / §3.5 detail / §3.6 history | `client.ts:274-292` | ✅ 端点齐全；history 已接 client，store 分页见 P2-5 |
| §3.7 open/close | `client.ts:295-310`、`store.ts:openSession/closeSession` | ✅ body 默认值符合协议；close 幂等 |
| §3.8 prompt（含 requestId/mode/content/clientTimeZone） | `client.ts:313-315`、`store.ts:sendPrompt` | ✅ 每次生成 uuid requestId；clientTimeZone 取 IANA |
| §3.9 cancel/rename/model/models | `client.ts:318-335`、`store.ts:cancel/selectModel/loadModels` | ✅ |
| §3.10 approvals | `client.ts:338-345`、`store.ts:answerApproval` | ✅ 410 approval-gone 清理 pending |
| §3.11 devices | `client.ts:348-355`、`store.ts:removeDevice` | ✅ 删除当前设备后 disconnect 清 token |
| §4 hello/snapshot/event/assistant/state/status/added/removed/approval.request/resolved/error | `client.ts:388-464` | ✅ 全部解析；未知事件/connection.replaced/ping/subscription.closed 忽略（§7） |
| §4 心跳 15s / 重连退避 1s→30s | `sse.ts:243-255,273-288` | ⚠️ 基本符合；上限见 P3-1；空闲看门狗 45s 覆盖 15s ping |
| §5 事件渲染子集 | `transcript.ts` | ✅ user/assistant/tool/turn/title/model/approval/todo 均有；注入 source.kind 过滤与 §9.2 一致 |
| §5 working-directory/change | store 未消费 | ⚠️ 见 P2-6 |
| §6.2 重连后重新 open | `store.ts:169-180,291-304` | ✅ streamOpened 标记 + reconnected 时 reopen + refreshSessions |
| §6.3 前台恢复 | `store.ts:483-504` | ✅ resume()=health+host+reopen（页面调用待确认） |
| §6.4 乐观消息 | `store.ts:593-625`、`state-updates.ts:removeConfirmedPending` | ✅ requestId→rpcId 匹配；⚠️ 快照回填见 P1-2 |
| §6.5 审批卡 | `store.ts:637-653` | ✅ 回答后立即移除；⚠️ 无会话时丢弃见 P2-2 |
| §6.6 停止按钮 cancel | `store.ts:cancel` | ✅ |
| §6.7 token 存 SecureStore | `config.ts` | ✅ 原生端 SecureStore；web 兜底见 P3-7 |
| §9.1 assistant 帧（start/chunk/text-delta/end） | `state-updates.ts:76-122` | ✅ text-delta/reasoning-delta 累加；end 停止；未知 chunk 忽略 |
| §9.2 source.kind 过滤 | `transcript.ts:176-180` | ✅ 仅 kind==="user" 渲染 |
| §9.4 快照投影 values.modelSelection/title | `state-updates.ts:183-198` | ✅ 同时兼容顶层与 values |
| §9.5 createdAt=0 / lastMessage=null | `types.ts`、列表 UI 待确认 | ✅ 类型可空/可 0 |

## 待真实宿主/真机确认项（不阻塞静态复核）

1. DSH 的 `user/message` 事件 `data.source.rpcId` 是否等于 App 发出的 `requestId`：§9.2 依赖该匹配。若不等，P1-2 需要加文本匹配兜底。e2e `prompt.optimistic-dedupe-key` 会记录实测值。
2. `session.assistant` 帧是否逐 chunk 到达且 `chunk.type==="text-delta"`（§9.1）；e2e `assistant.stream-chunk` 会记录样本。
3. cancel 后 Host 是否还会补发 `assistant/message`；e2e `cancel.effective` 会断言并给出 seq 证据。
4. 快照 records 包含注入 `user/message`（§9.6）时，transcript 过滤是否完整（`runtime-context` 等）；真实样本可见 e2e-report.md「原始 wire 样本」。

## 附：复核输入文件清单

| 文件 | 行数 | 复核结论 |
|---|---|---|
| `app/src/lib/client.ts` | 465 | 端点与 SSE 分发完整；P1-1 关联 |
| `app/src/lib/store.ts` | 743 | 主状态机完整；P1-2、P2-2/3/4/5/6 |
| `app/src/lib/sse.ts` | 302 | 重连/心跳 watchdog 良好；P1-1、P3-1 |
| `app/src/lib/sse-parser.ts` | 127 | P2-1（CRLF 跨 chunk） |
| `app/src/lib/state-updates.ts` | 221 | 纯函数，§9.1/§9.4 对齐；P3-8 |
| `app/src/lib/types.ts` | 485 | 字段容错好，含 §9 注释 |
| `app/src/lib/pairing.ts` | 168 | P3-6（路径规整） |
| `app/src/lib/config.ts` | 132 | P3-7（web token 存储） |
| `app/src/lib/transcript.ts` | 763 | §5/§9.2 渲染子集实现完整 |


---

## 补记：页面/路由层复核（18:06，app/src/app 已落地）

在报告初版之后，`app/src/app/**` 路由已落地（`_layout.tsx`、`index.tsx`、`sessions.tsx`、`session/[id].tsx`、`settings.tsx`）。补充只读复核结论：

| 协议要求 | 页面实现 | 结论 |
|---|---|---|
| §6.1 启动先 health+host 校验，失败进入配对页 | `index.tsx:56-62` 启动 restore()；失败停留在连接页可扫码/手输 | ✅ |
| §1.2 二维码/深链 payload | `index.tsx:79-96` 解析 dshremote://pair 与粘贴 URI；扫描用 expo-camera | ✅ |
| §6.2 重连后重新 open + UI 重连态 | `_layout.tsx:30-32` AppState active → resume()；session 页进入即 open、离开 close（`session/[id].tsx:83-89`）；`ConnectionBanner` 展示 connecting/error | ✅ |
| §6.3 前台恢复 | `_layout.tsx:30-32` + `store.resume()`（health+host+reopen） | ✅ |
| §6.4 乐观消息展示 | `session/[id].tsx:92` 把 pendingUser 传入 buildTranscript | ✅（P1-2 的快照回填仍存在） |
| §6.5 审批卡 | `session/[id].tsx:202-210` 底部 ApprovalSheet，回答后关闭 | ✅（P2-2 的“无会话时丢弃”仍存在） |
| §6.6 停止按钮 | `session/[id].tsx:211-219` running 时 Composer onStop → actions.cancel() | ✅ |
| §6.7 设置页显示 Host/断开重配 | `settings.tsx:59-82` disconnect + 重新配对；`settings.tsx:103-119` 设备列表/移除 | ✅ |
| §4 会话列表实时更新 | `sessions.tsx:49` connected 时 refreshSessions；下拉刷新 | ✅ |
| §3.6 历史分页（上翻加载更多） | 路由/页面无 loadMore / beforeSeq 调用；`store` 只存 cursor/hasMore | ❌ 维持 P2-5（确认页面层未实现） |
| §5 working-directory/change 顶部路径 | `session/[id].tsx:99-101` subtitle 取 sessions 行 cwd 或 host.defaultCwd，不消费事件 | ❌ 维持 P2-6（确认页面层未实现） |

页面层未发现新的 P0/P1。P1-1（SSE 401 无限重连）与 P1-2（快照不回填 pendingUser）仍是本轮最值得修的两项；P2-5/P2-6 已由页面层确认存在，建议排入后续迭代。
---

## 修复复核（18:10，只读复核 app 开发者后续提交）

app 团队在初版报告后提交了修复；以下按原编号逐条复核当前工作区代码（仍是只读）：

| 编号 | 原问题 | 状态 | 当前实现证据 |
|---|---|---|---|
| P1-1 | SSE HTTP 401 无限重连 | ✅ **已修复** | `app/src/lib/sse.ts:147-155`（401/403 置 fatal + onHttpStatus 回调）、`app/src/lib/client.ts:368-370`（emit unauthorized）、`app/src/lib/store.ts:385-397`（clearToken + needsPairing + 停止重连） |
| P1-2 | 快照不回填 pendingUser | ✅ **已修复** | `app/src/lib/store.ts:206` 调用 `state-updates.ts:143 filterPendingByEvents` |
| P2-1 | CRLF 跨 chunk 丢事件名 | ✅ **已修复** | `app/src/lib/sse-parser.ts:61-67` 缓冲末尾 CR 等待下一 chunk |
| P2-2 | 无打开会话时审批被丢弃 | ✅ **已修复** | `app/src/lib/store.ts:280-301` 全局 `approvals` + `stageApproval`；`openSession:594-607` 把匹配会话的已暂存审批带入 current |
| P2-3 | 切换会话不关旧订阅 | ✅ **已修复** | `app/src/lib/store.ts:585-593` openSession 前 closeSession(previousId) |
| P2-4 | 401 只提示不清理 token | ✅ **已修复** | `app/src/lib/store.ts:385-397` unauthorized 处理器 clearToken + needsPairing |
| P2-5 | 历史分页未实现 | 🟡 **部分修复** | store 已实现 `loadOlderHistory`（`store.ts:620-648`，beforeSeq=cursor-1 符合 §3.6）；但 `app/src/app` 页面尚未接线（无 onEndReached/loadOlderHistory 调用）→ 降级为 P3 |
| P2-6 | working-directory/change 未消费 | ❌ **仍存在** | `session/[id].tsx:99-101` 仍只用 sessions 行 cwd/host.defaultCwd；`store` 无 cwd 事件处理 |
| P3-1 | 退避 jitter 可超 30s | ❌ 仍存在 | `sse.ts:256-258`：base 先 min(max) 再乘 1.0~1.2，最大 36s |
| P3-2 | 请求超时未覆盖 body 读取 | ❌ 仍存在 | `client.ts:145-168` |
| P3-3 | subscription.closed 被忽略 | ❌ 仍存在 | `client.ts:460` 与默认分支一起忽略 |
| P3-4 | openSession 未取 active 状态 | 🟡 改善 | 仍用列表行 `active`；但 session.state 帧会纠正，影响小 |
| P3-5 | restore 401 不清 token/meta | ❌ 仍存在 | `store.ts:504-508` catch 只 setConnectionError；注意此路径 handlers 尚未 attach，401 不会触发 unauthorized 处理器 |
| P3-6/7/8/9 | pairing 路径规整 / web token / status 缺省 / 列表行同步 | ❌ 仍存在（均为小改进） | 同初版 |

**复核结论**：两个 P1 与 P2-1/2/3/4 均已在当前代码修复（静态复核）；P2-6 与 P2-5 的页面接线仍待处理；其他 P3 不影响协议主路径。真实运行期仍需在 APK/真机上确认（尤其 P1-1 的 401 行为与 P1-2 的重连快照场景）。
---

## 追加复核（18:5x，模拟器实测发现的 P1）：`clientTimeZone` 未归一化导致所有 prompt 失败

| 编号 | 问题 | 级别 | 位置 | 证据/修复建议 |
|---|---|---|---|---|
| P1-3 | App 把设备时区原样作为 `clientTimeZone` 发送；当设备时区解析为 `GMT` 等非 Area/Location 值时，DSH 校验失败返回 500 internal，App 所有发送均失败（模拟器实测 100%） | **P1（已修复，待新 APK 复验）** | `app/src/lib/config.ts:125-132`（getClientTimeZone）、`app/src/lib/store.ts:sendPrompt` | 宿主复现：`node tools/verify/probe-timezone.mjs`；`"GMT"`→500 internal（clientTimeZone must be UTC or a valid IANA Area/Location name），`"UTC"`/`"Asia/Shanghai"`/`"Etc/GMT-8"`/省略→200。建议：GMT/Etc/UTC 归一化为 `UTC`，非法值返回 undefined；失败时透出 ApiError.message。 |

> 说明：该问题与协议 §3.8「clientTimeZone 可选」兼容（省略字段 DSH 接受），因此 App 应先校验/归一化再发送。插件侧同类校验错误映射 400 的建议见 plugin-dev 通报（P2）。
### P1-3 修复复核（19:0x）

- app-core 新增 `app/src/lib/timezone.ts`（`normalizeClientTimeZone()`），`config.ts:getClientTimeZone()` 改为调用它；GMT/Etc/UTC 归一到 `UTC`，非法值返回 undefined 省略字段。
- verifier 直接以 Node 24 加载该纯 TS 文件执行 16 组断言（`tools/verify/probe-app-timezone.mjs`）：**16/16 PASS**（含 GMT/UTC/Etc 系列 → UTC；Asia/Shanghai、America/Argentina/... 原样；CST/GMT+8/+08:00/空/null → undefined）。
- 待 Lead 重新构建 APK 后，在模拟器上复验「发送消息成功 + 流式回复」；届时本报告与本目录 e2e/模拟器报告一并更新。
