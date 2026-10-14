import * as jose from "jose";
import { JWK_PRIVATE_KEY_PROPERTIES } from "@unidipveri/core";

/**
 * Standard error thrown when a holder proof-of-possession fails validation.
 * Yields OAuth 2.0 error code "invalid_or_missing_proof" per OpenID4VCI 1.0 Final Section 7.5.
 */
export class InvalidProofError extends Error {
  readonly code = "invalid_or_missing_proof";

  constructor(message: string) {
    super(message);
    this.name = "InvalidProofError";
  }
}

/**
 * Structure of the proof parameter inside an OpenID4VCI Credential Request.
 */
export interface HolderProofParameter {
  proof_type: string;
  jwt: string;
  [key: string]: unknown;
}

/**
 * Result of successful holder proof verification.
 */
export interface VerifiedProofResult {
  holderJwk: jose.JWK;
  header: jose.ProtectedHeaderParameters;
  payload: jose.JWTPayload;
}

/**
 * Supported cryptographic signing algorithms for holder proofs.
 */
export const SUPPORTED_PROOF_ALGORITHMS = ["ES256", "EdDSA", "ES384"] as const;

/**
 * Permitted typ header values for holder proof tokens.
 */
export const PERMITTED_PROOF_TYP_VALUES = [
  "openid-credential-proof+jwt",
  "jwt",
] as const;

/**
 * Strips any private key properties from a JWK to ensure public-only representation.
 */
export function sanitizePublicJwk(jwk: jose.JWK): jose.JWK {
  const { d, p, q, dp, dq, qi, k, ...publicJwk } = jwk;
  return publicJwk;
}

/**
 * Verifies an incoming holder proof-of-possession JWT per OpenID4VCI 1.0 Final Section 7.2.1.
 *
 * Validates:
 * 1. Proof structure (proof_type === "jwt" and jwt string).
 * 2. Header typ and supported algorithm.
 * 3. Header jwk presence and absence of private key material.
 * 4. JWS cryptographic signature using the embedded public JWK.
 * 5. Audience matching issuer base URL or issuer DID.
 * 6. Nonce matching the session c_nonce challenge.
 * 7. Issuance timestamp freshness within maximum allowed clock skew.
 *
 * @param proof Raw proof parameter from Credential Request body
 * @param expectedAudience Expected audience URI(s) (e.g. issuer base URL or DID)
 * @param expectedNonce Expected c_nonce from active authorization session
 * @param maxClockSkewSeconds Maximum allowed clock skew in seconds (default: 300)
 * @returns VerifiedProofResult with sanitized holder public JWK
 * @throws InvalidProofError on any validation or cryptographic failure
 */
export async function verifyHolderProof(
  proof: unknown,
  expectedAudience: string | string[],
  expectedNonce: string,
  maxClockSkewSeconds = 300
): Promise<VerifiedProofResult> {
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
    throw new InvalidProofError("Missing or malformed proof object");
  }

  const proofObj = proof as Partial<HolderProofParameter>;

  if (proofObj.proof_type !== "jwt") {
    throw new InvalidProofError(
      `Unsupported proof_type: expected 'jwt', received '${String(proofObj.proof_type)}'`
    );
  }

  if (typeof proofObj.jwt !== "string" || proofObj.jwt.trim().length === 0) {
    throw new InvalidProofError("Proof parameter must contain a non-empty 'jwt' string");
  }

  let decodedHeader: jose.ProtectedHeaderParameters;
  try {
    decodedHeader = jose.decodeProtectedHeader(proofObj.jwt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new InvalidProofError(`Malformed proof protected header: ${message}`);
  }

  // Check typ header
  const typ = decodedHeader.typ;
  if (
    !typ ||
    !PERMITTED_PROOF_TYP_VALUES.includes(
      typ as (typeof PERMITTED_PROOF_TYP_VALUES)[number]
    )
  ) {
    throw new InvalidProofError(
      `Invalid proof typ header: expected 'openid-credential-proof+jwt' or 'jwt', received '${String(typ)}'`
    );
  }

  // Check alg header
  const alg = decodedHeader.alg;
  if (
    !alg ||
    !SUPPORTED_PROOF_ALGORITHMS.includes(
      alg as (typeof SUPPORTED_PROOF_ALGORITHMS)[number]
    )
  ) {
    throw new InvalidProofError(
      `Unsupported proof algorithm: received '${String(alg)}'`
    );
  }

  // Check holder JWK presence
  const jwk = decodedHeader.jwk;
  if (!jwk || typeof jwk !== "object" || Array.isArray(jwk)) {
    throw new InvalidProofError(
      "Proof protected header must include a valid 'jwk' object"
    );
  }

  // Prohibit private key material
  const rawJwk = jwk as Record<string, unknown>;
  for (const prop of JWK_PRIVATE_KEY_PROPERTIES) {
    if (prop in rawJwk) {
      throw new InvalidProofError(
        `Proof JWK must not contain private key property '${prop}'`
      );
    }
  }

  // Import holder public key
  let publicKey: CryptoKey | Uint8Array;
  try {
    publicKey = (await jose.importJWK(jwk, alg)) as CryptoKey | Uint8Array;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new InvalidProofError(`Failed to import holder public key: ${message}`);
  }

  // Verify JWS signature
  let verifiedPayload: jose.JWTPayload;
  try {
    const verified = await jose.jwtVerify(proofObj.jwt, publicKey, {
      algorithms: [alg],
    });
    verifiedPayload = verified.payload;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new InvalidProofError(`Proof cryptographic verification failed: ${message}`);
  }

  // Validate audience
  const audiences = Array.isArray(expectedAudience)
    ? expectedAudience
    : [expectedAudience];

  const payloadAud = verifiedPayload.aud;
  let audMatched = false;
  if (typeof payloadAud === "string") {
    audMatched = audiences.includes(payloadAud);
  } else if (Array.isArray(payloadAud)) {
    audMatched = payloadAud.some((aud) =>
      typeof aud === "string" && audiences.includes(aud)
    );
  }

  if (!audMatched) {
    throw new InvalidProofError(
      `Proof audience '${String(payloadAud)}' does not match expected issuer audience`
    );
  }

  // Validate nonce
  if (verifiedPayload.nonce !== expectedNonce) {
    throw new InvalidProofError(
      `Proof nonce does not match session c_nonce challenge`
    );
  }

  // Validate iat freshness
  if (typeof verifiedPayload.iat !== "number") {
    throw new InvalidProofError("Proof iat claim must be a numeric timestamp");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const diffSeconds = Math.abs(nowSeconds - verifiedPayload.iat);
  if (diffSeconds > maxClockSkewSeconds) {
    throw new InvalidProofError(
      `Proof timestamp is outside acceptable clock skew (${diffSeconds}s > ${maxClockSkewSeconds}s)`
    );
  }

  return {
    holderJwk: sanitizePublicJwk(jwk),
    header: decodedHeader,
    payload: verifiedPayload,
  };
}
