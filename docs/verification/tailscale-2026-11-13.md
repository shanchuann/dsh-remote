# Tailscale 迁移验证（2026-11-13）

## 本轮改动

- 删除 Cloudflare 子进程管理、配置解析及对应测试；旧 `cloudflare` / `publicUrl` 配置被忽略，不再启动隧道。
- 从系统 IPv4 网卡发现 Tailscale，配对二维码优先使用 Tailscale 地址，可识别的物理局域网地址作为备用。排除虚拟网卡作为备用地址。
- 健康检查、Host、桌面设置页和配对文件使用 `tailscaleUrl`；移除旧 `publicUrl` / `tunnel` 字段。
- 更新手机连接提示、README、插件说明、架构、协议和远程连接迁移文档。

## 验证结果

| 检查 | 结果 |
|---|---|
| `node plugin/test/run-all.mjs` | 99 项通过，0 失败 |
| 最后补充虚拟网卡过滤后的 Tailscale / QR 定向复验 | 11 项通过，0 失败 |
| App `npm test` | 147 项通过，0 失败 |
| App `npm run typecheck` | 通过 |
| App `npm run lint` | 通过 |
| Host 入口、桌面客户端 JS 语法检查 | 通过 |
| 本机实际网卡发现 | 正确识别 Tailscale 主地址及 WLAN 备用地址 |
| `git -c core.whitespace=cr-at-eol diff --check` | 通过 |

新增测试覆盖 Tailscale 主地址选择、LAN 备用、虚拟网卡排除、LAN 单独配对、普通 CGNAT 不误识别、网卡 IPv4/IPv6 与范围边界、旧隧道配置失效，以及 HTTP 响应、设置状态、二维码和磁盘配对文件的一致性。

## 范围

HTTP 集成测试使用隔离的临时数据目录、随机端口和 FakeBridge，不会调用付费模型。用户已确认现有手机通过手动填写 Tailscale 地址连接成功。后续已将 Host 插件更新到本机 DSH，详见下节；手机提示文案仍需新 App 构建才生效，未将新版手机流式聊天计为已复验。

## 本机 DSH 插件更新

- 离线包：`dist/dsh-remote-harness-0.1.16.tgz`，SHA-256 为 `caee28755ca43c4bc987a66e9edcf3288b14e8ceacef13dabb8682f4700c572a`。
- 使用 DSH 桌面「插件 → 添加插件 → 安装第三方插件」更新已有组合包；界面确认已安装 0.1.16，服务热加载成功，无需重启整台应用。CLI 拒绝操作 Electron 独占的 desktop profile，因此未直接运行 pnpm 修改依赖。
- desktop profile 依赖已指向新的离线包，原组合包启用项保留。
- 删除 profile 中 dsh-remote 的旧 Cloudflare 配置块，保留端口 8790，明确监听 `0.0.0.0`；其他插件配置保留。修改前备份位于 `C:/Users/15375/.dsh/backups/dsh-remote-tailscale-20261113-124649/`。
- 实际 Tailscale IP 的 `/v1/health` 返回 `ok: true`、`pluginVersion: 0.1.16`、有效的 `tailscaleUrl`，不再包含 `publicUrl` / `tunnel`。
- 安装时旧插件释放了 Cloudflare 子进程；更新后检查未发现运行中的 `cloudflared.exe`。
