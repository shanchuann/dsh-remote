/**
 * Formatting helpers shared by the list and settings screens. Pure (no React
 * Native imports) so they stay trivially testable.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function pad(value: number): string {
  return value < 10 ? '0' + value : String(value);
}

/** "刚刚" / "3 分钟前" / "2 小时前" / "昨天" / "11月9日". */
export function formatRelativeTime(timestamp: number | null | undefined, now = Date.now()): string {
  if (!timestamp || !Number.isFinite(timestamp) || timestamp <= 0) return '—';
  const delta = now - timestamp;
  if (delta < 0) return formatClock(timestamp);
  if (delta < MINUTE) return '刚刚';
  if (delta < HOUR) return Math.floor(delta / MINUTE) + ' 分钟前';
  if (delta < DAY) return Math.floor(delta / HOUR) + ' 小时前';
  if (delta < 2 * DAY) return '昨天';
  if (delta < 7 * DAY) return Math.floor(delta / DAY) + ' 天前';
  const date = new Date(timestamp);
  const current = new Date(now);
  if (date.getFullYear() === current.getFullYear()) {
    return date.getMonth() + 1 + '月' + date.getDate() + '日';
  }
  return date.getFullYear() + '/' + (date.getMonth() + 1) + '/' + date.getDate();
}

/** "14:05" clock label. */
export function formatClock(timestamp: number | null | undefined): string {
  if (!timestamp || !Number.isFinite(timestamp) || timestamp <= 0) return '—';
  const date = new Date(timestamp);
  return pad(date.getHours()) + ':' + pad(date.getMinutes());
}

/** Shorten a string for a single line label. */
export function truncate(text: string | null | undefined, maxLength = 120): string {
  const value = (text ?? '').trim();
  if (!value) return '';
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 1)) + '…';
}

/** Human label for a device platform string from the host. */
export function formatPlatform(platform: string | null | undefined): string {
  switch (platform) {
    case 'android':
      return 'Android';
    case 'ios':
      return 'iOS';
    case 'win32':
      return 'Windows';
    case 'darwin':
      return 'macOS';
    case 'linux':
      return 'Linux';
    case 'web':
      return 'Web';
    default:
      return platform || '未知平台';
  }
}

/** Pretty-print a byte-ish version string without inventing values. */
export function formatVersion(value: string | null | undefined): string {
  return value && value.trim() ? value : '—';
}
