# 手机与桌面项目归属一致性修复

手机此前仅按工作目录分组，插件创建请求也只向 DSH 传 `cwd`。DSH 0.2.2-rc.1 的 `sessionController.create` 只有收到 `workspaceId` 才会调用项目的 `attachSession`，因此两端显示不一致。

## 实现

- 手机按插件返回的真实 Workspace ID、标题与路径分组；明确的空 ID 合入“未分组”，保留旧插件缺少字段时的兼容行为。
- 项目内新建直接发送 Workspace ID。插件同时将旧手机发送的目录解析为已有项目 ID，避免旧 APK 继续创建错组会话。
- 不自动注册新项目；读取目录或注册表失败时返回错误，不静默降级创建一条未分组会话。
- 手机版本 0.1.11 / versionCode 11，插件版本 0.1.9。

## 验证

- App 126 项测试、插件 94 项测试通过，失败与跳过为 0；App TypeScript、Expo lint 和导出通过。
- 使用本机实际安装的 DSH 0.2.2-rc.1 启动独立 web 宿主，数据位于 `D:/Code/dsh-remote.testhome/project-grouping/host`。验证旧目录创建、显式 ID 创建均进入真实 Workspace；迁移样本也可加载并显示正确项目。
- 最终 APK release 构建及签名验证通过，内置 Hermes bundle 与本轮最终 Expo 导出 SHA-256 一致，包含 arm64-v8a、x86_64。
- 最终 APK：`dist/dsh-remote-0.1.11-release.apk`，SHA-256 `404D2B70F3437D6A708AEAF42E462DC50B817A885057EBBDC96451C0361C135C`。
- 插件分发包：`dist/dsh-remote-harness-0.1.9.tgz`。

## 历史迁移验证

在明确授权和完整备份后，将三条历史主会话归入目标项目。跨目录迁移仅调整目录元数据与项目归属，逐条校验原始事件一致，保留会话 ID 和消息历史。实时接口和桌面界面均确认项目归属与消息正常，其他项目和子智能体未迁移。运行数据与备份保留在隔离测试目录，不随源码分发。
