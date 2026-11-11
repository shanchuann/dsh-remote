
const sharp = require('sharp');
const shot = 'D:\\Code\\dsh-remote\\docs\\verification\\screenshots\\centered-01-drawer.png';
(async () => {
  const { data, info } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const circle = { x0: 584, y0: 1101, x1: 742, y1: 1259 };
  const center = [(circle.x0 + circle.x1) / 2, (circle.y0 + circle.y1) / 2];
  const radius = (circle.x1 - circle.x0) / 2;
  let sx = 0, sy = 0, n = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (let y = circle.y0; y <= circle.y1; y++) for (let x = circle.x0; x <= circle.x1; x++) {
    const dx = x - center[0], dy = y - center[1];
    if (dx * dx + dy * dy > radius * radius) continue;
    const i = (y * info.width + x) * 3;
    const r = data[i], g = data[i+1], b = data[i+2];
    if (r < 100 && g < 100 && b < 100) {
      sx += x; sy += y; n++;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const centroid = [sx / n, sy / n];
  const bboxCenter = [(minX + maxX) / 2, (minY + maxY) / 2];
  const diameter = circle.x1 - circle.x0;
  console.log(JSON.stringify({
    circleCenter: center, diameter, whalePixels: n,
    whaleBBox: [minX, minY, maxX, maxY],
    centroid, bboxCenter,
    centroidOffsetPct: [ +((centroid[0]-center[0])/diameter*100).toFixed(2), +((centroid[1]-center[1])/diameter*100).toFixed(2) ],
    bboxOffsetPct: [ +((bboxCenter[0]-center[0])/diameter*100).toFixed(2), +((bboxCenter[1]-center[1])/diameter*100).toFixed(2) ]
  }, null, 1));
})();
