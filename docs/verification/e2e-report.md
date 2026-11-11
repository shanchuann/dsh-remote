# DSH Remote 端到端矩阵报告（协议客户端 vs 真实 DSH 宿主）

- 生成时间：2026-11-11T11:11:15.707Z（本地 2026/11/11 19:11:15）
- 目标宿主：http://127.0.0.1:8790（复用 Lead 启动的宿主）
- DSH_HOME：D:\Code\dsh-remote\.testhome
- 配对信息：D:\Code\dsh-remote\.testhome\plugins\dsh-remote\pairing.json（pairing.json）
- 命 令：`D:\NVM\nodejs\node.exe D:\Code\dsh-remote\tools\verify\run-e2e.mjs --url http://127.0.0.1:8790 --dsh-home D:\Code\dsh-remote\.testhome --json-out tools\verify\.e2e-report.json --report docs\verification\e2e-report.md`
- 环境：node v24.9.0 / win32 x64
- 真实宿主：DSH 0.2.2-rc.1，插件 dsh-remote 0.1.0
- hostId：9926a229-b090-422b-be40-076e65b1136b，sessionId：session-a2ab37c9-0147-4db9-8927-bdaeb6ffab06，deviceId：c803f280-d999-417f-935f-4112a11f95b1
- 耗时：13.7 s
- 结果：**PASS** — pass 24 / fail 0 / warn 0 / skip 0

## 断言矩阵

| # | 断言 | 结果 | 耗时(ms) | 证据 / 说明 |
|---|---|---|---|---|
| 1 | `health.public` | ✅ PASS | 38 | {"hostId":"9926a229-b090-422b-be40-076e65b1136b","dshVersion":"0.2.2-rc.1","pluginVersion":"0.1.0","pairingRequired":false} |
| 2 | `pair-page.loopback-html` | ✅ PASS | 46 | {"contentType":"text/html; charset=utf-8","bytes":40438} |
| 3 | `pair.succeeds` | ✅ PASS | 65 | {"mode":"pair","deviceId":"c803f280-d999-417f-935f-4112a11f95b1","host":{"id":"9926a229-b090-422b-be40-076e65b1136b","name":"山川不念旧","platform":"win32","dshVersion":"0.2.2-rc.1","pluginVersion":"0.1.0"},"token":"87da0c... |
| 4 | `auth.missing-token-401` | ✅ PASS | 3 | {"status":401,"code":"unauthorized"} |
| 5 | `auth.sse-bad-token-401` | ✅ PASS | 3 | {"status":401,"code":"unauthorized"} |
| 6 | `host.shape` | ✅ PASS | 4 | {"name":"山川不念旧","platform":"win32","capabilities":{"assistantStream":true,"approvals":true,"models":true,"problemQuestions":false,"attachments":false,"images":true},"devices":13} |
| 7 | `sessions.list.structure` | ✅ PASS | 20 | {"count":14,"nextCursor":null,"sample":{"sessionId":"session-9667a02f-928d-4ed9-8cfb-29a49b3b463e","title":"UTC Timezone Probe"}} |
| 8 | `sessions.create` | ✅ PASS | 16 | {"sessionId":"session-a2ab37c9-0147-4db9-8927-bdaeb6ffab06","agentPreset":"standard"} |
| 9 | `session.detail` | ✅ PASS | 21 | {"title":null,"state":{"cursor":2,"active":true,"running":false,"queue":[],"pendingInput":[]}} |
| 10 | `models.catalog` | ✅ PASS | 328 | {"groups":2,"default":{"provider":"opencode-go","model":"deepseek-v4.1-flash","reasoningEffort":"high"}} |
| 11 | `sse.hello` | ✅ PASS | 5 | {"protocol":1,"subscriptions":[]} |
| 12 | `open.snapshot` | ✅ PASS | 23 | {"subscriptionId":"sub_10a9515ab8e3b1925019d005","records":3,"hasMore":false,"cursor":2} |
| 13 | `prompt.user-message` | ✅ PASS | 152 | {"requestId":"081ddd1d-4db4-4a3f-b595-4987afcc101d","seq":8,"text":"你好，这是端到端验证消息 verifier-e2e-9ed3b246。请用一句话回复确认。","sourceKind":"user","rpcId":"081ddd1d-4db4-4a3f-b595-4987afcc101d"} |
| 14 | `prompt.optimistic-dedupe-key` | ✅ PASS | 1 | {"requestId":"081ddd1d-4db4-4a3f-b595-4987afcc101d","rpcId":"081ddd1d-4db4-4a3f-b595-4987afcc101d","sourceKind":"user"} |
| 15 | `assistant.stream-frames` | ✅ PASS | 13 | {"frames":1,"sample":"[{\"subscriptionId\":\"sub_10a9515ab8e3b1925019d005\",\"sessionId\":\"session-a2ab37c9-0147-4db9-8927-bdaeb6ffab06\",\"frame\":{\"type\":\"start\",\"attemptId\":\"session-a2ab37c9-0147-4db9-8927-... |
| 16 | `assistant.stream-chunk` | ✅ PASS | 8456 | {"observed":true,"sample":"{\"subscriptionId\":\"sub_10a9515ab8e3b1925019d005\",\"sessionId\":\"session-a2ab37c9-0147-4db9-8927-bdaeb6ffab06\",\"frame\":{\"type\":\"chunk\",\"attemptId\":\"session-a2ab37c9-0147-4db9-8... |
| 17 | `assistant.message` | ✅ PASS | 262 | {"seq":17,"text":"收到，端到端验证消息 verifier-e2e-9ed3b246 已确认无误。","length":39} |
| 18 | `session.state-after-turn` | ✅ PASS | 130 | {"running":false,"active":true,"queue":[]} |
| 19 | `cancel.effective` | ✅ PASS | 3778 | {"started":true,"stopped":true,"cancelLatencyMs":3225,"lateAssistantMessages":0} |
| 20 | `sse.reconnect-reopen` | ✅ PASS | 234 | {"oldSubscriptionId":"sub_10a9515ab8e3b1925019d005","newSubscriptionId":"sub_03cbf12b2603e9b6c8a932b4","records":24,"replayed":false} |
| 21 | `session.rename` | ✅ PASS | 8 | {"title":"verifier-e2e-32f8e4","seq":24} |
| 22 | `history.ascending` | ✅ PASS | 20 | {"count":25,"hasMore":false,"cursor":24} |
| 23 | `devices.list-current` | ✅ PASS | 7 | {"count":13,"currentDeviceId":"c803f280-d999-417f-935f-4112a11f95b1"} |
| 24 | `device.revoke-self-401` | ✅ PASS | 27 | {"revokedDeviceId":"c803f280-d999-417f-935f-4112a11f95b1","status":401,"code":"unauthorized","sseStatus":401} |

## SSE 证据

- 收到用户消息：`你好，这是端到端验证消息 verifier-e2e-9ed3b246。请用一句话回复确认。`（seq 8）
- 收到助手最终消息：收到，端到端验证消息 verifier-e2e-9ed3b246 已确认无误。（seq 17）
- assistant 流式帧样本数：13，SSE 帧总数：50
- 快照：sub_10a9515ab8e3b1925019d005 (3 records)；sub_03cbf12b2603e9b6c8a932b4 (24 records)

### 会话事件时间线（末尾 22 条）

| 时间 | 类型 | seq | 摘要 |
|---|---|---|---|
| 2026-11-11T11:11:02.625Z | `agent/inbox/spliced` | 3 | {"target":"next-turn","start":0,"inserted":[{"content":[{"type":"text","text":"你好，这是端到端验证消息 verifier-e2e-9ed3b246。请用一句话回复确认。"}],"source":... |
| 2026-11-11T11:11:02.625Z | `turn/start` | 4 | {"turn":1} |
| 2026-11-11T11:11:02.625Z | `agent/inbox/spliced` | 5 | {"target":"next-turn","start":0,"removedCount":1,"inserted":[]} |
| 2026-11-11T11:11:02.767Z | `step/start` | 6 | {"turn":1,"step":1} |
| 2026-11-11T11:11:02.767Z | `system/message` | 7 | {"turn":1,"step":1,"message":{"role":"system","content":[{"type":"text","text":"You are an AI agent powered by DeepSeek Harness.\n\nYou a... |
| 2026-11-11T11:11:02.767Z | `user/message` | 8 | {"content":[{"type":"text","text":"你好，这是端到端验证消息 verifier-e2e-9ed3b246。请用一句话回复确认。"}],"source":{"kind":"user","rpcId":"081ddd1d-4db4-4a3f-b... |
| 2026-11-11T11:11:02.767Z | `user/message` | 9 | {"content":[{"type":"text","text":"Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nCurrent workin... |
| 2026-11-11T11:11:02.768Z | `user/message` | 10 | {"content":[{"type":"text","text":"<system-reminder>\nA skill is a reusable set of task-specific instructions. The following skills are a... |
| 2026-11-11T11:11:02.768Z | `user/message` | 11 | {"content":[{"type":"text","text":"Time sampled while preparing turn 1, step 1: 2026-11-11T19:11:02+08:00[Asia/Shanghai]\nBrowser time zo... |
| 2026-11-11T11:11:02.780Z | `request/header` | 12 | {"header":{"config":{"provider":"opencode-go","model":"deepseek-v4.1-flash","reasoningEffort":"high"},"tools":[{"name":"ask_user_question... |
| 2026-11-11T11:11:02.781Z | `request/context` | 13 | {"provider":"opencode-go","model":"deepseek-v4.1-flash","contextWindow":1000000} |
| 2026-11-11T11:11:02.781Z | `session/title` | 14 | {"title":"你好，这是端到端验证消息 ver","messageSeqs":[8],"source":{"kind":"fallback"}} |
| 2026-11-11T11:11:02.781Z | `session/title-llm-request` | 15 | {"titleProvider":"session-title-first-prompt-llm","messageSeqs":[8],"route":{"provider":"opencode-go","model":"deepseek-v4.1-flash"},"sys... |
| 2026-11-11T11:11:06.989Z | `session/title` | 16 | {"title":"端到端验证消息确认","messageSeqs":[8],"source":{"kind":"provider","provider":"session-title-first-prompt-llm","model":{"provider":"openc... |
| 2026-11-11T11:11:11.499Z | `assistant/message` | 17 | {"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"收到，端到端验证消息 verifier-e2e-9ed3b246 已确认无误。"}],"source":{"... |
| 2026-11-11T11:11:11.499Z | `step/end` | 18 | {"turn":1,"step":1} |
| 2026-11-11T11:11:11.499Z | `turn/end` | 19 | {"turn":1,"reason":{"kind":"completed"}} |
| 2026-11-11T11:11:11.730Z | `agent/inbox/spliced` | 20 | {"target":"next-turn","start":0,"inserted":[{"content":[{"type":"text","text":"verifier-cancel-8c3f3bc0 请写一篇不少于 500 字的长文，分多段详细展开：请尽量长、不要省... |
| 2026-11-11T11:11:11.730Z | `turn/start` | 21 | {"turn":2} |
| 2026-11-11T11:11:11.730Z | `agent/inbox/spliced` | 22 | {"target":"next-turn","start":0,"removedCount":1,"inserted":[]} |
| 2026-11-11T11:11:12.211Z | `turn/end` | 23 | {"turn":2,"reason":{"kind":"aborted","reason":{"kind":"user"}}} |
| 2026-11-11T11:11:15.654Z | `session/title` | 24 | {"title":"verifier-e2e-32f8e4","messageSeqs":[],"source":{"kind":"user"}} |

## 原始 wire 样本（供 App 协议复核）

- SSE 事件计数：`hello`=2，`session.snapshot`=2，`session.status`=4，`session.event`=22，`session.state`=4，`session.assistant`=13，`subscription.closed`=2，`error`=1
- hello：`{"protocol":1,"serverTime":1794395462585,"hostId":"9926a229-b090-422b-be40-076e65b1136b","subscriptions":[]}`

### user/message 原始 data

```json
{"content":[{"type":"text","text":"你好，这是端到端验证消息 verifier-e2e-9ed3b246。请用一句话回复确认。"}],"source":{"kind":"user","rpcId":"081ddd1d-4db4-4a3f-b595-4987afcc101d","clientTimeZone":"Asia/Shanghai"},"role":"user","id":"247a23a4-5135-4429-a843-857d2f3956c9"}
```

### assistant/message 原始 data

```json
{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"收到，端到端验证消息 verifier-e2e-9ed3b246 已确认无误。"}],"source":{"kind":"model","provider":"opencode-go","model":"deepseek-v4.1-flash","replayState":{"response":{"kind":"pi-ai","version":2,"api":"openai-completions","provider":"opencode-go","model":"deepseek-v4.1-flash","responseId":"chatcmpl-0842f5160d4a432d83cc00e65759eb50","stopReason":"stop"},"blocks":[{"type":"text"}]}},"id":"533316b4-7d7f-44c3-a2d8-d7dcce2f7c3a"},"usage":{"inputTokens":12521,"outputTokens":25,"totalTokens":12546},"stream":[{"type":"chunk","time":1794395471233,"chunk":{"type":"block-start","index":0,"blockType":"text"}},{"type":"text-chunks","time0":1794395471233,"index":0,"dt":[15,62,17,67,35,34],"texts":["收到","，端","到端验证消息 verifier","-e2e-9ed","3b246 已确认","无误","。"]},{"type":"chunk","time":1794395471472,"chunk":{"type":"block-end","index":0,"block":{"type":"text","text":"收到，端到端验证消息 verifier-e2e-9ed3b246 已确认无误。"}}},{"type":"chunk","time":1794395471472,"chunk":{"type":"usage","usage":{"inputTokens":12521,"outputTokens":25,"totalTokens":12546}}},{"type":"chunk","time":1794395471473,"chunk":{"type":"finish","reason":{"kind":"stop"},"replayState":{"response":{"kind":"pi-ai","version":2,"api":"openai-completions","provider":"opencode-go","model":"deepseek-v4.1-flash","responseId":"chatcmpl-0842f5160d4a432d83cc00e65759eb50","stopReason":"stop"},"blocks":[{"type":"text"}]}}}]}
```

### session.assistant 帧样本（协议 §9.1）

```json
{"type":"start","attemptId":"session-a2ab37c9-0147-4db9-8927-bdaeb6ffab06:1","revision":1,"turn":1,"step":1,"startedAfterSeq":13}
{"type":"chunk","attemptId":"session-a2ab37c9-0147-4db9-8927-bdaeb6ffab06:1","revision":2,"index":0,"time":1794395471233,"chunk":{"type":"block-start","index":0,"blockType":"text"}}
{"type":"chunk","attemptId":"session-a2ab37c9-0147-4db9-8927-bdaeb6ffab06:1","revision":3,"index":1,"time":1794395471233,"chunk":{"type":"text-delta","index":0,"text":"收到"}}
{"type":"chunk","attemptId":"session-a2ab37c9-0147-4db9-8927-bdaeb6ffab06:1","revision":4,"index":2,"time":1794395471248,"chunk":{"type":"text-delta","index":0,"text":"，端"}}
{"type":"chunk","attemptId":"session-a2ab37c9-0147-4db9-8927-bdaeb6ffab06:1","revision":5,"index":3,"time":1794395471310,"chunk":{"type":"text-delta","index":0,"text":"到端验证消息 verifier"}}
{"type":"chunk","attemptId":"session-a2ab37c9-0147-4db9-8927-bdaeb6ffab06:1","revision":6,"index":4,"time":1794395471327,"chunk":{"type":"text-delta","index":0,"text":"-e2e-9ed"}}
```

### 注入的 user/message 样本（协议 §9.2，App 必须过滤）

- source.kind = `runtime-context`，seq 9

```text
Current runtime context. This snapshot supersedes earlier runtime-context snapshots.

Current working directory: "D:\\Code\\dsh-remote".

Current DSH file policy: workspace-write. Any available operation enforced by the DSH file sandbox may modify files under the session workspace: "D:\\Code\\dsh-remote". Some platform temporary areas may also be writable.

Approval prompts are enabled in this ses
```

## 请求日志

| 方法 | 路径 | 状态 | 耗时(ms) |
|---|---|---|---|
| POST | `/v1/pair` | 200 | 65 |
| GET | `/v1/host` | 200 | 3 |
| GET | `/v1/sessions?limit=30` | 200 | 20 |
| POST | `/v1/sessions` | 200 | 15 |
| GET | `/v1/sessions/session-a2ab37c9-0147-4db9-8927-bdaeb6ffab06` | 200 | 21 |
| GET | `/v1/models` | 200 | 328 |
| POST | `/v1/sessions/session-a2ab37c9-0147-4db9-8927-bdaeb6ffab06/open` | 200 | 22 |
| POST | `/v1/sessions/session-a2ab37c9-0147-4db9-8927-bdaeb6ffab06/prompt` | 200 | 9 |
| GET | `/v1/sessions/session-a2ab37c9-0147-4db9-8927-bdaeb6ffab06` | 200 | 130 |
| POST | `/v1/sessions/session-a2ab37c9-0147-4db9-8927-bdaeb6ffab06/prompt` | 200 | 100 |
| GET | `/v1/sessions/session-a2ab37c9-0147-4db9-8927-bdaeb6ffab06` | 200 | 443 |
| POST | `/v1/sessions/session-a2ab37c9-0147-4db9-8927-bdaeb6ffab06/cancel` | 200 | 9 |
| GET | `/v1/sessions/session-a2ab37c9-0147-4db9-8927-bdaeb6ffab06` | 200 | 211 |
| POST | `/v1/sessions/session-a2ab37c9-0147-4db9-8927-bdaeb6ffab06/open` | 200 | 179 |
| POST | `/v1/sessions/session-a2ab37c9-0147-4db9-8927-bdaeb6ffab06/rename` | 200 | 8 |
| GET | `/v1/sessions/session-a2ab37c9-0147-4db9-8927-bdaeb6ffab06/history?maxMessages=20` | 200 | 20 |
| GET | `/v1/devices` | 200 | 6 |
| GET | `/v1/devices` | 200 | 2 |
| DELETE | `/v1/devices/c803f280-d999-417f-935f-4112a11f95b1` | 200 | 9 |
| GET | `/v1/sessions` | 401 | 7 |

## 复现命令

```bat
D:\NVM\nodejs\node.exe D:\Code\dsh-remote\tools\verify\run-e2e.mjs --url http://127.0.0.1:8790 --dsh-home D:\Code\dsh-remote\.testhome --json-out tools\verify\.e2e-report.json --report docs\verification\e2e-report.md
```
