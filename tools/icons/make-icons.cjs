
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = 'D:\\Code\\dsh-remote';
const IMAGES = path.join(ROOT, 'app', 'assets', 'images');
const WHALE = path.join(IMAGES, 'deepseek-whale.png');
const WORDMARK = path.join(IMAGES, 'deepseek-wordmark.png');
const BLUE = { r: 77, g: 107, b: 254 };

/** Render the whale silhouette (alpha mask) in one solid color. */
async function tintWhale(size, color) {
  const { data, info } = await sharp(WHALE)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color.r; data[i + 1] = color.g; data[i + 2] = color.b;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

/** Same for the wordmark: preserve its alpha, replace RGB. */
async function tintWordmark(color) {
  const { data, info } = await sharp(WORDMARK).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color.r; data[i + 1] = color.g; data[i + 2] = color.b;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

async function roundedIcon(size) {
  const bg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5B7BFF"/><stop offset="1" stop-color="#3D55E8"/></linearGradient></defs><rect width="' + size + '" height="' + size + '" fill="url(#g)"/></svg>');
  const mark = await tintWhale(Math.round(size * 0.62), { r: 255, g: 255, b: 255 });
  const offset = Math.round(size * 0.19);
  return sharp(bg).composite([{ input: mark, top: offset, left: offset }]).png().toBuffer();
}

async function transparentMark(size, ratio) {
  const mark = await tintWhale(Math.round(size * ratio), { r: 255, g: 255, b: 255 });
  const offset = Math.round((size - Math.round(size * ratio)) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, top: offset, left: offset }]).png().toBuffer();
}

(async () => {
  // Launcher / splash / favicon (white whale on brand blue).
  const icon1024 = await roundedIcon(1024);
  fs.writeFileSync(path.join(IMAGES, 'icon.png'), icon1024);
  fs.writeFileSync(path.join(IMAGES, 'favicon.png'), await sharp(icon1024).resize(64, 64).png().toBuffer());
  fs.writeFileSync(path.join(IMAGES, 'splash-icon.png'), await tintWhale(512, { r: 255, g: 255, b: 255 }));
  fs.writeFileSync(path.join(IMAGES, 'adaptive-icon.png'), await transparentMark(1024, 0.6));
  fs.writeFileSync(path.join(IMAGES, 'adaptive-icon-monochrome.png'), await transparentMark(1024, 0.6));
  // In-app tile mark: brand blue whale (visible on light and dark tiles).
  fs.writeFileSync(path.join(IMAGES, 'deepseek-mark.png'), await tintWhale(256, BLUE));
  // README wordmark: keep the supplied artwork, plus a white variant for dark mode.
  fs.writeFileSync(path.join(IMAGES, 'deepseek-wordmark-white.png'), await tintWordmark({ r: 255, g: 255, b: 255 }));
  const meta = await sharp(WORDMARK).metadata();
  console.log('icons written; wordmark', meta.width + 'x' + meta.height);
  for (const f of fs.readdirSync(IMAGES)) console.log(' ', f, fs.statSync(path.join(IMAGES, f)).size, 'bytes');
})().catch((e) => { console.error(e); process.exit(1); });
