# 发布到 npm

包名：**`dsh-remote-harness`**（目录 [`plugin/`](../plugin/)）· 当前版本 **0.1.0** 已发布：<https://www.npmjs.com/package/dsh-remote-harness>。

## 发布前检查（无需登录）

```bash
cd plugin
node test/run-all.mjs      # 80 个用例
npm pack --dry-run         # 查看将发布的 28 个文件（约 58 KB）
npm publish --dry-run      # 校验包元数据与 registry 可达
```

## 发布

```bash
npm login                  # 在浏览器完成登录（或 npm adduser）
cd plugin
npm publish --access public
```

> 想改成自己的 scope（如 `@you/dsh-remote`）：修改 `plugin/package.json` 的 `name`，
> 然后 `npm publish --access public`。scope 必须是你的 npm 账号名。

## 通过 GitHub Actions 发布（推荐，可复现）

仓库已带 [`.github/workflows/publish-npm.yml`](../.github/workflows/publish-npm.yml)：

1. 在 GitHub 仓库 **Settings → Secrets and variables → Actions** 添加 `NPM_TOKEN`（npm 的 Automation token，类型选 *Automation*，绕过 2FA）；
2. 打 tag 触发：

```bash
git tag v0.1.0
git push origin v0.1.0
```

工作流会先跑 80 个单测，再 `npm publish --access public --provenance`（带 Supply Chain 证明）。

## 安装（发布后）

```bash
dsh plugin --profile desktop add dsh-remote-harness
```

然后在 `~/.dsh/profiles/desktop/cordis.patch.yml` 的 `insert` 列表加入：

```yaml
- insert:
    - id: dsh-remote
      name: "dsh-remote-harness"
      config:
        port: 8790
```

或继续用仓库内的一键安装脚本：

```bash
node plugin/scripts/install.mjs --yes
```

## 包内容

`src/`（Cordis 入口、DSH bridge、net/auth/pairing/state）、`scripts/`（install / uninstall / pair CLI）、`vendor/qrcode`（MIT）、README、LICENSE。
运行时零依赖，因此不需要 `dependencies`，安装很快。