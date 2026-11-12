export type DiffLine = { kind: 'add' | 'del' | 'context' | 'meta'; old?: number; current?: number; text: string; prefix?: string; changed?: string; suffix?: string };

/** Unified diff line numbers reset at each hunk and each file. */
export function parseDiff(code: string): DiffLine[] {
  let old = 0, current = 0;
  let hunk = false;
  const rows = code.replace(/\r\n/g, '\n').split('\n').map((text): DiffLine => {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (header) { old = Number(header[1]); current = Number(header[2]); hunk = true; return { kind: 'meta', text }; }
    if (/^(diff |index |--- |\+\+\+ |\\)/.test(text)) { if (text.startsWith('diff ')) hunk = false; return { kind: 'meta', text }; }
    if (!hunk) return { kind: 'meta', text };
    if (text.startsWith('+')) return { kind: 'add', current: current++, text: text.slice(1) };
    if (text.startsWith('-')) return { kind: 'del', old: old++, text: text.slice(1) };
    if (text.startsWith(' ')) return { kind: 'context', old: old++, current: current++, text: text.slice(1) };
    return { kind: 'meta', text };
  });
  // Highlight the changed span in adjacent replacement lines without a quadratic diff.
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i], b = rows[i + 1];
    if (a.kind !== 'del' || b.kind !== 'add') continue;
    let start = 0, end = 0;
    while (start < Math.min(a.text.length, b.text.length) && a.text[start] === b.text[start]) start++;
    while (end < Math.min(a.text.length, b.text.length) - start && a.text.at(-1 - end) === b.text.at(-1 - end)) end++;
    for (const row of [a, b]) { row.prefix = row.text.slice(0, start); row.changed = row.text.slice(start, row.text.length - end); row.suffix = end ? row.text.slice(-end) : ''; }
  }
  return rows;
}
