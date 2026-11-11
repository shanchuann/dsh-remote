/**
 * Unit tests for the chat screen's pure helpers (format.ts, models.ts).
 *
 * Run: node --test src/lib/__tests__/chat-helpers.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatClock,
  formatDuration,
  languageFromPath,
  shortenPath,
  splitFencedCode,
  splitInlineCode,
  toCodeLanguage,
  toolCode,
  toolKind,
  toolLabel,
  toolTarget,
  truncate,
} from "../../components/chat/format.ts";
import {
  defaultSelection,
  findChoice,
  modelChipLabel,
  normalizeModelCatalog,
  selectionKey,
} from "../../components/chat/models.ts";

/* ------------------------------------------------------------- markdown */

test("splitFencedCode keeps prose and closed code blocks in order", () => {
  const segments = splitFencedCode(
    "先跑一下：\n```bash\nnpm test\n```\n然后用结果判断。",
  );
  assert.deepEqual(
    segments.map((segment) => segment.kind),
    ["text", "code", "text"],
  );
  const code = segments[1];
  assert.equal(code?.kind, "code");
  if (code?.kind === "code") {
    assert.equal(code.code, "npm test");
    assert.equal(code.language, "bash");
    assert.equal(code.closed, true);
  }
});

test("splitFencedCode marks an unclosed fence as still streaming", () => {
  const segments = splitFencedCode("说明\n```ts\nconst a = 1;");
  assert.equal(segments.length, 2);
  const code = segments[1];
  if (code?.kind === "code") {
    assert.equal(code.code, "const a = 1;");
    assert.equal(code.language, "typescript");
    assert.equal(code.closed, false);
  } else {
    assert.fail("expected a code segment");
  }
});

test("splitFencedCode leaves plain prose as a single text segment", () => {
  const segments = splitFencedCode("没有代码，只有一句话。");
  assert.deepEqual(segments, [{ kind: "text", text: "没有代码，只有一句话。" }]);
});

test("splitInlineCode separates inline code runs from prose", () => {
  const segments = splitInlineCode("运行 `npm test` 看结果");
  assert.deepEqual(segments, [
    { kind: "text", text: "运行 " },
    { kind: "code", text: "npm test" },
    { kind: "text", text: " 看结果" },
  ]);
});

test("unknown fence languages fall back to plain text", () => {
  assert.equal(toCodeLanguage("brainfuck"), "text");
  assert.equal(toCodeLanguage("TS"), "typescript");
  assert.equal(toCodeLanguage(".json"), "json");
  assert.equal(languageFromPath("src/app/index.tsx"), "tsx");
  assert.equal(languageFromPath(undefined), "text");
});

/* ----------------------------------------------------------------- format */

test("formatClock renders a 24h HH:MM clock and tolerates junk", () => {
  const time = new Date(2026, 10, 11, 9, 5).getTime();
  assert.equal(formatClock(time), "09:05");
  assert.equal(formatClock(0), "");
  assert.equal(formatClock(undefined), "");
  assert.equal(formatClock(Number.NaN), "");
});

test("formatDuration reads as a human elapsed time", () => {
  assert.equal(formatDuration(8200), "8s");
  assert.equal(formatDuration(64_000), "1m 04s");
  assert.equal(formatDuration(3_720_000), "1h 2m");
  assert.equal(formatDuration(0), "");
});

test("truncate keeps whole words and shortenPath keeps the tail", () => {
  assert.equal(truncate("hello world again", 12), "hello world…");
  assert.equal(truncate("short", 12), "short");
  assert.equal(
    shortenPath("D:\\Code\\dsh-remote\\app\\src\\components\\chat", 24),
    "…app/src/components/chat",
  );
});

/* ------------------------------------------------------------------ tools */

test("toolLabel maps known DSH tools to Chinese labels", () => {
  assert.equal(toolLabel("pwsh"), "运行命令");
  assert.equal(toolLabel("read"), "读取文件");
  assert.equal(toolLabel("mystery_tool"), "mystery_tool");
  assert.equal(toolLabel(undefined), "工具");
});

test("toolTarget prefers the command, then the path, then the query", () => {
  assert.equal(toolTarget("pwsh", { command: "npm   test" }), "npm test");
  assert.equal(toolTarget("read", { path: "D:\\a.ts" }), "D:\\a.ts");
  assert.equal(toolTarget("web_search", { query: "dsh remote" }), "dsh remote");
  assert.equal(toolTarget("pwsh", { args: { command: "pwd" } }), "pwd");
  assert.equal(toolTarget("pwsh", undefined), undefined);
});

test("toolCode extracts a shell command or a code payload", () => {
  assert.deepEqual(toolCode("pwsh", { command: "ls -la" }), {
    code: "ls -la",
    language: "bash",
  });
  const edit = toolCode("edit", { path: "a.ts", newText: "const a = 1;" });
  assert.equal(edit?.language, "typescript");
  assert.equal(edit?.code, "const a = 1;");
  assert.deepEqual(toolCode("tool", { input: { a: 1 } }), {
    code: '{\n  "a": 1\n}',
    language: "json",
  });
  assert.equal(toolCode("read", { path: "a.ts" }), undefined);
});

test("toolKind picks the matching tool-result icon", () => {
  assert.equal(toolKind("pwsh"), "terminal");
  assert.equal(toolKind("web_fetch"), "request");
  assert.equal(toolKind("read"), "custom");
});

/* ----------------------------------------------------------------- models */

const CATALOG = {
  default: { provider: "opencode-go", model: "deepseek-v4.1-flash" },
  routableProviders: ["opencode-go"],
  groups: [
    {
      id: "opencode-go",
      name: "OpenCode Go",
      models: [
        { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
        { id: "deepseek-v4.1-pro", name: "DeepSeek V4.1 Pro", description: "更慢但更强" },
      ],
    },
    { id: "local", name: "Local", models: ["qwen3-coder"] },
  ],
  failures: [],
};

test("normalizeModelCatalog reads the real host catalog shape", () => {
  const groups = normalizeModelCatalog(CATALOG);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.name, "OpenCode Go");
  assert.equal(groups[0]?.choices.length, 2);
  assert.deepEqual(
    { provider: groups[0]?.choices[0]?.provider, model: groups[0]?.choices[0]?.model },
    { provider: "opencode-go", model: "deepseek-v4.1-flash" },
  );
  assert.equal(groups[0]?.choices[0]?.label, "DeepSeek V4.1 Flash");
  assert.equal(groups[0]?.choices[1]?.description, "更慢但更强");
});

test("normalizeModelCatalog accepts string models and a provider group id", () => {
  const groups = normalizeModelCatalog(CATALOG);
  assert.deepEqual(groups[1]?.choices[0], {
    provider: "local",
    model: "qwen3-coder",
    key: "local/qwen3-coder",
    label: "qwen3-coder",
  });
});

test("normalizeModelCatalog tolerates missing/foreign shapes", () => {
  assert.deepEqual(normalizeModelCatalog(undefined), []);
  assert.deepEqual(normalizeModelCatalog({}), []);
  assert.deepEqual(normalizeModelCatalog({ groups: "nope" }), []);
  const entries = normalizeModelCatalog({
    groups: [{ id: "p", models: [{ model: "m", provider: "other" }, null, {}] }],
  });
  assert.deepEqual(entries[0]?.choices.map((choice) => choice.key), ["other/m"]);
});

test("defaultSelection and selectionKey read the catalog default", () => {
  assert.deepEqual(defaultSelection(CATALOG), {
    provider: "opencode-go",
    model: "deepseek-v4.1-flash",
  });
  assert.deepEqual(defaultSelection({ default: "a/b" }), { provider: "a", model: "b" });
  assert.equal(defaultSelection({}), undefined);
  assert.equal(
    selectionKey({ provider: "p", model: "m", reasoningEffort: "high" }),
    "p/m",
  );
});

test("modelChipLabel and findChoice resolve the current selection", () => {
  const groups = normalizeModelCatalog(CATALOG);
  const selection = { provider: "opencode-go", model: "deepseek-v4.1-flash" };
  assert.equal(modelChipLabel(groups, selection), "DeepSeek V4.1 Flash");
  assert.equal(findChoice(groups, selection)?.model, "deepseek-v4.1-flash");
  assert.equal(modelChipLabel(groups, { provider: "x", model: "y" }), "y");
  assert.equal(modelChipLabel(groups, undefined), undefined);
});
