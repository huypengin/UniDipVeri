import * as jose from "jose";
import {
  generateKeyPair,
  JWK_PRIVATE_KEY_PROPERTIES,
  type SigningAlgorithm,
} from "@unidipveri/core";
import type { IssuerConfig } from "../config.js";

/**
 * Resolved and pre-imported cryptographic key context for the Issuer.
 * Caches the native CryptoKey or KeyLike in memory to eliminate
 * redundant jose.importJWK() overhead on issuance request paths.
 */
export interface KeyContext {
  /** Key ID in DID Document and JWS header 'kid' */
  keyId: string;

  /** Cryptographic algorithm identifier (ES256, EdDSA, ES384) */
  alg: SigningAlgorithm;

  /** Strictly sanitized public JWK safe for external transmission */
  publicKeyJwk: jose.JWK;

  /** Pre-imported private key ready for signing */
  privateKey: CryptoKey | jose.KeyLike | Uint8Array;
}

/**
 * Sanitizes a JWK by stripping all private key parameters per RFC 7517 and RFC 7518.
 *
 * Uses strongly-typed object destructuring to omit private key parameters (d, p, q, dp, dq, qi, k).
 * Because all private parameters are optional in jose.JWK, the resulting object naturally satisfies
 * jose.JWK without unsafe casts or index signature coercion.
 *
 * @param jwk Raw JWK object to sanitize
 * @returns Public-only JWK object
 */
export function sanitizePublicJwk(jwk: jose.JWK): jose.JWK {
  const { d, p, q, dp, dq, qi, k, ...publicJwk } = jwk;

  // Verification guard: assert no private key properties exist
  for (const privateProp of JWK_PRIVATE_KEY_PROPERTIES) {
    if (privateProp in publicJwk) {
      throw new Error(
        `Failed to sanitize public JWK: private parameter '${privateProp}' remained`
      );
    }
  }

  return publicJwk;
}

/**
 * Cryptographically verifies that the private key and public JWK form a matching pair.
 *
 * Signs an ephemeral test challenge using the private key and verifies the resulting
 * JWS using the public key. If the keys do not match (or if coordinates were tampered),
 * verification fails and an error is thrown.
 *
 * @param privateKey The pre-imported private key (CryptoKey, KeyLike, or Uint8Array)
 * @param publicKeyJwk The sanitized public JWK to verify against
 * @param alg The expected signing algorithm
 */
export async function assertCryptographicConsistency(
  privateKey: CryptoKey | jose.KeyLike | Uint8Array,
  publicKeyJwk: jose.JWK,
  alg: SigningAlgorithm
): Promise<void> {
  let publicKey: CryptoKey | jose.KeyLike | Uint8Array;
  try {
    publicKey = await jose.importJWK(publicKeyJwk, alg);
  } catch (err) {
    throw new Error(
      `Failed to import public JWK for cryptographic consistency check: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  const challenge = new TextEncoder().encode(
    JSON.stringify({ challenge: "issuer-key-consistency-check" })
  );

  let jws: string;
  try {
    jws = await new jose.CompactSign(challenge)
      .setProtectedHeader({ alg })
      .sign(privateKey);
  } catch (err) {
    throw new Error(
      `Failed to generate test signature with private key: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  try {
    const verified = await jose.compactVerify(jws, publicKey);
    const decoded = JSON.parse(new TextDecoder().decode(verified.payload));
    if (decoded.challenge !== "issuer-key-consistency-check") {
      throw new Error("Payload challenge mismatch during key verification");
    }
  } catch (err) {
    throw new Error(
      `Cryptographic consistency check failed: public key cannot verify signatures produced by private key (${
        err instanceof Error ? err.message : String(err)
      })`
    );
  }
}

/**
 * Initializes the issuer's key manager from configuration.
 *
 * If `privateKeyJwkJson` is provided in config, it imports and caches that key.
 * If omitted (development/test mode), an ephemeral keypair is generated.
 * In both cases, cryptographic consistency between the private key and public JWK is asserted.
 *
 * @param config IssuerConfig
 * @returns Initialized KeyContext with pre-imported privateKey and sanitized publicKeyJwk
 */
export async function initializeKeyManager(
  config: IssuerConfig
): Promise<KeyContext> {
  const { signingAlgorithm, keyId, privateKeyJwkJson } = config;

  let rawPrivateKeyJwk: jose.JWK;
  let rawPublicKeyJwk: jose.JWK;

  if (privateKeyJwkJson && privateKeyJwkJson.trim().length > 0) {
    try {
      rawPrivateKeyJwk = JSON.parse(privateKeyJwkJson) as jose.JWK;
    } catch (err) {
      throw new Error(
        `Failed to parse ISSUER_PRIVATE_KEY_JWK as JSON: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (
      typeof rawPrivateKeyJwk !== "object" ||
      rawPrivateKeyJwk === null ||
      !("kty" in rawPrivateKeyJwk)
    ) {
      throw new Error("Parsed private key JWK must be a valid JSON object with a 'kty' property");
    }

    rawPublicKeyJwk = sanitizePublicJwk(rawPrivateKeyJwk);
  } else {
    // Generate ephemeral keypair for dev/test environments
    const generated = await generateKeyPair(signingAlgorithm);
    rawPrivateKeyJwk = generated.privateKeyJwk;
    rawPublicKeyJwk = generated.publicKeyJwk;
  }

  // Ensure key metadata matches configuration
  const publicKeyJwk: jose.JWK = {
    ...rawPublicKeyJwk,
    kid: keyId,
    alg: signingAlgorithm,
  };

  // Pre-import the private key once into a native CryptoKey / KeyLike
  const privateKey = await jose.importJWK(rawPrivateKeyJwk, signingAlgorithm);

  // Assert cryptographic consistency before returning key context
  await assertCryptographicConsistency(privateKey, publicKeyJwk, signingAlgorithm);

  return {
    keyId,
    alg: signingAlgorithm,
    publicKeyJwk,
    privateKey,
  };
}
