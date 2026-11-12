# 2026-11-12 迭代收尾

本轮在项目分组、重连布局、连接页文案、子智能体入口和六类 BeautifulUI 原生适配的基础上，继续修复旧协议复核记录中的遗留项。

| 遗留问题 | 当前处理 |
|---|---|
| 工作目录变化未消费 | 快照及 `working-directory/change` 同步聊天标题下的路径与项目列表；标题和模型事件同步列表行 |
| 历史分页入口与边界 | 页面已有入口；修正从最早已显示消息向前翻页，按包含式边界减一，不再用实时游标重读当前页 |
| 切换会话时异步请求串页 | 打开详情、关闭订阅和历史分页按会话代次判断；晚到的旧请求不能覆盖新对话或同名重开的对话 |
| 首次打开未读取 active 状态 | 读取会话详情中的当前 active/running 状态，再打开实时订阅 |
| 状态帧省略字段会改写旧值 | 缺省 running/active 保留原状态；结束状态先刷入最后一批已缓冲文字，再停止流式标记 |
| 请求超时不含响应体 | REST 与配对共用完整请求期限，覆盖响应头及响应体；半开连接也会结束等待 |
| 失效凭据重复恢复 | HTTP 401/403 立即转为认证失效；清除 token 与内存副本、停止实时连接、提示重新配对；保留地址和设备名称便于重配 |
| 实时订阅关闭被忽略 | 意外关闭清理 loading/running/流式动画并保留文字、提示重开；正常替换和主动关闭不误报 |
| 退避时间超过 30 秒 | jitter 计算后再次限制为最大 30 秒 |
| 公网备用地址被连接页漏传 | 深链、扫码、粘贴 URI 都保留备用地址；自动配对等待旧恢复流程结束，避免两个连接流程竞争 |
| 错误地址路径和 IPv6 | 拒绝不受支持的任意路径，保留 `/v1`、`/pair` 容错；修正 IPv6 重复方括号 |
| 审批完成仍留在全局队列 | REST 成功或 approval-gone 同时移除全局及当前队列；再次打开不会复现已处理卡片；兼容历史 allowed-once 结果 |
| 后台操作返回污染当前聊天 | 旧消息的失败提示及旧模型选择结果只更新所属对话 |

Android token 继续保存在 SecureStore。旧报告中 Web AsyncStorage 的备注属于浏览器开发兜底，与本次 Android APK 的凭据存储不同。

自动回归：App 122 项、插件 89 项通过。新增测试覆盖响应体挂起、401、30 秒退避上限、订阅关闭、历史边界、会话切换、晚到详情、状态帧与尾部增量、全局审批清理。类型检查、lint、`git diff --check` 和 Android 导出通过。

所有本轮测试数据、日志、独立服务和临时构建脚本位于 `D:/Code/dsh-remote.testhome/closure` 及其父目录，未使用真实桌面宿主或模型请求。

## APK 与模拟器复验

全新原生构建 `assembleRelease` 成功，版本 `0.1.9` / `versionCode 9`，包含 `arm64-v8a` 与 `x86_64`。APK v2 签名验证通过，包内 Hermes bundle 与本轮 Expo 导出 SHA-256 完全一致。安装至独立 Android 模拟器成功，最近 500 条日志中未见 ReactNativeJS / AndroidRuntime 错误。

| 场景 | 观察结果与证据 |
|---|---|
| 原有 token 已失效后启动 | 回到连接表单，显示重新配对提示，未停留在恢复状态；`closure/form.xml` |
| 手动重新配对 | 通过本地测试代理连接成功；`closure/04-projects.png` |
| 项目分组与子智能体过滤 | 2 条宿主记录中 1 条为子会话，列表显示 1 个项目、1 个主对话；展开项目后可进入主对话 |
| 延迟快照的加载界面 | 显示分层消息骨架，无可见“加载中”提示；`closure/05-skeleton.png`。动画节奏以此前 BeautifulUI 原生适配为准，本轮静态截图不单独证明运动效果 |
| 历史分页 | 当前最早 seq=100，请求 beforeSeq=99；97/98/99 插入原有 100/101/102 前，末页入口消失；`closure/06-history.png` |
| 子智能体切换 | 顶部入口打开子列表；进入子对话时跟随列表仅为 child，返回父对话后仅为 parent；`closure/07-child.png` |
| 工作目录变化 | 聊天标题下路径与项目列表均更新为 moved-project；`closure/08-directory.png`、`closure/10-moved-project.xml` |
| 意外订阅关闭 | 服务端订阅清空；已显示消息保留，提示“会话实时连接已关闭，请重新打开对话”；`closure/09-closed.xml` |

测试深链启动与强制重启截图命令被自动审批拒绝，返回理由为 `blocked by policy`。因此本轮未将备用地址深链的设备验证、冷启动恢复布局截图计为通过；备用地址传递与恢复流程竞争已修正源码，恢复 401 路径有自动回归及上述设备观察。公网隧道、真实手机、真实 DSH 和模型请求不在本轮隔离复验结论内。

## 构建记录与交付

本机 Gradle 调用 Metro 打包时退出码为 `-1073741819`。单独执行 `expo export --platform android --max-workers 2` 成功后，通过测试目录中的 Gradle init 脚本，将该 Hermes bundle 与按 Expo 导出校验过的原始资源交给完整原生构建。资源复制使用 React Native 自带的 saveAssets；未复用旧 APK 外壳。最终日志：`D:/Code/dsh-remote.testhome/build-019-final.log`。

- APK：`D:/Code/dsh-remote/dist/dsh-remote-0.1.9-release.apk`
- APK SHA-256：`048e038e65f91cb83b0e507bf7956688b0f6a38166fc54bc9c26baae7f7fd565`
- Hermes bundle SHA-256：`0ac5d80ea2f9fe87a2a9f0153a87053113cd565402d31ac1e9d738dd7cd14cbe`
- 插件本地包：`D:/Code/dsh-remote.testhome/closure/dsh-remote-harness-0.1.8.tgz`，保留现有版本号，未向 npm 发布或安装至真实宿主。

APK 沿用项目现有本地构建签名配置。本轮未提交 Git、发布或覆盖此前版本的安装包。
