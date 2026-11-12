/**
 * DSH Remote protocol v1 types (docs/protocol.md, including the real-host
 * capture notes in section 9). Every shape here is intentionally tolerant:
 * unknown JSON fields pass through and optional fields may be missing, because
 * the app must keep working against older/newer hosts.
 */

/** Protocol version this app speaks. Hosts must report the same value. */
export const PROTOCOL_VERSION = 1;

/** Error codes defined by protocol section 2. */
export type ProtocolErrorCode =
  | 'invalid-argument'
  | 'unauthorized'
  | 'pairing-invalid'
  | 'pairing-locked'
  | 'protocol-unsupported'
  | 'session-not-found'
  | 'session-unavailable'
  | 'stream-unavailable'
  | 'approval-gone'
  | 'rate-limited'
  | 'internal';

/** Wire shape of an error response body. */
export interface ErrorResponse {
  error: {
    code: ProtocolErrorCode | string;
    message?: string;
    details?: unknown;
  };
}

/** GET /v1/health (unauthenticated). */
export interface Health {
  ok?: boolean;
  name?: string;
  protocol: number;
  pluginVersion?: string;
  dshVersion?: string;
  hostId?: string;
  pairingRequired?: boolean;
  time?: number;
}

/** Host capabilities advertised by GET /v1/host. */
export interface Capabilities {
  assistantStream?: boolean;
  approvals?: boolean;
  models?: boolean;
  problemQuestions?: boolean;
  attachments?: boolean;
  images?: boolean;
}

/** A paired device row (GET /v1/devices, GET /v1/host). */
export interface Device {
  deviceId: string;
  name?: string;
  platform?: string;
  createdAt?: number;
  lastSeenAt?: number;
  /** True for the device that made the request. */
  current?: boolean;
}

/** GET /v1/host. */
export interface HostInfo {
  hostId: string;
  name: string;
  platform?: string;
  dshVersion?: string;
  pluginVersion?: string;
  protocol: number;
  capabilities?: Capabilities;
  defaultCwd?: string;
  devices?: Device[];
}

/** A selectable model / provider pair. */
export interface ModelSelection {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

/** One model inside a catalog group. Field set follows the host catalog. */
export interface ModelInfo {
  id: string;
  name?: string;
  provider?: string;
  [key: string]: unknown;
}

/** A provider group in GET /v1/models. */
export interface ModelGroup {
  id: string;
  name?: string;
  models: ModelInfo[];
  [key: string]: unknown;
}

/** GET /v1/models — the host's modelCatalog passed through. */
export interface ModelCatalog {
  default?: ModelSelection | null;
  routableProviders?: string[];
  groups?: ModelGroup[];
  failures?: unknown[];
  [key: string]: unknown;
}

/** Best-effort last message summary on a session row (may be null). */
export interface SessionLastMessage {
  role?: string;
  text?: string;
  time?: number;
}

/** A row from GET /v1/sessions (protocol 3.3). */
export interface SessionRow {
  sessionId: string;
  title?: string | null;
  createdAt?: number;
  updatedAt?: number;
  cwd?: string;
  running?: boolean;
  active?: boolean;
  blank?: boolean;
  agentAvailable?: boolean;
  model?: ModelSelection | null;
  lastMessage?: SessionLastMessage | null;
  parentSessionId?: string | null;
  origin?: unknown;
  agentPreset?: string;
  [key: string]: unknown;
}

/** GET /v1/sessions response. */
export interface SessionListResponse {
  items: SessionRow[];
  nextCursor?: string | null;
}

/** Session header inside snapshots / details (protocol 3.5, 9.4). */
export interface SessionHeader {
  id: string;
  createdAt?: number;
  cwd?: string;
  agentPreset?: string;
  version?: number;
  isSeeded?: boolean;
  [key: string]: unknown;
}

/** Live session state (protocol 3.5 / SSE session.state). */
export interface SessionState {
  active: boolean;
  running: boolean;
  queue?: unknown[];
  pendingInput?: unknown[];
  [key: string]: unknown;
}

/** Projection block returned by snapshots (protocol 9.4). */
export interface SessionProjections {
  asOfSeq?: number;
  values?: {
    title?: string | null;
    workingDirectory?: string | null;
    modelSelection?: {
      next?: ModelSelection | null;
      lastUsed?: ModelSelection | null;
    } | null;
    [key: string]: unknown;
  };
  /** Older/reference hosts put modelSelection at the top level. */
  modelSelection?: {
    next?: ModelSelection | null;
    lastUsed?: ModelSelection | null;
  } | null;
  [key: string]: unknown;
}

/** GET /v1/sessions/:id (one-shot detail). */
export interface SessionDetail {
  sessionId: string;
  title?: string | null;
  header?: SessionHeader;
  state?: SessionState;
  projections?: SessionProjections;
  [key: string]: unknown;
}

/** A content part inside a DSH message. */
export interface ContentPart {
  type: string;
  text?: string;
  mediaType?: string;
  data?: string;
  name?: string;
  [key: string]: unknown;
}

/** Source of a user/message event; only kind === 'user' is a real user turn. */
export interface SessionEventSource {
  kind?: string;
  rpcId?: string;
  clientTimeZone?: string;
  provider?: string;
  model?: string;
  [key: string]: unknown;
}

/** Raw DSH SessionEvent as transported by the protocol. */
export interface SessionEvent {
  type: string;
  seq: number;
  time?: number;
  data?: unknown;
  surfaceOp?: unknown;
  sourceEventSeqs?: number[];
  ignorable?: boolean;
  [key: string]: unknown;
}

/** user/message event data (protocol 9.3). */
export interface UserMessageData {
  role?: string;
  id?: string;
  content?: ContentPart[];
  source?: SessionEventSource | string | null;
  [key: string]: unknown;
}

/** assistant/message event data (protocol 9.3). */
export interface AssistantMessageData {
  turn?: number;
  step?: number;
  message?: {
    role?: string;
    id?: string;
    content?: ContentPart[];
    source?: SessionEventSource;
    [key: string]: unknown;
  } | null;
  usage?: { inputTokens?: number; outputTokens?: number; [key: string]: unknown };
  stream?: unknown[];
  [key: string]: unknown;
}

/** One entry in a history/snapshot record list. */
export interface HistoryRecord {
  type: string;
  event?: SessionEvent;
  [key: string]: unknown;
}

/** GET /v1/sessions/:id/history response. */
export interface HistoryPage {
  records: HistoryRecord[];
  cursor?: number | null;
  hasMore?: boolean;
}

/** Assistant streaming frame (protocol 9.1 and the reference mock shape). */
export interface AssistantStreamChunk {
  type: string;
  index?: number;
  text?: string;
  blockType?: string;
  block?: unknown;
  usage?: { inputTokens?: number; outputTokens?: number; [key: string]: unknown };
  [key: string]: unknown;
}

/** SSE session.assistant frame: either attempt start/chunk/end or assistant-stream. */
export interface AssistantStreamFrame {
  type: string;
  attemptId?: string;
  attempt?: string;
  revision?: number;
  index?: number;
  time?: number;
  chunk?: AssistantStreamChunk;
  turn?: number;
  step?: number;
  startedAfterSeq?: number;
  finishReason?: string;
  phase?: string;
  delta?: { text?: string; reasoning?: string; [key: string]: unknown };
  [key: string]: unknown;
}

/** SSE hello payload. */
export interface HelloPayload {
  protocol: number;
  serverTime?: number;
  hostId?: string;
  subscriptions?: { subscriptionId: string; sessionId: string }[];
  [key: string]: unknown;
}

/** SSE session.snapshot payload (protocol 9.4). */
export interface SnapshotPayload {
  subscriptionId: string;
  sessionId: string;
  header?: SessionHeader;
  records?: HistoryRecord[];
  hasMore?: boolean;
  cursor?: number | null;
  projections?: SessionProjections;
  assistantStream?: unknown;
  [key: string]: unknown;
}

/** SSE session.event payload. */
export interface SessionEventPayload {
  subscriptionId: string;
  sessionId: string;
  event: SessionEvent;
  [key: string]: unknown;
}

/** SSE session.assistant payload. */
export interface AssistantPayload {
  subscriptionId: string;
  sessionId: string;
  frame: AssistantStreamFrame;
  [key: string]: unknown;
}

/** SSE session.state payload. */
export interface SessionStatePayload {
  subscriptionId: string;
  sessionId: string;
  state: SessionState;
  [key: string]: unknown;
}

/** SSE session.status payload (global). */
export interface SessionStatusPayload {
  sessionId: string;
  running: boolean;
  active: boolean;
  [key: string]: unknown;
}

/** SSE session.added payload. */
export interface SessionAddedPayload {
  row: SessionRow;
  [key: string]: unknown;
}

/** SSE session.removed payload. */
export interface SessionRemovedPayload {
  sessionId: string;
  [key: string]: unknown;
}

/** SSE subscription.closed payload. */
export interface SubscriptionClosedPayload {
  subscriptionId: string;
  sessionId: string;
  reason?: string;
  [key: string]: unknown;
}

/** SSE error payload (connection level). */
export interface SseErrorPayload {
  code: ProtocolErrorCode | string;
  message?: string;
  [key: string]: unknown;
}

/** POST /v1/pair success payload (protocol 1.3). */
export interface PairResult {
  protocol: number;
  token: string;
  deviceId: string;
  host?: {
    id?: string;
    name?: string;
    platform?: string;
    dshVersion?: string;
    pluginVersion?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** An approval request (protocol 3.10). */
export interface Approval {
  id: string;
  sessionId?: string;
  tool?: string;
  callId?: string;
  reason?: string;
  displayReason?: string;
  requestedAt?: number;
  expiresAt?: number | null;
  /** Present on approval/decided events and resolved approvals. */
  outcome?: string;
  decision?: string;
  [key: string]: unknown;
}

/** Answers accepted by POST /v1/approvals/:id. */
export type ApprovalDecision = 'allow' | 'reject';

/** An image queued for the next prompt (protocol 3.8 content block). */
export interface PromptImage {
  id: string;
  name?: string;
  mediaType: string;
  /** Base64 without the data: prefix. */
  data: string;
  /** Local preview URI (never sent to the host). */
  uri?: string;
}

/** POST /v1/sessions/:id/prompt payload (protocol 3.8). */
export interface PromptPayload {
  requestId: string;
  mode?: 'queue' | 'steer';
  content: ContentPart[];
  clientTimeZone?: string;
}

/** Options for POST /v1/sessions/:id/open (protocol 3.7). */
export interface OpenSessionOptions {
  maxMessages?: number;
  turnWindow?: { minMessages?: number; maxMessages?: number; minTurns?: number };
  assistantStream?: boolean;
}

/** Options for POST /v1/sessions (protocol 3.4). */
export interface CreateSessionOptions {
  cwd?: string;
  agentPreset?: string;
}

/** SSE connection status shown in the UI. */
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

/** Persistent view of the app's link to the host. */
export interface ConnectionState {
  status: ConnectionStatus;
  baseUrl?: string;
  host?: HostInfo;
  /** Device display name chosen at pairing time. */
  deviceName?: string;
  error?: string;
  /** True when the stored token was rejected and the user must pair again. */
  needsPairing?: boolean;
}

/** Live assistant text accumulated from session.assistant frames. */
export interface StreamingState {
  attemptId?: string;
  text: string;
  reasoning: string;
  active: boolean;
}

/** An optimistically inserted user bubble that has not been echoed yet. */
export interface PendingUser {
  requestId: string;
  text: string;
  time: number;
  status: 'sending' | 'failed';
}

/** Everything the chat screen needs about the open session. */
export interface CurrentSessionState {
  sessionId?: string;
  title?: string;
  running: boolean;
  active: boolean;
  /** Raw events; snapshot replaces the array, live events append by seq. */
  events: SessionEvent[];
  streaming: StreamingState;
  pendingApprovals: Approval[];
  pendingUser: PendingUser[];
  model?: ModelSelection;
  loading: boolean;
  hasMore: boolean;
  cursor?: number | null;
  error?: string;
}

/** Persisted connection metadata stored in AsyncStorage (token lives elsewhere). */
export interface StoredConnectionMeta {
  baseUrl: string;
  deviceId: string;
  deviceName: string;
  hostId?: string;
  hostName?: string;
}