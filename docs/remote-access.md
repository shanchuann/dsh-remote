# 远程访问（不在同一局域网）

DSH Remote 的插件与 App 只依赖 **手机能访问到 `/v1/...`**，因此公网访问有三种成熟做法。插件自 **0.1.3** 起内置 **Cloudflare Tunnel** 支持，无需额外脚本。

## 1. Cloudflare Tunnel（插件内置，推荐）

需要电脑上安装 [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)（Windows：下载 `cloudflared-windows-amd64.exe`），然后在 profile 的 `cordis.patch.yml` 里给插件加配置：

### 快速隧道（零配置，随机公网地址）

```yaml
- id: dsh-remote
  config:
    port: 8790
    cloudflare:
      enabled: true
      mode: quick
      # 可选：cloudflared 不在 PATH 时指定绝对路径
      # binPath: "C:\\Tools\\cloudflared.exe"
```

重启 DSH 后：

- `/v1/health`、`/v1/host` 返回 `publicUrl`（`https://<random>.trycloudflare.com`）与 `tunnel` 状态
- 配对页 <http://127.0.0.1:8790/pair> 出现「公网访问」卡片与第二个二维码
- 手机用公网二维码配对后，即使不在同一 Wi-Fi 也能连接

> quick 模式每次重启 URL 会变；长期使用建议命名隧道。

### 命名隧道（固定域名 + Cloudflare 账号）

先在 Cloudflare 控制台创建 Tunnel、配置 Public Hostname（如 `dsh.example.com` → `http://127.0.0.1:8790`），取得 tunnel token：

```yaml
- id: dsh-remote
  config:
    port: 8790
    cloudflare:
      enabled: true
      mode: named
      token: "eyJhIjoi..."          # 建议用环境变量/credentials，不要提交
      hostname: "dsh.example.com"
```

插件会以 `cloudflared tunnel run` 启动，公网地址即 `https://dsh.example.com`。建议再加 **Cloudflare Access**（邮箱/OTP/SSO）作为最外层认证。

## 2. 静态公网地址（Caddy / Nginx / 其他隧道）

如果你已经有反向代理或别的隧道（frp、Tailscale Funnel、ngrok…），只需告诉插件公网根地址：

```yaml
- id: dsh-remote
  config:
    port: 8790
    publicUrl: "https://dsh.example.com"
```

插件不会启动 cloudflared，只把这个地址展示在配对页/健康检查中，供手机扫码或手动填写。

反向代理需要支持 **SSE**：关闭响应缓冲、读超时设长（Caddy 默认即可；Nginx 需 `proxy_buffering off; proxy_read_timeout 3600s;`）。

## 3. Tailscale / ZeroTier（不暴露公网，最安全）

电脑与手机加入同一虚拟局域网后，用 Tailscale 分配的 `100.x.y.z` 地址访问 8790：

```
http://100.x.y.z:8790
```

配对页会把所有网卡地址列出（含 Tailscale 的 100.x），也可以手动输入。无需 TLS、无需服务器、无需改插件。

## 安全建议

DSH Agent 能在电脑上执行命令，**公网入口等于远程执行入口**：

1. 公网必须 HTTPS（Cloudflare Tunnel 自带；自建反代用 Caddy 自动证书）。
2. 配对完成后建议关闭新配对：在 profile 里把插件配置加 `allowNewPairings: false`（后续版本）或只保留已配对 token；当前可临时改端口/关隧道。
3. 最外层加 Cloudflare Access / SSO，或改用 Tailscale。
4. 保持 DSH 审批策略为 `ask`，不要公网环境用 `never`。
5. 定期在 App 设置里撤销不用的设备，不用时关闭隧道。

## 桌面入口

插件 0.1.3 起会向 DSH Web UI 注入一个右下角 **「远程控制」** 浮动按钮（通过 `webserver/index-inject`），点击直接打开本机配对页（QR + 配对码 + 公网地址）。桌面窗口与浏览器访问的 Web UI 都会出现；不需要运行任何脚本。
