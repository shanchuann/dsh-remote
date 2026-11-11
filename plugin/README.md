# dsh-remote-harness

**LAN remote access for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — the Host side of [DSH Remote](https://github.com/shanchuann/dsh-remote-).**

A paired Android phone gets the session list, live streaming chat, tool calls, approvals, and model selection over plain HTTP/1.1 + JSON + SSE.

- **Zero runtime dependencies** — only `node:` builtins plus one vendored MIT QR encoder.
- **Runs in-process** in DSH: calls `ctx.sessionController.follow/prompt/cancel/...`, the same business logic the official Web client uses.
- **Security-first pairing** — one-time 6-digit code (10 min TTL, rotates on success), device tokens stored as SHA-256, revocable per device.

<p align="center">
  <img src="https://raw.githubusercontent.com/shanchuann/dsh-remote-/main/docs/verification/screenshots/black-01-connect.png" width="260" alt="会话列表" />
  <img src="https://raw.githubusercontent.com/shanchuann/dsh-remote-/main/docs/verification/screenshots/36-progress.png" width="260" alt="流式与工具卡" />
</p>

## 安装

### 1) 在 DSH 桌面里安装（推荐）

DSH → **插件 → 添加插件** → 输入 `dsh-remote-harness`。本包声明了 `dsh.bundle` 与 `dsh.client`：安装后随 DSH 启动自动加载，并在 **设置 → 远程控制** 提供二维码/配对码/设备列表页面（4 秒自动刷新）。

或在命令行安装：

```bash
dsh plugin --profile desktop add dsh-remote-harness
```

### 2) 或用自带安装脚本（复制到 `<DSH_HOME>/plugins/dsh-remote` 并自动打 patch）

```bash
npx dsh-remote-install            # dry-run（默认）
npx dsh-remote-install --yes      # 应用
npx dsh-remote-uninstall --yes    # 卸载
```

重启 DSH（或等待配置热加载）后：

- 日志出现 `dsh remote: http://<LAN-IP>:8790 (pair code 123456)`
- 配对信息：`<DSH_HOME>/plugins/dsh-remote/pairing.json` / `pairing.png` / `pairing.txt`
- 电脑浏览器打开 **http://127.0.0.1:8790/pair** 看二维码与配对码

```bash
npx dsh-remote-pair --home ~/.dsh      # 终端里打印配对信息 / 二维码
```

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `port` | `8790` | 局域网监听端口；`0` 表示随机空闲端口 |
| `host` | `0.0.0.0` | 绑定地址 |
| `pairingTtlMs` | `600000` | 配对码有效期（10 分钟） |
| `deviceTtlDays` | `30` | 设备 token 有效期 |
| `logLevel` | `info` | `debug` / `info` / `warn` / `error` / `silent` |
| `cloudflare` | 关 | `{ enabled: true, mode: "quick" }` 或 `{ mode: "named", token, hostname }` |
| `publicUrl` | 无 | 静态公网根地址（Caddy/Nginx/其他隧道） |
| `uiEntry` | `true` | 是否在 DSH Web UI 注入「远程控制」浮动按钮 |

## 中小规模远程访问

```yaml
- id: dsh-remote
  config:
    port: 8790
    cloudflare:
      enabled: true
      mode: quick
```

`/v1/health` 返回 `publicUrl` 与 `tunnel` 状态；配对页展示公网地址与二维码。详见仓库 `docs/remote-access.md`。

## 接口

HTTP/JSON + SSE（`GET /v1/events`）。端点：pair、devices、sessions（list/create/detail/history）、open/close、prompt、cancel、rename、model、models、approvals。完整协议（含真实抓包）见仓库 [docs/protocol.md](https://github.com/shanchuann/dsh-remote-/blob/main/docs/protocol.md)。

## 测试

```bash
npm test        # 80 个 node:test 用例
```

真实 DSH 0.2.2-rc.1 宿主上的 e2e 24/24、负向 36 PASS，App 端单测 94/94。

## License

[MIT](./LICENSE) © shanchuann