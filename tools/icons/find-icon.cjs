
const fs = require('fs');
const xml = fs.readFileSync('D:\\Code\\dsh-remote\\.ui-launcher.xml','utf8');
for (const m of xml.matchAll(/<node[^>]*>/g)) {
  const n = m[0];
  const d = (n.match(/content-desc="([^"]*)"/)||[])[1] || '';
  const t = (n.match(/\stext="([^"]*)"/)||[])[1] || '';
  const b = (n.match(/bounds="([^"]*)"/)||[])[1] || '';
  if (/DSH Remote/i.test(d + ' ' + t)) console.log('desc=', d, '| text=', t, '|', b);
}
