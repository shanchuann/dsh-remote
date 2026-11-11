
const fs = require('fs');
const path = require('path');
const APP = 'D:\\Code\\dsh-remote\\app';
const COMP = path.join(APP, 'src', 'components');
const slugs = fs.readdirSync(COMP).filter((d) => fs.statSync(path.join(COMP, d)).isDirectory());
(async () => {
  let written = 0, skipped = 0;
  for (const slug of slugs) {
    let json;
    try {
      const res = await fetch('https://beui.dev/native/r/' + slug);
      if (!res.ok) { console.log('SKIP', slug, res.status); continue; }
      json = await res.json();
    } catch (error) { console.log('FETCH-ERR', slug, error.message); continue; }
    for (const file of json.files || []) {
      const rel = file.path || file.target;
      if (!rel || typeof file.content !== 'string') continue;
      if (!rel.startsWith('src/')) continue;
      const dest = path.join(APP, rel);
      if (fs.existsSync(dest)) { skipped++; continue; }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, file.content);
      console.log('WROTE', rel);
      written++;
    }
  }
  console.log('written', written, 'skipped', skipped);
})().catch((e) => { console.error(e); process.exit(1); });
