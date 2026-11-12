import type { WorkspaceDiff } from './types';

/** Resolve only web links externally; all desktop paths go through scoped host IO. */
export function desktopPath(value: string): string | undefined {
  let path = value.trim().replace(/^<|>$/g, '');
  if (/^(https?:|data:|mailto:|tel:|#)/i.test(path)) return undefined;
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path) && !/^file:/i.test(path)) return undefined;
  path = path.replace(/^file:\/\//i, '').replace(/^\/([a-z]:[\\/])/i, '$1').replace(/#L?\d+(?:[-:]L?\d+)?$/i, '');
  try { return decodeURIComponent(path); } catch { return path; }
}
export function workspaceFileUrl(base: string, sessionId: string, path: string): string {
  return base.replace(/\/+$/, '') + '/v1/sessions/' + encodeURIComponent(sessionId) + '/file?format=bytes&path=' + encodeURIComponent(path);
}
export function isImagePath(path: string): boolean { return /\.(png|jpe?g|webp|gif|bmp|avif)(?:[?#]|$)/i.test(path); }
export function unifiedDiff(diff: WorkspaceDiff): string {
  if (diff.kind !== 'text' || !diff.hunks?.length) return '';
  return ['--- a/' + (diff.path ?? 'file'), '+++ b/' + (diff.path ?? 'file'), ...diff.hunks.flatMap(h => [
    `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines,
  ])].join('\n');
}
