import { readFileSync } from 'node:fs';
const file = process.argv[2] || 'tools/verify/.ui.xml';
const needle = process.argv[3] || '';
const xml = readFileSync(file, 'utf8');
const nodes = [...xml.matchAll(/<node[^>]*>/g)].map((m) => m[0]);
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const results = [];
for (const node of nodes) {
  const text = /text="([^"]*)"/.exec(node);
  const desc = /content-desc="([^"]*)"/.exec(node);
  const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
  if (!bounds) continue;
  const label = (text && unescape(text[1])) || (desc && unescape(desc[1])) || '';
  if (needle && !label.includes(needle)) continue;
  results.push({ label, x: Math.round((+bounds[1] + +bounds[3]) / 2), y: Math.round((+bounds[2] + +bounds[4]) / 2), bounds: bounds[0] });
}
if (needle) {
  if (results.length === 0) { console.log('NOT_FOUND'); process.exit(1); }
  console.log(results[0].x + ' ' + results[0].y + ' ' + results[0].label);
} else {
  console.log(results.map((r) => r.x + ' ' + r.y + ' ' + r.label).join('\n'));
}
