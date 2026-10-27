import * as jose from "jose";
import { JWK_PRIVATE_KEY_PROPERTIES } from "@unidipveri/core";

/**
 * Standard error thrown when a holder proof-of-possession fails validation.
 * Yields OAuth 2.0 error codes "invalid_proof" or "invalid_nonce" per OpenID4VCI 1.0 Final.
 */
export class InvalidProofError extends Error {
  readonly code: "invalid_proof" | "invalid_nonce" | "invalid_or_missing_proof";

  constructor(
    message: string,
    code: "invalid_proof" | "invalid_nonce" | "invalid_or_missing_proof" = "invalid_proof"
  ) {
    super(message);
    this.name = "InvalidProofError";
    this.code = code;
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
 * Standard supported typ header values for holder proof tokens (OpenID4VCI 1.0 Final & Draft 11/13).
 */
export const STANDARD_PROOF_TYP_VALUES = [
  "openid4vci-proof+jwt",
  "openid-credential-proof+jwt",
] as const;

/**
 * Legacy typ header values for holder proof tokens, disabled by default.
 */
export const LEGACY_PROOF_TYP_VALUES = [
  "jwt",
  "JWT",
] as const;

/**
 * Permitted typ header values for holder proof tokens across standard and legacy modes.
 */
export const PERMITTED_PROOF_TYP_VALUES = [
  ...STANDARD_PROOF_TYP_VALUES,
  ...LEGACY_PROOF_TYP_VALUES,
] as const;

/**
 * Configuration options for holder proof validation.
 */
export interface ProofValidationOptions {
  /**
   * Whether to accept deprecated generic "jwt" or "JWT" typ headers.
   * Default: false (strictly enforces openid4vci-proof+jwt or openid-credential-proof+jwt).
   */
  allowLegacyProofTyp?: boolean;

  /**
   * Whether to accept deprecated non-standard body shapes (direct string, root jwt, arrays).
   * Default: false (strictly enforces proofs.jwt[] or proof.jwt wire shapes).
   */
  allowLegacyShapes?: boolean;

  /**
   * Maximum allowed clock skew for proof iat validation in seconds.
   * Default: 300 seconds.
   */
  maxClockSkewSeconds?: number;
}

/**
 * Strips any private key properties from a JWK to ensure public-only representation.
 */
export function sanitizePublicJwk(jwk: jose.JWK): jose.JWK {
  const { d, p, q, dp, dq, qi, k, ...publicJwk } = jwk;
  return publicJwk;
}

/**
 * Robustly extracts the holder proof JWT string from an incoming OID4VCI Credential Request body
 * or proof parameter.
 *
 * Enforces wire shapes seen on the wire:
 * - proofs.jwt array or string (OpenID4VCI 1.0 Final)
 * - proof.jwt object (Draft 11/13)
 * Rejects requests containing both proof and proofs.
 * Gates non-standard structures behind options.allowLegacyShapes.
 *
 * @param input Parsed Credential Request JSON body or raw proof object/string
 * @param options Validation options including allowLegacyShapes
 * @returns Compact serialized JWT string, or null if missing
 */
export function extractProofJwt(
  input: unknown,
  options?: ProofValidationOptions
): string | null {
  if (!input) {
    return null;
  }

  const allowLegacyShapes = options?.allowLegacyShapes ?? false;

  // 1. Direct compact JWT string (legacy shape)
  if (typeof input === "string") {
    if (!allowLegacyShapes) {
      return null;
    }
    const trimmed = input.trim();
    if (trimmed.length > 0 && trimmed.split(".").length === 3) {
      return trimmed;
    }
    return null;
  }

  if (typeof input !== "object") {
    return null;
  }

  const record = input as Record<string, unknown>;

  // Reject mutual presence of both 'proof' and 'proofs'
  if (record.proof !== undefined && record.proofs !== undefined) {
    throw new InvalidProofError(
      "Request must not contain both 'proof' and 'proofs' parameters",
      "invalid_proof"
    );
  }

  // 2. Check input.proofs (OpenID4VCI 1.0 Final)
  if (record.proofs !== undefined && record.proofs !== null) {
    // Case 2a: proofs: { jwt: ["..."] } or proofs: { jwt: "..." }
    if (typeof record.proofs === "object" && !Array.isArray(record.proofs)) {
      const proofsObj = record.proofs as Record<string, unknown>;
      if (Array.isArray(proofsObj.jwt)) {
        if (proofsObj.jwt.length > 1) {
          throw new InvalidProofError(
            "Multiple proofs in proofs.jwt are unsupported in single credential request; expected exactly 1 proof",
            "invalid_proof"
          );
        }
        if (proofsObj.jwt.length === 1) {
          const candidate = proofsObj.jwt[0];
          if (typeof candidate === "string" && candidate.trim().length > 0) {
            return candidate.trim();
          }
        }
      }
      if (typeof proofsObj.jwt === "string" && proofsObj.jwt.trim().length > 0) {
        return proofsObj.jwt.trim();
      }
    }
    // Case 2b: proofs: [ { jwt: "..." } ] or proofs: [ "..." ] (legacy array shape)
    if (Array.isArray(record.proofs)) {
      if (!allowLegacyShapes) {
        return null;
      }
      if (record.proofs.length > 1) {
        throw new InvalidProofError(
          "Multiple proofs in proofs array are unsupported in single credential request; expected exactly 1 proof",
          "invalid_proof"
        );
      }
      if (record.proofs.length === 1) {
        const first = record.proofs[0];
        if (typeof first === "string" && first.trim().length > 0) {
          return first.trim();
        }
        if (first && typeof first === "object" && !Array.isArray(first)) {
          const item = first as Record<string, unknown>;
          if (typeof item.jwt === "string" && item.jwt.trim().length > 0) {
            return item.jwt.trim();
          }
        }
      }
    }
  }

  // 3. Check input.proof (OpenID4VCI Draft 11/13 / common wallet implementations)
  if (record.proof !== undefined && record.proof !== null) {
    // Case 3a: proof: "eyJ..." (direct compact JWT string)
    if (typeof record.proof === "string") {
      if (!allowLegacyShapes) {
        return null;
      }
      if (record.proof.trim().length > 0) {
        return record.proof.trim();
      }
    }
    // Case 3b: proof: { proof_type: "jwt", jwt: "..." } or proof: { jwt: "..." }
    if (typeof record.proof === "object" && !Array.isArray(record.proof)) {
      const proofObj = record.proof as Record<string, unknown>;
      if (typeof proofObj.jwt === "string" && proofObj.jwt.trim().length > 0) {
        return proofObj.jwt.trim();
      }
    }
    // Case 3c: proof: [ { jwt: "..." } ] or proof: [ "..." ] (legacy array shape)
    if (Array.isArray(record.proof)) {
      if (!allowLegacyShapes) {
        return null;
      }
      if (record.proof.length > 0) {
        const first = record.proof[0];
        if (typeof first === "string" && first.trim().length > 0) {
          return first.trim();
        }
        if (first && typeof first === "object" && !Array.isArray(first)) {
          const item = first as Record<string, unknown>;
          if (typeof item.jwt === "string" && item.jwt.trim().length > 0) {
            return item.jwt.trim();
          }
        }
      }
    }
  }

  // 4. Input itself is a proof object: { proof_type: "...", jwt: "..." }
  if (typeof record.jwt === "string" && record.jwt.trim().length > 0) {
    // If it's a proof parameter object with proof_type, it's the wire proof object passed directly
    if (record.proof_type !== undefined) {
      return record.jwt.trim();
    }
    // Otherwise, it's a root-level jwt on the body without proof/proofs wrapper -> gate behind allowLegacyShapes
    if (allowLegacyShapes) {
      return record.jwt.trim();
    }
  }

  return null;
}

/**
 * Verifies an incoming holder proof-of-possession JWT per OpenID4VCI 1.0 Final proof verification rules.
 *
 * Validates:
 * 1. Proof extraction (proofs.jwt, proof.jwt, or gated legacy structures).
 * 2. Header typ and supported algorithm.
 * 3. Header jwk presence (or did:jwk in kid) and absence of private key material.
 * 4. JWS cryptographic signature using the embedded public JWK.
 * 5. Audience matching issuer base URL, issuer DID, or credential endpoint URL.
 * 6. Nonce matching the session c_nonce challenge.
 * 7. Issuance timestamp freshness within maximum allowed clock skew.
 *
 * @param proofOrBody Raw proof parameter, compact JWT string, or full Credential Request body
 * @param expectedAudience Expected audience URI(s) (e.g. issuer base URL, DID, or /credential endpoint)
 * @param expectedNonce Expected c_nonce challenge(s) or validator function
 * @param optionsOrClockSkew Validation options or clock skew number
 * @returns VerifiedProofResult with sanitized holder public JWK
 * @throws InvalidProofError on any validation or cryptographic failure
 */
export async function verifyHolderProof(
  proofOrBody: unknown,
  expectedAudience: string | string[],
  expectedNonce: string | string[] | ((nonce: string | undefined) => boolean),
  optionsOrClockSkew?: ProofValidationOptions | number
): Promise<VerifiedProofResult> {
  const options: ProofValidationOptions =
    typeof optionsOrClockSkew === "number"
      ? { maxClockSkewSeconds: optionsOrClockSkew }
      : (optionsOrClockSkew ?? {});

  const maxClockSkewSeconds = options.maxClockSkewSeconds ?? 300;
  const allowLegacyProofTyp = options.allowLegacyProofTyp ?? false;

  const jwtString = extractProofJwt(proofOrBody, options);
  if (!jwtString) {
    throw new InvalidProofError("Missing or malformed proof object");
  }

  // If proof_type is explicitly supplied on a wrapper object, enforce supported value
  if (
    proofOrBody &&
    typeof proofOrBody === "object" &&
    !Array.isArray(proofOrBody)
  ) {
    const raw = proofOrBody as Record<string, unknown>;
    const explicitType = raw.proof_type ?? (raw.proof && typeof raw.proof === "object" ? (raw.proof as Record<string, unknown>).proof_type : undefined);
    if (explicitType !== undefined && explicitType !== "jwt") {
      throw new InvalidProofError(
        `Unsupported proof_type: expected 'jwt', received '${String(explicitType)}'`
      );
    }
  }

  let decodedHeader: jose.ProtectedHeaderParameters;
  try {
    decodedHeader = jose.decodeProtectedHeader(jwtString);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new InvalidProofError(`Malformed proof protected header: ${message}`);
  }

  // Check typ header using PERMITTED_PROOF_TYP_VALUES constants
  const typ = decodedHeader.typ;
  const normalizedTyp = typ ? typ.toLowerCase() : "";

  const allowedTypes = allowLegacyProofTyp
    ? (PERMITTED_PROOF_TYP_VALUES as readonly string[])
    : (STANDARD_PROOF_TYP_VALUES as readonly string[]);

  if (!typ || !allowedTypes.includes(normalizedTyp)) {
    if (normalizedTyp === "jwt" && !allowLegacyProofTyp) {
      throw new InvalidProofError(
        "Proof typ 'jwt' is rejected by default policy; expected 'openid4vci-proof+jwt' or 'openid-credential-proof+jwt'"
      );
    }
    throw new InvalidProofError(
      `Invalid proof typ header: expected one of [${allowedTypes.join(", ")}], received '${String(typ)}'`
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

  // Extract holder public key from decoded header (jwk or did:jwk in kid)
  let jwk = decodedHeader.jwk;
  if (!jwk && typeof decodedHeader.kid === "string" && decodedHeader.kid.startsWith("did:jwk:")) {
    try {
      const b64 = decodedHeader.kid.slice("did:jwk:".length).split("#")[0];
      const jsonStr = Buffer.from(b64, "base64url").toString("utf-8");
      jwk = JSON.parse(jsonStr) as jose.JWK;
    } catch {
      // ignore parse failure and let jwk check fail below
    }
  }

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
    const verified = await jose.jwtVerify(jwtString, publicKey, {
      algorithms: [alg],
    });
    verifiedPayload = verified.payload;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new InvalidProofError(`Proof cryptographic verification failed: ${message}`);
  }

  // Validate audience with trailing slash normalization
  const expectedList = (
    Array.isArray(expectedAudience) ? expectedAudience : [expectedAudience]
  ).map((a) => a.replace(/\/+$/, ""));

  const payloadAud = verifiedPayload.aud;
  let audMatched = false;
  if (typeof payloadAud === "string") {
    audMatched = expectedList.includes(payloadAud.replace(/\/+$/, ""));
  } else if (Array.isArray(payloadAud)) {
    audMatched = payloadAud.some(
      (aud) => typeof aud === "string" && expectedList.includes(aud.replace(/\/+$/, ""))
    );
  }

  if (!audMatched) {
    throw new InvalidProofError(
      `Proof audience '${String(payloadAud)}' does not match expected issuer audience`
    );
  }

  // Validate nonce
  const payloadNonce = verifiedPayload.nonce as string | undefined;
  let nonceValid = false;
  if (typeof expectedNonce === "function") {
    nonceValid = expectedNonce(payloadNonce);
  } else if (Array.isArray(expectedNonce)) {
    nonceValid = typeof payloadNonce === "string" && expectedNonce.includes(payloadNonce);
  } else if (typeof expectedNonce === "string") {
    nonceValid = typeof payloadNonce === "string" && payloadNonce === expectedNonce;
  }

  if (!nonceValid) {
    throw new InvalidProofError(
      `Proof nonce does not match session c_nonce challenge`,
      "invalid_nonce"
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
