/**
 * transcript.ts - pure reducer: DSH SessionEvent[] (+ live streaming fragment)
 * to the list of items the chat screen renders.
 *
 * Contract: docs/app-architecture.md section 3.3 and docs/protocol.md 5 / 9.2.
 *
 * Rules encoded here:
 * - Only real user input becomes a user bubble: user/message with
 *   data.source.kind === 'user' (protocol 9.2). Injected messages such as
 *   runtime-context, skill-catalog or user-question-reply are dropped.
 * - assistant/message becomes one assistant item (text + reasoning). Tool-call
 *   blocks inside the message also become tool items.
 * - tool/call and tool/result merge into one item keyed by callId.
 * - approval/asked and approval/decided merge into one item keyed by
 *   requestId; a decision without a prior ask still renders as history.
 * - todo/write replaces the latest todo item (snapshot semantics).
 * - turn/start and turn/end become turn boundary items (the chat screen folds
 *   them, see components/chat).
 * - Live streaming text is appended as the trailing assistant item with
 *   streaming: true; the final assistant/message event replaces it once the
 *   store clears current.streaming.
 *
 * Everything is synchronous and side-effect free (no clock, no store access),
 * so it is unit tested with node --test (transcript.test.ts).
 *
 * The types below are structural and intentionally permissive: app-core's
 * protocol types in src/lib/types.ts are assignable to them, and missing or
 * unknown fields must never throw (protocol 7: forward compatibility).
 */

/* ------------------------------------------------------------------ types */

/** Minimal shape of a DSH session event. Extra fields are ignored. */
export interface SessionEventLike {
  type: string;
  seq?: number;
  time?: number;
  data?: unknown;
  id?: string;
}

/** Live assistant fragment, mirroring the store's current.streaming. */
export interface TranscriptStreaming {
  attemptId?: string;
  text?: string;
  reasoning?: string;
  active?: boolean;
}

/** An approval, mirroring protocol 3.10 Approval. */
export interface TranscriptApproval {
  id: string;
  sessionId?: string;
  tool?: string;
  callId?: string;
  reason?: string;
  displayReason?: string;
  requestedAt?: number;
  expiresAt?: number | null;
  /** Set by approval/decided: 'allowed' | 'rejected'. */
  outcome?: string;
  /** Set by approval/decided when the raw decision is present. */
  decision?: string;
}

/** An image block inside a user message (protocol 3.8). */
export interface TranscriptImage {
  type?: string;
  mediaType?: string;
  name?: string;
  data?: string;
  url?: string;
  /** Host-side attachment reference (sha256:...) for images sent from the app. */
  attachmentId?: string;
}

export type TranscriptTodoStatus =
  | "pending"
  | "in-progress"
  | "completed"
  | "cancelled";

/** A normalized todo row, ready for beUI's TodoList. */
export interface TranscriptTodo {
  id: string;
  title: string;
  status: TranscriptTodoStatus;
  progress?: number;
}

/** An optimistic user message that has not been confirmed by the host yet. */
export interface TranscriptPendingUser {
  requestId: string;
  text: string;
  time?: number;
  status?: "sending" | "failed";
  images?: TranscriptImage[];
}

export interface BuildTranscriptOptions {
  /** Optimistic messages rendered after the confirmed ones (deduped by requestId). */
  pending?: TranscriptPendingUser[] | null;
  imagePreviews?: Record<string, TranscriptImage[]>;
}

/** One renderable row. */
export type TranscriptItem =
  | {
      kind: "user";
      id: string;
      text: string;
      images?: TranscriptImage[];
      time: number;
      pending?: boolean;
      failed?: boolean;
    }
  | {
      kind: "assistant";
      id: string;
      text: string;
      reasoning?: string;
      images?: TranscriptImage[];
      time: number;
      streaming?: boolean;
    }
  | {
      kind: "tool";
      id: string;
      callId: string;
      name: string;
      input?: unknown;
      status: "running" | "ok" | "error";
      result?: string;
      meta?: unknown;
      images?: TranscriptImage[];
      time: number;
    }
  | { kind: "approval"; id: string; approval: TranscriptApproval }
  | { kind: "turn"; id: string; label: "start" | "end"; time: number }
  | { kind: "changes"; id: string; seq: number; time: number }
  | { kind: "deliverables"; id: string; files: { path: string; label?: string }[]; title?: string; time: number }
  | { kind: "todo"; id: string; items: TranscriptTodo[]; time: number };

/* --------------------------------------------------------------- utilities */

type Rec = Record<string, unknown>;

function asRecord(value: unknown): Rec | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Rec)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Normalizes any text-ish value; objects fall back to compact JSON. */
function stringify(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

/**
 * True only for genuine user input: protocol 9.2 requires
 * source.kind === 'user'. Some hosts (and the reference mock host) send the
 * shortcut form source: 'user'; both are accepted. Everything else -
 * runtime-context, skill-catalog, system replies - is hidden.
 */
export function isUserSource(source: unknown): boolean {
  if (source === "user") return true;
  const record = asRecord(source);
  return record?.kind === "user";
}

function joinText(parts: string[]): string {
  return parts.filter((part) => part.length > 0).join("\n");
}

type ToolCallBlock = { callId: string; name: string; input?: unknown };
type ToolResultBlock = { callId: string; text: string; isError: boolean };

type ReadParts = {
  text: string;
  reasoning: string;
  images: TranscriptImage[];
  toolCalls: ToolCallBlock[];
  toolResults: ToolResultBlock[];
};

/** Reads a message content array (text / reasoning / image / tool blocks). */
function readParts(content: unknown): ReadParts {
  const result: ReadParts = {
    text: "",
    reasoning: "",
    images: [],
    toolCalls: [],
    toolResults: [],
  };
  if (typeof content === "string") {
    result.text = content;
    return result;
  }
  const texts: string[] = [];
  const reasonings: string[] = [];
  for (const raw of asArray(content)) {
    const block = asRecord(raw);
    if (!block) {
      const plain = asString(raw);
      if (plain) texts.push(plain);
      continue;
    }
    const type = asString(block.type) ?? "";
    switch (type) {
      case "text":
      case "output_text": {
        const text = asString(block.text) ?? asString(block.value);
        if (text) texts.push(text);
        break;
      }
      case "reasoning":
      case "thinking":
      case "reasoning_text": {
        const text = asString(block.text) ?? asString(block.reasoning);
        if (text) reasonings.push(text);
        break;
      }
      case "image":
      case "image_url": {
        const attachment = asRecord(block.attachment);
        const source = asRecord(block.source);
        const imageUrl = asRecord(block.image_url);
        result.images.push({
          type: "image",
          mediaType: asString(block.mediaType) ?? asString(block.mimeType) ?? asString(attachment?.mediaType) ?? asString(source?.media_type) ?? asString(source?.mediaType),
          name: asString(block.name) ?? asString(attachment?.name),
          data: asString(block.data) ?? asString(source?.data),
          url: asString(block.url) ?? asString(block.imageUrl) ?? asString(block.image_url) ?? asString(imageUrl?.url) ?? asString(source?.url),
          attachmentId: asString(block.attachmentId) ?? asString(attachment?.attachmentId) ?? asString(attachment?.id),
        });
        break;
      }
      case "tool-call":
      case "tool_call":
      case "tool-use":
      case "tool_use": {
        const callId =
          asString(block.callId) ??
          asString(block.toolCallId) ??
          asString(block.id);
        const name =
          asString(block.name) ??
          asString(block.toolName) ??
          asString(block.tool);
        if (callId) {
          result.toolCalls.push({
            callId,
            name: name ?? "tool",
            input: parseToolInput(block.input ?? block.args ?? block.arguments),
          });
        }
        break;
      }
      case "tool-result":
      case "tool_result": {
        const callId =
          asString(block.callId) ??
          asString(block.toolCallId) ??
          asString(block.id);
        if (callId) {
          result.toolResults.push({
            callId,
            text: resultText(block.output ?? block.content ?? block.result) ?? "",
            isError: block.isError === true || block.error != null,
          });
        }
        break;
      }
      default: {
        // Unknown block: keep its text when it carries any.
        const text = asString(block.text);
        if (type === "" && text) texts.push(text);
      }
    }
  }
  result.text = joinText(texts);
  result.reasoning = joinText(reasonings);
  return result;
}

/** Flattens a tool result payload into displayable text. */
function resultText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const direct = stringify(value);
  if (typeof value === "string") return value;
  if (typeof value !== "object") return direct;
  const record = asRecord(value);
  if (!record) {
    const list = asArray(value)
      .map((entry) => resultText(entry))
      .filter((entry): entry is string => Boolean(entry));
    return list.length > 0 ? list.join("\n") : "";
  }
  if (record.type === "image" || record.type === "image_url") return undefined;
  const candidate =
    record.text ??
    record.content ??
    record.output ??
    record.stdout ??
    record.result ??
    record.message;
  if (candidate !== undefined && candidate !== value) {
    const nested = resultText(candidate);
    if (nested !== undefined) return nested;
  }
  const list = asArray(record.content)
    .map((entry) => resultText(entry))
    .filter((entry): entry is string => Boolean(entry));
  if (list.length > 0) return list.join("\n");
  return direct;
}

function todoStatus(value: unknown): TranscriptTodoStatus {
  const status = (asString(value) ?? "").toLowerCase().replace(/[_\s]/g, "-");
  if (status === "completed" || status === "complete" || status === "done") {
    return "completed";
  }
  if (
    status === "in-progress" ||
    status === "inprogress" ||
    status === "active" ||
    status === "running"
  ) {
    return "in-progress";
  }
  if (status === "cancelled" || status === "canceled") return "cancelled";
  return "pending";
}

/** Normalizes a todo/write payload into rows beUI's TodoList accepts. */
export function readTodos(data: unknown): TranscriptTodo[] {
  const record = asRecord(data);
  const rawList = Array.isArray(data)
    ? data
    : asArray(record?.todos ?? record?.items ?? record?.tasks);
  const todos: TranscriptTodo[] = [];
  rawList.forEach((raw, index) => {
    const entry = asRecord(raw);
    if (!entry) {
      const text = asString(raw);
      if (text) {
        todos.push({ id: "todo-" + index, title: text, status: "pending" });
      }
      return;
    }
    const title =
      asString(entry.title) ??
      asString(entry.content) ??
      asString(entry.subject) ??
      asString(entry.text) ??
      asString(entry.label) ??
      asString(entry.task);
    if (!title) return;
    const progress = asNumber(entry.progress);
    todos.push({
      id: asString(entry.id) ?? "todo-" + index,
      title,
      status: todoStatus(entry.status),
      ...(progress === undefined ? {} : { progress }),
    });
  });
  return todos;
}

function parseToolInput(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function eventTime(event: SessionEventLike): number {
  return asNumber(event.time) ?? asNumber(asRecord(event.data)?.time) ?? 0;
}

/**
 * Validates, orders (by seq) and de-duplicates raw events.
 * A repeated seq is a protocol-level replay: keep the first one.
 */
export function normalizeEvents(
  events: readonly SessionEventLike[] | null | undefined,
): SessionEventLike[] {
  if (!Array.isArray(events)) return [];
  const seen = new Set<number>();
  const rows: { event: SessionEventLike; order: number }[] = [];
  events.forEach((event, order) => {
    if (!event || typeof event !== "object") return;
    const type = asString((event as { type?: unknown }).type);
    if (!type) return;
    const seq = asNumber((event as { seq?: unknown }).seq);
    if (seq !== undefined) {
      if (seen.has(seq)) return;
      seen.add(seq);
    }
    rows.push({ event, order });
  });
  const allSequenced = rows.every(
    (row) => asNumber(row.event.seq) !== undefined,
  );
  if (allSequenced) {
    rows.sort(
      (a, b) => (asNumber(a.event.seq) ?? 0) - (asNumber(b.event.seq) ?? 0),
    );
  }
  return rows.map((row) => row.event);
}

type ToolItem = Extract<TranscriptItem, { kind: "tool" }>;

/* ------------------------------------------------------------- the reducer */

/**
 * Turns session events (plus the live streaming fragment) into render items.
 *
 * Pure: same inputs give the same output. Malformed events are skipped instead
 * of throwing, so one bad frame can never blank the conversation.
 */
export function buildTranscript(
  events: readonly SessionEventLike[] | null | undefined,
  streaming?: TranscriptStreaming | null,
  options?: BuildTranscriptOptions | null,
): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  /** callId to index in items, for tool/call + tool/result merging. */
  const toolIndex = new Map<string, number>();
  /** requestId to index in items, for approval/asked + approval/decided. */
  const approvalIndex = new Map<string, number>();
  /** A todo list is a snapshot: the latest write replaces the previous item. */
  let todoIndex = -1;
  /** rpcIds of confirmed user messages, to drop their optimistic twin. */
  const confirmedRequests = new Set<string>();
  let lastTime = 0;
  const produced = new Map<string, { path: string; label?: string }>();

  const putTool = (tool: ToolItem): void => {
    const existing = toolIndex.get(tool.callId);
    if (existing === undefined) {
      toolIndex.set(tool.callId, items.length);
      items.push(tool);
      return;
    }
    items[existing] = tool;
  };

  const upsertTool = (
    callId: string,
    name: string,
    input: unknown,
    time: number,
    patch?: Partial<Pick<ToolItem, "status" | "result" | "images" | "meta">>,
  ): void => {
    const index = toolIndex.get(callId);
    if (index === undefined) {
      putTool({
        kind: "tool",
        id: "tool-" + callId,
        callId,
        name,
        input,
        status: patch?.status ?? "running",
        result: patch?.result,
        images: patch?.images,
        meta: patch?.meta,
        time,
      });
      return;
    }
    const current = items[index];
    if (!current || current.kind !== "tool") return;
    items[index] = {
      ...current,
      name: name !== "" && name !== "tool" ? name : current.name,
      input: input === undefined ? current.input : input,
      status: patch?.status ?? current.status,
      result: patch?.result ?? current.result,
      images: patch?.images ?? current.images,
      meta: patch?.meta ?? current.meta,
      time: current.time || time,
    };
  };

  const recordProduced = (callId: string) => {
    const index = toolIndex.get(callId); const tool = index === undefined ? undefined : items[index];
    if (tool?.kind !== 'tool' || tool.status !== 'ok' || !/^(write|edit|write_file|edit_file)$/i.test(tool.name)) return;
    const input = asRecord(tool.input); const meta = asRecord(tool.meta);
    const path = asString(meta?.path) ?? asString(input?.path) ?? asString(input?.file_path);
    if (path) produced.set(path, { path });
  };
  const flushProduced = (time: number, seq: unknown) => {
    if (produced.size) items.push({ kind: 'deliverables', id: 'produced-' + String(seq ?? items.length), title: '已修改文件', files: [...produced.values()], time });
    produced.clear();
  };

  const lastRunningTool = (): ToolItem | undefined => {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (!item) continue;
      if (item.kind === "tool") {
        return item.status === "running" ? item : undefined;
      }
      if (item.kind === "assistant" || item.kind === "turn") return undefined;
    }
    return undefined;
  };

  for (const event of normalizeEvents(events)) {
    try {
      const time = eventTime(event);
      if (time > lastTime) lastTime = time;
      const data = asRecord(event.data) ?? {};

      switch (event.type) {
        case "user/message": {
          if (!isUserSource(data.source)) break;
          const parts = readParts(data.content);
          if (!parts.text.trim() && parts.images.length === 0) break;
          const source = asRecord(data.source);
          const rpcId = asString(source?.rpcId);
          const previews = rpcId ? options?.imagePreviews?.[rpcId] : undefined;
          if (rpcId) confirmedRequests.add(rpcId);
          items.push({
            kind: "user",
            id:
              asString(data.id) ??
              rpcId ??
              "user-" + (asNumber(event.seq) ?? items.length),
            text: parts.text,
            ...(previews?.length ? { images: previews } : parts.images.length > 0 ? { images: parts.images } : {}),
            time,
          });
          break;
        }

        case "assistant/message": {
          const message = asRecord(data.message) ?? {};
          const parts = readParts(message.content);
          if (parts.text || parts.reasoning || parts.images.length) {
            items.push({
              kind: "assistant",
              id:
                asString(message.id) ??
                "assistant-" + (asNumber(event.seq) ?? items.length),
              text: parts.text,
              ...(parts.reasoning ? { reasoning: parts.reasoning } : {}),
              ...(parts.images.length ? { images: parts.images } : {}),
              time,
            });
          }
          for (const call of parts.toolCalls) {
            upsertTool(call.callId, call.name, call.input, time);
          }
          for (const result of parts.toolResults) {
            upsertTool(result.callId, "tool", undefined, time, {
              status: result.isError ? "error" : "ok",
              result: result.text,
            });
          }
          break;
        }

        case "tool/ptc-dispatch-start":
        case "tool/ptc-dispatch": {
          const callId = asString(data.subCallId);
          if (!callId) break;
          const parts = readParts(data.content);
          upsertTool(callId, asString(data.name) ?? 'tool', parseToolInput(data.arguments), time,
            event.type === 'tool/ptc-dispatch' ? { status: data.isError === true ? 'error' : 'ok', result: resultText(data.content), images: parts.images, meta: data.meta } : undefined);
          recordProduced(callId);
          break;
        }
        case "tool/call": {
          const callId =
            asString(data.callId) ??
            asString(data.toolCallId) ??
            asString(data.id);
          if (!callId) break;
          upsertTool(
            callId,
            asString(data.name) ??
              asString(data.toolName) ??
              asString(data.tool) ??
              "tool",
            parseToolInput(data.input ?? data.args ?? data.arguments),
            time,
          );
          break;
        }

        case "tool/result": {
          const message = asRecord(data.message) ?? {};
          const contentParts = readParts(message.content);
          const callId =
            asString(data.callId) ??
            asString(data.toolCallId) ??
            asString(message.toolCallId) ??
            asString(asRecord(message.source)?.callId) ??
            asString(data.id) ??
            contentParts.toolResults[0]?.callId ??
            lastRunningTool()?.callId;
          const text =
            resultText(message.content) ??
            resultText(data.result) ??
            resultText(data.output) ??
            contentParts.text ??
            "";
          const isError = data.isError === true || message.isError === true || data.error != null;
          const fallbackId =
            "tool-result-" + (asNumber(event.seq) ?? items.length);
          if (!callId) {
            // Unknown call: still show the output rather than losing it.
            putTool({
              kind: "tool",
              id: fallbackId,
              callId: fallbackId,
              name: asString(data.name) ?? "tool",
              status: isError ? "error" : "ok",
              result: text,
              images: contentParts.images,
              time,
            });
            break;
          }
          upsertTool(callId, "tool", undefined, time, {
            status: isError ? "error" : "ok",
            result: text,
            images: contentParts.images,
            meta: data.meta,
          });
          recordProduced(callId);
          break;
        }

        case "approval/asked": {
          const requestId =
            asString(data.requestId) ??
            asString(data.id) ??
            "approval-" + (asNumber(event.seq) ?? items.length);
          const approval: TranscriptApproval = {
            id: requestId,
            sessionId: asString(data.sessionId),
            tool: asString(data.tool) ?? asString(data.toolName),
            callId: asString(data.callId),
            reason: asString(data.reason),
            displayReason:
              asString(data.displayReason) ?? asString(data.description),
            requestedAt: asNumber(data.requestedAt) ?? time,
            expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : null,
          };
          const existing = approvalIndex.get(requestId);
          if (existing === undefined) {
            approvalIndex.set(requestId, items.length);
            items.push({ kind: "approval", id: "approval-" + requestId, approval });
          } else {
            items[existing] = {
              kind: "approval",
              id: "approval-" + requestId,
              approval,
            };
          }
          break;
        }

        case "approval/decided": {
          const requestId = asString(data.requestId) ?? asString(data.id);
          if (!requestId) break;
          const outcome =
            asString(data.outcome) ??
            (data.decision === "allow"
              ? "allowed"
              : data.decision === "reject"
                ? "rejected"
                : undefined);
          const existing = approvalIndex.get(requestId);
          if (existing === undefined) {
            approvalIndex.set(requestId, items.length);
            items.push({
              kind: "approval",
              id: "approval-" + requestId,
              approval: {
                id: requestId,
                tool: asString(data.tool),
                displayReason: asString(data.displayReason),
                requestedAt: time,
                outcome,
                decision: asString(data.decision),
              },
            });
            break;
          }
          const current = items[existing];
          if (!current || current.kind !== "approval") break;
          items[existing] = {
            kind: "approval",
            id: current.id,
            approval: {
              ...current.approval,
              outcome,
              decision: asString(data.decision) ?? current.approval.decision,
            },
          };
          break;
        }

        case "workspace/changes": {
          if (typeof event.seq === 'number') items.push({ kind: 'changes', id: 'changes-' + event.seq, seq: event.seq, time });
          break;
        }
        case "deliverables/presented": {
          const files = asArray(data.files).flatMap((raw) => {
            const file = asRecord(raw); const path = asString(file?.path);
            return path ? [{ path, label: asString(file?.label) ?? asString(file?.description) }] : [];
          });
          files.forEach(file => produced.delete(file.path));
          if (files.length) items.push({ kind: 'deliverables', id: 'deliverables-' + (event.seq ?? items.length), files, time });
          break;
        }
        case "todo/write": {
          const todos = readTodos(event.data);
          if (todos.length === 0) break;
          const todo: TranscriptItem & { kind: "todo" } = {
            kind: "todo",
            id: "todo-" + (asNumber(event.seq) ?? items.length),
            items: todos,
            time,
          };
          if (todoIndex >= 0) items[todoIndex] = todo;
          else {
            todoIndex = items.length;
            items.push(todo);
          }
          break;
        }

        case "turn/start":
        case "turn/end": {
          if (event.type === "turn/end") flushProduced(time, event.seq);
          else produced.clear();
          items.push({
            kind: "turn",
            id:
              "turn-" +
              event.type +
              "-" +
              (asNumber(event.seq) ?? items.length),
            label: event.type === "turn/start" ? "start" : "end",
            time,
          });
          break;
        }

        default:
          break;
      }
    } catch {
      // A malformed frame must never break the transcript (protocol 7).
    }
  }

  // Live assistant text rides on the trailing assistant item.
  const streamText = asString(streaming?.text) ?? "";
  const streamReasoning = asString(streaming?.reasoning) ?? "";
  if (streamText.length > 0 || streamReasoning.length > 0) {
    const last = items[items.length - 1];
    const alreadyRendered =
      last !== undefined &&
      last.kind === "assistant" &&
      last.text === streamText &&
      (last.reasoning ?? "") === streamReasoning;
    if (!alreadyRendered) {
      items.push({
        kind: "assistant",
        id: "streaming-" + (asString(streaming?.attemptId) ?? "current"),
        text: streamText,
        ...(streamReasoning ? { reasoning: streamReasoning } : {}),
        time: lastTime,
        streaming: streaming?.active !== false,
      });
    }
  }

  // Optimistic user messages that the host has not echoed yet.
  for (const pending of options?.pending ?? []) {
    if (!pending || typeof pending.text !== "string" || !pending.text.trim()) {
      continue;
    }
    if (!pending.requestId) continue;
    if (confirmedRequests.has(pending.requestId)) continue;
    if (items.some((item) => item.kind === "user" && item.id === pending.requestId)) {
      continue;
    }
    items.push({
      kind: "user",
      id: pending.requestId,
      text: pending.text,
      time: asNumber(pending.time) ?? lastTime,
      pending: true,
      failed: pending.status === 'failed',
      ...(pending.images?.length ? { images: pending.images } : {}),
    });
  }

  return items;
}

/** Convenience for headers: how many completed turns the transcript holds. */
export function countTurns(items: readonly TranscriptItem[]): number {
  let turns = 0;
  for (const item of items) {
    if (item.kind === "turn" && item.label === "end") turns += 1;
  }
  return turns;
}
