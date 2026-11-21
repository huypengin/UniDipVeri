import { describe, expect, it } from "bun:test";
import { createZipArchive, unzipArchive } from "../src/services/zip-archive.js";

describe("ZIP archive service", () => {
  it("round-trips string, Buffer, and Uint8Array entries", () => {
    const archive = createZipArchive([
      { name: "manifest.json", data: '{"status":"ready"}' },
      { name: "nested/credential.txt", data: Buffer.from("credential-data") },
      { name: "binary.bin", data: new Uint8Array([0, 1, 2, 255]) },
    ]);

    const files = unzipArchive(archive);

    expect(files.get("manifest.json")?.toString("utf8")).toBe('{"status":"ready"}');
    expect(files.get("nested/credential.txt")?.toString("utf8")).toBe("credential-data");
    expect([...files.get("binary.bin")!]).toEqual([0, 1, 2, 255]);
  });

  it("normalizes Windows and leading-slash paths", () => {
    const archive = createZipArchive([
      { name: "\\exports\\offers.csv", data: "studentId\nSTU-001" },
    ]);

    const files = unzipArchive(archive);

    expect(files.has("exports/offers.csv")).toBe(true);
    expect(files.get("exports/offers.csv")?.toString("utf8")).toBe("studentId\nSTU-001");
  });

  it("supports stored entries for already-compressed data", () => {
    const archive = createZipArchive([
      { name: "image.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), store: true },
    ]);

    const files = unzipArchive(archive);

    expect([...files.get("image.png")!]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("round-trips an empty archive", () => {
    const archive = createZipArchive([]);

    expect(unzipArchive(archive).size).toBe(0);
  });

  it("rejects a buffer without an end-of-directory record", () => {
    expect(() => unzipArchive(Buffer.from("not a zip archive"))).toThrow(
      "End of Central Directory signature not found"
    );
  });

  it("rejects a corrupt central directory header", () => {
    const archive = createZipArchive([{ name: "file.txt", data: "content" }]);
    const centralDirectoryOffset = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(centralDirectoryOffset).toBeGreaterThanOrEqual(0);
    archive.writeUInt32LE(0, centralDirectoryOffset);

    expect(() => unzipArchive(archive)).toThrow("corrupt Central Directory header");
  });
});
