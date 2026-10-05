import { base64url } from "jose";

/**
 * Default byte length for salt generation (16 bytes = 128 bits).
 * Conforms to RFC 9901 Section 4.2.1 and Section 9.3 entropy recommendations.
 */
export const DEFAULT_SALT_BYTE_LENGTH = 16;

/**
 * Minimum recommended byte length for issuer-generated salts (16 bytes = 128 bits).
 * RFC 9901 Section 9.3 recommends a minimum random length of 128 bits.
 */
export const MIN_SALT_BYTE_LENGTH = 16;

/**
 * Generates a cryptographically secure random salt formatted as an unpadded base64url string.
 *
 * Per RFC 9901 Section 4.2.1:
 * "To achieve the recommended entropy of the salt, the Issuer can base64url-encode 128 bits
 * of cryptographically secure random data, producing a string."
 *
 * Per RFC 9901 Section 9.3:
 * "The RECOMMENDED minimum length of the randomly generated portion of the salt is 128 bits."
 *
 * @param byteLength Number of random bytes to generate (defaults to 16 bytes = 128 bits entropy).
 *                   Must be an integer >= 16.
 * @returns Unpadded base64url encoded salt string.
 * @throws Error if byteLength is not an integer or is less than 16 bytes.
 */
export function generateSalt(byteLength: number = DEFAULT_SALT_BYTE_LENGTH): string {
  if (!Number.isInteger(byteLength) || byteLength < MIN_SALT_BYTE_LENGTH) {
    throw new Error(
      `Salt byte length must be an integer >= ${MIN_SALT_BYTE_LENGTH} (128 bits of entropy) per RFC 9901 Section 9.3, received ${byteLength}`
    );
  }

  const buffer = new Uint8Array(byteLength);
  crypto.getRandomValues(buffer);
  return base64url.encode(buffer);
}

/**
 * Validates whether a given salt conforms to RFC 9901 Section 4.2.1 requirements.
 * Per RFC 9901 Section 4.2.1: "A salt value. MUST be a string."
 * Verifiers treat the salt as an opaque string and do not enforce internal encoding formats.
 *
 * @param salt The salt candidate to validate.
 * @returns True if the salt is a non-empty string, false otherwise.
 */
export function isValidSalt(salt: unknown): boolean {
  return typeof salt === "string" && salt.length > 0;
}

/**
 * Asserts that a salt conforms to RFC 9901 Section 4.2.1 (non-empty string).
 *
 * @param salt The salt candidate to assert.
 * @throws Error if the salt is not a non-empty string.
 */
export function assertValidSalt(salt: unknown): asserts salt is string {
  if (typeof salt !== "string" || salt.length === 0) {
    throw new Error("Salt must be a non-empty string per RFC 9901 Section 4.2.1");
  }
}

/**
 * Issuer-side utility that verifies an unpadded base64url-encoded salt string decodes
 * to at least the specified byte length (default 16 bytes = 128 bits).
 *
 * Note: This function verifies decoded byte length, not statistical randomness/entropy.
 * Per RFC 9901 Section 7.1.3, this check is an Issuer generation validation helper
 * and MUST NOT be used to reject third-party credentials where the salt may use alternative
 * string formats (e.g. UUIDs, hex strings).
 *
 * @param salt The base64url salt candidate to check.
 * @param minByteLength Minimum required decoded byte length (default 16 bytes = 128 bits).
 * @throws Error if the salt is invalid base64url or decodes to fewer than minByteLength bytes.
 */
export function assertMinSaltByteLength(
  salt: unknown,
  minByteLength: number = MIN_SALT_BYTE_LENGTH
): asserts salt is string {
  assertValidSalt(salt);

  if (!/^[A-Za-z0-9_-]+$/.test(salt)) {
    throw new Error(
      "Salt must be a valid unpadded base64url string without padding or special characters"
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = base64url.decode(salt);
  } catch (err) {
    throw new Error(`Failed to decode base64url salt: ${(err as Error).message}`);
  }

  if (bytes.length < minByteLength) {
    throw new Error(
      `Salt decoded byte length too short: decoded to ${bytes.length} bytes, minimum recommended is ${minByteLength} bytes per RFC 9901 Section 9.3`
    );
  }
}
