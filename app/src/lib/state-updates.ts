/**
 * Pure state transition helpers used by the zustand store.
 *
 * Kept free of React Native imports (type-only imports are erased) so they can
 * be exercised with node --test. All functions are immutable: they return a new
 * value and never mutate their input.
 */

import type {
  Approval,
  AssistantStreamFrame,
  ModelSelection,
  PendingUser,
  SessionEvent,
  SessionProjections,
  SessionRow,
  StreamingState,
} from './types';

/** A fresh, idle streaming buffer. */
export function emptyStreaming(): StreamingState {
  return { text: '', reasoning: '', active: false };
}

/** Rebuild the compact prefix DSH supplies when joining an in-flight attempt. */
export function streamingFromSnapshot(value: unknown): StreamingState {
  if (!isObject(value) || !isObject(value.activeAttempt)) return emptyStreaming();
  const attempt = value.activeAttempt;
  if (typeof attempt.attemptId !== 'string' || !Array.isArray(attempt.stream)) return emptyStreaming();
  let state: StreamingState = { ...emptyStreaming(), attemptId: attempt.attemptId, active: true };
  let remaining = typeof attempt.nextIndex === 'number' ? attempt.nextIndex : Number.MAX_SAFE_INTEGER;
  for (const record of attempt.stream) {
    if (!isObject(record) || remaining <= 0) continue;
    if (record.type === 'chunk') {
      state = applyAssistantFrame(state, { type: 'chunk', attemptId: attempt.attemptId, chunk: record.chunk } as AssistantStreamFrame);
      remaining--;
    } else if (record.type === 'text-chunks' || record.type === 'reasoning-chunks') {
      if (!Array.isArray(record.texts)) continue;
      const text = record.texts.slice(0, remaining).filter((part): part is string => typeof part === 'string').join('');
      state = { ...state, ...(record.type === 'text-chunks' ? { text: state.text + text } : { reasoning: state.reasoning + text }) };
      remaining -= record.texts.length;
    } else if (record.type === 'tool-call-chunks' && Array.isArray(record.args)) remaining -= record.args.length;
  }
  return state;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Structural check for a DSH session event. */
export function isEventLike(value: unknown): value is SessionEvent {
  return isObject(value) && typeof value.type === 'string';
}

function isModelSelection(value: unknown): value is ModelSelection {
  return isObject(value) && typeof value.provider === 'string' && typeof value.model === 'string';
}

/**
 * Append a live event, de-duplicating by seq (protocol 6: reconnects can replay
 * frames). Out-of-order events with a new seq are still kept; the transcript
 * sorts by seq.
 */
export function appendEvent(events: SessionEvent[], event: SessionEvent): SessionEvent[] {
  if (!isEventLike(event)) return events;
  const seq = typeof event.seq === 'number' ? event.seq : undefined;
  if (seq !== undefined) {
    const last = events.length > 0 ? events[events.length - 1] : undefined;
    const lastSeq = last && typeof last.seq === 'number' ? last.seq : undefined;
    if (lastSeq !== undefined && seq <= lastSeq && events.some((item) => item.seq === seq)) {
      return events;
    }
  }
  return [...events, event];
}

/** Replace the whole event list from a snapshot's records array. */
export function replaceEvents(records: unknown): SessionEvent[] {
  if (!Array.isArray(records)) return [];
  const seen = new Set<number>();
  const events: SessionEvent[] = [];
  for (const record of records) {
    if (!isObject(record)) continue;
    const event = record.event;
    if (!isEventLike(event)) continue;
    if (typeof event.seq === 'number') {
      if (seen.has(event.seq)) continue;
      seen.add(event.seq);
    }
    events.push(event);
  }
  events.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  return events;
}

/** Assistant stream frame -> next streaming buffer (protocol 9.1 + mock shape). */
export function applyAssistantFrame(previous: StreamingState | null | undefined, frame: AssistantStreamFrame | null | undefined): StreamingState {
  const base = previous ?? emptyStreaming();
  if (!isObject(frame) || typeof (frame as { type?: unknown }).type !== 'string') return base;
  const attemptId = typeof frame.attemptId === 'string' && frame.attemptId
    ? frame.attemptId
    : typeof frame.attempt === 'string' && frame.attempt
      ? frame.attempt
      : base.attemptId;

  if (frame.type === 'start') {
    return { attemptId, text: '', reasoning: '', active: true };
  }
  if (frame.type === 'end') {
    return { ...base, attemptId, active: false };
  }

  if (frame.type === 'chunk' && isObject(frame.chunk)) {
    const chunk = frame.chunk;
    if (chunk.type === 'text-delta') {
      const text = typeof chunk.text === 'string' ? chunk.text : '';
      return { ...base, attemptId, text: base.text + text, active: true };
    }
    if (chunk.type === 'reasoning-delta') {
      const reasoning = typeof chunk.text === 'string' ? chunk.text : '';
      return { ...base, attemptId, reasoning: base.reasoning + reasoning, active: true };
    }
    // block-start / block-end / usage / tool deltas carry no renderable text.
    return { ...base, attemptId, active: true };
  }

  // Reference mock host (tools/verify/mock-server.mjs) uses a phase wrapper.
  if (frame.type === 'assistant-stream') {
    if (frame.phase === 'start') return { attemptId, text: '', reasoning: '', active: true };
    if (frame.phase === 'end') return { ...base, attemptId, active: false };
    const delta = isObject(frame.delta) ? frame.delta : {};
    const text = typeof delta.text === 'string' ? delta.text : '';
    const reasoning = typeof delta.reasoning === 'string' ? delta.reasoning : '';
    return {
      attemptId,
      text: base.text + text,
      reasoning: base.reasoning + reasoning,
      active: true,
    };
  }

  return { ...base, attemptId };
}

/** Drop optimistic bubbles whose user/message echo arrived (protocol 6.4). */
export function removeConfirmedPending(
  pending: PendingUser[],
  event: SessionEvent | null | undefined,
): PendingUser[] {
  if (!Array.isArray(pending) || pending.length === 0) return pending ?? [];
  if (!isEventLike(event) || event.type !== 'user/message') return pending;
  const data = isObject(event.data) ? event.data : null;
  const source = data && isObject(data.source) ? data.source : null;
  if (!source || source.kind !== 'user' || typeof source.rpcId !== 'string') return pending;
  const rpcId = source.rpcId;
  return pending.filter((item) => item.requestId !== rpcId);
}

/**
 * Drop optimistic bubbles already confirmed by a snapshot's history (P1-2).
 * Reconnects re-send the whole snapshot, so the confirmed user events may not
 * have produced a live user/message frame we could match against.
 */
export function filterPendingByEvents(pending: PendingUser[], events: SessionEvent[]): PendingUser[] {
  if (!Array.isArray(pending) || pending.length === 0) return pending ?? [];
  const confirmed = new Set<string>();
  for (const event of events) {
    if (!isEventLike(event) || event.type !== 'user/message' || !isObject(event.data)) continue;
    const source = isObject(event.data.source) ? event.data.source : null;
    if (source && source.kind === 'user' && typeof source.rpcId === 'string') confirmed.add(source.rpcId);
  }
  if (confirmed.size === 0) return pending;
  return pending.filter((item) => !confirmed.has(item.requestId));
}

/** Merge two event lists by seq (history paging + snapshot), sorted ascending. */
export function mergeEventLists(first: SessionEvent[], second: SessionEvent[]): SessionEvent[] {
  const seen = new Set<number>();
  const merged: SessionEvent[] = [];
  for (const event of [...first, ...second]) {
    if (!isEventLike(event)) continue;
    if (typeof event.seq === 'number') {
      if (seen.has(event.seq)) continue;
      seen.add(event.seq);
    }
    merged.push(event);
  }
  merged.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  return merged;
}

/** History pages move backwards from the oldest rendered event, not the live cursor. */
export function historyBoundary(events: SessionEvent[], fallback?: number | null): number | null {
  const sequences = events.map((event) => event.seq).filter((seq): seq is number => typeof seq === 'number' && Number.isFinite(seq));
  return sequences.length > 0 ? Math.min(...sequences) : typeof fallback === 'number' ? fallback : null;
}

/** Insert or replace an approval request. */
export function mergeApproval(list: Approval[], approval: Approval): Approval[] {
  if (!isObject(approval) || typeof approval.id !== 'string') return list;
  const index = list.findIndex((item) => item.id === approval.id);
  if (index === -1) return [...list, approval];
  const next = list.slice();
  next[index] = { ...list[index], ...approval };
  return next;
}

/** Remove an approval (resolved, expired, or answered on the desktop). */
export function removeApproval(list: Approval[], id: string): Approval[] {
  return list.filter((item) => item.id !== id);
}

/** Insert a fresh session row at the top or replace an existing one in place. */
export function upsertSessionRow(rows: SessionRow[], row: SessionRow): SessionRow[] {
  if (!isObject(row) || typeof row.sessionId !== 'string') return rows;
  const index = rows.findIndex((item) => item.sessionId === row.sessionId);
  if (index === -1) return [row, ...rows];
  const next = rows.slice();
  next[index] = { ...rows[index], ...row };
  return next;
}

/** Remove a session row. */
export function removeSessionRow(rows: SessionRow[], sessionId: string): SessionRow[] {
  return rows.filter((row) => row.sessionId !== sessionId);
}

/** Apply a session.status frame to the list rows. */
export function applySessionStatus(rows: SessionRow[], status: { sessionId?: string; running?: boolean; active?: boolean }): SessionRow[] {
  if (!isObject(status) || typeof status.sessionId !== 'string') return rows;
  const index = rows.findIndex((row) => row.sessionId === status.sessionId);
  if (index === -1) return rows;
  const next = rows.slice();
  next[index] = {
    ...rows[index],
    ...(typeof status.running === 'boolean' ? { running: status.running } : {}),
    ...(typeof status.active === 'boolean' ? { active: status.active } : {}),
  };
  return next;
}

/** Model selection from snapshot projections (protocol 9.4). */
export function modelFromProjections(projections: SessionProjections | null | undefined): ModelSelection | undefined {
  if (!isObject(projections)) return undefined;
  const values = isObject(projections.values) ? projections.values : projections;
  const selection = isObject(values.modelSelection) ? values.modelSelection : isObject(projections.modelSelection) ? projections.modelSelection : null;
  if (!selection) return undefined;
  const candidate = isModelSelection(selection.next) ? selection.next : isModelSelection(selection.lastUsed) ? selection.lastUsed : undefined;
  return candidate;
}

/** Title from snapshot projections. */
export function titleFromProjections(projections: SessionProjections | null | undefined): string | undefined {
  if (!isObject(projections)) return undefined;
  const values = isObject(projections.values) ? projections.values : projections;
  const title = values.title;
  return typeof title === 'string' && title.trim() !== '' ? title : undefined;
}

/** Title carried by a session/title event (protocol 9.3). */
export function titleFromEvent(event: SessionEvent | null | undefined): string | undefined {
  if (!isEventLike(event) || event.type !== 'session/title' || !isObject(event.data)) return undefined;
  const title = event.data.title;
  return typeof title === 'string' && title.trim() !== '' ? title : undefined;
}

export function cwdFromEvent(event: SessionEvent | null | undefined): string | undefined {
  if (!isEventLike(event) || event.type !== 'working-directory/change' || !isObject(event.data)) return undefined;
  return typeof event.data.cwd === 'string' && event.data.cwd.trim() ? event.data.cwd : undefined;
}

/** Keep project rows in sync with the same events rendered in the chat. */
export function applySessionEventToRows(rows: SessionRow[], sessionId: string, event: SessionEvent): SessionRow[] {
  const title = titleFromEvent(event);
  const model = modelFromEvent(event);
  const cwd = cwdFromEvent(event);
  if (title === undefined && model === undefined && cwd === undefined) return rows;
  return rows.map((row) => row.sessionId === sessionId ? {
    ...row, ...(title === undefined ? {} : { title }), ...(model === undefined ? {} : { model }),
    ...(cwd === undefined ? {} : { cwd }),
  } : row);
}

/** Model selection carried by a model/selection event. */
export function modelFromEvent(event: SessionEvent | null | undefined): ModelSelection | undefined {
  if (!isEventLike(event) || event.type !== 'model/selection' || !isObject(event.data)) return undefined;
  const data = event.data;
  if (isModelSelection(data.next)) return data.next;
  return isModelSelection(data) ? data : undefined;
}

/** running hint from turn boundaries when no session.state frame arrived yet. */
export function runningFromEvent(event: SessionEvent | null | undefined): boolean | undefined {
  if (!isEventLike(event)) return undefined;
  if (event.type === 'turn/start') return true;
  if (event.type === 'turn/end') return false;
  return undefined;
}
