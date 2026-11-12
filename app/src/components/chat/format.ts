import type { CodeLanguage } from "../../primitives/code-tokens";

/* --------------------------------------------------------------- time */

/** 24h clock, HH:MM. Returns "" for a missing/invalid timestamp. */
export function formatClock(time: number | undefined | null): string {
  if (typeof time !== "number" || !Number.isFinite(time) || time <= 0) return "";
  const date = new Date(time);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return hours + ":" + minutes;
}

/** Compact elapsed time: "8s", "1m 04s", "1h 12m". */
export function formatDuration(ms: number | undefined | null): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "";
  const total = Math.round(ms / 1000);
  if (total < 60) return total + "s";
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) {
    return seconds === 0
      ? minutes + "m"
      : minutes + "m " + String(seconds).padStart(2, "0") + "s";
  }
  const hours = Math.floor(minutes / 60);
  return hours + "h " + (minutes % 60) + "m";
}

/* -------------------------------------------------------------- text */

/** Cuts at a word boundary where possible and adds an ellipsis. */
export function truncate(text: string, max: number): string {
  const value = text.trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, Math.max(0, max - 1));
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd() + "…";
}

/** Keeps the end of a long path, which is the part that identifies it. */
export function shortenPath(path: string, max = 36): string {
  const value = path.trim().replace(/\\/g, "/");
  if (value.length <= max) return value;
  return "…" + value.slice(value.length - (max - 1));
}

const LANGUAGE_ALIASES: Record<string, CodeLanguage> = {
  diff: "diff",
  patch: "patch",
  ts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  js: "javascript",
  javascript: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "json",
  json5: "json",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  cmd: "bash",
  bat: "bash",
  powershell: "bash",
  ps1: "bash",
  pwsh: "bash",
  py: "python",
  python: "python",
  go: "go",
  golang: "go",
  rust: "rust",
  rs: "rust",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  css: "css",
  scss: "css",
  md: "markdown",
  markdown: "markdown",
  kotlin: "kotlin",
  kt: "kotlin",
  swift: "swift",
  text: "text",
  txt: "text",
  plain: "text",
  log: "text",
};

/** Maps a fenced-code info string or file extension to a Prism language. */
export function toCodeLanguage(raw: string | undefined | null): CodeLanguage {
  const key = (raw ?? "").trim().toLowerCase().replace(/^\./, "").split(/\s+/)[0];
  if (key in LANGUAGE_ALIASES) return LANGUAGE_ALIASES[key] ?? "text";
  return "text";
}

const EXTENSIONS: Record<string, CodeLanguage> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  scss: "css",
  md: "markdown",
  py: "python",
  go: "go",
  rs: "rust",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  kt: "kotlin",
  swift: "swift",
  sh: "bash",
  ps1: "bash",
  bat: "bash",
};

export function languageFromPath(path: string | undefined): CodeLanguage {
  if (!path) return "text";
  const match = /\.([a-zA-Z0-9]+)(?:[?#].*)?$/.exec(path.trim());
  if (!match) return "text";
  return EXTENSIONS[(match[1] ?? "").toLowerCase()] ?? "text";
}

export type AssistantSegment =
  | { kind: "text"; text: string }
  | { kind: "code"; code: string; language: CodeLanguage; closed: boolean };

/**
 * Splits an assistant reply into prose and fenced code blocks.
 * An unclosed fence (still streaming) yields a code segment with closed: false.
 */
export function splitFencedCode(text: string): AssistantSegment[] {
  const segments: AssistantSegment[] = [];
  const fence = /```([^\n`]*)\n?/g;
  let cursor = 0;
  for (;;) {
    fence.lastIndex = cursor;
    const match = fence.exec(text);
    if (!match) break;
    const start = match.index;
    const bodyStart = start + match[0].length;
    const closing = text.indexOf("```", bodyStart);
    const before = text.slice(cursor, start).replace(/^\n+/, "").replace(/\n+$/, "");
    if (before.trim().length > 0) segments.push({ kind: "text", text: before });
    if (closing === -1) {
      const code = text.slice(bodyStart).replace(/\n$/, "");
      segments.push({
        kind: "code",
        code,
        language: toCodeLanguage(match[1]),
        closed: false,
      });
      cursor = text.length;
      break;
    }
    segments.push({
      kind: "code",
      code: text.slice(bodyStart, closing).replace(/\n$/, ""),
      language: toCodeLanguage(match[1]),
      closed: true,
    });
    cursor = closing + 3;
  }
  const rest = text.slice(cursor).replace(/^\n+/, "").replace(/\n+$/, "");
  if (rest.trim().length > 0) segments.push({ kind: "text", text: rest });
  return segments.length > 0 ? segments : [{ kind: "text", text }];
}

export type InlineSegment = { kind: "text" | "code"; text: string };

/** Splits prose into plain runs and `inline code` runs. */
export function splitInlineCode(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const pattern = /`([^`\n]+)`/g;
  let cursor = 0;
  for (;;) {
    pattern.lastIndex = cursor;
    const match = pattern.exec(text);
    if (!match) break;
    if (match.index > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, match.index) });
    }
    segments.push({ kind: "code", text: match[1] ?? "" });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
  return segments;
}

/* -------------------------------------------------------------- tools */

const TOOL_LABELS: Record<string, string> = {
  pwsh: "运行命令",
  powershell: "运行命令",
  shell: "运行命令",
  bash: "运行命令",
  sh: "运行命令",
  terminal: "运行命令",
  exec: "运行命令",
  run: "运行命令",
  read: "读取文件",
  read_file: "读取文件",
  write: "写入文件",
  write_file: "写入文件",
  edit: "编辑文件",
  apply_patch: "编辑文件",
  patch: "编辑文件",
  grep: "搜索内容",
  rg: "搜索内容",
  search: "搜索内容",
  glob: "查找文件",
  find: "查找文件",
  ls: "列出文件",
  list: "列出文件",
  web_search: "网络搜索",
  websearch: "网络搜索",
  web_fetch: "读取网页",
  webfetch: "读取网页",
  fetch: "读取网页",
  todo_write: "更新任务",
  todowrite: "更新任务",
  todo: "更新任务",
  task: "派发子任务",
  agent: "派发子任务",
  question: "向你提问",
  mcp: "调用 MCP 工具",
};

function lookupToolName(name: string): string {
  const key = name.trim().toLowerCase().replace(/[\s.-]/g, "_");
  return TOOL_LABELS[key] ?? TOOL_LABELS[key.replace(/^dsh_/, "")] ?? "";
}

/** Human label for a tool name, falling back to the raw tool id. */
export function toolLabel(name: string | undefined): string {
  if (!name) return "工具";
  const known = lookupToolName(name);
  if (known) return known;
  return name;
}

/** The most useful one-line summary of a tool call, shown as its subtitle. */
export function toolTarget(
  name: string | undefined,
  input: unknown,
): string | undefined {
  const record = asRecord(input);
  if (!record) {
    return typeof input === "string" ? truncate(input, 80) : undefined;
  }
  const direct =
    record.command ??
    record.cmd ??
    record.commandLine ??
    record.path ??
    record.file_path ??
    record.filePath ??
    (Array.isArray(record.queries) ? record.queries.join("，") : record.query) ??
    record.url ??
    record.pattern;
  if (typeof direct === "string" && direct.trim().length > 0) {
    return truncate(direct.replace(/\s+/g, " "), 80);
  }
  const nested = asRecord(record.input) ?? asRecord(record.args);
  if (nested) return toolTarget(name, nested);
  return undefined;
}

/** A shell command or code snippet carried by the tool input, if any. */
export function toolCode(
  name: string | undefined,
  input: unknown,
): { code: string; language: CodeLanguage } | undefined {
  if (typeof input === 'string' && /patch|diff/.test(name ?? '')) return { code: input, language: 'diff' };
  const record = asRecord(input);
  if (!record) return undefined;
  if (typeof record.patch === 'string') return { code: record.patch, language: 'diff' };
  if (typeof record.diff === 'string') return { code: record.diff, language: 'diff' };
  const command =
    record.command ?? record.cmd ?? record.commandLine ?? record.script;
  if (typeof command === "string" && command.trim().length > 0) {
    return { code: command, language: "bash" };
  }
  const code = record.code ?? record.content ?? record.newText ?? record.new_text;
  if (typeof code === "string" && code.trim().length > 0) {
    const path = record.path ?? record.file_path ?? record.filePath;
    return { code, language: languageFromPath(typeof path === "string" ? path : undefined) };
  }
  const json = record.input ?? record.args ?? record.arguments ?? record.patch;
  if (json !== undefined && typeof json === "object") {
    try {
      return { code: JSON.stringify(json, null, 2), language: "json" };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** beUI ToolResult kind, chosen from the tool name. */
export function toolKind(name: string | undefined): "terminal" | "request" | "custom" {
  const key = (name ?? "").toLowerCase();
  if (/pwsh|shell|bash|terminal|exec|command|run/.test(key)) return "terminal";
  if (/fetch|http|request|web|search|url/.test(key)) return "request";
  return "custom";
}

/** One-line summary of an arbitrary value for metadata rows. */
export function summarize(value: unknown, max = 80): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return truncate(value.replace(/\s+/g, " "), max);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return truncate(JSON.stringify(value), max);
  } catch {
    return undefined;
  }
}

/** Shallow record guard shared by the helpers above. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
