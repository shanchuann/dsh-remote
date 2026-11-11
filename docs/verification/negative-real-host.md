# DSH Remote 负向 / 协议契约测试报告

- 生成时间：2026-11-11T11:11:36.706Z（本地 2026/11/11 19:11:36）
- 目标：真实 DSH 宿主 http://127.0.0.1:8790
- 命令：`D:\NVM\nodejs\node.exe D:\Code\dsh-remote\tools\verify\run-negative.mjs --url http://127.0.0.1:8790 --dsh-home D:\Code\dsh-remote\.testhome --skip-lockout --json tools\verify\.negative-real-host.json --report docs\verification\negative-real-host.md`
- 环境：node v24.9.0 / win32 x64
- 耗时：13.5 s
- 结果：**PASS** — pass 36 / fail 0 / warn 0 / skip 2

## 用例结果

| # | 用例 | 结果 | 耗时(ms) | 说明 |
|---|---|---|---|---|
| 1 | `health.public` | ✅ PASS | 8 | {"hostId":"9926a229-b090-422b-be40-076e65b1136b","pluginVersion":"0.1.0","dshVersion":"0.2.2-rc.1","pairingRequired":false} |
| 2 | `host.shape-and-no-token-leak` | ✅ PASS | 6 | {"hostId":"9926a229-b090-422b-be40-076e65b1136b","capabilities":{"assistantStream":true,"approvals":true,"models":true,"problemQuestions":false,"attachments"... |
| 3 | `sessions.list.shape` | ✅ PASS | 92 | {"count":16,"nextCursor":null} |
| 4 | `session.detail.shape` | ✅ PASS | 161 | {"title":null,"state":{"cursor":2,"active":true,"running":false,"queue":[],"pendingInput":[]},"hasProjections":true} |
| 5 | `history.shape-ascending` | ✅ PASS | 8 | {"count":3,"hasMore":false,"cursor":2} |
| 6 | `devices.shape-no-token` | ✅ PASS | 6 | {"count":13} |
| 7 | `models.catalog.shape` | ✅ PASS | 7 | {"groups":2,"providers":2} |
| 8 | `auth.missing-token-401` | ✅ PASS | 4 | {"status":401,"code":"unauthorized"} |
| 9 | `auth.bad-token-401` | ✅ PASS | 2 | {"status":401,"code":"unauthorized"} |
| 10 | `auth.sse-bad-token-401` | ✅ PASS | 5 | {"status":401,"code":"unauthorized"} |
| 11 | `auth.sse-query-token-only` | ✅ PASS | 12 | {"protocol":1} |
| 12 | `json.malformed-prompt` | ✅ PASS | 4 | {"status":400,"code":"invalid-argument"} |
| 13 | `json.malformed-open` | ✅ PASS | 5 | {"status":400,"code":"invalid-argument"} |
| 14 | `body.too-large-rejected` | ✅ PASS | 139 | {"status":413,"sentBytes":26214490} |
| 15 | `prompt.content-empty-rejected` | ✅ PASS | 639 | {"status":400,"code":"invalid-argument"} |
| 16 | `prompt.text-not-string-rejected` | ✅ PASS | 4 | {"status":400,"code":"invalid-argument"} |
| 17 | `prompt.mode-invalid-rejected` | ✅ PASS | 4 | {"status":400,"code":"invalid-argument"} |
| 18 | `session.unknown-get-404` | ✅ PASS | 233 | {"status":404,"code":"session-not-found"} |
| 19 | `session.unknown-prompt-404` | ✅ PASS | 96 | {"status":404,"code":"session-not-found"} |
| 20 | `session.unknown-open-404` | ✅ PASS | 261 | {"status":404,"code":"session-not-found"} |
| 21 | `session.unknown-cancel-404` | ✅ PASS | 13 | {"status":404,"code":"session-not-found"} |
| 22 | `prompt.invalid-timezone-400` | ✅ PASS | 46 | {"status":400,"code":"invalid-argument","utcStatus":200} |
| 23 | `model.unknown-provider-400` | ✅ PASS | 79 | {"status":400,"code":"invalid-argument"} |
| 24 | `approval.unknown-410` | ✅ PASS | 4 | {"status":410,"code":"approval-gone"} |
| 25 | `route.unknown-404-envelope` | ✅ PASS | 3 | {"status":404,"code":"invalid-argument"} |
| 26 | `method.not-allowed-envelope` | ✅ PASS | 2 | {"status":405,"code":"invalid-argument"} |
| 27 | `sse.hello-shape` | ✅ PASS | 5 | {"protocol":1,"subscriptions":0} |
| 28 | `sse.snapshot-on-open` | ✅ PASS | 147 | {"subscriptionId":"sub_c199b76a677cd7b34f68b112","records":7} |
| 29 | `sse.connection-replaced` | ✅ PASS | 35 | {"replacedPayload":{"reason":"replaced"}} |
| 30 | `sse.heartbeat-ping` | ✅ PASS | 5536 | {"intervalHintMs":20000,"pingAt":"2026-11-11T11:11:31.151Z"} |
| 31 | `session.close-idempotent` | ✅ PASS | 28 | {"first":{"closed":true},"second":{"closed":true}} |
| 32 | `cancel.idle-idempotent` | ✅ PASS | 92 | {"accepted":true} |
| 33 | `prompt.idempotent-requestId` | ✅ PASS | 5250 | {"requestId":"640cd0b6-8a6b-4dea-91a3-c8dd033a2b5d","userMessageEvents":1} |
| 34 | `prompt.unknown-fields-tolerated` | ✅ PASS | 15 | {"status":200,"requestId":"2a13522a-fd0c-4f31-a73a-50c449f63fe4"} |
| 35 | `device.revoke-invalidates-token` | ✅ PASS | 125 | {"victimDeviceId":"5cc1dc4e-202d-4e8a-8748-907e78a50899","revokedStatus":401} |
| 36 | `pair.wrong-code-401` | ✅ PASS | 44 | {"status":401,"code":"pairing-invalid"} |
| 37 | `pair.lockout-429` | ⏭️ SKIP | 0 | --skip-lockout |
| 38 | `rate.limit-429` | ⏭️ SKIP | 0 | mock-only test |

## 说明

- 断言目标为 docs/protocol.md（协议 v1）语义；mock 为一比一参考实现，真实宿主结果以本表为准。
- 错误响应必须为 { error: { code, message } } 且 code 在协议错误码表内；本套件同时断言错误响应不泄露堆栈。
- 超大体按实现允许 400/413/414/431，但若返回 JSON 错误体则 code 必须为 invalid-argument。
- pair.lockout-429 会锁定配对 5 分钟：真实宿主默认跳过（--skip-lockout），mock 默认执行。
- device.revoke-invalidates-token 需要第二个配对码（mock 自动取轮换后的 code；真实宿主用 --code2）。

## 复现命令

```bat
D:\NVM\nodejs\node.exe D:\Code\dsh-remote\tools\verify\run-negative.mjs --url http://127.0.0.1:8790 --dsh-home D:\Code\dsh-remote\.testhome --skip-lockout --json tools\verify\.negative-real-host.json --report docs\verification\negative-real-host.md
```
