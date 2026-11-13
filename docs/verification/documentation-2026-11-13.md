# 文档与界面示例更新（2026-11-13）

## 范围

根目录 README 与 npm 包 README 改用用户提供的四张带手机边框的 PNG，分别展示连接、项目列表、对话输入和本地语音设置。补充界面说明，修订系统架构、App 架构、构建、Tailscale 和 npm 发布文档，更新验证索引。历史测试截图保留原样。

文档按 humanizer-zh 的编辑原则修订，使用正式的技术表述，删除宣传性描述、过时的固定测试数量及与桌面端限制冲突的安装命令。

## 图片

四张图片均为 1286 × 2689，复制后字节与用户提供的原始文件一致。

| 文件 | SHA-256 |
|---|---|
| `docs/screenshots/connect.png` | `65cddf36812a28b9c1f94a00534d5b1ba7ea939e4a2155fc853ea783afdc7c5e` |
| `docs/screenshots/projects.png` | `c8428ba2e5b0732c0ff3830f47e932674ac6f0eec05f6b6cf7f9dc08646de964` |
| `docs/screenshots/chat.png` | `3065c77fe5277f51aeda9268b1c765d331aacdf39756ad408ad93eec95371a3d` |
| `docs/screenshots/voice-settings.png` | `318e8b6bf7cbefe6b2d640b80c811b093dc6006864db01363200a8b7c3a49c23` |

## 检查

- 九份入口文档中的 52 个本地引用均存在；npm README 的四张图片使用 GitHub 原始资源绝对地址。
- Host 插件测试 99 项通过，0 失败。
- npm 候选包的 README 与源码字节一致，包含四个示例图片地址。候选包共 31 个文件，未发现 npm 凭据特征或 `.npmrc`。
- `npm publish --dry-run` 通过，仅检查发布内容，未写入 npm registry。
- `git -c core.whitespace=cr-at-eol diff --check` 通过。

## npm 候选包

文件为 `dist/dsh-remote-harness-0.1.16.tgz`，大小 118557 字节，SHA-256 为 `ee148374728c649f8fd8263884460d60b8216db467100ee057ccc6207476c6f7`。本次重新打包纳入新 README；该文件与此前实际安装时记录的离线包哈希不同。

使用用户提供令牌进行认证的命令被自动审批拒绝，返回 `blocked by policy`，未执行该认证或正式发布。npm 页面仍需维护者在本机完成认证后发布候选包，不能将 dry-run 输出视为发布成功。

本次没有重新构建 APK，也没有根据截图中的会话正文认定其他构建或测试已经完成。

## 后续发布状态核验

同日再次查询 npm 官方源，确认 `dsh-remote-harness@0.1.16` 已存在且 `latest` 指向该版本。`dist.shasum` 为 `b473d14364f1a783a46e524ba4eb1c92882e4673`，`dist.integrity` 与本次候选包一致，说明已发布包含新 README 的包。该核验不代表本地令牌认证命令曾执行，也不代表 GitHub Actions 的 OIDC 授权已验证。

## 0.1.16 源码同步

同步前再次运行 Host 插件测试，99 项通过，0 失败。将 npm 官方源公布的 SHA-1 与本地候选包核对后，逐一比较包内 31 个文件，确认全部与本地 `plugin/` 源码字节一致。本次同步包含 Tailscale 迁移、已发布包内的消息分支与反馈接口，以及相应测试。App 侧其他未提交改动保留在本地。
