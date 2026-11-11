# App 架构与文件所有权（app-core / app-chat 必读）

App 目录：`D:\Code\dsh-remote\app`（Expo SDK 58 / RN 0.88 / TypeScript / Expo Router / uniwind + beUI Native）。
协议：`docs/protocol.md`（v1，含 §9 真实抓包）。设计基调：DeepSeek 品牌蓝 `#4D6BFE`，暗色优先，移动端手感（大点击区、底部安全区）。

## 1. 构建与命令
- 依赖用 `npx expo install <pkg>` 安装（SDK 兼容版本）；JS 库可 `npm install`。
- 类型检查：`npx tsc --noEmit`；lint：`npx expo lint`。交付前必须两者通过（允许已知第三方组件的小问题，但要报告）。
- **不要手写/修改 `android/`、`ios/`**；原生配置写进 `app.json`（icon/splash 由 Lead 负责）。`npx expo prebuild` 与 APK 构建由 Lead/verifier 执行。
- 入口：Expo Router（`main: "expo-router/entry"`，路由目录 `src/app/`）。若脚手架尚未装 router，app-core 负责 `npx expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants` 并配置。

## 2. 文件所有权（硬边界，不要越界写别人的文件）

### app-core 拥有
- `app/src/app/_layout.tsx`、`app/src/app/index.tsx`（连接/配对页）、`app/src/app/sessions.tsx`（会话列表）、`app/src/app/settings.tsx`
- `app/src/lib/**`：`types.ts`（协议类型）、`client.ts`（HTTP+SSE 客户端）、`store.ts`（zustand store）、`pairing.ts`（QR 解析/手动输入/持久化）、`config.ts`
- `app/src/components/common/**`（按钮、空状态、错误条、连接状态）
- `app/package.json` / `app.json` / `tsconfig.json`（app.json 的 icon/splash 键由 Lead 定稿，app-core 只加 permissions/plugin 配置时先告知 Lead）

### app-chat 拥有
- `app/src/app/session/[id].tsx`（聊天页路由）
- `app/src/components/chat/**`（消息列表、气泡、工具卡、审批卡、输入区、模型选择弹层）
- `app/src/lib/transcript.ts`（纯函数：事件数组 + 流式片段 → 渲染项；可单测）
- `app/src/components/chat/__tests__/**` 或 `app/src/lib/__tests__/`（transcript 单测）

### 共享约定
- app-core 先落地 `src/lib/types.ts` + `src/lib/store.ts` 的**接口骨架**（含 TSDoc），app-chat 只按接口消费；需要改接口先 send_message 给 app-core 并抄送 lead。
- 任何跨边界修改先在任务板/消息里说明。

## 3. 运行时架构

```
RemoteClient (src/lib/client.ts)
  - fetch JSON RPC: GET/POST /v1/*
  - SSE: GET /v1/events?token=... （用 react-native-sse 或自写 XHR 流；需断线重连/心跳）
  - 事件分发：on('event', handler)
        |
useRemoteStore (zustand, src/lib/store.ts)
  - connection / sessions / currentSession / models / approvals
        |
screens (src/app/**) -> beUI Native 组件 (src/components/**)
```

### 3.1 RemoteClient 必须提供的 API（app-core 实现，签名可细化但语义不变）
```ts
class RemoteClient {
  constructor(cfg: { baseUrl: string; token?: string });
  connectEvents(): void;                 // 建立 SSE，自动重连；触发下面的事件
  disconnect(): void;
  on(event: 'event'|'assistant'|'snapshot'|'state'|'status'|'listChanged'|'approval'|'approvalResolved'|'error'|'open'|'close', cb): () => void;

  static async pair(baseUrl, code, deviceName): Promise<PairResult>;
  health(): Promise<Health>;
  host(): Promise<HostInfo>;
  listSessions(): Promise<{items: SessionRow[]}>;
  createSession(opts): Promise<{sessionId: string}>;
  getSession(id): Promise<SessionDetail>;
  history(id, opts): Promise<{records, cursor, hasMore}>;
  openSession(id, opts): Promise<{subscriptionId: string}>;   // 之后 SSE 收 session.snapshot/event/assistant/state
  closeSession(id): Promise<void>;
  prompt(id, payload): Promise<{accepted: boolean}>;
  cancel(id): Promise<{accepted: boolean}>;
  rename(id, title): Promise<{title, seq}>;
  selectModel(id, sel): Promise<{selected}>;
  models(): Promise<ModelCatalog>;
  approvals(): Promise<{items: Approval[]}>;
  answerApproval(id, decision): Promise<{resolved: boolean}>;
  devices(): Promise<{items: Device[]}>;
  deleteDevice(id): Promise<{removed: boolean}>;
}
```

### 3.2 Store 形状（app-core 实现；app-chat 消费）
```ts
interface RemoteState {
  connection: { status: 'idle'|'connecting'|'connected'|'error'; baseUrl?: string; host?: HostInfo; error?: string };
  sessions: SessionRow[];
  sessionsLoading: boolean;
  current: {
    sessionId?: string;
    title?: string;
    running: boolean;
    active: boolean;
    items: TranscriptItem[];        // app-chat 的 transcript.ts 输出（store 只存原始 events，items 由选择器计算）
    events: SessionEvent[];
    streaming: { attemptId?: string; text: string; reasoning: string; active: boolean };
    pendingApprovals: Approval[];
    loading: boolean;
    error?: string;
  };
  models?: ModelCatalog;
  actions: {
    connect(input: {baseUrl: string; code: string; deviceName: string}): Promise<void>;
    restore(): Promise<boolean>;    // 启动时用已存 token 重连
    disconnect(): Promise<void>;
    refreshSessions(): Promise<void>;
    createSession(opts?: {cwd?: string}): Promise<string>;
    openSession(id: string): Promise<void>;
    closeSession(): Promise<void>;
    sendPrompt(text: string): Promise<void>;
    cancel(): Promise<void>;
    answerApproval(id: string, decision: 'allow'|'reject'): Promise<void>;
    selectModel(sel: {provider: string; model: string; reasoningEffort?: string}): Promise<void>;
    loadModels(): Promise<void>;
  };
}
export const useRemoteStore = create<RemoteState>()(...)
```
- **store 必须处理**：SSE 重连后对当前会话重新 `openSession`；`session.snapshot` 全量替换 events；`session.event` 按 seq 去重追加；`session.assistant` 写入 streaming；收到 `assistant/message` 后清空 streaming；`session.state` 更新 running。
- 乐观消息：`sendPrompt` 立即加入本地 pending 用户气泡（带 requestId），收到 `user/message`（source.kind==='user' 且 rpcId 相同）后去重。
- token 存 `expo-secure-store`；baseUrl/设备名存 AsyncStorage。

### 3.3 transcript.ts（app-chat 实现，必须纯函数可测）
```ts
type TranscriptItem =
  | { kind: 'user'; id: string; text: string; images?: ImageRef[]; time: number; pending?: boolean }
  | { kind: 'assistant'; id: string; text: string; reasoning?: string; time: number; streaming?: boolean }
  | { kind: 'tool'; id: string; callId: string; name: string; input?: unknown; status: 'running'|'ok'|'error'; result?: string; time: number }
  | { kind: 'approval'; id: string; approval: Approval }
  | { kind: 'turn'; id: string; label: 'start'|'end'; time: number }
  | { kind: 'todo'; id: string; items: unknown[]; time: number };
export function buildTranscript(events: SessionEvent[], streaming: StreamingState): TranscriptItem[];
```
规则见 `docs/protocol.md §9.2`：只显示 `user/message`（source.kind==='user'）、`assistant/message`、`tool/call`/`tool/result`（按 callId 合并）、`approval/asked|decided`、`todo/write`；注入消息隐藏。流式文本作为最后一个 assistant item 追加（`streaming?`），收到最终 `assistant/message` 后替换。

## 4. UI/组件（app-chat）
beUI Native 组件已由 Lead 安装到 `app/src/components/<slug>/`（见目录），可用：
- 消息：`message-bubble`、`message`、`message-scroller`、`streaming-response`
- 输入：`prompt-input`（attachments/voice/stop；当前只接文本 + 停止）
- 工具/审批：`agent-activity`、`tool-result`、`tool-approval`、`approval-card`、`loading-states`
- 代码/任务：`code-block`、`todo-list`
用 `className` + Tailwind（uniwind）写样式；颜色用主题 token（`bg-background/text-foreground/bg-primary` 等，勿硬编码色值，品牌蓝已在 theme.css）。所有屏幕适配深/浅色（系统主题），底部安全区用 `useSafeAreaInsets`。
不要修改 `app/src/components/<slug>/` 下的库文件（要改就复制到 `app/src/components/chat/` 自建版本）。

## 5. 验收（两块共同）
- `npx tsc --noEmit` 通过；
- 连接页：手动输入 `http://<ip>:8790` + 6 位码可配对；扫码入口（expo-camera）可用；
- 列表页：展示 title/时间/running 指示、下拉刷新；
- 聊天页：历史、流式回复（逐字）、工具调用卡、停止按钮、审批卡（收到即弹）、模型选择弹层、断线重连提示；
- 退出/重进 App 自动恢复连接（token 持久化）。
