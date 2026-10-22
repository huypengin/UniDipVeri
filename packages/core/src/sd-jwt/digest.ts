import { createHash } from "node:crypto";
import { base64url } from "jose";
import { z } from "zod";

/**
 * Supported hash algorithms registered in the IANA Named Information Hash Algorithm Registry
 * for use with _sd_alg in RFC 9901 Section 4.1.1.
 */
export const SupportedDigestAlgorithmSchema = z.enum([
  "sha-256",
  "sha-384",
  "sha-512",
]);

export type SupportedDigestAlgorithm = z.infer<
  typeof SupportedDigestAlgorithmSchema
>;

/**
 * Default hash algorithm per RFC 9901 Section 4.1.1:
 * "The default hash algorithm is sha-256. If _sd_alg is not present, sha-256 MUST be used."
 */
export const DEFAULT_DIGEST_ALGORITHM: SupportedDigestAlgorithm = "sha-256";

/**
 * Mapping from RFC 9901 algorithm identifiers to Web Crypto / Node crypto identifiers.
 */
const HASH_NAME_MAP: Record<
  SupportedDigestAlgorithm,
  { webCrypto: string; nodeCrypto: string }
> = {
  "sha-256": { webCrypto: "SHA-256", nodeCrypto: "sha256" },
  "sha-384": { webCrypto: "SHA-384", nodeCrypto: "sha384" },
  "sha-512": { webCrypto: "SHA-512", nodeCrypto: "sha512" },
};

/**
 * Validates whether an algorithm identifier is a supported RFC 9901 digest algorithm.
 */
export function isValidDigestAlgorithm(
  alg: unknown
): alg is SupportedDigestAlgorithm {
  return SupportedDigestAlgorithmSchema.safeParse(alg).success;
}

/**
 * Normalizes an algorithm identifier matching _sd_alg.
 * Returns "sha-256" if undefined or omitted, adhering to RFC 9901 Section 4.1.1.
 *
 * @param alg The candidate algorithm identifier.
 * @returns SupportedDigestAlgorithm
 * @throws Error if an explicit algorithm is supplied but unsupported.
 */
export function normalizeDigestAlgorithm(
  alg?: unknown
): SupportedDigestAlgorithm {
  if (alg === undefined || alg === null || alg === "") {
    return DEFAULT_DIGEST_ALGORITHM;
  }

  const result = SupportedDigestAlgorithmSchema.safeParse(alg);
  if (!result.success) {
    throw new Error(
      `Unsupported _sd_alg hash algorithm: "${alg}". Supported algorithms are: ${SupportedDigestAlgorithmSchema.options.join(", ")} per RFC 9901 Section 4.1.1`
    );
  }

  return result.data;
}

/**
 * Computes the base64url-encoded digest of any US-ASCII string using Web Crypto API.
 * Conforms to RFC 9901 Section 4.2.3 and Section 4.3.
 *
 * @param input Non-empty US-ASCII string
 * @param algorithm Hash algorithm matching _sd_alg (defaults to sha-256)
 * @returns Unpadded base64url-encoded digest string
 */
export async function computeAsciiDigest(
  input: string,
  algorithm: SupportedDigestAlgorithm = DEFAULT_DIGEST_ALGORITHM
): Promise<string> {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error("Input must be a non-empty string");
  }

  const validatedAlg = normalizeDigestAlgorithm(algorithm);
  const { webCrypto } = HASH_NAME_MAP[validatedAlg];

  const asciiBytes = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest(webCrypto, asciiBytes);

  return base64url.encode(new Uint8Array(hashBuffer));
}

/**
 * Computes the base64url-encoded digest of any US-ASCII string using Node / Bun crypto.
 * Conforms to RFC 9901 Section 4.2.3 and Section 4.3.
 *
 * @param input Non-empty US-ASCII string
 * @param algorithm Hash algorithm matching _sd_alg (defaults to sha-256)
 * @returns Unpadded base64url-encoded digest string
 */
export function computeAsciiDigestSync(
  input: string,
  algorithm: SupportedDigestAlgorithm = DEFAULT_DIGEST_ALGORITHM
): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error("Input must be a non-empty string");
  }

  const validatedAlg = normalizeDigestAlgorithm(algorithm);
  const { nodeCrypto } = HASH_NAME_MAP[validatedAlg];

  const hash = createHash(nodeCrypto).update(input, "ascii").digest();
  return base64url.encode(hash);
}

/**
 * Computes the base64url-encoded digest of a base64url disclosure string using Web Crypto API.
 *
 * Requirements per RFC 9901 Section 4.2.3:
 * 1. The digest MUST be computed over the US-ASCII bytes of the base64url-encoded Disclosure string.
 * 2. The input to the hash function MUST be the base64url-encoded string itself, not the decoded bytes.
 * 3. The bytes of the output of the hash function MUST be base64url encoded directly (no hex conversion).
 *
 * @param disclosureString Unpadded base64url disclosure string
 * @param algorithm Hash algorithm matching _sd_alg (defaults to sha-256)
 * @returns Unpadded base64url-encoded digest string
 */
export async function computeDisclosureDigest(
  disclosureString: string,
  algorithm: SupportedDigestAlgorithm = DEFAULT_DIGEST_ALGORITHM
): Promise<string> {
  if (typeof disclosureString !== "string" || disclosureString.length === 0) {
    throw new Error("Disclosure string must be a non-empty string");
  }

  if (!/^[A-Za-z0-9_-]+$/.test(disclosureString)) {
    throw new Error(
      "Invalid disclosure: input must be a valid unpadded base64url string"
    );
  }

  return computeAsciiDigest(disclosureString, algorithm);
}

/**
 * Synchronous variant of computeDisclosureDigest using Node / Bun crypto.
 * Conforms identically to RFC 9901 Section 4.2.3.
 *
 * @param disclosureString Unpadded base64url disclosure string
 * @param algorithm Hash algorithm matching _sd_alg (defaults to sha-256)
 * @returns Unpadded base64url-encoded digest string
 */
export function computeDisclosureDigestSync(
  disclosureString: string,
  algorithm: SupportedDigestAlgorithm = DEFAULT_DIGEST_ALGORITHM
): string {
  if (typeof disclosureString !== "string" || disclosureString.length === 0) {
    throw new Error("Disclosure string must be a non-empty string");
  }

  if (!/^[A-Za-z0-9_-]+$/.test(disclosureString)) {
    throw new Error(
      "Invalid disclosure: input must be a valid unpadded base64url string"
    );
  }

  return computeAsciiDigestSync(disclosureString, algorithm);
}

/**
 * Verifies whether a given disclosure string matches an expected digest.
 *
 * @param disclosureString Unpadded base64url disclosure string
 * @param expectedDigest Expected base64url-encoded digest
 * @param algorithm Hash algorithm matching _sd_alg (defaults to sha-256)
 * @returns Promise<boolean> True if the computed digest equals the expected digest
 */
export async function verifyDisclosureDigest(
  disclosureString: string,
  expectedDigest: string,
  algorithm: SupportedDigestAlgorithm = DEFAULT_DIGEST_ALGORITHM
): Promise<boolean> {
  if (
    typeof expectedDigest !== "string" ||
    expectedDigest.length === 0 ||
    typeof disclosureString !== "string" ||
    disclosureString.length === 0
  ) {
    return false;
  }

  try {
    const computed = await computeDisclosureDigest(disclosureString, algorithm);
    return computed === expectedDigest;
  } catch {
    return false;
  }
}

/**
 * Synchronous variant of verifyDisclosureDigest.
 */
export function verifyDisclosureDigestSync(
  disclosureString: string,
  expectedDigest: string,
  algorithm: SupportedDigestAlgorithm = DEFAULT_DIGEST_ALGORITHM
): boolean {
  if (
    typeof expectedDigest !== "string" ||
    expectedDigest.length === 0 ||
    typeof disclosureString !== "string" ||
    disclosureString.length === 0
  ) {
    return false;
  }

  try {
    const computed = computeDisclosureDigestSync(disclosureString, algorithm);
    return computed === expectedDigest;
  } catch {
    return false;
  }
}
