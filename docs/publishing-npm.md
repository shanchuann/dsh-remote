# npm 发布与 DSH 插件页更新

包名：`dsh-remote-harness`，源码目录：`plugin/`。

## 更新检测条件

DSH 支持第三方 npm 包的版本检测与更新。profile 必须将插件保存为 npm registry 依赖，例如 `"dsh-remote-harness": "0.1.16"`；包需要合法的 semver 版本号、同名 `name` 和 `dsh.bundle` 声明。本包使用 DSH 的更新机制，无需额外实现检查器。

通过 `.tgz`、`file:`、`link:`、Git 或脚本复制方式安装的插件，不参与 npm 更新检测。npm 上存在高于已安装版本的新版本时，插件页才有可选更新；每次发布必须递增版本号。

迁移离线版本前，先查询 npm 官方源，确认它已经提供当前所需版本。Host 插件 0.1.16 开始使用 Tailscale；不要安装缺少该功能的旧版。

## 发布前检查

在仓库根目录运行：

```bash
node plugin/test/run-all.mjs
npm pack ./plugin --dry-run
cd plugin
npm publish --dry-run --access public --registry https://registry.npmjs.org/
```

确认包只包含预期源码、桌面客户端、配对资源、脚本、许可证与说明，不包含 profile、设备或 npm 凭据。`--dry-run` 成功不证明发布权限有效。

## README 与示例图片

仓库首页使用根目录 `README.md`，npm 包页面使用 `plugin/README.md`。两份 README 共用 `docs/screenshots/` 下的连接页、项目列表、对话输入和语音设置图片，操作说明位于[界面示例](screenshots.md)。

仓库文档使用相对路径；npm README 使用 `https://raw.githubusercontent.com/shanchuann/dsh-remote/main/docs/screenshots/` 下的完整图片地址。先提交并推送图片与文档，确认公开地址可访问，再打包发布。图片不需要重复放入 npm 包。

修改本地 README 不会更新已发布的 npm 页面。需要以新版本发布包含修改的 `plugin/README.md`；已发布版本不能覆盖。

## 发布

正式发布会向 npm 写入公开版本。由有该包发布权限的维护者在自己的终端完成登录：

```bash
npm login --registry https://registry.npmjs.org/
```

然后在 `plugin/` 目录发布；根据 npm 提示由本人完成 2FA：

```bash
npm whoami --registry https://registry.npmjs.org/
npm publish --access public --registry https://registry.npmjs.org/
npm view dsh-remote-harness version --registry https://registry.npmjs.org/
```

也可发布已经检查过的离线包。在仓库根目录运行：

```bash
npm pack ./plugin --pack-destination ./dist
npm publish ./dist/dsh-remote-harness-0.1.16.tgz --access public --registry https://registry.npmjs.org/
```

文件名应与 `plugin/package.json` 中的实际版本一致。

若返回 `E403`，并提示必须启用双因素认证或使用允许绕过 2FA 的细粒度令牌，登录成功仍不足以发布。可在 npm 账号设置中启用 2FA，并按发布流程完成验证；自动发布使用具有目标包写入权限的细粒度令牌时，还需满足相应的 2FA 条件。账号设置与认证由维护者本人完成。

令牌通过本机凭据配置或 CI secret 提供，不写入源码、README、截图或发布日志。认证要求见 [npm 双因素认证说明](https://docs.npmjs.com/configuring-two-factor-authentication/)。

仓库也提供 `.github/workflows/publish-npm.yml`，支持 tag 和手动触发。使用前需在 npm 的 Trusted publishers 配置实际仓库 `shanchuann/dsh-remote` 和工作流 `publish-npm.yml`，并核对该工作流的 npm OIDC 发布环境要求。工作流文件存在不代表 npm 端已经授权；未验证前不要把它当作可用发布凭据。

## 从当前离线包迁移

1. 确认 npm 官方源已经提供 0.1.16 或更高的所需版本。
2. 在 **DSH → 插件 → 添加插件 → 安装第三方插件** 输入 `dsh-remote-harness@0.1.16`（或实际已发布的新版本），选择 npm 官方源。安装目标必须是包名和版本，不再填写本地 `.tgz` 路径。
3. 检查 profile 中该依赖已是 registry 版本、组合包仍启用，再用 `/v1/health` 的 `pluginVersion` 核对实际运行版本。原配对设备数据继续保存在插件数据目录。
4. 刷新插件页面并查看插件详情。后续 npm 发布更高版本时，可在页面选择版本并更新；支持热加载时即时生效，否则按 DSH 提示重启。

Electron 独占管理的 desktop profile 不允许用 `dsh plugin --profile desktop add ...` 修改依赖，应使用桌面插件管理界面。不要仅手改依赖字符串：必须实际安装并核对运行版本。镜像源可能延迟同步，查不到新版本时优先使用 npm 官方源复核。
