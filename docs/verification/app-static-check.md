# DSH Remote App 静态检查记录（TypeScript / 单测）

- 时间：2026-11-11 18:12（Asia/Shanghai）
- 范围：`app/**`（只读执行，不修改代码）
- 备注：APK 由 Lead 的 gradle 构建产出；本文件记录 JS/TS 层健康度，APK 级验证见 `app-build-report.md` 与 `app-emulator-report.md`。

## 1. TypeScript 类型检查

```bat
cd app
npx tsc --noEmit
```

- 结果：**exit 0，无错误输出**（2026-11-11 18:08 执行，覆盖 app/src 全量 TS/TSX）。

## 2. 单元测试（node:test）

```bat
cd app
node --test "src/lib/__tests__/*.test.mjs" "src/lib/__tests__/*.test.ts"
```

- 结果：**85 passed / 0 failed**（2026-11-11 18:12）；App 修复时区/重试/深链后复跑 **94 passed / 0 failed**（2026-11-11 19:20），tsc 复跑仍 0 error。
- 覆盖：transcript 渲染子集与 §9.2 注入过滤、§9.1 assistant 帧（真实宿主 start/text-delta/block-start/end 与 mock phase 两种形状）、乐观消息 rpcId 转正 + 快照回填（P1-2 回归）、history 分页合并、SSE parser（LF/CRLF/跨 chunk/多行/注释/BOM）、pairing payload/URL 规整、模型 catalog 归一化、clientTimeZone 归一化（GMT→UTC/非法省略）、错误 message 透出、chat 格式化工具。
- 备注：Node 运行 .ts/.mjs 测试时输出 `MODULE_TYPELESS_PACKAGE_JSON` 警告（建议 app/package.json 加 `"type": "module"` 或在测试脚本里统一 .mjs），不影响结果。

## 3. 与协议复核的关系

- 协议符合性见 `docs/verification/app-protocol-review.md`（P0=0；初版 P1=2 已在 18:10 复核确认修复；P2-6/P3 若干仍待后续）。
- 静态检查通过不等于运行期正确：模拟器安装/启动/截图/logcat 结果见 `app-emulator-report.md`。
