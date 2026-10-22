import * as jose from "jose";
import * as zlib from "node:zlib";
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
 * Token Status List Revocation Engine conforming to draft-ietf-oauth-status-list-21.
 *
 * Manages an in-memory bitstring with 1-bit allocation per credential (0 = active, 1 = revoked).
 * Produces zlib-compressed base64url-encoded bitstrings and signed Status List Tokens (typ: "statuslist+jwt").
 */
export class StatusListService {
  readonly capacity: number;
  private readonly bitArray: Uint8Array;
  private nextIndex = 0;

  constructor(capacity = DEFAULT_STATUS_LIST_CAPACITY) {
    if (capacity <= 0 || capacity % 8 !== 0) {
      throw new Error(`Status list capacity must be a positive multiple of 8, received ${capacity}`);
    }
    this.capacity = capacity;
    this.bitArray = new Uint8Array(capacity / 8);
  }

  /**
   * Total number of allocated credential indices so far.
   */
  get allocatedCount(): number {
    return this.nextIndex;
  }

  /**
   * Allocates the next available credential status index.
   *
   * @returns Non-negative integer index
   * @throws Error if the status list capacity is exhausted
   */
  allocateIndex(): number {
    if (this.nextIndex >= this.capacity) {
      throw new Error(`Status list capacity of ${this.capacity} entries has been exhausted`);
    }
    const allocated = this.nextIndex;
    this.nextIndex += 1;
    return allocated;
  }

  /**
   * Revokes the credential at the specified status index (sets bit to 1).
   *
   * @param index Non-negative integer index
   */
  revoke(index: number): void {
    this.assertValidIndex(index);
    const byteIndex = Math.floor(index / 8);
    const bitShift = index % 8;
    this.bitArray[byteIndex] |= (1 << bitShift);
  }

  /**
   * Reactivates or unrevokes the credential at the specified status index (sets bit to 0).
   *
   * @param index Non-negative integer index
   */
  reactivate(index: number): void {
    this.assertValidIndex(index);
    const byteIndex = Math.floor(index / 8);
    const bitShift = index % 8;
    this.bitArray[byteIndex] &= ~(1 << bitShift);
  }

  /**
   * Queries the revocation status of the credential at the specified index.
   *
   * @param index Non-negative integer index
   * @returns 0 if active/valid, 1 if revoked
   */
  getStatus(index: number): 0 | 1 {
    this.assertValidIndex(index);
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
    const expSeconds = nowSeconds + ttlSeconds;

    const payload = {
      iss: issuer,
      sub: statusListUri,
      iat: nowSeconds,
      ttl: ttlSeconds,
      exp: expSeconds,
      status_list: {
        bits: 1,
        lst: this.getLst(),
      },
    };

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
}
