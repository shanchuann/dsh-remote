/**
 * Minimal SSE transport for React Native built on XMLHttpRequest.
 *
 * The protocol exposes GET /v1/events?token=..., so no custom headers are
 * needed (protocol 1.4). This client:
 *  - parses frames incrementally with SseParser,
 *  - reconnects with exponential backoff (1s -> 30s, protocol section 6.2),
 *  - watches the 15s server heartbeat and reconnects if the stream goes silent,
 *  - stops reconnecting on fatal connection errors such as unauthorized.
 */

import { SseParser, type SseMessage } from './sse-parser';

/** Lifecycle state of the event stream. */
export type SseState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Parsed connection-level error payload. */
export interface SseErrorInfo {
  code: string;
  message?: string;
}

export interface SseCloseInfo {
  /** False when close() was called by us (or a fatal error stopped retries). */
  willReconnect: boolean;
  error?: Error;
}

export interface SseConnectionOptions {
  url: string;
  /** Called for every parsed SSE message, in order. */
  onMessage: (message: SseMessage) => void;
  /** Called once per successful (re)connection. */
  onOpen?: () => void;
  /** Called whenever the stream drops. */
  onClose?: (info: SseCloseInfo) => void;
  /** Transport-level errors (network, idle timeout). Not fatal by itself. */
  onError?: (error: Error) => void;
  /** Called when the stream is rejected with an HTTP auth status (401/403). */
  onHttpStatus?: (status: number) => void;
  /** No-data watchdog. The server pings every 15s, so 45s is generous. */
  idleTimeoutMs?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** SSE error codes that must not be retried (protocol section 8). */
  fatalCodes?: string[];
  /** Test seams. */
  createXhr?: () => XMLHttpRequest;
  setTimeoutFn?: (callback: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  randomFn?: () => number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 45_000;
const DEFAULT_MIN_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;
const DEFAULT_FATAL_CODES = ['unauthorized', 'protocol-unsupported'];

export class SseConnection {
  private readonly options: SseConnectionOptions;
  private readonly parser = new SseParser();
  private readonly fatalCodes: string[];
  private readonly setTimeoutFn: (callback: () => void, ms: number) => unknown;
  private readonly clearTimeoutFn: (handle: unknown) => void;
  private readonly randomFn: () => number;

  private stateValue: SseState = 'idle';
  private xhr: XMLHttpRequest | null = null;
  private readOffset = 0;
  private attempt = 0;
  private opened = false;
  private stopped = false;
  private fatal = false;
  private reconnectTimer: unknown = null;
  private idleTimer: unknown = null;
  private lastError: Error | undefined;

  constructor(options: SseConnectionOptions) {
    this.options = options;
    this.fatalCodes = options.fatalCodes ?? DEFAULT_FATAL_CODES;
    this.setTimeoutFn =
      options.setTimeoutFn ?? ((callback, ms) => setTimeout(callback, ms) as unknown);
    this.clearTimeoutFn =
      options.clearTimeoutFn ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.randomFn = options.randomFn ?? Math.random;
  }

  get state(): SseState {
    return this.stateValue;
  }

  /** Establish the stream; safe to call again after close(). */
  open(): void {
    if (this.stateValue === 'connecting' || this.stateValue === 'open' || this.stateValue === 'reconnecting') {
      return;
    }
    this.stopped = false;
    this.fatal = false;
    this.attempt = 0;
    this.connect();
  }

  /** Stop the stream and cancel any pending reconnect. */
  close(): void {
    if (this.stateValue === 'closed') return;
    this.stopped = true;
    this.clearReconnectTimer();
    this.clearIdleTimer();
    this.abortXhr();
    this.stateValue = 'closed';
    this.options.onClose?.({ willReconnect: false });
  }

  private connect(): void {
    if (this.stopped || this.fatal) return;
    this.clearReconnectTimer();
    this.parser.reset();
    this.readOffset = 0;
    this.opened = false;
    this.stateValue = this.attempt === 0 ? 'connecting' : 'reconnecting';

    let xhr: XMLHttpRequest;
    try {
      xhr = this.options.createXhr ? this.options.createXhr() : new XMLHttpRequest();
    } catch (error) {
      this.handleDrop(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    this.xhr = xhr;

    try {
      xhr.open('GET', this.options.url, true);
      xhr.setRequestHeader('Accept', 'text/event-stream');
      xhr.setRequestHeader('Cache-Control', 'no-cache');
      xhr.setRequestHeader('Connection', 'keep-alive');
    } catch (error) {
      this.handleDrop(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    xhr.onreadystatechange = () => {
      if (this.xhr !== xhr) return;
      if (xhr.readyState === 3) {
        this.consume(xhr);
      } else if (xhr.readyState === 4) {
        this.consume(xhr);
        const status = typeof xhr.status === 'number' ? xhr.status : 0;
        if (status === 401 || status === 403) {
          // The device token is gone: retrying would hammer the host forever.
          this.fatal = true;
          this.options.onHttpStatus?.(status);
          this.handleDrop(new Error('SSE unauthorized (HTTP ' + status + ')'));
          return;
        }
        const error = status >= 400 ? new Error('SSE connection failed with HTTP ' + status) : undefined;
        this.handleDrop(error);
      }
    };
    xhr.onprogress = () => {
      if (this.xhr === xhr) this.consume(xhr);
    };
    xhr.onerror = () => {
      if (this.xhr !== xhr) return;
      this.handleDrop(new Error('Network request failed'));
    };
    xhr.ontimeout = () => {
      if (this.xhr !== xhr) return;
      this.handleDrop(new Error('SSE connection timeout'));
    };
    xhr.onabort = () => {
      if (this.xhr !== xhr || this.stopped) return;
      this.handleDrop(new Error('SSE connection aborted'));
    };

    try {
      xhr.send();
    } catch (error) {
      this.handleDrop(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    this.armIdleTimer();
  }

  private consume(xhr: XMLHttpRequest): void {
    if (this.stopped || this.fatal) return;
    let text: string;
    try {
      text = xhr.responseText;
    } catch {
      return;
    }
    if (typeof text !== 'string' || text.length === 0) return;
    if (!this.opened) {
      this.opened = true;
      this.attempt = 0;
      this.stateValue = 'open';
      this.options.onOpen?.();
    }
    if (text.length <= this.readOffset) return;
    const chunk = text.slice(this.readOffset);
    this.readOffset = text.length;
    this.armIdleTimer();
    let messages: SseMessage[];
    try {
      messages = this.parser.push(chunk);
    } catch {
      return;
    }
    for (const message of messages) {
      if (message.event === 'error') {
        const info = this.parseErrorPayload(message.data);
        if (info && this.fatalCodes.includes(info.code)) {
          this.fatal = true;
          this.lastError = new Error(info.message || info.code);
        }
      }
      this.options.onMessage(message);
      if (this.fatal) break;
    }
  }

  private parseErrorPayload(data: string): SseErrorInfo | null {
    try {
      const parsed = JSON.parse(data) as { code?: unknown; message?: unknown };
      if (parsed && typeof parsed.code === 'string') {
        return { code: parsed.code, message: typeof parsed.message === 'string' ? parsed.message : undefined };
      }
    } catch {
      // Fall through: malformed payloads are ignored.
    }
    return null;
  }

  private handleDrop(error?: Error): void {
    if (this.stopped) return;
    this.clearIdleTimer();
    this.abortXhr();
    this.lastError = error ?? this.lastError;
    if (error) this.options.onError?.(error);
    if (this.fatal) {
      this.stopped = true;
      this.stateValue = 'closed';
      this.options.onClose?.({ willReconnect: false, error: error ?? this.lastError });
      return;
    }
    const willReconnect = true;
    this.stateValue = 'reconnecting';
    this.options.onClose?.({ willReconnect, error: error ?? this.lastError });
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.fatal) return;
    this.clearReconnectTimer();
    const { minBackoffMs = DEFAULT_MIN_BACKOFF_MS, maxBackoffMs = DEFAULT_MAX_BACKOFF_MS } = this.options;
    const base = Math.min(maxBackoffMs, minBackoffMs * Math.pow(2, this.attempt));
    // Up to 20% jitter so several devices do not reconnect in lockstep.
    const delay = Math.round(base * (1 + this.randomFn() * 0.2));
    this.attempt = Math.min(this.attempt + 1, 16);
    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private abortXhr(): void {
    const xhr = this.xhr;
    this.xhr = null;
    if (!xhr) return;
    xhr.onreadystatechange = null;
    xhr.onprogress = null;
    xhr.onerror = null;
    xhr.ontimeout = null;
    xhr.onabort = null;
    try {
      xhr.abort();
    } catch {
      // Ignore: already closed.
    }
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    const timeout = this.options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    if (timeout <= 0) return;
    this.idleTimer = this.setTimeoutFn(() => {
      this.idleTimer = null;
      this.handleDrop(new Error('SSE idle timeout'));
    }, timeout);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      this.clearTimeoutFn(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      this.clearTimeoutFn(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

/** Build the SSE endpoint URL including the query token (protocol 1.4). */
export function buildEventsUrl(baseUrl: string, token: string): string {
  const separator = baseUrl.includes('?') ? '&' : '?';
  return baseUrl + '/v1/events' + separator + 'token=' + encodeURIComponent(token);
}
