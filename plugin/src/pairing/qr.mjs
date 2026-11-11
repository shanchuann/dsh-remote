/**
 * QR code rendering for the pairing page and the on-disk artifacts.
 *
 * The encoder is vendored (vendor/qrcode/qrcode.cjs, MIT, Kazuhiko Arase) so
 * the plugin keeps zero runtime dependencies: the harness loads this plugin by
 * absolute file URL, where a bare specifier would not resolve.
 */
import qrcodeFactory from "../../vendor/qrcode/qrcode.cjs";

/** Default QR error correction level; "M" survives a slightly smudged screen. */
const DEFAULT_ERROR_CORRECTION = "M";

/**
 * Build a QR code object for a payload.
 * @param {string} text
 * @param {{errorCorrectionLevel?: string, typeNumber?: number}} [options]
 */
export function createQrCode(text, options) {
  const qr = qrcodeFactory(options?.typeNumber ?? 0, options?.errorCorrectionLevel ?? DEFAULT_ERROR_CORRECTION);
  qr.addData(String(text));
  qr.make();
  return qr;
}

/**
 * QR code as an inline SVG string.
 * @param {string} text
 * @param {{cellSize?: number, margin?: number, scalable?: boolean, alt?: string}} [options]
 * @returns {string}
 */
export function qrSvg(text, options) {
  const qr = createQrCode(text, options);
  return qr.createSvgTag({
    cellSize: options?.cellSize ?? 4,
    margin: options?.margin ?? 4,
    scalable: options?.scalable ?? true
  });
}

/**
 * QR code as a module matrix (row-major, true = dark).
 * @param {string} text
 * @param {{errorCorrectionLevel?: string}} [options]
 * @returns {{size: number, isDark: (row: number, column: number) => boolean}}
 */
export function qrMatrix(text, options) {
  const qr = createQrCode(text, options);
  const size = qr.getModuleCount();
  return {
    size,
    isDark: (row, column) => row >= 0 && row < size && column >= 0 && column < size && qr.isDark(row, column) === true
  };
}
