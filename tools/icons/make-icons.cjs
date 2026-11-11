
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = 'D:\\Code\\dsh-remote';
const IMAGES = path.join(ROOT, 'app', 'assets', 'images');
const WHALE = path.join(IMAGES, 'deepseek-whale.png');
const WORDMARK = path.join(IMAGES, 'deepseek-wordmark.png');
const BLACK = { r: 12, g: 14, b: 18 };
const WHITE = { r: 255, g: 255, b: 255 };

/** Solid-colour silhouette of the whale at the given canvas size. */
async function tint(src, size, color) {
  const { data, info } = await sharp(src)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color.r; data[i + 1] = color.g; data[i + 2] = color.b;
  }
  return { buffer: await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer(), width: info.width, height: info.height };
}

/** Alpha-weighted centre of the artwork inside a square PNG buffer. */
async function alphaCentroid(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let sx = 0, sy = 0, total = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const a = data[(y * info.width + x) * 4 + 3];
    if (a > 8) { sx += x * a; sy += y * a; total += a; }
  }
  return { x: sx / total, y: sy / total, size: info.width };
}

/**
 * Place a mark on a canvas so the artwork's visual weight (alpha centroid) sits
 * at the canvas centre, not just its bounding box. The supplied whale carries
 * more ink on its upper-left, which reads as off-centre otherwise.
 */
async function centredMark(canvas, ratio, color) {
  const markSize = Math.round(canvas * ratio);
  const tinted = await tint(WHALE, markSize, color);
  const centroid = await alphaCentroid(tinted.buffer);
  const left = Math.round(canvas / 2 - centroid.x);
  const top = Math.round(canvas / 2 - centroid.y);
  return { buffer: tinted.buffer, left, top };
}

async function lightIcon(size, ratio) {
  const bg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#EEF1F7"/></linearGradient></defs><rect width="' + size + '" height="' + size + '" fill="url(#g)"/></svg>');
  const mark = await centredMark(size, ratio, BLACK);
  return sharp(bg).composite([{ input: mark.buffer, top: mark.top, left: mark.left }]).png().toBuffer();
}

async function transparentMark(canvas, ratio, color) {
  const mark = await centredMark(canvas, ratio, color);
  return sharp({ create: { width: canvas, height: canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark.buffer, top: mark.top, left: mark.left }]).png().toBuffer();
}

async function tintWordmark(color) {
  const { data, info } = await sharp(WORDMARK).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color.r; data[i + 1] = color.g; data[i + 2] = color.b;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

(async () => {
  const icon1024 = await lightIcon(1024, 0.54);
  fs.writeFileSync(path.join(IMAGES, 'icon.png'), icon1024);
  fs.writeFileSync(path.join(IMAGES, 'favicon.png'), await sharp(icon1024).resize(64, 64).png().toBuffer());
  fs.writeFileSync(path.join(IMAGES, 'splash-icon.png'), await transparentMark(512, 0.52, BLACK));
  fs.writeFileSync(path.join(IMAGES, 'adaptive-icon.png'), await transparentMark(1024, 0.52, BLACK));
  fs.writeFileSync(path.join(IMAGES, 'adaptive-icon-monochrome.png'), await transparentMark(1024, 0.52, BLACK));
  fs.writeFileSync(path.join(IMAGES, 'deepseek-mark.png'), await transparentMark(256, 0.9, BLACK));
  fs.writeFileSync(path.join(IMAGES, 'deepseek-whale-white.png'), await centredMark(640, 0.94, WHITE).then(async (m) => {
    return sharp({ create: { width: 640, height: 640, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: m.buffer, top: m.top, left: m.left }]).png().toBuffer();
  }));
  fs.writeFileSync(path.join(IMAGES, 'deepseek-wordmark-white.png'), await tintWordmark(WHITE));
  console.log('icons written');
  for (const f of fs.readdirSync(IMAGES)) console.log(' ', f, fs.statSync(path.join(IMAGES, f)).size, 'bytes');
})().catch((e) => { console.error(e); process.exit(1); });