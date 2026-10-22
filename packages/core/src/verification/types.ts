import type * as jose from "jose";
import type { FetchLike } from "../did/did-resolver.js";

/**
 * Options configuring presentation verification across pluggable engines.
 */
export interface VerificationOptions {
  /**
   * Custom callback to resolve the issuer's public verification JWK.
   * If omitted, falls back to resolving did:web via resolveDidVerificationKey.
   */
  resolveIssuerKey?: (issuerDid: string, kid?: string) => Promise<jose.JWK>;

  /**
   * Expected Verifiable Credential Type (vct) identifier per draft-ietf-oauth-sd-jwt-vc-19 Section 3.2.2.1.
   * If provided, presentation MUST declare this exact vct.
   */
  expectedVct?: string;

  /**
   * Expected issuer identifier (iss claim).
   * If provided, presentation MUST declare this exact issuer.
   */
  expectedIssuer?: string;

  /**
   * Expected audience for holder Key Binding JWT (aud claim) per RFC 9901 Section 4.3.
   */
  expectedAudience?: string;

  /**
   * Expected challenge nonce for holder Key Binding JWT (nonce claim) per RFC 9901 Section 4.3.
   */
  expectedNonce?: string;

  /**
   * Acceptable clock tolerance in seconds for time-based claims (iat, exp, nbf).
   * Defaults to 0 seconds.
   */
  clockToleranceSeconds?: number;

  /**
   * Compatible fetch function for HTTP dereferencing (DID documents, Status Lists).
   * Defaults to global fetch.
   */
  fetchFn?: FetchLike;

  /**
   * Whether holder Key Binding JWT verification is strictly required by verifier policy.
   * If true and presentation lacks a KB-JWT or credential lacks cnf, verification fails.
   * Defaults to false.
   */
  requireKeyBinding?: boolean;

  /**
   * Whether to dereference and check the Token Status List if the credential includes a status claim.
   * Defaults to true.
   */
  checkRevocation?: boolean;
}

/**
 * Revocation status evaluation result.
 */
export type RevocationStatus = "ACTIVE" | "REVOKED" | "UNKNOWN" | "NOT_APPLICABLE";

/**
 * Detailed cryptographic check summary for audit and visualization.
 */
export interface VerificationCheckSummary {
  /** Outer JWS signature verified against issuer public key */
  issuerSignature: boolean;
  /** All presented disclosure digests match digests committed in the credential */
  disclosureDigests: boolean;
  /** Holder Key Binding JWT signature and sd_hash verified (or true if not required) */
  holderKeyBinding: boolean;
  /** Live Token Status List revocation check outcome */
  revocationStatus: RevocationStatus;
}

/**
 * Unified verification result returned by all IVerificationEngine implementations.
 */
export interface VerificationResult {
  /** Overall validity boolean */
  valid: boolean;

  /** Identification of the engine that performed verification */
  engine: "native" | "oracle";

  /** High-resolution execution time in milliseconds (performance.now) */
  executionTimeMs: number;

  /** Issuer URI or DID extracted from iss claim */
  issuer: string;

  /** Credential type URI extracted from vct claim */
  vct: string;

  /** Detailed status of individual cryptographic checks */
  checks: VerificationCheckSummary;

  /** Unmasked and verified claims reconstructed per RFC 9901 */
  verifiedClaims: Record<string, unknown>;

  /** Keys or path segments of selectively disclosable claims that were not disclosed */
  concealedClaimKeys: string[];

  /** Holder public key extracted from cnf.jwk if present */
  holderJwk?: jose.JWK;

  /** Descriptive failure reason if verification failed */
  error?: string;
}

/**
 * Interface contract for pluggable SD-JWT VC verification engines.
 */
export interface IVerificationEngine {
  /** Engine identifier */
  readonly engineName: "native" | "oracle";

  /**
   * Verifies an SD-JWT presentation string per RFC 9901 and draft-ietf-oauth-sd-jwt-vc-19.
   *
   * @param presentation The complete presentation wire format: <jwt>~<disc1>~...~<discN>~[<kb-jwt>]
   * @param options Verification options and policies
   * @returns Detailed VerificationResult
   */
  verify(presentation: string, options?: VerificationOptions): Promise<VerificationResult>;
}
