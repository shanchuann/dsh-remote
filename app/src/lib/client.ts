/**
 * RemoteClient: HTTP JSON + SSE transport for the DSH Remote protocol v1.
 *
 * Contract: docs/app-architecture.md section 3.1. The store owns this object;
 * screens never talk to it directly. Every request throws ApiError with the
 * protocol error code attached, and every SSE frame is re-emitted as a typed
 * client event.
 */

import { ApiError } from './errors';
import { fetchText } from './http';
import { normalizeBaseUrl } from './pairing';
import { buildEventsUrl, SseConnection } from './sse';
import type { SseMessage } from './sse-parser';
import type {
  WorkspaceChangeSummary,
  WorkspaceDiff,
  Approval,
  ApprovalDecision,
  AssistantPayload,
  CreateSessionOptions,
  Device,
  Health,
  HelloPayload,
  HistoryPage,
  HostInfo,
  ModelCatalog,
  ModelSelection,
  OpenSessionOptions,
  PairResult,
  PromptPayload,
  SessionDetail,
  SessionEvent,
  SessionEventPayload,
  SessionListResponse,
  SessionRow,
  SessionStatePayload,
  SessionStatusPayload,
  SnapshotPayload,
  SubscriptionClosedPayload,
  SseErrorPayload,
} from './types';
import { PROTOCOL_VERSION } from './types';

/** Payloads emitted on the client event bus. */
export interface ClientEvents {
  /** session.event: one new DSH session event. */
  event: SessionEventPayload;
  /** session.assistant: one assistant stream frame. */
  assistant: AssistantPayload;
  /** session.snapshot: full opening snapshot for an open subscription. */
  snapshot: SnapshotPayload;
  /** session.state: running/active changed. */
  state: SessionStatePayload;
  /** session.status: global running/active update. */
  status: SessionStatusPayload;
  /** session.added / session.removed. */
  listChanged: { kind: 'added'; row: SessionRow } | { kind: 'removed'; sessionId: string };
  /** approval.request. */
  approval: Approval;
  /** approval.resolved. */
  approvalResolved: { id: string; outcome: string };
  /** SSE connection-level error frame. */
  error: SseErrorPayload;
  /** SSE stream became usable (initial connect or a successful reconnect). */
  open: undefined;
  /** SSE stream dropped; willReconnect=false means retries stopped. */
  close: { willReconnect: boolean; error?: string };
  /** SSE hello frame. */
  hello: HelloPayload;
  /** Server rejected the device token (HTTP 401 or SSE error unauthorized). */
  unauthorized: undefined;
  subscriptionClosed: SubscriptionClosedPayload;
}

type Handler<K extends keyof ClientEvents> = (payload: ClientEvents[K]) => void;

export interface RemoteClientOptions {
  baseUrl: string;
  token?: string;
  /** Injectable fetch (tests / non-RN environments). */
  fetchImpl?: typeof fetch;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Initial SSE backoff (protocol 6.2: 1s -> 30s). */
  minBackoffMs?: number;
  maxBackoffMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

function joinUrl(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, '') + path;
}

/** RemoteClient owns one device token and at most one SSE stream. */
export class RemoteClient {
  baseUrl: string;
  token?: string;

  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly handlers = new Map<string, Set<(payload: never) => void>>();
  private sse: SseConnection | null = null;

  constructor(options: RemoteClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.minBackoffMs = options.minBackoffMs ?? 1_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000;
  }

  // ---------------------------------------------------------------- events

  /** Subscribe to a client event; returns an unsubscribe function. */
  on<K extends keyof ClientEvents>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (payload: never) => void);
    return () => {
      set?.delete(handler as (payload: never) => void);
    };
  }

  off<K extends keyof ClientEvents>(event: K, handler: Handler<K>): void {
    this.handlers.get(event)?.delete(handler as (payload: never) => void);
  }

  private emit<K extends keyof ClientEvents>(event: K, payload: ClientEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        (handler as Handler<K>)(payload);
      } catch {
        // A broken subscriber must not kill the event stream.
      }
    }
  }

  // -------------------------------------------------------------- HTTP JSON

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = joinUrl(this.baseUrl, path);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    let payload: string | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      payload = JSON.stringify(body);
    }
    const { response, text } = await fetchText(this.fetchImpl, url, { method, headers, body: payload }, this.timeoutMs,
      (response) => {
        if (response.status === 401 || response.status === 403) {
          this.emit('unauthorized', undefined);
          throw new ApiError(response.status, 'unauthorized', '认证已失效，请重新配对');
        }
      });
    if (!response.ok) {
      let code = 'internal';
      let message = 'HTTP ' + response.status;
      let details: unknown;
      if (text) {
        try {
          const parsed = JSON.parse(text) as { error?: { code?: unknown; message?: unknown; details?: unknown } };
          if (parsed && parsed.error) {
            if (typeof parsed.error.code === 'string') code = parsed.error.code;
            if (typeof parsed.error.message === 'string') message = parsed.error.message;
            details = parsed.error.details;
          }
        } catch {
          message = text.slice(0, 200);
        }
      }
      throw new ApiError(response.status, code, message, details);
    }
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(response.status, 'invalid-argument', 'Host 返回了无法解析的 JSON');
    }
  }

  // -------------------------------------------------------------- pairing

  /** POST /v1/pair (unauthenticated). */
  static async pair(
    baseUrl: string,
    code: string,
    deviceName: string,
    options: { deviceId?: string; platform?: string; appVersion?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
  ): Promise<PairResult> {
    const normalized = normalizeBaseUrl(baseUrl);
    const url = joinUrl(normalized, '/v1/pair');
    const body = {
      code: code.trim(),
      ...(options.deviceId ? { deviceId: options.deviceId } : {}),
      deviceName,
      ...(options.platform ? { platform: options.platform } : {}),
      ...(options.appVersion ? { appVersion: options.appVersion } : {}),
    };
    const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    const { response, text } = await fetchText(fetchImpl, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' },
        body: JSON.stringify(body),
      }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const errorBody = parsed && typeof parsed.error === 'object' && parsed.error !== null ? (parsed.error as Record<string, unknown>) : null;
      const code2 = errorBody && typeof errorBody.code === 'string' ? errorBody.code : 'internal';
      const message = errorBody && typeof errorBody.message === 'string' ? errorBody.message : 'HTTP ' + response.status;
      throw new ApiError(response.status, code2, message);
    }
    if (!parsed || typeof parsed.token !== 'string') {
      throw new ApiError(response.status, 'invalid-argument', 'Host 返回的配对结果缺少 token');
    }
    const protocol = typeof parsed.protocol === 'number' ? parsed.protocol : PROTOCOL_VERSION;
    if (protocol !== PROTOCOL_VERSION) {
      throw new ApiError(response.status, 'protocol-unsupported', 'Host 协议版本不兼容（' + protocol + '）');
    }
    return parsed as unknown as PairResult;
  }

  // -------------------------------------------------------------- endpoints

  /** GET /v1/health (no token needed). */
  health(): Promise<Health> {
    return this.request<Health>('GET', '/v1/health');
  }

  /** GET /v1/host. */
  host(): Promise<HostInfo> {
    return this.request<HostInfo>('GET', '/v1/host');
  }

  /** GET /v1/sessions. */
  listSessions(options: { limit?: number; cursor?: string } = {}): Promise<SessionListResponse> {
    const query: string[] = [];
    if (options.limit !== undefined) query.push('limit=' + encodeURIComponent(String(options.limit)));
    if (options.cursor) query.push('cursor=' + encodeURIComponent(options.cursor));
    return this.request<SessionListResponse>('GET', '/v1/sessions' + (query.length ? '?' + query.join('&') : ''));
  }

  /** POST /v1/sessions. */
  createSession(options: CreateSessionOptions = {}): Promise<{ sessionId: string; agentPreset?: string }> {
    return this.request('POST', '/v1/sessions', options);
  }

  /** GET /v1/sessions/:id. */
  getSession(id: string): Promise<SessionDetail> {
    return this.request<SessionDetail>('GET', '/v1/sessions/' + encodeURIComponent(id));
  }

  /** GET /v1/sessions/:id/history. */
  history(id: string, options: { beforeSeq?: number; maxMessages?: number } = {}): Promise<HistoryPage> {
    const query: string[] = [];
    if (options.beforeSeq !== undefined) query.push('beforeSeq=' + encodeURIComponent(String(options.beforeSeq)));
    if (options.maxMessages !== undefined) query.push('maxMessages=' + encodeURIComponent(String(options.maxMessages)));
    return this.request<HistoryPage>(
      'GET',
      '/v1/sessions/' + encodeURIComponent(id) + '/history' + (query.length ? '?' + query.join('&') : ''),
    );
  }

  changes(id: string, seq: number): Promise<WorkspaceChangeSummary> {
    return this.request('GET', '/v1/sessions/' + encodeURIComponent(id) + '/changes/' + seq);
  }
  diff(id: string, seq: number, index: number): Promise<WorkspaceDiff> {
    return this.request('GET', '/v1/sessions/' + encodeURIComponent(id) + '/changes/' + seq + '/' + index);
  }
  readFile(id: string, path: string): Promise<{ text: string; eof?: boolean; path?: string }> {
    return this.request('GET', '/v1/sessions/' + encodeURIComponent(id) + '/file?format=text&path=' + encodeURIComponent(path));
  }

  /** POST /v1/sessions/:id/open — subscribes the SSE stream to this session. */
  openSession(
    id: string,
    options: OpenSessionOptions = {},
  ): Promise<{ subscriptionId: string; sessionId?: string }> {
    const body = {
      maxMessages: options.maxMessages ?? 60,
      turnWindow: options.turnWindow ?? { minMessages: 40, minTurns: 1 },
      assistantStream: options.assistantStream ?? true,
    };
    return this.request('POST', '/v1/sessions/' + encodeURIComponent(id) + '/open', body);
  }

  /** POST /v1/sessions/:id/close (idempotent). */
  async closeSession(id: string): Promise<void> {
    await this.request<{ closed?: boolean }>('POST', '/v1/sessions/' + encodeURIComponent(id) + '/close', {});
  }

  /** POST /v1/sessions/:id/prompt. */
  prompt(id: string, payload: PromptPayload): Promise<{ accepted: boolean; requestId?: string }> {
    return this.request('POST', '/v1/sessions/' + encodeURIComponent(id) + '/prompt', payload);
  }

  /** POST /v1/sessions/:id/cancel. */
  cancel(id: string): Promise<{ accepted: boolean }> {
    return this.request('POST', '/v1/sessions/' + encodeURIComponent(id) + '/cancel', {});
  }

  /** POST /v1/sessions/:id/rename. */
  rename(id: string, title: string): Promise<{ title: string; seq?: number }> {
    return this.request('POST', '/v1/sessions/' + encodeURIComponent(id) + '/rename', { title });
  }

  /** POST /v1/sessions/:id/model. */
  selectModel(id: string, selection: ModelSelection): Promise<{ selected: ModelSelection }> {
    return this.request('POST', '/v1/sessions/' + encodeURIComponent(id) + '/model', selection);
  }

  /** GET /v1/models. */
  models(): Promise<ModelCatalog> {
    return this.request<ModelCatalog>('GET', '/v1/models');
  }

  /** GET /v1/approvals. */
  approvals(): Promise<{ items: Approval[] }> {
    return this.request<{ items: Approval[] }>('GET', '/v1/approvals');
  }

  /** POST /v1/approvals/:id. */
  answerApproval(id: string, decision: ApprovalDecision): Promise<{ resolved: boolean; outcome?: string }> {
    return this.request('POST', '/v1/approvals/' + encodeURIComponent(id), { decision });
  }

  /** GET /v1/devices. */
  devices(): Promise<{ items: Device[] }> {
    return this.request<{ items: Device[] }>('GET', '/v1/devices');
  }

  /** DELETE /v1/devices/:deviceId. */
  deleteDevice(deviceId: string): Promise<{ removed: boolean }> {
    return this.request('DELETE', '/v1/devices/' + encodeURIComponent(deviceId));
  }

  // ------------------------------------------------------------------ SSE

  /** Open (or re-open) the event stream. Requires a token. */
  connectEvents(): void {
    if (!this.token) throw new ApiError(0, 'unauthorized', '缺少设备 token，无法建立实时连接');
    this.disconnectEvents();
    const connection = new SseConnection({
      url: buildEventsUrl(this.baseUrl, this.token),
      minBackoffMs: this.minBackoffMs,
      maxBackoffMs: this.maxBackoffMs,
      onMessage: (message) => this.dispatchSseMessage(message),
      onHttpStatus: (status) => {
        if (status === 401 || status === 403) this.emit('unauthorized', undefined);
      },
      onOpen: () => this.emit('open', undefined),
      onClose: (info) => this.emit('close', { willReconnect: info.willReconnect, error: info.error?.message }),
    });
    this.sse = connection;
    connection.open();
  }

  /** Close the event stream and stop reconnecting. */
  disconnectEvents(): void {
    const connection = this.sse;
    this.sse = null;
    connection?.close();
  }

  /** Close the SSE stream and drop all subscribers. */
  disconnect(): void {
    this.disconnectEvents();
    this.handlers.clear();
  }

  private dispatchSseMessage(message: SseMessage): void {
    let data: unknown;
    try {
      data = JSON.parse(message.data);
    } catch {
      return; // Malformed frames are ignored (protocol 7).
    }
    if (!data || typeof data !== 'object') return;
    const payload = data as Record<string, unknown>;
    switch (message.event) {
      case 'hello': {
        const hello = payload as unknown as HelloPayload;
        this.emit('hello', hello);
        if (typeof hello.protocol === 'number' && hello.protocol !== PROTOCOL_VERSION) {
          this.emit('error', { code: 'protocol-unsupported', message: 'Host 协议版本不兼容' });
        }
        return;
      }
      case 'session.snapshot':
        this.emit('snapshot', payload as unknown as SnapshotPayload);
        return;
      case 'session.event': {
        const event = payload.event as SessionEvent | undefined;
        if (!event || typeof event !== 'object' || typeof event.type !== 'string') return;
        this.emit('event', payload as unknown as SessionEventPayload);
        return;
      }
      case 'session.assistant': {
        const frame = payload.frame as { type?: unknown } | undefined;
        if (!frame || typeof frame.type !== 'string') return;
        this.emit('assistant', payload as unknown as AssistantPayload);
        return;
      }
      case 'session.state':
        this.emit('state', payload as unknown as SessionStatePayload);
        return;
      case 'session.status':
        this.emit('status', payload as unknown as SessionStatusPayload);
        return;
      case 'session.added': {
        const row = payload.row as SessionRow | undefined;
        if (row && typeof row.sessionId === 'string') this.emit('listChanged', { kind: 'added', row });
        return;
      }
      case 'session.removed': {
        if (typeof payload.sessionId === 'string') this.emit('listChanged', { kind: 'removed', sessionId: payload.sessionId });
        return;
      }
      case 'approval.request': {
        const approval = payload as unknown as Approval;
        if (typeof approval.id === 'string') this.emit('approval', approval);
        return;
      }
      case 'approval.resolved': {
        if (typeof payload.id === 'string') {
          this.emit('approvalResolved', {
            id: payload.id,
            outcome: typeof payload.outcome === 'string' ? payload.outcome : 'rejected',
          });
        }
        return;
      }
      case 'error': {
        const info = payload as unknown as SseErrorPayload;
        const code = typeof info.code === 'string' ? info.code : 'internal';
        this.emit('error', { code, message: typeof info.message === 'string' ? info.message : undefined });
        if (code === 'unauthorized' || code === 'protocol-unsupported') this.emit('unauthorized', undefined);
        return;
      }
      case 'subscription.closed':
        if (typeof payload.sessionId === 'string' && typeof payload.subscriptionId === 'string') {
          this.emit('subscriptionClosed', payload as unknown as SubscriptionClosedPayload);
        }
        return;
      case 'ping':
      case 'connection.replaced':
      default:
        // Unknown events must be ignored (protocol section 7).
        return;
    }
  }
}
