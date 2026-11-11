
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = 'D:\\Code\\dsh-remote';
const IMAGES = path.join(ROOT, 'app', 'assets', 'images');
const WHALE = path.join(IMAGES, 'deepseek-whale.png');
const WORDMARK = path.join(IMAGES, 'deepseek-wordmark.png');
const BLACK = { r: 12, g: 14, b: 18 };
const WHITE = { r: 255, g: 255, b: 255 };

async function tint(src, size, color) {
  const { data, info } = await sharp(src)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color.r; data[i + 1] = color.g; data[i + 2] = color.b;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

async function tintWordmark(color) {
  const { data, info } = await sharp(WORDMARK).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color.r; data[i + 1] = color.g; data[i + 2] = color.b;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

/** Black whale centred on a light rounded-launcher canvas. */
async function lightIcon(size, ratio) {
  const bg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#EEF1F7"/></linearGradient></defs><rect width="' + size + '" height="' + size + '" fill="url(#g)"/></svg>');
  const markSize = Math.round(size * ratio);
  const mark = await tint(WHALE, markSize, BLACK);
  const offset = Math.round((size - markSize) / 2);
  return sharp(bg).composite([{ input: mark, top: offset, left: offset }]).png().toBuffer();
}

async function transparentMark(size, ratio, color) {
  const markSize = Math.round(size * ratio);
  const mark = await tint(WHALE, markSize, color);
  const offset = Math.round((size - markSize) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, top: offset, left: offset }]).png().toBuffer();
}

(async () => {
  // Launcher/icons: black whale, centred, a touch smaller than before.
  const icon1024 = await lightIcon(1024, 0.54);
  fs.writeFileSync(path.join(IMAGES, 'icon.png'), icon1024);
  fs.writeFileSync(path.join(IMAGES, 'favicon.png'), await sharp(icon1024).resize(64, 64).png().toBuffer());
  fs.writeFileSync(path.join(IMAGES, 'splash-icon.png'), await transparentMark(512, 0.52, BLACK));
  fs.writeFileSync(path.join(IMAGES, 'adaptive-icon.png'), await transparentMark(1024, 0.52, BLACK));
  fs.writeFileSync(path.join(IMAGES, 'adaptive-icon-monochrome.png'), await transparentMark(1024, 0.52, BLACK));
  // In-app tile (white tile on connect screen): black whale.
  fs.writeFileSync(path.join(IMAGES, 'deepseek-mark.png'), await tint(WHALE, 256, BLACK));
  // README assets: supplied dark artwork + white variant for dark mode.
  fs.writeFileSync(path.join(IMAGES, 'deepseek-whale-white.png'), await transparentMark(640, 0.94, WHITE));
  fs.writeFileSync(path.join(IMAGES, 'deepseek-wordmark-white.png'), await tintWordmark(WHITE));
  const meta = await sharp(WORDMARK).metadata();
  console.log('icons written; wordmark', meta.width + 'x' + meta.height);
  for (const f of fs.readdirSync(IMAGES)) console.log(' ', f, fs.statSync(path.join(IMAGES, f)).size, 'bytes');
})().catch((e) => { console.error(e); process.exit(1); });
