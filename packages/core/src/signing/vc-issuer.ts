import * as jose from "jose";
import { z } from "zod";
import {
  SigningAlgorithmSchema,
  type SigningAlgorithm,
} from "./signer.js";
import {
  transformClaims,
  type TransformedClaimsResult,
  type TransformOptions,
} from "../sd-jwt/transform.js";
import type { SupportedDigestAlgorithm } from "../sd-jwt/digest.js";
import type { CredentialTypeConfig, ClaimDef } from "../schema/types.js";
import {
  RESERVED_ROOT_CLAIM_NAMES,
  type ReservedRootClaimName,
} from "../schema/validator.js";

/**
 * Standard media type for SD-JWT-based Verifiable Credentials
 * per draft-ietf-oauth-sd-jwt-vc-19.
 */
export const SD_JWT_VC_TYP = "dc+sd-jwt";

/**
 * Reserved top-level claim names prohibited in caller raw claims.
 * Enforced per draft-ietf-oauth-sd-jwt-vc-19 Section 3 and RFC 9901 Section 4.2.1.
 */
export const RESERVED_TOP_LEVEL_CLAIMS = RESERVED_ROOT_CLAIM_NAMES;

export type ReservedTopLevelClaim = ReservedRootClaimName;

/**
 * Standard JWK private key parameters per RFC 7517 and RFC 7518
 * that must never appear in holder confirmation (cnf) public keys.
 */
export const JWK_PRIVATE_KEY_PROPERTIES = [
  "d",
  "p",
  "q",
  "dp",
  "dq",
  "qi",
  "k",
] as const;

/**
 * Zod schema for Holder Confirmation (cnf) claim per RFC 9901 Section 4.3
 * and draft-ietf-oauth-sd-jwt-vc-19 Section 3.2.1.
 */
export const CnfClaimSchema = z
  .object({
    jwk: z
      .custom<jose.JWK>(
        (val) => typeof val === "object" && val !== null && !Array.isArray(val)
      )
      .optional(),
    kid: z.string().min(1).optional(),
  })
  .refine((data) => data.jwk !== undefined || data.kid !== undefined, {
    message: "cnf claim must contain at least one of 'jwk' or 'kid'",
  })
  .refine(
    (data) => {
      if (!data.jwk) {
        return true;
      }
      const jwk = data.jwk as unknown as Record<string, unknown>;
      return !JWK_PRIVATE_KEY_PROPERTIES.some((prop) => prop in jwk);
    },
    {
      message:
        "cnf.jwk must not contain private key material (d, p, q, dp, dq, qi, or k)",
    }
  );

export type CnfClaim = z.infer<typeof CnfClaimSchema>;

/**
 * Zod schema for Token Status List (status) revocation claim per
 * draft-ietf-oauth-status-list-21 and draft-ietf-oauth-sd-jwt-vc-19 Section 3.2.2.
 */
export const TokenStatusListClaimSchema = z.object({
  status_list: z.object({
    idx: z.number().int().nonnegative({
      message: "status_list.idx must be a non-negative integer",
    }),
    uri: z.string().url({
      message: "status_list.uri must be a valid URL",
    }),
  }),
});

export type TokenStatusListClaim = z.infer<typeof TokenStatusListClaimSchema>;

/**
 * Issuer signing key parameters for SD-JWT VC issuance.
 */
export interface IssuerSigningKey {
  /** Private key as JWK, CryptoKey, KeyLike, or Uint8Array */
  privateKey: jose.JWK | CryptoKey | jose.KeyLike | Uint8Array;
  /** Cryptographic algorithm identifier (ES256, EdDSA, ES384) */
  alg: SigningAlgorithm;
  /** Key ID in DID Document or JWKS (sets 'kid' in header) */
  keyId?: string;
}

/**
 * Options for the all-in-one issueSdJwtVc pipeline.
 */
export interface IssueSdJwtVcOptions {
  /** Issuer DID or HTTPS URI (sets 'iss' claim) */
  issuer: string;

  /** Issuer signing key configuration */
  signingKey: IssuerSigningKey;

  /** Optional VCT override (defaults to schema.vct) */
  vct?: string;

  /** Optional Holder Key Confirmation (sets 'cnf' claim) */
  holderConfirmation?: CnfClaim;

  /** Optional Token Status List revocation reference (sets 'status' claim) */
  status?: TokenStatusListClaim;

  /** Validity duration in seconds (sets 'exp' = iat + validitySeconds) */
  validitySeconds?: number;

  /** Not-before offset in seconds from iat (sets 'nbf', defaults to iat) */
  notBeforeSeconds?: number;

  /** Explicit JWT ID (defaults to crypto.randomUUID()) */
  jti?: string;

  /** Explicit issuance timestamp in seconds (defaults to current unix time) */
  iat?: number;

  /** SD-JWT digest algorithm for disclosures (defaults to 'sha-256') */
  digestAlgorithm?: SupportedDigestAlgorithm;

  /** Optional custom salt generator producing >= 128-bit CSPRNG salts */
  saltGenerator?: () => string;
}

/**
 * Result of SD-JWT VC issuance.
 */
export interface IssuedSdJwtVcResult {
  /** Combined SD-JWT wire format: <signed-jwt>~<disc1>~...~<discN>~ */
  compact: string;

  /** The outer signed JWS string (header.payload.signature) */
  jwt: string;

  /** Array of generated base64url disclosure strings */
  disclosures: string[];

  /** The full signed JWT payload (root metadata + masked claims) */
  payload: Record<string, unknown>;
}

/**
 * Low-level options for signSdJwtVc.
 */
export interface SignSdJwtVcOptions {
  /** Assembled payload (including root claims like iss, vct, iat) */
  payload: Record<string, unknown>;

  /** Generated disclosure strings to append */
  disclosures: string[];

  /** Issuer signing key configuration */
  signingKey: IssuerSigningKey;
}

/**
 * Asserts that caller claims do not contain reserved top-level claim names.
 *
 * @param claims Raw caller claims object
 * @throws Error if any reserved key is found
 */
export function assertNoReservedClaims(claims: Record<string, unknown>): void {
  for (const reservedKey of RESERVED_TOP_LEVEL_CLAIMS) {
    if (Object.prototype.hasOwnProperty.call(claims, reservedKey)) {
      throw new Error(
        `Caller claims must not contain reserved top-level claim '${reservedKey}' per draft-ietf-oauth-sd-jwt-vc-19 and RFC 9901`
      );
    }
  }
}

/**
 * Resolves a private key into a jose KeyLike or CryptoKey suitable for signing.
 */
async function resolvePrivateKey(
  privateKey: jose.JWK | CryptoKey | jose.KeyLike | Uint8Array,
  alg: SigningAlgorithm
): Promise<CryptoKey | jose.KeyLike | Uint8Array> {
  if (typeof privateKey === "object" && privateKey !== null && "kty" in privateKey) {
    return jose.importJWK(privateKey as jose.JWK, alg);
  }
  return privateKey;
}

/**
 * Low-level pure signer that signs an already-assembled payload and appends disclosures.
 *
 * Requirements per draft-ietf-oauth-sd-jwt-vc-19:
 * - JWT header contains typ: "dc+sd-jwt" and alg matching signingKey.alg.
 * - JWT payload must contain mandatory 'iss' and 'vct' claims.
 * - Validates 'cnf' and 'status' claims if present against schema constraints.
 * - Enforces timestamp ordering if both 'nbf' and 'exp' are numeric.
 * - Output serialized as <signed-jwt>~<disc1>~...~<discN>~ per RFC 9901 Section 5.
 *
 * @param options Low-level signing options
 * @returns IssuedSdJwtVcResult containing compact string and breakdown
 */
export async function signSdJwtVc(
  options: SignSdJwtVcOptions
): Promise<IssuedSdJwtVcResult> {
  const { payload, disclosures, signingKey } = options;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("payload must be a non-null object");
  }

  if (typeof payload.iss !== "string" || payload.iss.trim().length === 0) {
    throw new Error("Payload must contain a non-empty 'iss' claim");
  }

  if (typeof payload.vct !== "string" || payload.vct.trim().length === 0) {
    throw new Error("Payload must contain a non-empty 'vct' claim");
  }

  // Validate cnf claim if present in payload
  if (payload.cnf !== undefined) {
    CnfClaimSchema.parse(payload.cnf);
  }

  // Validate status claim if present in payload
  if (payload.status !== undefined) {
    TokenStatusListClaimSchema.parse(payload.status);
  }

  // Validate timestamp ordering if both nbf and exp are present
  if (
    typeof payload.exp === "number" &&
    typeof payload.nbf === "number" &&
    payload.nbf > payload.exp
  ) {
    throw new Error(
      `Invalid timestamps: nbf (${payload.nbf}) cannot be greater than exp (${payload.exp})`
    );
  }

  const validatedAlg = SigningAlgorithmSchema.parse(signingKey.alg);
  const key = await resolvePrivateKey(signingKey.privateKey, validatedAlg);

  const jwt = await new jose.SignJWT(payload)
    .setProtectedHeader({
      alg: validatedAlg,
      typ: SD_JWT_VC_TYP,
      ...(signingKey.keyId ? { kid: signingKey.keyId } : {}),
    })
    .sign(key);

  const compact =
    disclosures.length > 0
      ? `${jwt}~${disclosures.join("~")}~`
      : `${jwt}~`;

  return {
    compact,
    jwt,
    disclosures,
    payload,
  };
}

/**
 * Primary all-in-one pipeline for issuing SD-JWT Verifiable Credentials.
 *
 * Pipeline steps:
 * 1. Validates caller claims against reserved top-level claim names.
 * 2. Runs pure claim transformation pipeline (transformClaims) to produce masked payload and disclosures.
 * 3. Assembles draft-19 compliant root metadata claims: iss, vct, iat, nbf, exp, jti, and optional cnf/status.
 * 4. Signs the outer JWS using signSdJwtVc with typ: "dc+sd-jwt".
 * 5. Returns the combined wire token and components.
 *
 * @param rawClaims Raw academic credential data
 * @param schema CredentialTypeConfig or claim definitions record
 * @param options Issuance options including issuer, signing key, cnf, status, and timestamps
 * @returns IssuedSdJwtVcResult containing compact wire format and breakdown
 */
export async function issueSdJwtVc(
  rawClaims: Record<string, unknown>,
  schema: CredentialTypeConfig | Record<string, ClaimDef>,
  options: IssueSdJwtVcOptions
): Promise<IssuedSdJwtVcResult> {
  if (!rawClaims || typeof rawClaims !== "object" || Array.isArray(rawClaims)) {
    throw new Error("rawClaims must be a non-null object");
  }

  // Guard 1: Prohibit caller injection of reserved top-level claims
  assertNoReservedClaims(rawClaims);

  // Validate issuer
  if (typeof options.issuer !== "string" || options.issuer.trim().length === 0) {
    throw new Error("options.issuer must be a non-empty string");
  }

  // Determine VCT from options or schema
  let vct: string | undefined = options.vct;
  if (!vct && "vct" in schema && typeof (schema as CredentialTypeConfig).vct === "string") {
    vct = (schema as CredentialTypeConfig).vct;
  }

  if (!vct || vct.trim().length === 0) {
    throw new Error("Credential type 'vct' must be provided in options or schema");
  }

  // Validate optional cnf claim
  if (options.holderConfirmation !== undefined) {
    CnfClaimSchema.parse(options.holderConfirmation);
  }

  // Validate optional status claim
  if (options.status !== undefined) {
    TokenStatusListClaimSchema.parse(options.status);
  }

  // Validate timestamp parameters
  if (options.validitySeconds !== undefined) {
    if (
      typeof options.validitySeconds !== "number" ||
      !Number.isFinite(options.validitySeconds) ||
      options.validitySeconds <= 0
    ) {
      throw new Error("options.validitySeconds must be a positive number (> 0)");
    }
  }

  if (
    options.notBeforeSeconds !== undefined &&
    (typeof options.notBeforeSeconds !== "number" ||
      !Number.isFinite(options.notBeforeSeconds))
  ) {
    throw new Error("options.notBeforeSeconds must be a finite number");
  }

  // Step 2: Transform raw claims into masked payload and salted disclosures
  const transformOptions: TransformOptions = {
    algorithm: options.digestAlgorithm,
    saltGenerator: options.saltGenerator,
  };

  const transformResult: TransformedClaimsResult = transformClaims(
    rawClaims,
    schema,
    transformOptions
  );

  // Step 3: Assemble Draft-19 root metadata claims
  const iat = options.iat ?? Math.floor(Date.now() / 1000);
  const nbf =
    options.notBeforeSeconds !== undefined
      ? iat + options.notBeforeSeconds
      : iat;
  const exp =
    options.validitySeconds !== undefined
      ? iat + options.validitySeconds
      : undefined;

  if (exp !== undefined && nbf > exp) {
    throw new Error(
      `Invalid timestamps: nbf (${nbf}) cannot be greater than exp (${exp})`
    );
  }

  const jti = options.jti ?? crypto.randomUUID();

  const assembledPayload: Record<string, unknown> = {
    ...transformResult.maskedPayload,
    iss: options.issuer,
    vct,
    iat,
    nbf,
    jti,
  };

  if (exp !== undefined) {
    assembledPayload.exp = exp;
  }

  if (options.holderConfirmation !== undefined) {
    assembledPayload.cnf = options.holderConfirmation;
  }

  if (options.status !== undefined) {
    assembledPayload.status = options.status;
  }

  // Step 4 & 5: Sign outer JWS and serialize into compact wire format
  return signSdJwtVc({
    payload: assembledPayload,
    disclosures: transformResult.disclosures,
    signingKey: options.signingKey,
  });
}
