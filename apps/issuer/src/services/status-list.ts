import * as jose from "jose";
import * as zlib from "node:zlib";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { resolveIssuerKeyId } from "@unidipveri/core";
import type { KeyContext } from "./key-manager.js";

/**
 * Standard Status List Token typ header per draft-ietf-oauth-status-list-21.
 */
export const STATUS_LIST_TOKEN_TYP = "statuslist+jwt";

/**
 * Standard Content-Type header for serving Status List Tokens.
 */
export const STATUS_LIST_CONTENT_TYPE = "application/statuslist+jwt";

/**
 * Default status list capacity: 131,072 bits = 16,384 bytes (16 KB).
 */
export const DEFAULT_STATUS_LIST_CAPACITY = 131072;

/**
 * Default status list cache time-to-live in seconds (5 minutes).
 */
export const DEFAULT_STATUS_LIST_TTL_SECONDS = 300;

/**
 * Options for generating a cryptographically signed Status List Token.
 */
export interface GenerateStatusListTokenOptions {
  issuer: string;
  statusListUri: string;
  keyContext: KeyContext;
  ttlSeconds?: number;
}

/**
 * Decompresses an lst string and reads the bit value at a specified index.
 * Uses unzipSync to automatically handle both zlib (RFC 1950) and gzip (RFC 1952) formats.
 *
 * @param lst base64url-encoded compressed bit array
 * @param index Bit index of the referenced token
 * @param bits Number of bits per token (default: 1).
 * Currently, only 1-bit entries are supported.
 * @returns Status value (0 = valid, 1 = revoked)
 */
export function decompressAndGetBit(lst: string, index: number, bits = 1): number {
  if (bits !== 1) {
    throw new Error(`Unsupported bits allocation: ${bits}. Only 1-bit allocation is currently supported.`);
  }

  const compressed = jose.base64url.decode(lst);
  const decompressed = zlib.unzipSync(compressed);

  const byteIndex = Math.floor(index / 8);
  if (byteIndex >= decompressed.length) {
    throw new Error(`Index ${index} is out of bounds for decompressed status list of ${decompressed.length * 8} bits`);
  }

  const bitShift = index % 8;
  return (decompressed[byteIndex] >> bitShift) & 1;
}

/**
 * Zod validation schema for an individual tracked credential entry in the status list.
 */
export const StatusListEntrySchema = z.object({
  index: z.number().int().nonnegative(),
  studentId: z.string().min(1),
  allocatedAt: z.string().datetime(),
  revoked: z.boolean(),
  revokedAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type StatusListEntry = z.infer<typeof StatusListEntrySchema>;

/**
 * Zod validation schema for persisted status list file.
 */
export const StatusListFileSchema = z.object({
  version: z.literal(1),
  capacity: z.number().int().positive(),
  allocatedCount: z.number().int().nonnegative(),
  bitArray: z.string().min(1),
  updatedAt: z.string().datetime(),
  entries: z.array(StatusListEntrySchema).optional(),
});

export type StatusListFile = z.infer<typeof StatusListFileSchema>;

/**
 * Token Status List Revocation Engine conforming to draft-ietf-oauth-status-list-21.
 *
 * Manages an in-memory bitstring with 1-bit allocation per credential (0 = active, 1 = revoked).
 * Tracks subject mapping (studentId -> index) for administrative lookups and batch auditing.
 * Optionally persists state to disk via structured JSON with atomic writes on every mutation.
 * Produces zlib-compressed base64url-encoded bitstrings and signed Status List Tokens (typ: "statuslist+jwt").
 */
export class StatusListService {
  readonly capacity: number;
  readonly storagePath?: string;
  private readonly bitArray: Uint8Array;
  private nextIndex = 0;
  private readonly entriesByIndex = new Map<number, StatusListEntry>();
  private readonly indicesByStudentId = new Map<string, number[]>();

  constructor(capacity = DEFAULT_STATUS_LIST_CAPACITY, storagePath?: string) {
    if (capacity <= 0 || capacity % 8 !== 0) {
      throw new Error(`Status list capacity must be a positive multiple of 8, received ${capacity}`);
    }
    this.capacity = capacity;
    this.storagePath = storagePath;
    this.bitArray = new Uint8Array(capacity / 8);

    if (this.storagePath) {
      this.loadFromDisk();
    }
  }

  /**
   * Total number of allocated credential indices so far.
   */
  get allocatedCount(): number {
    return this.nextIndex;
  }

  /**
   * Allocates the next available credential status index.
   * Optionally registers the credential subject (studentId) and metadata for revocation tracking.
   *
   * @param studentId Optional unique student identifier (e.g. "ITIU22001001")
   * @param metadata Optional arbitrary institutional metadata (e.g. credentialConfigurationId, fullName)
   * @returns Non-negative integer index
   * @throws Error if the status list capacity is exhausted
   */
  allocateIndex(studentId?: string, metadata?: Record<string, unknown>): number {
    if (this.nextIndex >= this.capacity) {
      throw new Error(`Status list capacity of ${this.capacity} entries has been exhausted`);
    }
    const allocated = this.nextIndex;
    this.nextIndex += 1;

    if (studentId && studentId.trim().length > 0) {
      const cleanStudentId = studentId.trim();
      const entry: StatusListEntry = {
        index: allocated,
        studentId: cleanStudentId,
        allocatedAt: new Date().toISOString(),
        revoked: false,
        metadata,
      };
      this.entriesByIndex.set(allocated, entry);
      const existing = this.indicesByStudentId.get(cleanStudentId) ?? [];
      existing.push(allocated);
      this.indicesByStudentId.set(cleanStudentId, existing);
    }

    this.persistToDisk();
    return allocated;
  }

  /**
   * Retrieves the credential status entry associated with a specific index, if tracked.
   *
   * @param index Status list bit position
   */
  getEntryByIndex(index: number): StatusListEntry | undefined {
    return this.entriesByIndex.get(index);
  }

  /**
   * Retrieves all credential status entries allocated to a given student ID.
   *
   * @param studentId Unique student identifier
   */
  getEntriesByStudentId(studentId: string): StatusListEntry[] {
    const cleanId = studentId.trim();
    const indices = this.indicesByStudentId.get(cleanId) ?? [];
    return indices
      .map((idx) => this.entriesByIndex.get(idx))
      .filter((entry): entry is StatusListEntry => entry !== undefined);
  }

  /**
   * Returns all tracked status list entries.
   */
  getAllEntries(): StatusListEntry[] {
    return Array.from(this.entriesByIndex.values());
  }

  /**
   * Revokes all credentials issued to the specified student ID.
   *
   * @param studentId Unique student identifier
   * @returns Array of revoked indices
   * @throws Error if no credentials exist for the student
   */
  revokeByStudentId(studentId: string): number[] {
    const cleanId = studentId.trim();
    const indices = this.indicesByStudentId.get(cleanId);
    if (!indices || indices.length === 0) {
      throw new Error(`No credentials found for student ID '${cleanId}'`);
    }
    for (const idx of indices) {
      this.revoke(idx);
    }
    return [...indices];
  }

  /**
   * Reactivates all credentials issued to the specified student ID.
   *
   * @param studentId Unique student identifier
   * @returns Array of reactivated indices
   * @throws Error if no credentials exist for the student
   */
  reactivateByStudentId(studentId: string): number[] {
    const cleanId = studentId.trim();
    const indices = this.indicesByStudentId.get(cleanId);
    if (!indices || indices.length === 0) {
      throw new Error(`No credentials found for student ID '${cleanId}'`);
    }
    for (const idx of indices) {
      this.reactivate(idx);
    }
    return [...indices];
  }

  /**
   * Revokes the credential at the specified status index (sets bit to 1).
   *
   * @param index Non-negative integer index
   */
  revoke(index: number): void {
    this.assertAllocatedIndex(index);
    const byteIndex = Math.floor(index / 8);
    const bitShift = index % 8;
    this.bitArray[byteIndex] |= (1 << bitShift);

    const entry = this.entriesByIndex.get(index);
    if (entry) {
      entry.revoked = true;
      entry.revokedAt = new Date().toISOString();
    }

    this.persistToDisk();
  }

  /**
   * Reactivates or unrevokes the credential at the specified status index (sets bit to 0).
   *
   * @param index Non-negative integer index
   */
  reactivate(index: number): void {
    this.assertAllocatedIndex(index);
    const byteIndex = Math.floor(index / 8);
    const bitShift = index % 8;
    this.bitArray[byteIndex] &= ~(1 << bitShift);

    const entry = this.entriesByIndex.get(index);
    if (entry) {
      entry.revoked = false;
      delete entry.revokedAt;
    }

    this.persistToDisk();
  }

  /**
   * Loads persisted status list state from disk.
   * If the file does not exist, persists the initial zeroed state.
   */
  private loadFromDisk(): void {
    if (!this.storagePath) return;

    if (!fs.existsSync(this.storagePath)) {
      this.persistToDisk();
      return;
    }

    let fileContent: string;
    try {
      fileContent = fs.readFileSync(this.storagePath, "utf-8");
    } catch (err) {
      throw new Error(
        `Failed to read status list file at '${this.storagePath}': ${err instanceof Error ? err.message : String(err)}`
      );
    }

    let rawJson: unknown;
    try {
      rawJson = JSON.parse(fileContent);
    } catch (err) {
      throw new Error(
        `Status list file at '${this.storagePath}' contains invalid JSON: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const parseResult = StatusListFileSchema.safeParse(rawJson);
    if (!parseResult.success) {
      const errorMsg = parseResult.error.issues
        .map((i) => `[${i.path.join(".")}]: ${i.message}`)
        .join(", ");
      throw new Error(
        `Status list file at '${this.storagePath}' failed schema validation: ${errorMsg}`
      );
    }

    const { capacity, allocatedCount, bitArray } = parseResult.data;
    if (capacity !== this.capacity) {
      throw new Error(
        `Status list file capacity mismatch: file has ${capacity}, but service configured with ${this.capacity}`
      );
    }

    if (allocatedCount > capacity) {
      throw new Error(
        `Invalid allocatedCount: ${allocatedCount} exceeds capacity ${capacity}`
      );
    }

    const decodedBuffer = Buffer.from(bitArray, "base64");
    if (decodedBuffer.length !== this.bitArray.length) {
      throw new Error(
        `Status list file bitArray byte length mismatch: expected ${this.bitArray.length} bytes, received ${decodedBuffer.length} bytes`
      );
    }

    this.bitArray.set(decodedBuffer);
    this.nextIndex = allocatedCount;

    if (parseResult.data.entries) {
      this.entriesByIndex.clear();
      this.indicesByStudentId.clear();
      for (const entry of parseResult.data.entries) {
        this.entriesByIndex.set(entry.index, entry);
        const existing = this.indicesByStudentId.get(entry.studentId) ?? [];
        existing.push(entry.index);
        this.indicesByStudentId.set(entry.studentId, existing);
      }
    }
  }

  /**
   * Persists the status list state to disk via an atomic write (temp file + rename).
   */
  private persistToDisk(): void {
    if (!this.storagePath) return;

    const data: StatusListFile = {
      version: 1,
      capacity: this.capacity,
      allocatedCount: this.nextIndex,
      bitArray: Buffer.from(this.bitArray).toString("base64"),
      updatedAt: new Date().toISOString(),
      entries: Array.from(this.entriesByIndex.values()),
    };

    const serialized = JSON.stringify(data, null, 2) + "\n";
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tmpPath = `${this.storagePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(tmpPath, serialized, "utf-8");
    fs.renameSync(tmpPath, this.storagePath);
  }

  /**
   * Queries the revocation status of the credential at the specified index.
   *
   * @param index Non-negative integer index
   * @returns 0 if active/valid, 1 if revoked
   */
  getStatus(index: number): 0 | 1 {
    this.assertAllocatedIndex(index);
    const byteIndex = Math.floor(index / 8);
    const bitShift = index % 8;
    return ((this.bitArray[byteIndex] >> bitShift) & 1) as 0 | 1;
  }

  /**
   * Returns whether the credential at the specified index is revoked.
   */
  isRevoked(index: number): boolean {
    return this.getStatus(index) === 1;
  }

  /**
   * Generates the compressed, base64url-encoded status list string (lst).
   * Uses RFC 1950 zlib compression at maximum level (level 9) per draft-ietf-oauth-status-list-21.
   */
  getLst(): string {
    const compressed = zlib.deflateSync(this.bitArray, { level: 9 });
    return jose.base64url.encode(compressed);
  }

  /**
   * Generates and signs a Status List Token JWT per draft-ietf-oauth-status-list-21.
   *
   * @param options Configuration including issuer URI, status list sub URI, and key context
   * @returns Signed Status List Token JWS string
   */
  async generateStatusListToken(options: GenerateStatusListTokenOptions): Promise<string> {
    const { issuer, statusListUri, keyContext, ttlSeconds = DEFAULT_STATUS_LIST_TTL_SECONDS } = options;

    if (!issuer || typeof issuer !== "string" || issuer.trim().length === 0) {
      throw new Error("issuer must be a non-empty string");
    }

    if (!statusListUri || typeof statusListUri !== "string" || statusListUri.trim().length === 0) {
      throw new Error("statusListUri must be a non-empty string");
    }

    const nowSeconds = Math.floor(Date.now() / 1000);

    const payload: Record<string, unknown> = {
      iss: issuer,
      sub: statusListUri,
      iat: nowSeconds,
      ttl: ttlSeconds,
      status_list: {
        bits: 1,
        lst: this.getLst(),
      },
    };

    if (ttlSeconds > 0) {
      payload.exp = nowSeconds + ttlSeconds;
    }

    return new jose.SignJWT(payload)
      .setProtectedHeader({
        alg: keyContext.alg,
        typ: STATUS_LIST_TOKEN_TYP,
        kid: resolveIssuerKeyId(issuer, keyContext.keyId),
      })
      .sign(keyContext.privateKey);
  }

  private assertValidIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.capacity) {
      throw new Error(
        `Invalid status index ${index}: must be an integer between 0 and ${this.capacity - 1}`
      );
    }
  }

  private assertAllocatedIndex(index: number): void {
    this.assertValidIndex(index);

    if (index >= this.nextIndex) {
      throw new Error(`Status index ${index} has not been allocated`);
    }
  }
}
