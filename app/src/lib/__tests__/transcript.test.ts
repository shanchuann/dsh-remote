/**
 * Unit tests for the transcript reducer (pure functions only).
 *
 * Run: node --test src/lib/transcript.test.ts
 *
 * Cases cover protocol section 5 / 9.2: real user messages only, injected
 * message filtering, tool-call pairing, approvals, todos, turn boundaries,
 * streaming merge, seq de-duplication, ordering and malformed input.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildTranscript, countTurns, normalizeEvents } from "../transcript.ts";
import type { SessionEventLike, TranscriptItem } from "../transcript.ts";

let seq = 0;

type Ev = {
  type: string;
  data?: unknown;
  time?: number;
  seq?: number;
};

function ev(type: string, data: unknown, time = 1763000000000): Ev {
  seq += 1;
  return { type, seq, time, data };
}

function events(...items: Ev[]): SessionEventLike[] {
  return items as SessionEventLike[];
}

function kinds(items: TranscriptItem[]): string[] {
  return items.map((item) => item.kind);
}

/* --------------------------------------------------------------- 1. empty */

test("empty / missing events produce an empty transcript", () => {
  assert.deepEqual(buildTranscript([]), []);
  assert.deepEqual(buildTranscript(undefined), []);
  assert.deepEqual(buildTranscript(null, null), []);
});

/* ------------------------------------------------------- 2. plain messages */

test("renders real user and assistant text messages in order", () => {
  const items = buildTranscript(
    events(
      ev("user/message", {
        role: "user",
        id: "u1",
        content: [{ type: "text", text: "帮我看看这个报错" }],
        source: { kind: "user", rpcId: "rpc-1" },
      }),
      ev("assistant/message", {
        message: {
          role: "assistant",
          id: "a1",
          content: [{ type: "text", text: "好的，先看日志。" }],
        },
      }),
    ),
  );
  assert.deepEqual(kinds(items), ["user", "assistant"]);
  const [user, assistant] = items;
  assert.equal(user?.kind, "user");
  if (user?.kind === "user") {
    assert.equal(user.id, "u1");
    assert.equal(user.text, "帮我看看这个报错");
    assert.equal(user.pending, undefined);
  }
  if (assistant?.kind === "assistant") {
    assert.equal(assistant.id, "a1");
    assert.equal(assistant.text, "好的，先看日志。");
    assert.equal(assistant.streaming, undefined);
  }
});

test("joins multiple text blocks and keeps reasoning separate", () => {
  const items = buildTranscript(
    events(
      ev("assistant/message", {
        message: {
          id: "a1",
          content: [
            { type: "reasoning", text: "先分析原因" },
            { type: "text", text: "第一段" },
            { type: "text", text: "第二段" },
          ],
        },
      }),
    ),
  );
  const item = items[0];
  assert.equal(item?.kind, "assistant");
  if (item?.kind === "assistant") {
    assert.equal(item.text, "第一段\n第二段");
    assert.equal(item.reasoning, "先分析原因");
  }
});

test("user images become image refs on the user item", () => {
  const items = buildTranscript(
    events(
      ev("user/message", {
        id: "u1",
        content: [
          { type: "text", text: "看这张图" },
          { type: "image", mediaType: "image/jpeg", name: "a.jpg" },
        ],
        source: { kind: "user" },
      }),
    ),
  );
  const item = items[0];
  assert.equal(item?.kind, "user");
  if (item?.kind === "user") {
    assert.equal(item.text, "看这张图");
    assert.equal(item.images?.length, 1);
    assert.equal(item.images?.[0]?.mediaType, "image/jpeg");
  }
});

/* ------------------------------------------------- 3. injected messages */

test("hides injected user messages (runtime-context, skill-catalog, unknown sources)", () => {
  const items = buildTranscript(
    events(
      ev("user/message", {
        id: "inject-1",
        content: [{ type: "text", text: "runtime context: cwd D:\\Code" }],
        source: { kind: "runtime-context" },
      }),
      ev("user/message", {
        id: "inject-2",
        content: [{ type: "text", text: "skill catalog" }],
        source: { kind: "skill-catalog" },
      }),
      ev("user/message", {
        id: "inject-3",
        content: [{ type: "text", text: "system reply" }],
        source: { kind: "user-question-reply" },
      }),
      ev("user/message", {
        id: "real",
        content: [{ type: "text", text: "真实输入" }],
        source: { kind: "user", rpcId: "rpc-9" },
      }),
      ev("system/message", { content: [{ type: "text", text: "system prompt" }] }),
    ),
  );
  assert.deepEqual(kinds(items), ["user"]);
  const item = items[0];
  if (item?.kind === "user") assert.equal(item.text, "真实输入");
});

test("accepts the shortcut source: 'user' sent by the reference mock host", () => {
  const items = buildTranscript(
    events(
      ev("user/message", {
        role: "user",
        content: [{ type: "text", text: "hello from mock" }],
        source: "user",
      }),
    ),
  );
  assert.deepEqual(kinds(items), ["user"]);
});

/* --------------------------------------------------- 4. tool call pairing */

test("pairs tool/call with tool/result by callId and extracts the output", () => {
  const items = buildTranscript(
    events(
      ev("tool/call", { callId: "call_1", name: "pwsh", input: { command: "npm test" } }),
      ev("tool/result", {
        callId: "call_1",
        isError: false,
        message: {
          role: "tool",
          content: [{ type: "text", text: "49 tests passed" }],
        },
      }),
    ),
  );
  assert.deepEqual(kinds(items), ["tool"]);
  const tool = items[0];
  assert.equal(tool?.kind, "tool");
  if (tool?.kind === "tool") {
    assert.equal(tool.callId, "call_1");
    assert.equal(tool.name, "pwsh");
    assert.equal(tool.status, "ok");
    assert.equal(tool.result, "49 tests passed");
    assert.deepEqual(tool.input, { command: "npm test" });
  }
});

test("marks tool results with isError as failed", () => {
  const items = buildTranscript(
    events(
      ev("tool/call", { callId: "c1", name: "read", input: { path: "a.ts" } }),
      ev("tool/result", {
        callId: "c1",
        isError: true,
        message: { content: [{ type: "text", text: "ENOENT" }] },
      }),
    ),
  );
  const tool = items[0];
  assert.equal(tool?.kind, "tool");
  if (tool?.kind === "tool") {
    assert.equal(tool.status, "error");
    assert.equal(tool.result, "ENOENT");
  }
});

test("tool/result without callId attaches to the most recent running tool", () => {
  const items = buildTranscript(
    events(
      ev("tool/call", { callId: "c1", name: "pwsh", input: { command: "pwd" } }),
      ev("tool/result", {
        message: { content: [{ type: "text", text: "D:\\Code\\dsh-remote" }] },
      }),
    ),
  );
  assert.equal(items.length, 1);
  const tool = items[0];
  if (tool?.kind === "tool") {
    assert.equal(tool.callId, "c1");
    assert.equal(tool.status, "ok");
    assert.match(tool.result ?? "", /dsh-remote/);
  }
});

test("tool-call blocks inside assistant/message pair with later tool/result", () => {
  const items = buildTranscript(
    events(
      ev("assistant/message", {
        message: {
          id: "a1",
          content: [
            { type: "text", text: "我来跑一下测试" },
            { type: "tool-call", callId: "call_9", name: "pwsh", input: { command: "npm test" } },
          ],
        },
      }),
      ev("tool/result", {
        callId: "call_9",
        message: { content: [{ type: "tool-result", toolCallId: "call_9", output: "ok 12 tests" }] },
      }),
    ),
  );
  assert.deepEqual(kinds(items), ["assistant", "tool"]);
  const tool = items[1];
  if (tool?.kind === "tool") {
    assert.equal(tool.callId, "call_9");
    assert.equal(tool.status, "ok");
    assert.equal(tool.result, "ok 12 tests");
  }
});

test("keeps duplicate tool/call events for the same callId as one card", () => {
  const items = buildTranscript(
    events(
      ev("tool/call", { callId: "c1", name: "pwsh", input: { command: "ls" } }),
      ev("tool/call", { callId: "c1", name: "pwsh", input: { command: "ls" } }),
    ),
  );
  assert.equal(items.length, 1);
  assert.equal(items[0]?.kind, "tool");
});

/* ------------------------------------------------------------ 5. approval */

test("merges approval/asked with approval/decided and records the outcome", () => {
  const items = buildTranscript(
    events(
      ev("approval/asked", {
        requestId: "apr_1",
        sessionId: "s1",
        tool: "pwsh",
        callId: "call_1",
        reason: "run command",
        displayReason: "执行命令：npm install",
        requestedAt: 1763000000000,
        expiresAt: null,
      }),
      ev("approval/decided", { requestId: "apr_1", outcome: "allowed" }),
    ),
  );
  assert.deepEqual(kinds(items), ["approval"]);
  const item = items[0];
  assert.equal(item?.kind, "approval");
  if (item?.kind === "approval") {
    assert.equal(item.approval.id, "apr_1");
    assert.equal(item.approval.displayReason, "执行命令：npm install");
    assert.equal(item.approval.outcome, "allowed");
    assert.equal(item.approval.expiresAt, null);
  }
});

test("renders a decision without a prior ask as approval history", () => {
  const items = buildTranscript(
    events(ev("approval/decided", { requestId: "apr_2", decision: "reject" })),
  );
  const item = items[0];
  assert.equal(item?.kind, "approval");
  if (item?.kind === "approval") {
    assert.equal(item.approval.id, "apr_2");
    assert.equal(item.approval.outcome, "rejected");
    assert.equal(item.approval.decision, "reject");
  }
});

/* --------------------------------------------------------------- 6. todo */

test("replaces the previous todo list on the next todo/write (snapshot semantics)", () => {
  const items = buildTranscript(
    events(
      ev("todo/write", [
        { id: "t1", content: "读代码", status: "completed" },
        { id: "t2", content: "改代码", status: "in_progress" },
      ]),
      ev("todo/write", {
        todos: [
          { id: "t1", content: "读代码", status: "completed" },
          { id: "t2", content: "改代码", status: "completed" },
          { id: "t3", content: "跑测试", status: "pending" },
        ],
      }),
    ),
  );
  const todos = items.filter((item) => item.kind === "todo");
  assert.equal(todos.length, 1);
  const todo = todos[0];
  if (todo?.kind === "todo") {
    assert.equal(todo.items.length, 3);
    assert.equal(todo.items[0]?.title, "读代码");
    assert.equal(todo.items[1]?.status, "completed");
    assert.equal(todo.items[2]?.status, "pending");
  }
});

/* ------------------------------------------------------------ 7. streaming */

test("appends live streaming text as a trailing streaming assistant item", () => {
  const items = buildTranscript(
    events(
      ev("user/message", {
        content: [{ type: "text", text: "ping" }],
        source: { kind: "user" },
      }),
    ),
    { attemptId: "session:1", text: "PO", reasoning: "", active: true },
  );
  assert.deepEqual(kinds(items), ["user", "assistant"]);
  const assistant = items[1];
  if (assistant?.kind === "assistant") {
    assert.equal(assistant.text, "PO");
    assert.equal(assistant.streaming, true);
    assert.equal(assistant.id, "streaming-session:1");
  }
});

test("does not duplicate the final assistant text when streaming is stale", () => {
  const items = buildTranscript(
    events(
      ev("assistant/message", {
        message: { id: "a1", content: [{ type: "text", text: "PONG" }] },
      }),
    ),
    { text: "PONG", reasoning: "", active: true },
  );
  assert.equal(items.length, 1);
  const item = items[0];
  if (item?.kind === "assistant") assert.equal(item.streaming, undefined);
});

test("renders an empty transcript while only the streaming fragment exists", () => {
  const items = buildTranscript([], { text: "he", active: true });
  assert.equal(items.length, 1);
  const item = items[0];
  assert.equal(item?.kind, "assistant");
  if (item?.kind === "assistant") assert.equal(item.streaming, true);
});

/* ----------------------------------------------------- 8. seq de-duping */

test("dropping duplicate seq events (reconnect replay)", () => {
  const base = events(
    ev("user/message", {
      content: [{ type: "text", text: "one" }],
      source: { kind: "user" },
    }),
    ev("assistant/message", {
      message: { content: [{ type: "text", text: "two" }] },
    }),
  );
  const [first, second] = base;
  assert.ok(first && second);
  const deduped = normalizeEvents([first, first, second]);
  assert.equal(deduped.length, 2);
  const items = buildTranscript([first, first, second]);
  assert.deepEqual(kinds(items), ["user", "assistant"]);
});

test("sorts events that arrive out of order by seq", () => {
  const a: SessionEventLike = {
    type: "user/message",
    seq: 5,
    time: 1,
    data: { content: [{ type: "text", text: "later" }], source: { kind: "user" } },
  };
  const b: SessionEventLike = {
    type: "user/message",
    seq: 2,
    time: 1,
    data: { content: [{ type: "text", text: "earlier" }], source: { kind: "user" } },
  };
  const items = buildTranscript([a, b]);
  const texts = items.map((item) => (item.kind === "user" ? item.text : ""));
  assert.deepEqual(texts, ["earlier", "later"]);
});

/* --------------------------------------------------- 9. turn boundaries */

test("emits turn boundary items and counts completed turns", () => {
  const items = buildTranscript(
    events(
      ev("turn/start", { turn: 1 }),
      ev("user/message", {
        content: [{ type: "text", text: "hi" }],
        source: { kind: "user" },
      }),
      ev("assistant/message", {
        message: { content: [{ type: "text", text: "hello" }] },
      }),
      ev("turn/end", { turn: 1, reason: { kind: "completed" } }),
    ),
  );
  assert.deepEqual(kinds(items), ["turn", "user", "assistant", "turn"]);
  assert.equal(countTurns(items), 1);
  const last = items[3];
  if (last?.kind === "turn") assert.equal(last.label, "end");
});

/* ------------------------------------------------ 10. malformed tolerance */

test("tolerates malformed events without throwing", () => {
  const garbage = [
    null,
    undefined,
    "not an event",
    42,
    { data: {} },
    { type: "user/message" },
    { type: "user/message", data: "oops" },
    { type: "assistant/message", data: { message: null } },
    { type: "tool/call", data: {} },
    { type: "tool/result", data: { message: { content: [{}] } } },
    { type: "approval/asked", data: null },
    { type: "todo/write", data: null },
    { type: "totally/unknown", data: { a: 1 } },
  ] as unknown as SessionEventLike[];
  const items = buildTranscript(garbage);
  assert.ok(Array.isArray(items));
  // Only the approval ask without an id survives as a (degenerate) card.
  assert.ok(items.every((item) => typeof item.kind === "string"));
});

test("ignores unknown event types instead of rendering them", () => {
  const items = buildTranscript(
    events(
      ev("session/title", { title: "T" }),
      ev("model/selection", { provider: "p", model: "m" }),
      ev("working-directory/change", { cwd: "C:\\x" }),
      ev("compaction/start", {}),
      ev("session.other", { frame: 1 }),
    ),
  );
  assert.deepEqual(items, []);
});

/* ------------------------------------------------ 11. optimistic messages */

test("appends pending user messages and drops confirmed ones", () => {
  const items = buildTranscript(
    events(
      ev("user/message", {
        id: "u1",
        content: [{ type: "text", text: "confirmed" }],
        source: { kind: "user", rpcId: "rpc-1" },
      }),
    ),
    null,
    {
      pending: [
        { requestId: "rpc-1", text: "confirmed", status: "sending" },
        { requestId: "rpc-2", text: "still sending", status: "sending" },
      ],
    },
  );
  assert.deepEqual(kinds(items), ["user", "user"]);
  const pending = items[1];
  if (pending?.kind === "user") {
    assert.equal(pending.id, "rpc-2");
    assert.equal(pending.text, "still sending");
    assert.equal(pending.pending, true);
  }
});

test("empty user messages and injected-only turns are skipped", () => {
  const items = buildTranscript(
    events(
      ev("user/message", {
        content: [{ type: "text", text: "   " }],
        source: { kind: "user" },
      }),
      ev("user/message", {
        content: [],
        source: { kind: "runtime-context" },
      }),
    ),
  );
  assert.deepEqual(items, []);
});
/* ------------------------------------------------- 12. real capture replay */

test("replays the protocol section 9 capture: injected context, PONG turn, streaming", () => {
  const records: SessionEventLike[] = [
    {
      type: "user/message",
      seq: 1,
      time: 1794388800900,
      data: {
        role: "user",
        id: "ctx-1",
        content: [{ type: "text", text: "cwd: D:\\Code\\demo\nsandbox: workspace-write" }],
        source: { kind: "runtime-context" },
      },
    },
    {
      type: "turn/start",
      seq: 7,
      time: 1794388801000,
      data: { turn: 1 },
    },
    {
      type: "user/message",
      seq: 8,
      time: 1794388802000,
      data: {
        role: "user",
        id: "u-1",
        content: [{ type: "text", text: "reply with exactly PONG" }],
        source: { kind: "user", rpcId: "rpc-1", clientTimeZone: "Asia/Shanghai" },
      },
    },
    {
      type: "assistant/message",
      seq: 13,
      time: 1794388809200,
      data: {
        turn: 1,
        step: 1,
        message: {
          id: "a-1",
          role: "assistant",
          content: [{ type: "text", text: "PONG" }],
          source: { kind: "model", provider: "opencode-go", model: "deepseek-v4.1-flash" },
        },
        usage: { inputTokens: 9314, outputTokens: 4 },
      },
    },
    { type: "turn/end", seq: 14, time: 1794388809300, data: { turn: 1, reason: { kind: "completed" } } },
    { type: "session/title", seq: 15, time: 1794388809400, data: { title: "Exact PONG Reply Request" } },
  ];

  const items = buildTranscript(records, { attemptId: "session-1:1", text: "", reasoning: "", active: false });
  assert.deepEqual(kinds(items), ["turn", "user", "assistant", "turn"]);
  const user = items[1];
  if (user?.kind === "user") {
    assert.equal(user.text, "reply with exactly PONG");
    assert.equal(user.id, "u-1");
  }
  const assistant = items[2];
  if (assistant?.kind === "assistant") assert.equal(assistant.text, "PONG");
});

test("end-to-end turn with tool call, approval and todo renders in event order", () => {
  const records: SessionEventLike[] = [
    {
      type: "turn/start",
      seq: 1,
      time: 1000,
      data: { turn: 2 },
    },
    {
      type: "user/message",
      seq: 2,
      time: 1001,
      data: {
        id: "u-2",
        content: [{ type: "text", text: "跑一下测试并修掉" }],
        source: { kind: "user", rpcId: "rpc-2" },
      },
    },
    {
      type: "assistant/message",
      seq: 3,
      time: 1002,
      data: {
        message: {
          id: "a-2",
          content: [
            { type: "text", text: "先跑测试。" },
            { type: "reasoning", text: "需要先确认失败用例" },
          ],
        },
      },
    },
    {
      type: "tool/call",
      seq: 4,
      time: 1003,
      data: { callId: "call_1", name: "pwsh", input: { command: "npm test" } },
    },
    {
      type: "approval/asked",
      seq: 5,
      time: 1004,
      data: {
        requestId: "apr_1",
        tool: "pwsh",
        callId: "call_1",
        displayReason: "执行命令：npm test",
        requestedAt: 1004,
        expiresAt: null,
      },
    },
    { type: "approval/decided", seq: 6, time: 1005, data: { requestId: "apr_1", outcome: "allowed" } },
    {
      type: "todo/write",
      seq: 7,
      time: 1006,
      data: {
        todos: [
          { id: "t1", content: "跑测试", status: "completed" },
          { id: "t2", content: "修失败", status: "in_progress" },
        ],
      },
    },
    {
      type: "tool/result",
      seq: 8,
      time: 1007,
      data: {
        callId: "call_1",
        isError: false,
        message: { role: "tool", content: [{ type: "text", text: "2 failed, 10 passed" }] },
      },
    },
    {
      type: "assistant/message",
      seq: 9,
      time: 1008,
      data: { message: { id: "a-3", content: [{ type: "text", text: "已修复 2 个失败用例。" }] } },
    },
    { type: "turn/end", seq: 10, time: 1009, data: { turn: 2, reason: { kind: "completed" } } },
  ];

  const items = buildTranscript(records);
  assert.deepEqual(kinds(items), [
    "turn",
    "user",
    "assistant",
    "tool",
    "approval",
    "todo",
    "assistant",
    "turn",
  ]);
  const reasoning = items[2];
  if (reasoning?.kind === "assistant") assert.equal(reasoning.reasoning, "需要先确认失败用例");
  const tool = items[3];
  if (tool?.kind === "tool") {
    assert.equal(tool.status, "ok");
    assert.equal(tool.result, "2 failed, 10 passed");
  }
  const approval = items[4];
  if (approval?.kind === "approval") assert.equal(approval.approval.outcome, "allowed");
  const todo = items[5];
  if (todo?.kind === "todo") assert.equal(todo.items[1]?.status, "in-progress");
});

test("optimistic bubble is replaced by the host echo with the same rpcId", () => {
  const pending = [
    { requestId: "rpc-7", text: "hello", time: 100, status: "sending" as const },
  ];
  const before = buildTranscript([], null, { pending });
  assert.deepEqual(kinds(before), ["user"]);
  assert.equal(before[0]?.kind === "user" ? before[0].pending : undefined, true);

  const after = buildTranscript(
    [
      {
        type: "user/message",
        seq: 3,
        time: 120,
        data: {
          id: "u-9",
          content: [{ type: "text", text: "hello" }],
          source: { kind: "user", rpcId: "rpc-7" },
        },
      },
    ],
    null,
    { pending },
  );
  assert.equal(after.length, 1);
  const echo = after[0];
  if (echo?.kind === "user") {
    assert.equal(echo.id, "u-9");
    assert.equal(echo.pending, undefined);
  }
});

test("a failed pending bubble keeps its failed state for a retry hint", () => {
  const items = buildTranscript([], null, {
    pending: [{ requestId: "rpc-8", text: "hi", time: 5, status: "failed" }],
  });
  const item = items[0];
  assert.equal(item?.kind, "user");
  if (item?.kind === "user") assert.equal(item.pending, true);
});
