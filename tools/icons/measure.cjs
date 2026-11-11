
const sharp = require('sharp');
const path = 'D:\\Code\\dsh-remote\\app\\assets\\images\\deepseek-whale.png';
(async () => {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  let sumX = 0, sumY = 0, weight = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const a = data[(y * info.width + x) * 4 + 3];
      if (a > 8) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        sumX += x * a; sumY += y * a; weight += a;
      }
    }
  }
  console.log(JSON.stringify({
    size: [info.width, info.height],
    alphaBBox: { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 },
    bboxCenter: [(minX + maxX) / 2, (minY + maxY) / 2],
    imageCenter: [(info.width - 1) / 2, (info.height - 1) / 2],
    alphaCentroid: [Math.round(sumX / weight), Math.round(sumY / weight)],
    margins: { left: minX, top: minY, right: info.width - 1 - maxX, bottom: info.height - 1 - maxY }
  }, null, 1));
})();
