import type { ProtocolErrorCode } from './types';

/** Any error thrown by the remote client, with the protocol error code attached. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ProtocolErrorCode | string;
  readonly details?: unknown;

  constructor(status: number, code: ProtocolErrorCode | string, message?: string, details?: unknown) {
    super(message ?? code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Structurally detect an ApiError without importing the class at runtime. */
export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { status?: unknown }).status === 'number' &&
    typeof (value as { code?: unknown }).code === 'string'
  );
}

const CODE_MESSAGES: Record<string, string> = {
  'invalid-argument': '请求参数不合法',
  unauthorized: '认证已失效，请重新配对',
  'pairing-invalid': '配对码错误或已过期',
  'pairing-locked': '配对失败次数过多，请 5 分钟后再试',
  'protocol-unsupported': 'Host 协议版本不兼容，请升级 App 或插件',
  'session-not-found': '会话不存在或已被删除',
  'session-unavailable': '会话当前不可用',
  'stream-unavailable': '实时连接暂不可用',
  'approval-gone': '审批已过期或已在桌面端处理',
  'rate-limited': '请求过于频繁，请稍后再试',
  internal: 'Host 内部错误',
  'not-found': 'Host 地址不可达',
  network: '无法连接 Host，请检查手机与电脑是否在同一局域网',
  timeout: '连接 Host 超时',
  aborted: '请求已取消',
  'protocol-version': 'Host 协议版本不兼容',
  'sse-closed': '实时连接已断开',
};

/** Chinese human-readable message for any thrown value. */
export function describeError(error: unknown): string {
  if (isApiError(error)) {
    const mapped = CODE_MESSAGES[error.code];
    const detail = typeof error.message === 'string' ? error.message.trim() : '';
    const hasDetail = detail.length > 0 && detail !== error.code;
    if (mapped) {
      // Keep the host/plugin message when it adds information, so a toast such
      // as "Host 内部错误" still hints at the real cause instead of swallowing it.
      return hasDetail && !mapped.includes(detail) ? mapped + '（' + detail + '）' : mapped;
    }
    return hasDetail ? detail : '请求失败（' + error.code + '）';
  }
  if (error instanceof Error) {
    const message = error.message || '';
    if (/network request failed|failed to fetch|network error/i.test(message)) {
      return CODE_MESSAGES.network;
    }
    if (/aborted|abort/i.test(message)) return CODE_MESSAGES.aborted;
    if (/timeout|timed out/i.test(message)) return CODE_MESSAGES.timeout;
    return message || '未知错误';
  }
  if (typeof error === 'string' && error) return error;
  return '未知错误';
}

/**
 * True when the host rejected a prompt because the clientTimeZone value is not
 * "UTC" or an IANA Area/Location name (DSH answers 500 internal, message
 * "clientTimeZone must be UTC or a valid IANA Area/Location name").
 */
export function isClientTimeZoneError(error: unknown): boolean {
  if (!isApiError(error)) return false;
  const message = typeof error.message === 'string' ? error.message : '';
  return /clientTimeZone/i.test(message) && /(UTC|IANA|timezone)/i.test(message);
}

/** Describe a protocol violation (wrong version, bad payload). */
export function protocolError(what: string): ApiError {
  return new ApiError(0, 'protocol-version', '协议不兼容：' + what);
}