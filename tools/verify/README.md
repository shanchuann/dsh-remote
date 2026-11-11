# tools/verify — DSH Remote 协议 v1 独立验证工具

验证者（verifier）拥有的黑盒测试工具。**只依赖 Node >= 18 内置能力**（fetch/WebStreams），不导入 `plugin/**` 代码；
协议客户端完全按 `docs/protocol.md` 独立实现，用于发现实现与契约的偏差。

## 文件

| 文件 | 用途 |
|---|---|
| `protocol-client.mjs` | 协议 v1 独立客户端库 + CLI；手写 SSE 解析器（CRLF/LF/CR、跨 chunk、多行 data、注释、BOM、id/retry） |
| `mock-server.mjs` | 按协议 v1 实现的参考 mock 宿主（配对/锁定、鉴权、会话、历史、SSE 快照/心跳/连接替换、prompt 模拟流、cancel、审批 410、设备撤销、限流） |
| `test-sse-parser.mjs` | SSE 解析器单元测试（无网络，16 用例） |
| `run-negative.mjs` | 负向 / 协议契约测试套件（37 用例），输出 JSON + markdown；支持 `--pairing-json/--dsh-home` 自动读取轮换配对码 |
| `run-e2e.mjs` | 端到端矩阵（24 断言）：真实宿主（复用或启动）+ 配对 + SSE + prompt 流 + cancel + 重连 + 设备撤销 |
| `verify-apk.mjs` | APK 校验：包名/启动 Activity/清单文件/dex/mipmap 图标哈希，并提取图标供目检 |
| `run-emulator-check.mjs` | adb 安装 APK → 启动 → 截图 → 检查 pid/resumed activity/logcat 崩溃 |
| `probe-error-mapping.mjs` | 错误映射探针：未知 provider/model、未知 session 的 rename/history 错误码观察 |

## 常用命令

```bat
:: 0) SSE 解析器单测
node tools\verify\test-sse-parser.mjs

:: 1) 负向套件，对内置 mock（无需真实宿主）
node tools\verify\run-negative.mjs --mock
node tools\verify\run-negative.mjs --mock --include-rate-limit

:: 2) 负向套件，对真实宿主（隔离 DSH_HOME）
node tools\verify\run-negative.mjs --url http://127.0.0.1:8790 --code 123456 --skip-lockout

:: 3) 端到端矩阵（复用 Lead 启动的宿主；pairing.json 可自动读 code/port）
node tools\verify\run-e2e.mjs --url http://127.0.0.1:8790 --code 123456
node tools\verify\run-e2e.mjs --dsh-home D:\Code\dsh-remote\.testhome --pairing-json D:\Code\dsh-remote\.testhome\plugins\dsh-remote\pairing.json

:: 4) 自己启动宿主再跑 e2e（可选；默认 kill-on-exit）
node tools\verify\run-e2e.mjs --start-cmd "pnpm dsh web" --dsh-home D:\Code\dsh-remote\.testhome --url http://127.0.0.1:8790

:: 5) 协议客户端 CLI 冒烟（pair -> host -> sessions -> open -> prompt -> 流 -> cancel -> devices）
node tools\verify\protocol-client.mjs --url http://127.0.0.1:8790 --code 123456

:: 6) APK 校验（包名/入口/图标/内容）
node tools\verify\verify-apk.mjs --apk app\android\app\build\outputs\apk\release\app-release.apk

:: 7) 模拟器安装 + 启动 + 截图 + logcat（默认 emulator-5554）
node tools\verify\run-emulator-check.mjs --serial emulator-5554

:: 8) 错误映射探针（会配对临时设备并自动删除）
node tools\verify\probe-error-mapping.mjs
```

## 输出

- `docs/verification/negative-report.md`：负向套件对 mock 的报告（JSON 在 `tools/verify/.negative-report.json`）
- `docs/verification/negative-real-host.md`：负向套件对真实宿主的报告（JSON 在 `tools/verify/.negative-real-host.json`）
- `docs/verification/e2e-report.md`：真实宿主端到端矩阵报告（JSON 在 `tools/verify/.e2e-report.json`）
- `docs/verification/app-build-report.md` / `app-emulator-report.md`：APK 校验 / 模拟器安装启动截图报告
- `docs/verification/app-protocol-review.md` / `app-static-check.md`：App 协议复核 / TS+单测静态检查
- 失败时退出码为 1；`--json-out`、`--report` 可指定输出路径。

## 约定

- 不修改 `plugin/**`、`app/**`、`docs/protocol.md`；发现实现 bug 以「复现命令 + 期望 + 实际」报告给实现者与 Lead。
- 真实宿主测试使用隔离 `DSH_HOME=D:\Code\dsh-remote\.testhome` 与独立端口，不干扰用户桌面 DSH（127.0.0.1:62129）。
- `pair.lockout-429` 会锁定配对 5 分钟：真实宿主请加 `--skip-lockout`；mock 默认执行。
- `device.revoke-invalidates-token`（负向）需要第二个配对码：mock 自动取轮换后的 code，真实宿主用 `--code2` 或跳过；
  e2e 最后一律执行「撤销当前设备 -> 后续请求 401」，会主动作废本次 token。
