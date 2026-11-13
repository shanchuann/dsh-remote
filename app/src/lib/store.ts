/**
 * useRemoteStore: the single source of truth for the app's link to the host.
 *
 * Shape follows docs/app-architecture.md section 3.2. The store owns the
 * RemoteClient instance and translates SSE frames into UI state:
 *  - session.snapshot replaces the event list, session.event appends by seq,
 *  - session.assistant accumulates text-delta chunks into current.streaming,
 *  - assistant/message clears the streaming buffer,
 *  - approvals are queued in current.pendingApprovals,
 *  - optimistic user bubbles live in current.pendingUser until the host echoes
 *    the same source.rpcId (protocol 6.4), and
 *  - on SSE reconnect the open session is re-opened (protocol 6.2).
 */

import { create } from 'zustand';

import { RemoteClient } from './client';
import {
  appVersion,
  clearConnectionMeta,
  clearToken,
  defaultDeviceName,
  getClientTimeZone,
  loadConnectionMeta,
  loadToken,
  platformName,
  saveConnectionMeta,
  saveToken,
} from './config';
import { ApiError, describeError, isApiError, isClientTimeZoneError } from './errors';
import { randomUuid } from './ids';
import { isValidPairingCode, normalizeBaseUrl } from './pairing';
import { mergeTeamTask, teamTasksFromProjection } from './task-state';
import { readSessionCatalog } from './projects';
import {
  appendEvent,
  applyAssistantFrame,
  applySessionStatus,
  applySessionEventToRows,
  cwdFromEvent,
  emptyStreaming,
  streamingFromSnapshot,
  filterPendingByEvents,
  historyBoundary,
  mergeApproval,
  mergeEventLists,
  modelFromEvent,
  modelFromProjections,
  removeApproval,
  removeConfirmedPending,
  removeSessionRow,
  replaceEvents,
  runningFromEvent,
  titleFromEvent,
  titleFromProjections,
  upsertSessionRow,
} from './state-updates';
import type {
  Approval,
  ApprovalDecision,
  AssistantPayload,
  ConnectionState,
  CreateSessionOptions,
  CurrentSessionState,
  Device,
  HostInfo,
  ModelCatalog,
  MessageFeedback,
  ModelSelection,
  PendingUser,
  PromptImage,
  SessionEventPayload,
  SessionRow,
  SessionStatePayload,
  SessionStatusPayload,
  SnapshotPayload,
  WorkspaceRow,
  WorkspaceChangeSummary,
  WorkspaceDiff,
} from './types';
import { PROTOCOL_VERSION } from './types';

/** Input for connect() (protocol 1.2 / 1.3). */
export interface ConnectInput {
  baseUrl: string;
  /** Alternate address from the same QR; tried once when baseUrl is unreachable. */
  altBaseUrl?: string;
  code: string;
  /** Defaults to the persisted name or a platform default. */
  deviceName?: string;
}

/** Actions exposed on the store. Screens call store.actions.*. */
export interface RemoteActions {
  /** Pair with a host and establish the session/SSE link. Throws on failure. */
  connect(input: ConnectInput): Promise<void>;
  /** Restore a persisted pairing; returns false when the user must pair again. */
  restore(): Promise<boolean>;
  /** Re-validate the host and re-open the current session (app foregrounded). */
  resume(): Promise<void>;
  /** Forget the pairing and close the SSE stream. */
  disconnect(): Promise<void>;
  refreshSessions(): Promise<void>;
  createSession(options?: CreateSessionOptions): Promise<string>;
  forkSession(sessionId: string, atSeq: number): Promise<{ sessionId: string }>;
  loadMessageFeedback(sessionId: string): Promise<MessageFeedback[]>;
  rateMessage(sessionId: string, messageId: string, rating: 'positive' | 'negative' | null, ifVersion: string | null): Promise<Partial<MessageFeedback>>;
  openSession(id: string): Promise<void>;
  /** Page backwards through the open session's history (protocol 3.6). */
  loadOlderHistory(): Promise<void>;
  loadChanges(sessionId: string, seq: number): Promise<WorkspaceChangeSummary>;
  loadDiff(sessionId: string, seq: number, index: number): Promise<WorkspaceDiff>;
  readFile(sessionId: string, path: string): Promise<{ text: string; eof?: boolean; path?: string }>;
  closeSession(): Promise<void>;
  sendPrompt(text: string, options?: { mode?: 'queue' | 'steer'; images?: PromptImage[] }): Promise<void>;
  cancel(): Promise<void>;
  answerApproval(id: string, decision: ApprovalDecision): Promise<void>;
  selectModel(selection: ModelSelection): Promise<void>;
  loadModels(): Promise<void>;
  refreshHost(): Promise<void>;
  refreshDevices(): Promise<void>;
  removeDevice(deviceId: string): Promise<void>;
  /** Clear transient error banners. */
  clearError(): void;
}

/** Store state (app-architecture 3.2 plus a few convenience fields). */
export interface RemoteState {
  connection: ConnectionState;
  sessions: SessionRow[];
  workspaces?: WorkspaceRow[];
  sessionsLoading: boolean;
  /** Error from the session list refresh (kept separate from connection.error). */
  sessionsError?: string;
  current: CurrentSessionState;
  /** Approvals staged for every session (shown once its session is open). */
  approvals: Approval[];
  models?: ModelCatalog;
  host?: HostInfo;
  devices: Device[];
  actions: RemoteActions;
}

function createEmptyCurrent(): CurrentSessionState {
  return {
    sessionId: undefined,
    title: undefined,
    running: false,
    active: true,
    events: [],
    streaming: emptyStreaming(),
    pendingApprovals: [],
    pendingUser: [],
    loading: false,
    hasMore: false,
    cursor: null,
    error: undefined,
  };
}

// The device token lives in memory so attachment images can authenticate
// their own GET requests without persisting it a second place.
let activeToken: string | null = null;

/** Current device token for network image headers (null when disconnected). */
export function getActiveToken(): string | null {
  return activeToken;
}

export const useRemoteStore = create<RemoteState>()((set, get) => {
  let client: RemoteClient | null = null;
  let restoreInFlight: Promise<boolean> | null = null;
  let sessionGeneration = 0;
  let unsubscribers: (() => void)[] = [];
  // True once the SSE stream has opened at least once on this client, so the
  // next open() is a reconnect that must re-open the active session.
  let streamOpened = false;

  // Assistant deltas arrive per model chunk. Coalescing them into one state
  // update every ~50ms keeps the JS thread free for scrolling and taps.
  let assistantFrames: { sessionId: string; frame: AssistantPayload['frame'] }[] = [];
  let assistantTimer: ReturnType<typeof setTimeout> | undefined;

  function flushAssistantFrames(): void {
    if (assistantTimer !== undefined) {
      clearTimeout(assistantTimer);
      assistantTimer = undefined;
    }
    if (assistantFrames.length === 0) return;
    const frames = assistantFrames;
    assistantFrames = [];
    set((state) => {
      let streaming = state.current.streaming;
      let changed = false;
      for (const item of frames) {
        if (item.sessionId !== state.current.sessionId) continue;
        streaming = applyAssistantFrame(streaming, item.frame);
        changed = true;
      }
      return changed ? { current: { ...state.current, streaming } } : {};
    });
  }

  function detachClient(): void {
    for (const unsubscribe of unsubscribers) {
      try {
        unsubscribe();
      } catch {
        // Ignore: the client is going away anyway.
      }
    }
    unsubscribers = [];
    streamOpened = false;
    if (client) {
      client.disconnect();
      client = null;
    }
  }

  function requireClient(): RemoteClient {
    if (!client) throw new ApiError(0, 'unauthorized', '尚未连接 Host');
    return client;
  }

  function setConnectionError(message: string): void {
    set((state) => ({
      connection: { ...state.connection, status: 'error', error: message },
    }));
  }

  /** Re-open the current session after an SSE reconnect without clearing events. */
  async function reopenAfterReconnect(sessionId: string): Promise<void> {
    const active = client;
    if (!active) return;
    try {
      await active.openSession(sessionId);
    } catch (error) {
      set((state) => state.current.sessionId !== sessionId || client !== active ? {} : ({
        current: { ...state.current, error: describeError(error) },
      }));
    }
  }

  function applySnapshot(snapshot: SnapshotPayload): void {
    if (!snapshot || typeof snapshot.sessionId !== 'string') return;
    const events = replaceEvents(snapshot.records);
    const title = titleFromProjections(snapshot.projections);
    const model = modelFromProjections(snapshot.projections);
    const cwd = events.reduce<string | undefined>((value, event) => cwdFromEvent(event) ?? value, snapshot.header?.cwd);
    set((state) => {
      if (state.current.sessionId !== snapshot.sessionId) return {};
      return {
        sessions: state.sessions.map((row) => row.sessionId === snapshot.sessionId ? {
          ...row, ...(title === undefined ? {} : { title }), ...(model === undefined ? {} : { model }),
          ...(cwd === undefined ? {} : { cwd }),
        } : row),
        current: {
          ...state.current,
          events,
          todos: snapshot.projections?.values?.todos,
          teamTasks: teamTasksFromProjection(snapshot.projections?.values?.agentTeam),
          loading: false,
          error: undefined,
          streaming: streamingFromSnapshot(snapshot.assistantStream),
          hasMore: snapshot.hasMore === true,
          cursor: historyBoundary(events, snapshot.cursor),
          title: title ?? state.current.title,
          model: model ?? state.current.model,
          cwd: cwd ?? state.current.cwd,
          pendingUser: filterPendingByEvents(state.current.pendingUser, events),
        },
      };
    });
  }

  function applySessionEvent(payload: SessionEventPayload): void {
    const event = payload?.event;
    if (!event || typeof event.type !== 'string') return;
    // Deltas buffered behind a session event must land first so the final
    // assistant/message never races ahead of text that belongs before it.
    flushAssistantFrames();
    set((state) => {
      const sessions = applySessionEventToRows(state.sessions, payload.sessionId, event);
      if (state.current.sessionId !== payload.sessionId) return { sessions };
      const runningHint = runningFromEvent(event);
      const nextRunning = runningHint === undefined ? state.current.running : runningHint;
      const pendingUser =
        event.type === 'user/message'
          ? removeConfirmedPending(state.current.pendingUser, event)
          : state.current.pendingUser;
      return {
        sessions,
        current: {
          ...state.current,
          events: appendEvent(state.current.events, event),
          teamTasks: event.type === "team/task" ? mergeTeamTask(state.current.teamTasks, event.data) : state.current.teamTasks,
          todos: event.type === "todo/write" ? event.data : event.type === "turn/start" ? undefined : state.current.todos,
          streaming: event.type === 'assistant/message' ? emptyStreaming() : state.current.streaming,
          pendingUser,
          title: titleFromEvent(event) ?? state.current.title,
          model: modelFromEvent(event) ?? state.current.model,
          cwd: cwdFromEvent(event) ?? state.current.cwd,
          running: nextRunning,
        },
      };
    });
  }

  function applyAssistant(payload: AssistantPayload): void {
    const frame = payload?.frame;
    if (!frame || typeof frame.type !== 'string' || typeof payload?.sessionId !== 'string') return;
    assistantFrames.push({ sessionId: payload.sessionId, frame });
    if (assistantTimer === undefined) {
      assistantTimer = setTimeout(() => {
        assistantTimer = undefined;
        flushAssistantFrames();
      }, 50);
    }
  }

  function applySessionState(payload: SessionStatePayload): void {
    const next = payload?.state;
    if (!next || typeof next !== 'object') return;
    flushAssistantFrames();
    set((state) => {
      if (state.current.sessionId !== payload.sessionId) return {};
      const running = typeof next.running === 'boolean' ? next.running : state.current.running;
      return {
        current: {
          ...state.current,
          running,
          active: typeof next.active === 'boolean' ? next.active : state.current.active,
          // A finished turn must not leave a spinner behind.
          streaming: running ? state.current.streaming : { ...state.current.streaming, active: false },
        },
      };
    });
  }

  function applyStatusFrame(payload: SessionStatusPayload): void {
    if (!payload || typeof payload.sessionId !== 'string') return;
    set((state) => ({
      sessions: applySessionStatus(state.sessions, payload),
      current:
        state.current.sessionId === payload.sessionId
          ? { ...state.current,
              running: typeof payload.running === 'boolean' ? payload.running : state.current.running,
              active: typeof payload.active === 'boolean' ? payload.active : state.current.active }
          : state.current,
    }));
  }

  function stageApproval(approval: Approval): void {
    set((state) => {
      if (!approval || typeof approval.id !== 'string') return {};
      const approvals = mergeApproval(state.approvals, approval);
      const matchesCurrent =
        Boolean(state.current.sessionId) &&
        (!approval.sessionId || approval.sessionId === state.current.sessionId);
      return {
        approvals,
        current: matchesCurrent
          ? { ...state.current, pendingApprovals: mergeApproval(state.current.pendingApprovals, approval) }
          : state.current,
      };
    });
  }

  function resolveApprovalById(id: string): void {
    set((state) => ({
      approvals: removeApproval(state.approvals, id),
      current: { ...state.current, pendingApprovals: removeApproval(state.current.pendingApprovals, id) },
    }));
  }

  function attachClient(next: RemoteClient): void {
    detachClient();
    client = next;
    streamOpened = false;
    const offs: (() => void)[] = [];

    offs.push(
      next.on('open', () => {
        const reconnected = streamOpened;
        streamOpened = true;
        set((state) => ({
          connection: { ...state.connection, status: 'connected', error: undefined },
        }));
        if (reconnected) {
          const sessionId = get().current.sessionId;
          if (sessionId) void reopenAfterReconnect(sessionId);
          void get().actions.refreshSessions();
        }
      }),
    );

    offs.push(
      next.on('close', (info) => {
        if (info?.willReconnect) {
          set((state) => ({
            connection: {
              ...state.connection,
              status: state.connection.status === 'error' ? 'error' : 'connecting',
            },
          }));
        }
      }),
    );

    offs.push(
      next.on('hello', (hello) => {
        if (typeof hello?.protocol === 'number' && hello.protocol !== PROTOCOL_VERSION) {
          setConnectionError('Host 协议版本不兼容（' + hello.protocol + '），请升级 App 或插件');
        }
      }),
    );

    offs.push(next.on('snapshot', (snapshot) => applySnapshot(snapshot)));
    offs.push(next.on('event', (payload) => applySessionEvent(payload)));
    offs.push(next.on('assistant', (payload) => applyAssistant(payload)));
    offs.push(next.on('state', (payload) => applySessionState(payload)));
    offs.push(next.on('status', (payload) => applyStatusFrame(payload)));
    offs.push(next.on('subscriptionClosed', (payload) => {
      if (payload.reason === 'replaced' || payload.reason === 'client-close' || payload.reason === 'closed') return;
      flushAssistantFrames();
      set((state) => state.current.sessionId !== payload.sessionId ? {} : ({
        current: { ...state.current, loading: false, running: false,
          streaming: { ...state.current.streaming, active: false }, error: '会话实时连接已关闭，请重新打开对话' },
      }));
    }));

    offs.push(
      next.on('listChanged', (change) => {
        set((state) => {
          if (change.kind === 'added') {
            return { sessions: upsertSessionRow(state.sessions, change.row) };
          }
          return {
            sessions: removeSessionRow(state.sessions, change.sessionId),
            current:
              state.current.sessionId === change.sessionId
                ? { ...createEmptyCurrent(), error: '会话已从 Host 移除' }
                : state.current,
          };
        });
      }),
    );

    offs.push(next.on('approval', (approval) => stageApproval(approval)));
    offs.push(
      next.on('approvalResolved', (resolved) => {
        if (typeof resolved?.id !== 'string') return;
        resolveApprovalById(resolved.id);
      }),
    );

    offs.push(
      next.on('error', (error) => {
        set((state) => ({
          connection: { ...state.connection, error: describeError(error) },
        }));
      }),
    );

    offs.push(
      next.on('unauthorized', () => {
        // The token was revoked (desktop removed this device) or the host
        // restarted with fresh state: stop retrying and ask for a new pairing.
        void clearToken();
        activeToken = null;
        next.disconnect();
        set((state) => ({
          connection: {
            ...state.connection,
            status: 'error',
            needsPairing: true,
            error: '认证已失效，请重新配对',
          },
          current: { ...state.current, loading: false, running: false,
            streaming: { ...state.current.streaming, active: false } },
        }));
      }),
    );

    unsubscribers = offs;
  }

  function markPendingFailed(
    setState: (updater: (state: RemoteState) => Partial<RemoteState>) => void,
    requestId: string,
    error: unknown,
  ): void {
    setState((state) => !state.current.pendingUser.some((item) => item.requestId === requestId) ? {} : ({
      current: {
        ...state.current,
        error: describeError(error),
        pendingUser: state.current.pendingUser.map((item) =>
          item.requestId === requestId ? { ...item, status: 'failed' as const } : item,
        ),
      },
    }));
  }

  const actions: RemoteActions = {
    async connect(input) {
      const baseUrl = normalizeBaseUrl(input.baseUrl);
      const altBaseUrl = input.altBaseUrl ? normalizeBaseUrl(input.altBaseUrl) : undefined;
      const code = input.code?.trim() ?? '';
      if (!isValidPairingCode(code)) throw new Error('请输入 6 位数字配对码');
      // One QR carries both networks: Tailscale first when available, then the LAN
      // fallback. Only a failed attempt moves on, so a wrong code never turns
      // into two lockout attempts on two endpoints.
      const candidates = altBaseUrl && altBaseUrl !== baseUrl ? [baseUrl, altBaseUrl] : [baseUrl];
      let lastError: unknown = null;
      for (let index = 0; index < candidates.length; index += 1) {
        const target = candidates[index] ?? baseUrl;
        set((state) => ({
          connection: { ...state.connection, status: 'connecting', baseUrl: target, error: undefined },
        }));
        try {
          const meta = await loadConnectionMeta();
          const deviceId = meta?.deviceId ?? randomUuid();
          const deviceName = input.deviceName?.trim() || meta?.deviceName || defaultDeviceName();
          const result = await RemoteClient.pair(target, code, deviceName, {
            deviceId,
            platform: platformName(),
            appVersion: appVersion(),
          });
          if (typeof result.protocol === 'number' && result.protocol !== PROTOCOL_VERSION) {
            throw new ApiError(0, 'protocol-unsupported', 'Host 协议版本不兼容（' + result.protocol + '）');
          }
          await saveToken(result.token);
          activeToken = result.token;
          const next = new RemoteClient({ baseUrl: target, token: result.token });
          const health = await next.health();
          if (typeof health.protocol === 'number' && health.protocol !== PROTOCOL_VERSION) {
            throw new ApiError(0, 'protocol-unsupported', 'Host 协议版本不兼容（' + health.protocol + '）');
          }
          const host = await next.host();
          attachClient(next);
          next.connectEvents();
          await saveConnectionMeta({
            baseUrl: target,
            deviceId: typeof result.deviceId === 'string' && result.deviceId ? result.deviceId : deviceId,
            deviceName,
            hostId: host.hostId ?? result.host?.id,
            hostName: host.name ?? result.host?.name,
          });
          set((state) => ({
            connection: {
              ...state.connection,
              status: 'connected',
              baseUrl: target,
              deviceName,
              host,
              error: undefined,
              needsPairing: false,
            },
            host,
            devices: host.devices ?? [],
          }));
          void get().actions.refreshSessions();
          return;
        } catch (error) {
          lastError = error;
          detachClient();
          activeToken = null;
          await clearToken();
          await clearConnectionMeta();
          if (index === candidates.length - 1 || !isApiError(error) ||
              (error.code !== 'network' && error.code !== 'timeout')) break;
        }
      }
      setConnectionError(describeError(lastError));
      throw lastError;
    },

    restore() {
      // Android foreground events can overlap the launch/retry request.
      if (restoreInFlight) return restoreInFlight;
      restoreInFlight = (async () => {
        const [meta, token] = await Promise.all([loadConnectionMeta(), loadToken()]);
        if (!meta || !token) return false;
        set((state) => ({
          connection: {
            ...state.connection,
            status: 'connecting',
            baseUrl: meta.baseUrl,
            deviceName: meta.deviceName,
            error: undefined,
          },
        }));
        activeToken = token;
        let next: RemoteClient | null = null;
        try {
          next = new RemoteClient({ baseUrl: meta.baseUrl, token });
          const health = await next.health();
          if (typeof health.protocol === 'number' && health.protocol !== PROTOCOL_VERSION) {
            throw new ApiError(0, 'protocol-unsupported', 'Host 协议版本不兼容（' + health.protocol + '）');
          }
          const host = await next.host();
          attachClient(next);
          next.connectEvents();
          set((state) => ({
            connection: {
              ...state.connection,
              status: 'connected',
              baseUrl: meta.baseUrl,
              deviceName: meta.deviceName,
              host,
              error: undefined,
              needsPairing: false,
            },
            host,
            devices: host.devices ?? [],
          }));
          void saveConnectionMeta({
            ...meta,
            hostId: host.hostId ?? meta.hostId,
            hostName: host.name ?? meta.hostName,
          });
          void get().actions.refreshSessions();
          return true;
        } catch (error) {
          next?.disconnect();
          if (isApiError(error) && (error.status === 401 || error.status === 403)) {
            activeToken = null;
            await clearToken();
            set((state) => ({ connection: { ...state.connection, status: 'error', needsPairing: true, error: '认证已失效，请重新配对' } }));
            return false;
          }
          setConnectionError(describeError(error));
          return false;
        }
      })().finally(() => { restoreInFlight = null; });
      return restoreInFlight;
    },

    async resume() {
      if (!client) {
        await get().actions.restore();
        return;
      }
      try {
        const health = await client.health();
        if (typeof health.protocol === 'number' && health.protocol !== PROTOCOL_VERSION) {
          throw new ApiError(0, 'protocol-unsupported', 'Host 协议版本不兼容（' + health.protocol + '）');
        }
        const host = await client.host();
        set((state) => ({
          connection: { ...state.connection, status: 'connected', host, error: undefined },
          host,
        }));
        const sessionId = get().current.sessionId;
        if (sessionId) await reopenAfterReconnect(sessionId);
        void get().actions.refreshSessions();
      } catch (error) {
        setConnectionError(describeError(error));
      }
    },

    async disconnect() {
      sessionGeneration += 1;
      activeToken = null;
      flushAssistantFrames();
      const sessionId = get().current.sessionId;
      const active = client;
      if (active && sessionId) {
        try {
          await active.closeSession(sessionId);
        } catch {
          // Best effort: the token is about to be dropped anyway.
        }
      }
      detachClient();
      await Promise.all([clearToken(), clearConnectionMeta()]);
      set({
        connection: { status: 'idle' },
        sessions: [],
        workspaces: undefined,
        sessionsLoading: false,
        sessionsError: undefined,
        current: createEmptyCurrent(),
        approvals: [],
        models: undefined,
        host: undefined,
        devices: [],
      });
    },

    async refreshSessions() {
      const active = client;
      if (!active) return;
      set({ sessionsLoading: true, sessionsError: undefined });
      try {
        const catalog = await readSessionCatalog((cursor) => active.listSessions({ limit: 100, cursor }));
        if (client !== active) return;
        set({ ...catalog, sessionsLoading: false });
      } catch (error) {
        if (client !== active) return;
        set({ sessionsLoading: false, sessionsError: describeError(error) });
        if (isApiError(error) && error.code === 'unauthorized') setConnectionError('认证已失效，请重新配对');
      }
    },

    async createSession(options) {
      const active = requireClient();
      const host = get().host;
      const payload: CreateSessionOptions = options ?? (host?.defaultCwd ? { cwd: host.defaultCwd } : {});
      const result = await active.createSession(payload);
      if (!result || typeof result.sessionId !== 'string') {
        throw new ApiError(0, 'internal', 'Host 未返回新会话 id');
      }
      void get().actions.refreshSessions();
      return result.sessionId;
    },

    async forkSession(sessionId, atSeq) {
      const result = await requireClient().forkSession(sessionId, { atSeq, requestId: randomUuid() });
      void get().actions.refreshSessions();
      return result;
    },
    async loadMessageFeedback(sessionId) {
      return (await requireClient().messageFeedback(sessionId)).items ?? [];
    },
    async rateMessage(sessionId, messageId, rating, ifVersion) {
      return requireClient().messageFeedback(sessionId, { messageId, rating, ifVersion });
    },

    async openSession(id) {
      const generation = ++sessionGeneration;
      flushAssistantFrames();
      const active = requireClient();
      const row = get().sessions.find((item) => item.sessionId === id);
      const previousId = get().current.sessionId;
      if (previousId && previousId !== id) {
        // Opening another session must not leave the old subscription open
        // (P2-3): the host would keep streaming it to this device.
        void active.closeSession(previousId).catch(() => undefined);
      }
      const staged = get().approvals.filter(
        (approval) => !approval.sessionId || approval.sessionId === id,
      );
      set((state) => ({
        current: {
          ...createEmptyCurrent(),
          sessionId: id,
          title: row?.title ?? undefined,
          model: row?.model ?? undefined,
          cwd: row?.cwd,
          running: row?.running === true,
          active: row?.active !== false,
          loading: true,
          pendingApprovals: staged,
        },
        connection: { ...state.connection, status: state.connection.status === 'error' ? 'error' : state.connection.status },
      }));
      if (!get().models) void get().actions.loadModels();
      try {
        const detail = await active.getSession(id);
        if (client !== active || get().current.sessionId !== id || generation !== sessionGeneration) return;
        set((state) => ({ current: { ...state.current,
          active: typeof detail.state?.active === 'boolean' ? detail.state.active : state.current.active,
          running: typeof detail.state?.running === 'boolean' ? detail.state.running : state.current.running,
          cwd: detail.header?.cwd ?? state.current.cwd,
        } }));
        await active.openSession(id);
      } catch (error) {
        set((state) => state.current.sessionId !== id || client !== active || generation !== sessionGeneration ? {} : ({
          current: { ...state.current, loading: false, error: describeError(error) },
        }));
      }
    },

    loadChanges(sessionId, seq) { return requireClient().changes(sessionId, seq); },
    loadDiff(sessionId, seq, index) { return requireClient().diff(sessionId, seq, index); },
    readFile(sessionId, path) { return requireClient().readFile(sessionId, path); },
    async loadOlderHistory() {
      const generation = sessionGeneration;
      const active = client;
      const sessionId = get().current.sessionId;
      if (!active || !sessionId) return;
      const { cursor, hasMore, loading } = get().current;
      if (loading || hasMore === false) return;
      if (typeof cursor !== 'number' || cursor <= 0) return;
      try {
        const page = await active.history(sessionId, {
          beforeSeq: Math.max(0, cursor - 1),
          maxMessages: 100,
        });
        if (client !== active || get().current.sessionId !== sessionId || generation !== sessionGeneration) return;
        const older = replaceEvents(page.records);
        if (older.length === 0) {
          set((state) => ({ current: { ...state.current, hasMore: false } }));
          return;
        }
        set((state) => ({
          current: {
            ...state.current,
            events: mergeEventLists(older, state.current.events),
            cursor: historyBoundary(older, page.cursor),
            hasMore: page.hasMore === true && (historyBoundary(older, page.cursor) ?? cursor) < cursor,
          },
        }));
      } catch (error) {
        set((state) => state.current.sessionId !== sessionId || client !== active || generation !== sessionGeneration ? {} : ({ current: { ...state.current, error: describeError(error) } }));
      }
    },

    async closeSession() {
      sessionGeneration += 1;
      flushAssistantFrames();
      const sessionId = get().current.sessionId;
      const active = client;
      // Release UI ownership before awaiting the network. Navigating to a
      // child can open its snapshot while the previous close is in flight.
      set({ current: createEmptyCurrent() });
      if (active && sessionId) {
        try {
          await active.closeSession(sessionId);
        } catch {
          // Closing is best effort: leaving the screen must not block.
        }
      }
    },

    async sendPrompt(text, options) {
      const trimmed = (text ?? '').trim();
      const images = options?.images ?? [];
      if (!trimmed && images.length === 0) return;
      const sessionId = get().current.sessionId;
      if (!sessionId) throw new Error('尚未打开会话');
      const requestId = randomUuid();
      const pending: PendingUser = {
        requestId,
        text: trimmed || '（图片 ×' + images.length + '）',
        time: Date.now(),
        status: 'sending',
        images,
      };
      set((state) => ({
        current: {
          ...state.current,
          error: undefined,
          pendingUser: [...state.current.pendingUser, pending],
          imagePreviews: { ...state.current.imagePreviews, [requestId]: images },
        },
      }));
      const active = requireClient();
      const mode = options?.mode ?? 'queue';
      const clientTimeZone = getClientTimeZone();
      const basePayload = {
        requestId,
        mode,
        content: [
          ...(trimmed ? [{ type: 'text' as const, text: trimmed }] : []),
          ...images.map((image) => ({
            type: 'image' as const,
            mediaType: image.mediaType,
            data: image.data,
            ...(image.name ? { name: image.name } : {}),
          })),
        ],
      };
      try {
        await active.prompt(sessionId, { ...basePayload, ...(clientTimeZone ? { clientTimeZone } : {}) });
      } catch (error) {
        if (clientTimeZone && isClientTimeZoneError(error)) {
          // Defensive fallback: a device timezone the host rejects must not make
          // sending impossible. DSH accepts a missing clientTimeZone.
          try {
            await active.prompt(sessionId, basePayload);
            return;
          } catch (retryError) {
            markPendingFailed(set, requestId, retryError);
            return;
          }
        }
        markPendingFailed(set, requestId, error);
      }
    },

    async cancel() {
      const sessionId = get().current.sessionId;
      if (!sessionId) return;
      try {
        await requireClient().cancel(sessionId);
      } catch (error) {
        set((state) => ({ current: { ...state.current, error: describeError(error) } }));
      }
    },

    async answerApproval(id, decision) {
      const active = requireClient();
      try {
        await active.answerApproval(id, decision);
        resolveApprovalById(id);
      } catch (error) {
        if (isApiError(error) && error.code === 'approval-gone') {
          resolveApprovalById(id);
          return;
        }
        set((state) => ({ current: { ...state.current, error: describeError(error) } }));
      }
    },

    async selectModel(selection) {
      const sessionId = get().current.sessionId;
      if (!sessionId) return;
      try {
        const result = await requireClient().selectModel(sessionId, selection);
        const selected = result?.selected && typeof result.selected.provider === 'string' ? result.selected : selection;
        set((state) => ({
          current: state.current.sessionId === sessionId ? { ...state.current, model: selected } : state.current,
          sessions: state.sessions.map((row) =>
            row.sessionId === sessionId ? { ...row, model: selected } : row,
          ),
        }));
      } catch (error) {
        set((state) => ({ current: { ...state.current, error: describeError(error) } }));
      }
    },

    async loadModels() {
      if (!client) return;
      try {
        const catalog = await client.models();
        set({ models: catalog });
      } catch (error) {
        set((state) => ({ current: { ...state.current, error: describeError(error) } }));
      }
    },

    async refreshHost() {
      const active = client;
      if (!active) return;
      try {
        const host = await active.host();
        if (client !== active) return;
        set((state) => ({
          host,
          devices: host.devices ?? state.devices,
          connection: { ...state.connection, host, error: undefined },
        }));
      } catch (error) {
        if (client !== active) return;
        setConnectionError(describeError(error));
      }
    },

    async refreshDevices() {
      const active = client;
      if (!active) return;
      try {
        const result = await active.devices();
        if (client !== active) return;
        set({ devices: Array.isArray(result?.items) ? result.items : [] });
      } catch (error) {
        if (client !== active) return;
        setConnectionError(describeError(error));
      }
    },

    async removeDevice(deviceId) {
      const active = requireClient();
      const target = get().devices.find((device) => device.deviceId === deviceId);
      try {
        await active.deleteDevice(deviceId);
      } catch (error) {
        setConnectionError(describeError(error));
        throw error;
      }
      if (target?.current) {
        // Deleting the current device revokes its token (protocol 3.11).
        await get().actions.disconnect();
        return;
      }
      await get().actions.refreshDevices();
    },

    clearError() {
      set((state) => ({
        connection: { ...state.connection, error: undefined },
        sessionsError: undefined,
        current: { ...state.current, error: undefined },
      }));
    },
  };

  return {
    connection: { status: 'idle' },
    sessions: [],
    workspaces: undefined,
    sessionsLoading: false,
    sessionsError: undefined,
    current: createEmptyCurrent(),
    approvals: [],
    models: undefined,
    host: undefined,
    devices: [],
    actions,
  };
});
