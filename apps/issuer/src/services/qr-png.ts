import zlib from "node:zlib";
import QRCode from "qrcode";

/**
 * PNG file signature (8 bytes). Every valid PNG file must start with these bytes.
 * 0x89 'P' 'N' 'G' \r \n 0x1A \n
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Builds a single PNG chunk.
 *
 * A PNG file is a signature followed by a sequence of chunks, each laid out as:
 *   [4 bytes length][4 bytes type][N bytes data][4 bytes CRC-32]
 *
 * - `length` counts only the data bytes (not the type or CRC).
 * - The CRC-32 covers the type and the data (not the length field).
 * - All multi-byte integers in PNG are big-endian.
 *
 * @param type 4-character ASCII chunk type (e.g., 'IHDR', 'IDAT', 'IEND')
 * @param data Chunk payload (may be empty, as in IEND)
 * @returns Complete serialized chunk ready to append to the PNG stream
 */
function chunk(type: string, data: Buffer): Buffer {
  // Length field: number of bytes in the data section
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);

  const typeBuf = Buffer.from(type, "ascii");

  // CRC-32 over (type + data). `>>> 0` converts the result to an unsigned 32-bit
  // integer so writeUInt32BE never receives a negative number.
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0);

  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * Renders a string as a QR code and encodes it directly as a 1-bit grayscale PNG.
 *
 * Why this exists: `QRCode.toBuffer` renders through an RGBA (4 bytes per pixel)
 * pipeline, which is slow for a two-color image. This function takes the module
 * matrix from `QRCode.create` and writes a 1-bit-per-pixel PNG itself, so the raw
 * image data is ~30x smaller and needs no per-pixel work.
 *
 * Output size in pixels (both width and height):
 *   (modules + 2 * margin) * scale
 *
 * Each QR module becomes a `scale` x `scale` block of pixels, so the image is
 * always sharp with an integer number of pixels per module.
 *
 * @param uri    Text to encode (here: the OID4VCI credential offer URI)
 * @param scale  Pixels per QR module (default 4)
 * @param margin Quiet-zone width in modules around the code (default 4, per the QR spec)
 * @returns Complete PNG file as a Buffer
 */
export function qrToPng(uri: string, scale = 4, margin = 4): Buffer {
  // Encode the text into a QR module matrix (the expensive step, ~2 ms at version 16)
  const qr = QRCode.create(uri, { errorCorrectionLevel: "M" });

  // Number of modules per side (e.g., 81 for QR version 16)
  const n = qr.modules.size;

  // Flat row-major matrix of modules: bits[row * n + col] is truthy for a dark module
  const bits = qr.modules.data;

  // Final image width/height in pixels, including the quiet zone
  const dim = (n + margin * 2) * scale;

  // Bytes needed to hold one row at 1 bit per pixel (rounded up to whole bytes)
  const rowBytes = Math.ceil(dim / 8);

  // Raw (uncompressed) image data. Each scanline is 1 filter-type byte followed by
  // `rowBytes` pixel bytes, so the total is (rowBytes + 1) bytes per row.
  const raw = Buffer.alloc((rowBytes + 1) * dim);

  // Reusable scanline buffer: [filter byte][pixel bytes...]
  const row = Buffer.alloc(rowBytes + 1);

  // Write position inside `raw`
  let o = 0;

  for (let y = 0; y < dim; y++) {
    // Build a new scanline only once per module row. The next `scale - 1` pixel
    // rows are identical, so they simply re-copy the same buffer below.
    if (y % scale === 0) {
      row.fill(0xff); // Start all white (in 1-bit grayscale, 1 = white)
      row[0] = 0; // PNG filter type 0 = None (no per-row prediction, fastest)

      // Which module row this pixel row falls in (negative/out of range = quiet zone)
      const my = y / scale - margin;

      if (my >= 0 && my < n) {
        // Paint dark modules for this row. Quiet-zone columns stay white.
        for (let x = 0; x < dim; x++) {
          const mx = Math.floor(x / scale) - margin; // Module column for this pixel
          if (mx >= 0 && mx < n && bits[my * n + mx]) {
            // Clear the pixel's bit to make it black. Pixels are packed MSB-first:
            // pixel x lives in byte (x >> 3) at bit position (7 - (x & 7)).
            // `1 +` skips the filter-type byte at the start of the row.
            row[1 + (x >> 3)] &= ~(0x80 >> (x & 7));
          }
        }
      }
    }

    // Append the current scanline to the raw image data (fast native memcpy)
    row.copy(raw, o);
    o += row.length;
  }

  // IHDR chunk: image header (always 13 bytes)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(dim, 0); // Width in pixels
  ihdr.writeUInt32BE(dim, 4); // Height in pixels
  ihdr[8] = 1; // Bit depth: 1 bit per pixel
  ihdr[9] = 0; // Color type 0: grayscale
  // Bytes 10-12 (compression, filter method, interlace) stay 0: standard deflate,
  // standard adaptive filtering, no interlacing.

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    // IDAT chunk: the pixel data, zlib-compressed. Level 1 favors speed; the
    // image is mostly flat color runs, so it still compresses very well.
    chunk("IDAT", zlib.deflateSync(raw, { level: 1 })),
    // IEND chunk: marks end of file, always empty
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
