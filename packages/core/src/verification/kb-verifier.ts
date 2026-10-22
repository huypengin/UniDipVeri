import * as jose from "jose";
import {
  computeAsciiDigest,
  computeAsciiDigestSync,
  DEFAULT_DIGEST_ALGORITHM,
  type SupportedDigestAlgorithm,
} from "../sd-jwt/digest.js";

/**
 * Standard typ header for Holder Key Binding JWTs per RFC 9901 Section 4.3.
 */
export const KEY_BINDING_JWT_TYP = "kb+jwt";

/**
 * Options for verifying a Holder Key Binding JWT.
 */
export interface VerifyKeyBindingOptions {
  /** Expected verifier audience (aud claim) */
  expectedAudience?: string;

  /** Expected verifier challenge nonce (nonce claim) */
  expectedNonce?: string;

  /** Clock skew tolerance in seconds for iat */
  clockToleranceSeconds?: number;

  /** Digest algorithm used to compute sd_hash (defaults to sha-256 per RFC 9901 Section 4.3) */
  digestAlgorithm?: SupportedDigestAlgorithm;
}

/**
 * Result of Key Binding JWT verification.
 */
export interface VerifiedKeyBindingResult {
  /** Whether the Key Binding JWT verified successfully */
  valid: boolean;

  /** The parsed and verified Key Binding JWT payload */
  payload?: jose.JWTPayload;

  /** Holder public key used for verification */
  holderJwk?: jose.JWK;

  /** Failure reason if verification failed */
  error?: string;
}

/**
 * Computes the sd_hash claim over the presentation preceding the Key Binding JWT using Web Crypto API per RFC 9901 Section 4.3.
 *
 * Requirements per RFC 9901 Section 4.3:
 * - Input is the exact US-ASCII bytes of the SD-JWT presentation including the trailing "~" delimiter.
 * - Hash is computed using the hash algorithm from _sd_alg (defaults to sha-256).
 * - Output is unpadded base64url-encoded.
 *
 * @param presentationWithoutKb The presentation string up to and including the trailing "~"
 * @param algorithm Supported hash algorithm (defaults to sha-256)
 * @returns base64url-encoded digest string
 */
export async function computeSdHash(
  presentationWithoutKb: string,
  algorithm: SupportedDigestAlgorithm = DEFAULT_DIGEST_ALGORITHM
): Promise<string> {
  if (typeof presentationWithoutKb !== "string" || presentationWithoutKb.length === 0) {
    throw new Error("presentationWithoutKb must be a non-empty string");
  }

  // Ensure presentation ends with "~" per RFC 9901 Section 4.3 and Section 5
  const normalized = presentationWithoutKb.endsWith("~")
    ? presentationWithoutKb
    : `${presentationWithoutKb}~`;

  return computeAsciiDigest(normalized, algorithm);
}

/**
 * Synchronous variant of computeSdHash using Node / Bun crypto.
 * Conforms identically to RFC 9901 Section 4.3.
 *
 * @param presentationWithoutKb The presentation string up to and including the trailing "~"
 * @param algorithm Supported hash algorithm (defaults to sha-256)
 * @returns base64url-encoded digest string
 */
export function computeSdHashSync(
  presentationWithoutKb: string,
  algorithm: SupportedDigestAlgorithm = DEFAULT_DIGEST_ALGORITHM
): string {
  if (typeof presentationWithoutKb !== "string" || presentationWithoutKb.length === 0) {
    throw new Error("presentationWithoutKb must be a non-empty string");
  }

  // Ensure presentation ends with "~" per RFC 9901 Section 4.3 and Section 5
  const normalized = presentationWithoutKb.endsWith("~")
    ? presentationWithoutKb
    : `${presentationWithoutKb}~`;

  return computeAsciiDigestSync(normalized, algorithm);
}

/**
 * Verifies a Holder Key Binding JWT (typ: "kb+jwt") per RFC 9901 Section 4.3 and draft-ietf-oauth-sd-jwt-vc-19 Section 3.3.
 *
 * Verification rules:
 * 1. Protected header typ MUST equal "kb+jwt".
 * 2. Header MUST contain a valid cryptographic signature algorithm.
 * 3. JWS signature MUST verify against the holder's public key (e.g. from cnf.jwk).
 * 4. The sd_hash claim in the payload MUST match the base64url digest of presentationWithoutKb.
 * 5. If expectedAudience is supplied, aud MUST match.
 * 6. If expectedNonce is supplied, nonce MUST match.
 * 7. iat MUST be present and within allowable clock tolerance.
 *
 * @param kbJwt Compact Key Binding JWT string
 * @param presentationWithoutKb Presentation string preceding the KB-JWT
 * @param holderJwk Holder public key JWK from credential's cnf claim
 * @param options Expected parameters and clock tolerance
 * @returns VerifiedKeyBindingResult
 */
export async function verifyKeyBindingJwt(
  kbJwt: string,
  presentationWithoutKb: string,
  holderJwk: jose.JWK,
  options: VerifyKeyBindingOptions = {}
): Promise<VerifiedKeyBindingResult> {
  if (typeof kbJwt !== "string" || kbJwt.trim().length === 0) {
    return { valid: false, error: "Key Binding JWT must be a non-empty string" };
  }

  if (!holderJwk || typeof holderJwk !== "object") {
    return { valid: false, error: "Holder JWK must be a valid JWK object" };
  }

  const parts = kbJwt.split(".");
  if (parts.length !== 3) {
    return { valid: false, error: "Invalid Key Binding JWT format: expected compact 3-part JWS" };
  }

  let header: { typ?: string; alg?: string; [key: string]: unknown };
  try {
    header = JSON.parse(new TextDecoder().decode(jose.base64url.decode(parts[0])));
  } catch (err) {
    return {
      valid: false,
      error: `Failed to parse Key Binding JWT header: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (header.typ !== KEY_BINDING_JWT_TYP) {
    return {
      valid: false,
      error: `Invalid Key Binding JWT typ header: expected '${KEY_BINDING_JWT_TYP}', received '${header.typ}'`,
    };
  }

  const alg = header.alg || (holderJwk.alg as string) || "ES256";
  if (!alg || typeof alg !== "string") {
    return { valid: false, error: "Key Binding JWT header missing 'alg'" };
  }

  let key: CryptoKey | jose.KeyLike | Uint8Array;
  try {
    key = await jose.importJWK(holderJwk, alg);
  } catch (err) {
    return {
      valid: false,
      error: `Failed to import holder public key JWK: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let verifyResult: jose.JWTVerifyResult;
  try {
    verifyResult = await jose.jwtVerify(kbJwt, key, {
      algorithms: [alg],
      clockTolerance: options.clockToleranceSeconds ?? 0,
    });
  } catch (err) {
    return {
      valid: false,
      error: `Key Binding JWT signature verification failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const payload = verifyResult.payload;

  // Verify iat presence per RFC 9901 Section 4.3
  if (payload.iat === undefined || typeof payload.iat !== "number") {
    return { valid: false, error: "Key Binding JWT missing required 'iat' claim" };
  }

  // Verify aud if expected
  if (options.expectedAudience !== undefined) {
    const audMatches = Array.isArray(payload.aud)
      ? payload.aud.includes(options.expectedAudience)
      : payload.aud === options.expectedAudience;
    if (!audMatches) {
      return {
        valid: false,
        error: `Key Binding JWT audience mismatch: expected '${options.expectedAudience}', received '${payload.aud}'`,
      };
    }
  }

  // Verify nonce if expected
  if (options.expectedNonce !== undefined) {
    if (payload.nonce !== options.expectedNonce) {
      return {
        valid: false,
        error: `Key Binding JWT nonce mismatch: expected '${options.expectedNonce}', received '${payload.nonce}'`,
      };
    }
  }

  // Verify sd_hash per RFC 9901 Section 4.3
  if (typeof payload.sd_hash !== "string" || payload.sd_hash.length === 0) {
    return { valid: false, error: "Key Binding JWT missing required 'sd_hash' claim" };
  }

  const expectedSdHash = computeSdHashSync(
    presentationWithoutKb,
    options.digestAlgorithm ?? DEFAULT_DIGEST_ALGORITHM
  );

  if (payload.sd_hash !== expectedSdHash) {
    return {
      valid: false,
      error: `Key Binding JWT sd_hash mismatch: expected '${expectedSdHash}', received '${payload.sd_hash}'`,
    };
  }

  return {
    valid: true,
    payload,
    holderJwk,
  };
}
