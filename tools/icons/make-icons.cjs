
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = 'D:\\Code\\dsh-remote';
const svgSource = fs.readFileSync(path.join(ROOT, 'deepseek.svg'), 'utf8');
// Strip the inline style and take only the <path> geometry so we can recolor it.
const pathMatch = svgSource.match(/<path[^>]*d="([^"]+)"/s);
if (!pathMatch) throw new Error('deepseek.svg has no path');
const d = pathMatch[1];
const logo = (fill) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="' + fill + '" d="' + d + '"/></svg>';

const BLUE = '#4D6BFE';
const OUT = path.join(ROOT, 'app', 'assets', 'images');
fs.mkdirSync(OUT, { recursive: true });

async function logoPng(size, fill) {
  return sharp(Buffer.from(logo(fill))).resize(size, size, { fit: 'contain' }).png().toBuffer();
}

async function roundedIcon() {
  const size = 1024;
  const bg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5B7BFF"/><stop offset="1" stop-color="#3D55E8"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#g)"/></svg>');
  const mark = await logoPng(640, '#FFFFFF');
  return sharp(bg).composite([{ input: mark, top: 192, left: 192 }]).png().toBuffer();
}

(async () => {
  const icon = await roundedIcon();
  fs.writeFileSync(path.join(OUT, 'icon.png'), icon);
  fs.writeFileSync(path.join(OUT, 'favicon.png'), await sharp(icon).resize(64, 64).png().toBuffer());
  // Adaptive foreground: transparent, logo inside the 66% safe zone.
  const fg = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await logoPng(600, '#FFFFFF'), top: 212, left: 212 }]).png().toBuffer();
  fs.writeFileSync(path.join(OUT, 'adaptive-icon.png'), fg);
  const mono = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await logoPng(600, '#FFFFFF'), top: 212, left: 212 }]).png().toBuffer();
  fs.writeFileSync(path.join(OUT, 'adaptive-icon-monochrome.png'), mono);
  fs.writeFileSync(path.join(OUT, 'splash-icon.png'), await logoPng(512, '#FFFFFF'));
  // Also emit a small in-app brand mark (transparent, brand colour) for headers.
  fs.writeFileSync(path.join(ROOT, 'app', 'assets', 'images', 'deepseek-mark.png'), await logoPng(256, BLUE));
  console.log('icons written to', OUT);
  for (const f of fs.readdirSync(OUT)) console.log(' ', f, fs.statSync(path.join(OUT, f)).size, 'bytes');
})().catch((e) => { console.error(e); process.exit(1); });
