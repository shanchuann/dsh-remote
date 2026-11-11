/**
 * Incremental Server-Sent Events parser (WHATWG event-stream format).
 *
 * Pure: feed raw text chunks in, get complete messages out. Network code lives
 * in sse.ts so the parsing rules (CRLF, multi-line data, comments, BOM,
 * chunk boundaries inside a frame) can be unit tested.
 */

/** One dispatched SSE message. */
export interface SseMessage {
  /** Optional, from the `id:` field. */
  id?: string;
  /** Event name; defaults to "message" per the SSE spec. */
  event: string;
  /** Data lines joined with "\n". */
  data: string;
}

/** Stateful incremental parser. Feed it every chunk of responseText in order. */
export class SseParser {
  private buffer = '';
  private started = false;
  private eventName = '';
  private dataLines: string[] = [];
  private lastId: string | undefined;

  /** Feed one decoded chunk; returns the messages completed by this chunk. */
  push(chunk: string): SseMessage[] {
    if (!chunk) return [];
    let text = chunk;
    if (!this.started) {
      this.started = true;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    this.buffer += text;
    return this.drain();
  }

  /** Reset all parser state (used on reconnect). */
  reset(): void {
    this.buffer = '';
    this.started = false;
    this.eventName = '';
    this.dataLines = [];
    this.lastId = undefined;
  }

  private drain(): SseMessage[] {
    const messages: SseMessage[] = [];
    // Normalise line endings so a single splitter handles LF, CRLF and CR.
    let index = 0;
    let lineStart = 0;
    let consumed = 0;
    const buffer = this.buffer;
    while (index < buffer.length) {
      const char = buffer[index];
      if (char !== '\n' && char !== '\r') {
        index += 1;
        continue;
      }
      let next = index + 1;
      if (char === '\r') {
        // A CR at the very end of the buffer may be the first half of CRLF;
        // wait for the next chunk before deciding (P2-1).
        if (next >= buffer.length) break;
        if (buffer[next] === '\n') next += 1;
      }
      const line = buffer.slice(lineStart, index);
      const message = this.consumeLine(line);
      if (message) messages.push(message);
      index = next;
      lineStart = next;
      consumed = next;
    }
    this.buffer = buffer.slice(consumed);
    return messages;
  }

  private consumeLine(line: string): SseMessage | null {
    if (line.length === 0) {
      return this.dispatch();
    }
    if (line.startsWith(':')) return null; // comment / heartbeat
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    switch (field) {
      case 'event':
        this.eventName = value;
        break;
      case 'data':
        this.dataLines.push(value);
        break;
      case 'id':
        if (!value.includes('\u0000')) this.lastId = value;
        break;
      case 'retry':
        // Ignored: the client owns its own backoff schedule.
        break;
      default:
        // Unknown fields are ignored per the SSE spec.
        break;
    }
    return null;
  }

  private dispatch(): SseMessage | null {
    if (this.dataLines.length === 0) {
      // A blank line without data still resets the event name.
      this.eventName = '';
      return null;
    }
    const message: SseMessage = {
      event: this.eventName || 'message',
      data: this.dataLines.join('\n'),
    };
    if (this.lastId !== undefined) message.id = this.lastId;
    this.eventName = '';
    this.dataLines = [];
    return message;
  }
}

/** Parse one already-complete event-stream payload (tests / fixtures). */
export function parseSseText(text: string): SseMessage[] {
  const parser = new SseParser();
  return parser.push(text);
}
