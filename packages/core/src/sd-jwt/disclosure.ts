import { base64url } from "jose";
import { assertValidSalt } from "./salt.js";

/**
 * An object property disclosure tuple: [salt, claim_name, claim_value]
 * Conforms to RFC 9901 object disclosure tuple format.
 */
export type ObjectDisclosureTuple = [salt: string, key: string, value: unknown];

/**
 * An array element disclosure tuple: [salt, claim_value]
 * Conforms to RFC 9901 array element disclosure tuple format.
 */
export type ArrayDisclosureTuple = [salt: string, value: unknown];

/**
 * Union of valid disclosure tuples (object or array element).
 */
export type DisclosureTuple = ObjectDisclosureTuple | ArrayDisclosureTuple;

/**
 * Decoded representation of a named object property disclosure.
 */
export interface DecodedObjectDisclosure {
  type: "object";
  salt: string;
  key: string;
  value: unknown;
  tuple: ObjectDisclosureTuple;
  encoded: string;
}

/**
 * Decoded representation of an anonymous array element disclosure
 * (for selectively disclosable array elements marked by "..." in RFC 9901).
 */
export interface DecodedArrayDisclosure {
  type: "array";
  salt: string;
  key?: undefined;
  value: unknown;
  tuple: ArrayDisclosureTuple;
  encoded: string;
}

/**
 * Discriminated union of decoded disclosures.
 */
export type DecodedDisclosure = DecodedObjectDisclosure | DecodedArrayDisclosure;

export interface DisclosureOptions {
  /**
   * Whether to strictly validate salt format.
   * Default: true.
   */
  validateSalt?: boolean;
}

/**
 * Reserved claim names that MUST NOT be used as disclosure keys per RFC 9901.
 */
const RESERVED_CLAIM_NAMES = new Set(["_sd", "..."]);

/**
 * Recursively orders object keys lexicographically for deterministic JSON serialization
 * adhering to RFC 8785 (JSON Canonicalization Scheme).
 * Note: RFC 8785 is an internal Issuer implementation choice, not a wire requirement of RFC 9901.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const sortedObj: Record<string, unknown> = {};

  for (const key of sortedKeys) {
    if (obj[key] !== undefined) {
      sortedObj[key] = canonicalize(obj[key]);
    }
  }

  return sortedObj;
}

/**
 * Deterministically serializes a value into a canonical JSON string
 * with lexicographically sorted object keys and no redundant whitespace.
 */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Encodes a disclosure tuple into an unpadded base64url disclosure string.
 *
 * Serialization steps per RFC 9901 disclosure serialization rules:
 * 1. JSON serialization of array tuple: JSON.stringify(canonicalize(tuple))
 * 2. UTF-8 byte conversion: new TextEncoder().encode(json)
 * 3. Base64url encoding (unpadded): base64url.encode(bytes)
 *
 * @param tuple Either an object disclosure tuple [salt, key, value] or array element disclosure [salt, value]
 * @param options Encoding options
 * @returns Unpadded base64url disclosure string
 */
export function encodeDisclosure(
  tuple: DisclosureTuple,
  options: DisclosureOptions = {}
): string {
  if (!Array.isArray(tuple)) {
    throw new Error("Disclosure tuple must be an array");
  }

  if (tuple.length !== 2 && tuple.length !== 3) {
    throw new Error(
      `Invalid disclosure tuple length: expected 2 (array element) or 3 (object property), received ${(tuple as unknown[]).length}`
    );
  }

  const salt = tuple[0];
  if (options.validateSalt !== false) {
    assertValidSalt(salt);
  } else if (typeof salt !== "string" || salt.length === 0) {
    throw new Error("Salt must be a non-empty string");
  }

  if (tuple.length === 3) {
    const key = tuple[1];
    if (typeof key !== "string" || key.length === 0) {
      throw new Error("Object disclosure claim key must be a non-empty string");
    }
    if (RESERVED_CLAIM_NAMES.has(key)) {
      throw new Error(`Claim key cannot be reserved identifier "${key}"`);
    }

    const value = tuple[2];
    if (value === undefined) {
      throw new Error("Disclosure claim value cannot be undefined");
    }
  } else {
    const value = tuple[1];
    if (value === undefined) {
      throw new Error("Disclosure claim value cannot be undefined");
    }
  }

  const canonicalJson = canonicalJsonStringify(tuple);
  const utf8Bytes = new TextEncoder().encode(canonicalJson);
  return base64url.encode(utf8Bytes);
}

/**
 * Convenience helper to encode a named object property disclosure: [salt, key, value].
 */
export function encodeObjectDisclosure(
  salt: string,
  key: string,
  value: unknown,
  options: DisclosureOptions = {}
): string {
  return encodeDisclosure([salt, key, value], options);
}

/**
 * Convenience helper to encode an anonymous array element disclosure: [salt, value].
 * Used for selectively disclosable array elements marked with "..." digest markers.
 */
export function encodeArrayDisclosure(
  salt: string,
  value: unknown,
  options: DisclosureOptions = {}
): string {
  return encodeDisclosure([salt, value], options);
}

/**
 * Decodes and validates a base64url-encoded disclosure string.
 * Conforms to RFC 9901 disclosure decoding and validation rules.
 *
 * @param disclosureString Unpadded base64url disclosure string
 * @param options Decoding and validation options
 * @returns Decoded disclosure object
 */
export function decodeDisclosure(
  disclosureString: string,
  options: DisclosureOptions = {}
): DecodedDisclosure {
  if (typeof disclosureString !== "string" || disclosureString.length === 0) {
    throw new Error("Disclosure must be a non-empty string");
  }

  if (!/^[A-Za-z0-9_-]+$/.test(disclosureString)) {
    throw new Error(
      "Invalid disclosure: not a valid unpadded base64url string"
    );
  }

  let utf8String: string;
  try {
    const bytes = base64url.decode(disclosureString);
    utf8String = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (err) {
    throw new Error(
      `Failed to decode disclosure base64url/UTF-8: ${(err as Error).message}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8String);
  } catch (err) {
    throw new Error(
      `Invalid disclosure: payload is not valid JSON (${(err as Error).message})`
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Invalid disclosure: JSON payload must be an array");
  }

  if (parsed.length !== 2 && parsed.length !== 3) {
    throw new Error(
      `Invalid disclosure tuple length: expected 2 or 3 elements, received ${parsed.length}`
    );
  }

  const salt = parsed[0];
  if (options.validateSalt !== false) {
    assertValidSalt(salt);
  } else if (typeof salt !== "string" || salt.length === 0) {
    throw new Error("Invalid disclosure: salt must be a non-empty string");
  }

  if (parsed.length === 3) {
    const key = parsed[1];
    if (typeof key !== "string" || key.length === 0) {
      throw new Error(
        "Invalid disclosure: object claim key must be a non-empty string"
      );
    }
    if (RESERVED_CLAIM_NAMES.has(key)) {
      throw new Error(
        `Invalid disclosure: claim key cannot be reserved identifier "${key}"`
      );
    }

    const value = parsed[2];
    return {
      type: "object",
      salt,
      key,
      value,
      tuple: [salt, key, value],
      encoded: disclosureString,
    };
  }

  const value = parsed[1];
  return {
    type: "array",
    salt,
    value,
    tuple: [salt, value],
    encoded: disclosureString,
  };
}

/**
 * Validates whether a value is a well-formed base64url disclosure string.
 */
export function isValidDisclosure(
  disclosureString: unknown,
  options: DisclosureOptions = {}
): boolean {
  if (typeof disclosureString !== "string" || disclosureString.length === 0) {
    return false;
  }

  try {
    decodeDisclosure(disclosureString, options);
    return true;
  } catch {
    return false;
  }
}
