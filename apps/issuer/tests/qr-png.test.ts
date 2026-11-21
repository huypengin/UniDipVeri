import { describe, expect, it } from "bun:test";
import { inflateSync } from "node:zlib";
import QRCode from "qrcode";
import { qrToPng } from "../src/services/qr-png.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface ParsedPng {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  imageData: Buffer;
}

function parsePng(buffer: Buffer): ParsedPng {
  expect(buffer.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const compressedData: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      compressedData.push(data);
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  return {
    width,
    height,
    bitDepth,
    colorType,
    imageData: inflateSync(Buffer.concat(compressedData)),
  };
}

function readGrayscaleBit(png: ParsedPng, x: number, y: number): number {
  const rowBytes = Math.ceil(png.width / 8);
  const rowStart = y * (rowBytes + 1);
  const byte = png.imageData[rowStart + 1 + Math.floor(x / 8)];
  return (byte >> (7 - (x % 8))) & 1;
}

describe("QR PNG renderer", () => {
  it("writes a valid 1-bit grayscale PNG with the expected dimensions", () => {
    const uri = "openid-credential-offer://?credential_offer=test";
    const scale = 4;
    const margin = 4;
    const qr = QRCode.create(uri, { errorCorrectionLevel: "M" });
    const png = parsePng(qrToPng(uri, scale, margin));

    expect(png.width).toBe((qr.modules.size + margin * 2) * scale);
    expect(png.height).toBe(png.width);
    expect(png.bitDepth).toBe(1);
    expect(png.colorType).toBe(0);
  });

  it("preserves the QR module matrix in the PNG pixels", () => {
    const uri = "openid-credential-offer://?credential_offer=round-trip";
    const scale = 3;
    const margin = 4;
    const qr = QRCode.create(uri, { errorCorrectionLevel: "M" });
    const png = parsePng(qrToPng(uri, scale, margin));

    for (let moduleRow = 0; moduleRow < qr.modules.size; moduleRow++) {
      for (let moduleColumn = 0; moduleColumn < qr.modules.size; moduleColumn++) {
        const pixelX = (moduleColumn + margin) * scale + Math.floor(scale / 2);
        const pixelY = (moduleRow + margin) * scale + Math.floor(scale / 2);
        const pixelIsWhite = readGrayscaleBit(png, pixelX, pixelY) === 1;
        const moduleIsWhite = !qr.modules.data[moduleRow * qr.modules.size + moduleColumn];

        expect(pixelIsWhite).toBe(moduleIsWhite);
      }
    }
  });

  it("renders a white quiet zone around the QR matrix", () => {
    const png = parsePng(qrToPng("issuer-offer", 2, 4));

    for (let x = 0; x < png.width; x++) {
      expect(readGrayscaleBit(png, x, 0)).toBe(1);
      expect(readGrayscaleBit(png, x, png.height - 1)).toBe(1);
    }
    for (let y = 0; y < png.height; y++) {
      expect(readGrayscaleBit(png, 0, y)).toBe(1);
      expect(readGrayscaleBit(png, png.width - 1, y)).toBe(1);
    }
  });

  it("changes dimensions when scale or margin changes", () => {
    const uri = "issuer-offer";
    const qr = QRCode.create(uri, { errorCorrectionLevel: "M" });
    const png = parsePng(qrToPng(uri, 2, 3));

    expect(png.width).toBe((qr.modules.size + 6) * 2);
    expect(png.height).toBe(png.width);
  });
});
