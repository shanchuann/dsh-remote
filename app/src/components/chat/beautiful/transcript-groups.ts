import type { TranscriptItem } from '../../../lib/transcript.ts';

export type ToolRun = { kind: 'tools'; id: string; items: Extract<TranscriptItem, { kind: 'tool' }>[] };
export type DisplayItem = TranscriptItem | ToolRun;

/** Only adjacent calls share a group; messages and approvals keep their order. */
export function groupToolRuns(items: readonly TranscriptItem[]): DisplayItem[] {
  const result: DisplayItem[] = [];
  for (const item of items) {
    if (item.kind !== 'tool') {
      result.push(item);
      continue;
    }
    const last = result[result.length - 1];
    if (last?.kind === 'tools' && last.items.length < 8) last.items.push(item);
    else result.push({ kind: 'tools', id: 'tools-' + item.id, items: [item] });
  }
  return result;
}
