# DSH Remote 负向 / 协议契约测试报告

- 生成时间：2026-11-11T09:54:19.216Z（本地 2026/11/11 17:54:19）
- 目标：mock 参考宿主 http://127.0.0.1:65375
- 命令：`D:\NVM\nodejs\node.exe D:\Code\dsh-remote\tools\verify\run-negative.mjs --mock`
- 环境：node v24.9.0 / win32 x64
- 耗时：5.7 s
- 结果：**PASS** — pass 35 / fail 0 / warn 0 / skip 1

## 用例结果

| # | 用例 | 结果 | 耗时(ms) | 说明 |
|---|---|---|---|---|
| 1 | `health.public` | ✅ PASS | 2 | {"hostId":"cc9badd3-68d2-44b1-8e21-a70ed9696f15","pluginVersion":"0.1.0","dshVersion":"0.2.2-rc.1","pairingRequired":false} |
| 2 | `host.shape-and-no-token-leak` | ✅ PASS | 3 | {"hostId":"cc9badd3-68d2-44b1-8e21-a70ed9696f15","capabilities":{"assistantStream":true,"approvals":true,"models":true,"problemQuestions":false,"attachments"... |
| 3 | `sessions.list.shape` | ✅ PASS | 2 | {"count":2,"nextCursor":null} |
| 4 | `session.detail.shape` | ✅ PASS | 1 | {"title":"New session","state":{"active":true,"running":false,"queue":[],"pendingInput":[]},"hasProjections":true} |
| 5 | `history.shape-ascending` | ✅ PASS | 2 | {"count":0,"hasMore":false,"cursor":null} |
| 6 | `devices.shape-no-token` | ✅ PASS | 2 | {"count":1} |
| 7 | `models.catalog.shape` | ✅ PASS | 2 | {"groups":1,"providers":1} |
| 8 | `auth.missing-token-401` | ✅ PASS | 2 | {"status":401,"code":"unauthorized"} |
| 9 | `auth.bad-token-401` | ✅ PASS | 2 | {"status":401,"code":"unauthorized"} |
| 10 | `auth.sse-bad-token-401` | ✅ PASS | 1 | {"status":401,"code":"unauthorized"} |
| 11 | `auth.sse-query-token-only` | ✅ PASS | 5 | {"protocol":1} |
| 12 | `json.malformed-prompt` | ✅ PASS | 6 | {"status":400,"code":"invalid-argument"} |
| 13 | `json.malformed-open` | ✅ PASS | 1 | {"status":400,"code":"invalid-argument"} |
| 14 | `body.too-large-rejected` | ✅ PASS | 112 | {"status":413,"sentBytes":26214490} |
| 15 | `prompt.content-empty-rejected` | ✅ PASS | 1 | {"status":400,"code":"invalid-argument"} |
| 16 | `prompt.text-not-string-rejected` | ✅ PASS | 1 | {"status":400,"code":"invalid-argument"} |
| 17 | `prompt.mode-invalid-rejected` | ✅ PASS | 1 | {"status":400,"code":"invalid-argument"} |
| 18 | `session.unknown-get-404` | ✅ PASS | 1 | {"status":404,"code":"session-not-found"} |
| 19 | `session.unknown-prompt-404` | ✅ PASS | 2 | {"status":404,"code":"session-not-found"} |
| 20 | `session.unknown-open-404` | ✅ PASS | 1 | {"status":404,"code":"session-not-found"} |
| 21 | `session.unknown-cancel-404` | ✅ PASS | 1 | {"status":404,"code":"session-not-found"} |
| 22 | `approval.unknown-410` | ✅ PASS | 1 | {"status":410,"code":"approval-gone"} |
| 23 | `route.unknown-404-envelope` | ✅ PASS | 1 | {"status":404,"code":"invalid-argument"} |
| 24 | `method.not-allowed-envelope` | ✅ PASS | 1 | {"status":404,"code":"invalid-argument"} |
| 25 | `sse.hello-shape` | ✅ PASS | 2 | {"protocol":1,"subscriptions":0} |
| 26 | `sse.snapshot-on-open` | ✅ PASS | 7 | {"subscriptionId":"sub_bfce3c89-c19d-409a-a72f-c7a1f77daa38","records":0} |
| 27 | `sse.connection-replaced` | ✅ PASS | 54 | {"replacedPayload":{"reason":"new connection from same device"}} |
| 28 | `sse.heartbeat-ping` | ✅ PASS | 309 | {"intervalHintMs":20000,"pingAt":"2026-11-11T09:54:14.165Z"} |
| 29 | `session.close-idempotent` | ✅ PASS | 4 | {"first":{"closed":true},"second":{"closed":true}} |
| 30 | `cancel.idle-idempotent` | ✅ PASS | 3 | {"accepted":true} |
| 31 | `prompt.idempotent-requestId` | ✅ PASS | 5020 | {"requestId":"1d8a835b-b559-487d-88e1-ef3de055ae13","userMessageEvents":1} |
| 32 | `prompt.unknown-fields-tolerated` | ✅ PASS | 8 | {"status":200,"requestId":"3abe2b5b-c8b1-4bb7-82c4-27afb454ac31"} |
| 33 | `device.revoke-invalidates-token` | ✅ PASS | 8 | {"victimDeviceId":"fd2a8ced-247f-4c44-989a-ec1154d16ee1","revokedStatus":401} |
| 34 | `pair.wrong-code-401` | ✅ PASS | 2 | {"status":401,"code":"pairing-invalid"} |
| 35 | `pair.lockout-429` | ✅ PASS | 6 | {"status":429,"code":"pairing-locked"} |
| 36 | `rate.limit-429` | ⏭️ SKIP | 0 | --include-rate-limit not set |

## 说明

- 断言目标为 docs/protocol.md（协议 v1）语义；mock 为一比一参考实现，真实宿主结果以本表为准。
- 错误响应必须为 { error: { code, message } } 且 code 在协议错误码表内；本套件同时断言错误响应不泄露堆栈。
- 超大体按实现允许 400/413/414/431，但若返回 JSON 错误体则 code 必须为 invalid-argument。
- pair.lockout-429 会锁定配对 5 分钟：真实宿主默认跳过（--skip-lockout），mock 默认执行。
- device.revoke-invalidates-token 需要第二个配对码（mock 自动取轮换后的 code；真实宿主用 --code2）。

## 复现命令

```bat
D:\NVM\nodejs\node.exe D:\Code\dsh-remote\tools\verify\run-negative.mjs --mock
```
