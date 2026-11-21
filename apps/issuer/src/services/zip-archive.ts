import zlib from "node:zlib";

/**
 * A file entry to be packaged inside a ZIP archive.
 */
export interface ZipFileEntry {
  /** Relative file path within the ZIP archive (e.g., 'manifest.json' or 'qr-codes/STU001.png') */
  name: string;
  /** File contents as binary Buffer, Uint8Array, or UTF-8 string */
  data: Buffer | Uint8Array | string;
  /** If true, store without compression (ZIP method 0). Use for already-compressed data like PNG. */
  store?: boolean;
}

/**
 * Creates an in-memory ZIP archive from a list of file entries without external dependencies.
 *
 * Utilizes standard DEFLATE compression and CRC-32 checksums provided by node:zlib.
 * Conforms to standard PKZIP specifications with UTF-8 filename encoding flags.
 *
 * @param entries Array of file entries to package
 * @returns Complete ZIP archive binary Buffer
 */
export function createZipArchive(entries: ZipFileEntry[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let currentOffset = 0;

  for (const entry of entries) {
    // Normalize path separators to forward slashes per ZIP specification
    const normalizedName = entry.name.replace(/\\/g, "/").replace(/^\/+/, "");
    const nameBytes = Buffer.from(normalizedName, "utf8");

    // Convert data to Buffer
    let contentBytes: Buffer;
    if (Buffer.isBuffer(entry.data)) {
      contentBytes = entry.data;
    } else if (entry.data instanceof Uint8Array) {
      contentBytes = Buffer.from(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength);
    } else {
      contentBytes = Buffer.from(String(entry.data), "utf8");
    }

    const crc = zlib.crc32(contentBytes);

    // Method 0 = stored (no compression), 8 = deflate
    const method = entry.store ? 0 : 8;
    const compressedData = entry.store ? contentBytes : zlib.deflateRawSync(contentBytes);

    // Local file header (30 bytes + filename length)
    const localHeader = Buffer.alloc(30 + nameBytes.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4); // Minimum version needed to extract (2.0)
    localHeader.writeUInt16LE(0x0800, 6); // General purpose bit flag (Bit 11: UTF-8 filename)
    localHeader.writeUInt16LE(method, 8); // Compression method (0 = stored, 8 = deflate)
    localHeader.writeUInt16LE(0, 10); // Last mod file time
    localHeader.writeUInt16LE(0, 12); // Last mod file date
    localHeader.writeUInt32LE(crc, 14); // CRC-32 checksum
    localHeader.writeUInt32LE(compressedData.length, 18); // Compressed size
    localHeader.writeUInt32LE(contentBytes.length, 22); // Uncompressed size
    localHeader.writeUInt16LE(nameBytes.length, 26); // File name length
    localHeader.writeUInt16LE(0, 28); // Extra field length
    nameBytes.copy(localHeader, 30);

    const localHeaderOffset = currentOffset;
    localHeaders.push(localHeader, compressedData);
    currentOffset += localHeader.length + compressedData.length;

    // Central directory file header (46 bytes + filename length)
    const centralHeader = Buffer.alloc(46 + nameBytes.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central directory file header signature
    centralHeader.writeUInt16LE(20, 4); // Version made by (2.0, DOS/FAT)
    centralHeader.writeUInt16LE(20, 6); // Minimum version needed to extract (2.0)
    centralHeader.writeUInt16LE(0x0800, 8); // General purpose bit flag (UTF-8 filename)
    centralHeader.writeUInt16LE(method, 10); // Compression method (0 = stored, 8 = deflate)
    centralHeader.writeUInt16LE(0, 12); // Last mod file time
    centralHeader.writeUInt16LE(0, 14); // Last mod file date
    centralHeader.writeUInt32LE(crc, 16); // CRC-32 checksum
    centralHeader.writeUInt32LE(compressedData.length, 20); // Compressed size
    centralHeader.writeUInt32LE(contentBytes.length, 24); // Uncompressed size
    centralHeader.writeUInt16LE(nameBytes.length, 28); // File name length
    centralHeader.writeUInt16LE(0, 30); // Extra field length
    centralHeader.writeUInt16LE(0, 32); // File comment length
    centralHeader.writeUInt16LE(0, 34); // Disk number start
    centralHeader.writeUInt16LE(0, 36); // Internal file attributes
    centralHeader.writeUInt32LE(0x81a40000, 38); // External file attributes (regular file, rw-r--r--)
    centralHeader.writeUInt32LE(localHeaderOffset, 42); // Relative offset of local file header
    nameBytes.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);
  }

  const centralDirectoryOffset = currentOffset;
  let centralDirectorySize = 0;
  for (const header of centralHeaders) {
    centralDirectorySize += header.length;
  }

  // End of central directory record (22 bytes)
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0); // End of central directory signature
  endOfCentralDirectory.writeUInt16LE(0, 4); // Number of this disk
  endOfCentralDirectory.writeUInt16LE(0, 6); // Disk where central directory starts
  endOfCentralDirectory.writeUInt16LE(entries.length, 8); // Number of central directory records on this disk
  endOfCentralDirectory.writeUInt16LE(entries.length, 10); // Total number of central directory records
  endOfCentralDirectory.writeUInt32LE(centralDirectorySize, 12); // Size of central directory
  endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset, 16); // Offset of start of central directory
  endOfCentralDirectory.writeUInt16LE(0, 20); // Comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, endOfCentralDirectory]);
}

/**
 * Parses an in-memory ZIP archive buffer and extracts all contained files into a Map.
 *
 * @param buffer Raw binary ZIP buffer
 * @returns Map of relative file paths to uncompressed Buffer contents
 */
export function unzipArchive(buffer: Buffer): Map<string, Buffer> {
  // Search for End of Central Directory (EOCD) signature from the back
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error("Invalid ZIP archive: End of Central Directory signature not found");
  }

  const numEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  const files = new Map<string, Buffer>();
  let cdPtr = cdOffset;

  for (let i = 0; i < numEntries; i++) {
    if (buffer.readUInt32LE(cdPtr) !== 0x02014b50) {
      throw new Error(`Invalid ZIP archive: corrupt Central Directory header at index ${i}`);
    }

    const method = buffer.readUInt16LE(cdPtr + 10);
    const compSize = buffer.readUInt32LE(cdPtr + 20);
    const nameLen = buffer.readUInt16LE(cdPtr + 28);
    const extraLen = buffer.readUInt16LE(cdPtr + 30);
    const commentLen = buffer.readUInt16LE(cdPtr + 32);
    const localOffset = buffer.readUInt32LE(cdPtr + 42);

    const name = buffer.subarray(cdPtr + 46, cdPtr + 46 + nameLen).toString("utf8");

    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLen + localExtraLen;
    const rawData = buffer.subarray(dataOffset, dataOffset + compSize);

    const uncompressed = method === 8 ? zlib.inflateRawSync(rawData) : rawData;
    files.set(name, Buffer.from(uncompressed));

    cdPtr += 46 + nameLen + extraLen + commentLen;
  }

  return files;
}
