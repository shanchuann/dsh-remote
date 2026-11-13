/**
 * Pairing payload parsing and host-URL normalisation.
 *
 * Pure functions only (no React Native imports) so they can be unit tested with
 * node --test. The QR payload is documented in docs/protocol.md section 1.2:
 *
 *   dshremote://pair?u=http%3A%2F%2F192.168.1.23%3A8790&c=123456&h=<hostId>&n=<hostName>
 */

/** The subset of a pairing payload the app needs. */
export interface PairingInfo {
  /** Normalised host base URL, e.g. "http://192.168.1.23:8790". */
  baseUrl: string;
  /** Six digit one-time pairing code, when the payload carried one. */
  code?: string;
  /** Stable host id (same computer across restarts). */
  hostId?: string;
  /** Optional display name for the host. */
  hostName?: string;
  /** Alternate address carried by the same QR (tried when baseUrl fails). */
  altBaseUrl?: string;
}

const PAIR_SCHEME = 'dshremote';

const PAIRING_CODE_RE = /^\d{6}$/;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Parse an application/x-www-form-urlencoded query string (order independent). */
export function parseQueryString(query: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!query) return out;
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? '' : pair.slice(eq + 1);
    const key = safeDecode(rawKey);
    if (!key) continue;
    out[key] = safeDecode(rawValue);
  }
  return out;
}

/** True for the six digit one-time pairing code format. */
export function isValidPairingCode(code: string | undefined | null): boolean {
  return typeof code === 'string' && PAIRING_CODE_RE.test(code.trim());
}

/**
 * Normalise user input into a host base URL.
 *
 * Accepts "192.168.1.23:8790", "http://host:8790/", a pasted pairing URI, and
 * tolerates an accidental trailing "/v1" or "/pair". Returns null when the
 * input cannot be a usable http(s) origin.
 */
export function tryNormalizeBaseUrl(input: string | undefined | null): string | null {
  let raw = (input ?? '').trim();
  if (!raw) return null;
  raw = raw.replace(/\s+/g, '');
  if (raw.toLowerCase().startsWith(PAIR_SCHEME + ':')) {
    const parsed = parsePairingUri(raw);
    if (!parsed) return null;
    raw = parsed.baseUrl;
  }
  const explicitScheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(raw);
  if (explicitScheme && !/^https?$/i.test(explicitScheme[1] ?? '')) return null;
  if (!/^https?:\/\//i.test(raw)) raw = 'http://' + raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  if (url.username || url.password) return null;
  if (url.search || url.hash) return null;
  if (url.port) {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  }
  let path = url.pathname.replace(/\/+$/, '');
  // A pasted "/v1" (API root) or "/pair" (host pairing page) is a common slip.
  path = path.replace(/\/v1$/i, '').replace(/\/pair$/i, '');
  path = path.replace(/\/+$/, '');
  if (path) return null;
  const host = url.hostname.includes(':') && !url.hostname.startsWith('[') ? '[' + url.hostname + ']' : url.hostname;
  return url.protocol + '//' + host + (url.port ? ':' + url.port : '') + path;
}

/** Like tryNormalizeBaseUrl but throws a user-facing message. */
export function normalizeBaseUrl(input: string | undefined | null): string {
  const normalized = tryNormalizeBaseUrl(input);
  if (!normalized) {
    throw new Error('Host 地址格式不正确，示例：http://192.168.1.23:8790');
  }
  return normalized;
}

/** Build a pairing URI (used by tests and for debugging/display). */
export function buildPairingUri(info: PairingInfo): string {
  const parts = ['u=' + encodeURIComponent(info.baseUrl)];
  if (info.code) parts.push('c=' + encodeURIComponent(info.code));
  if (info.hostId) parts.push('h=' + encodeURIComponent(info.hostId));
  if (info.hostName) parts.push('n=' + encodeURIComponent(info.hostName));
  if (info.altBaseUrl) parts.push('alt=' + encodeURIComponent(info.altBaseUrl));
  return PAIR_SCHEME + '://pair?' + parts.join('&');
}

/**
 * Parse anything that might carry pairing data: the protocol pairing URI, a
 * JSON payload, or a plain host URL typed into the manual field.
 * Returns null when no usable host URL can be found.
 */
export function parsePairingUri(raw: string | undefined | null): PairingInfo | null {
  const text = (raw ?? '').trim();
  if (!text) return null;

  if (text.startsWith('{')) {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      const candidate =
        nonEmpty(obj.u) ?? nonEmpty(obj.baseUrl) ?? nonEmpty(obj.url) ?? nonEmpty(obj.host) ?? nonEmpty(obj.base_url);
      const baseUrl = tryNormalizeBaseUrl(candidate);
      if (!baseUrl) return null;
      const info: PairingInfo = { baseUrl };
      const code = nonEmpty(obj.c) ?? nonEmpty(obj.code) ?? nonEmpty(obj.pairingCode);
      if (code) info.code = code;
      const hostId = nonEmpty(obj.h) ?? nonEmpty(obj.hostId);
      if (hostId) info.hostId = hostId;
      const hostName = nonEmpty(obj.n) ?? nonEmpty(obj.hostName) ?? nonEmpty(obj.name);
      if (hostName) info.hostName = hostName;
      const alt = tryNormalizeBaseUrl(nonEmpty(obj.alt) ?? nonEmpty(obj.altBaseUrl));
      if (alt && alt !== baseUrl) info.altBaseUrl = alt;
      return info;
    } catch {
      return null;
    }
  }

  if (text.toLowerCase().startsWith(PAIR_SCHEME + ':')) {
    const queryIndex = text.indexOf('?');
    const params = parseQueryString(queryIndex === -1 ? '' : text.slice(queryIndex + 1));
    const candidate = nonEmpty(params.u) ?? nonEmpty(params.url) ?? nonEmpty(params.baseUrl) ?? nonEmpty(params.host);
    const baseUrl = tryNormalizeBaseUrl(candidate);
    if (!baseUrl) return null;
    const info: PairingInfo = { baseUrl };
    const code = nonEmpty(params.c) ?? nonEmpty(params.code);
    if (code) info.code = code;
    if (params.h) info.hostId = params.h;
    if (params.n) info.hostName = params.n;
    const alt = tryNormalizeBaseUrl(params.alt);
    if (alt && alt !== baseUrl) info.altBaseUrl = alt;
    return info;
  }

  const baseUrl = tryNormalizeBaseUrl(text);
  return baseUrl ? { baseUrl } : null;
}

/** Short display form of a base URL for the settings screen. */
export function displayBaseUrl(baseUrl: string | undefined | null): string {
  if (!baseUrl) return '—';
  return baseUrl.replace(/^https?:\/\//i, '');
}
