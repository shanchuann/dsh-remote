
const sharp = require('sharp');
const files = [
  'D:\\Code\\dsh-remote\\app\\android\\app\\src\\main\\res\\mipmap-xxxhdpi\\ic_launcher_foreground.webp',
  'D:\\Code\\dsh-remote\\app\\android\\app\\src\\main\\res\\mipmap-xxxhdpi\\ic_launcher.webp',
  'D:\\Code\\dsh-remote\\app\\assets\\images\\adaptive-icon.png',
  'D:\\Code\\dsh-remote\\app\\assets\\images\\icon.png'
];
(async () => {
  for (const path of files) {
    const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let minX = info.width, minY = info.height, maxX = -1, maxY = -1, sx = 0, sy = 0, w = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const a = data[(y * info.width + x) * 4 + 3];
      if (a > 8) { if (x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; sx+=x*a; sy+=y*a; w+=a; }
    }
    const bboxCenter = [(minX+maxX)/2, (minY+maxY)/2];
    const centroid = [sx/w, sy/w];
    const center = [(info.width-1)/2, (info.height-1)/2];
    console.log(path.split('\\').slice(-2).join('/'), JSON.stringify({
      size: [info.width, info.height],
      bbox: [minX, minY, maxX, maxY],
      bboxOffset: [ +(bboxCenter[0]-center[0]).toFixed(1), +(bboxCenter[1]-center[1]).toFixed(1) ],
      centroidOffset: [ +(centroid[0]-center[0]).toFixed(1), +(centroid[1]-center[1]).toFixed(1) ],
      centroidOffsetPct: [ +((centroid[0]-center[0])/info.width*100).toFixed(2), +((centroid[1]-center[1])/info.height*100).toFixed(2) ]
    }));
  }
})();
