/**
 * Minimal PNG encoder for monochrome QR codes: no dependency beyond node:zlib.
 * Writes an 8-bit-per-pixel grayscale-free 1-bit image (bit depth 1, color
 * type 0), which every camera and image viewer reads.
 */
import { deflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** CRC-32 lookup table (PNG polynomial 0xedb88320). */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/**
 * @param {Buffer} buffer
 * @returns {number} unsigned CRC-32
 */
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * @param {string} type
 * @param {Buffer} data
 * @returns {Buffer}
 */
function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

/**
 * Encode a QR module matrix as a PNG buffer.
 * @param {{size: number, isDark: (row: number, column: number) => boolean}} matrix
 * @param {{scale?: number, margin?: number}} [options] scale = pixels per module
 * @returns {Buffer}
 */
export function encodeMonochromePng(matrix, options) {
  const scale = Math.max(1, Math.floor(options?.scale ?? 6));
  const margin = Math.max(0, Math.floor(options?.margin ?? 4));
  const modules = matrix.size;
  const width = (modules + margin * 2) * scale;
  const height = width;
  const bytesPerRow = Math.ceil(width / 8);
  const raw = Buffer.alloc((bytesPerRow + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (bytesPerRow + 1);
    raw[rowOffset] = 0; // filter type: None
    const moduleRow = Math.floor(y / scale) - margin;
    for (let x = 0; x < width; x += 1) {
      const moduleColumn = Math.floor(x / scale) - margin;
      const dark = moduleRow >= 0 && moduleRow < modules && moduleColumn >= 0 && moduleColumn < modules
        ? matrix.isDark(moduleRow, moduleColumn)
        : false;
      if (!dark) continue;
      const byteIndex = rowOffset + 1 + (x >> 3);
      raw[byteIndex] |= 0x80 >> (x & 7);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 1; // bit depth
  ihdr[9] = 0; // color type: grayscale
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
