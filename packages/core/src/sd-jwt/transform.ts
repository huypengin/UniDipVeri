import { generateSalt } from "./salt.js";
import {
  decodeDisclosure,
  encodeArrayDisclosure,
  encodeObjectDisclosure,
} from "./disclosure.js";
import {
  DEFAULT_DIGEST_ALGORITHM,
  computeDisclosureDigestSync,
  normalizeDigestAlgorithm,
  type SupportedDigestAlgorithm,
} from "./digest.js";
import type { ClaimDef, CredentialTypeConfig } from "../schema/types.js";

/**
 * Options for transforming claims into an SD-JWT masked payload.
 */
export interface TransformOptions {
  /**
   * Hash algorithm matching _sd_alg in RFC 9901.
   * Defaults to "sha-256".
   */
  algorithm?: SupportedDigestAlgorithm;

  /**
   * Whether to explicitly include the "_sd_alg" property in the root masked payload.
   * Per RFC 9901 algorithm indicator rules:
   * - If algorithm is not "sha-256", _sd_alg MUST be present (enforced automatically).
   * - If algorithm is "sha-256", _sd_alg is optional and only added if this is true.
   * Default: false.
   */
  includeSdAlg?: boolean;

  /**
   * CSPRNG salt generator function producing >= 128-bit base64url salts.
   * Defaults to generateSalt().
   */
  saltGenerator?: () => string;

  /**
   * Whether to validate that claims marked "required: true" in the schema
   * are provided in the claimsData.
   * Default: true.
   */
  enforceRequired?: boolean;
}

/**
 * Result of the claims transformation pipeline.
 */
export interface TransformedClaimsResult {
  /**
   * The transformed claims payload with selectively disclosable properties replaced by
   * digests in sorted "_sd" arrays, and selectively disclosable array elements replaced by
   * "..." digest markers.
   */
  maskedPayload: Record<string, unknown>;

  /**
   * Flat array of all generated base64url disclosure strings.
   */
  disclosures: string[];
}

/**
 * Options for reconstructing claims from masked payload and disclosures.
 */
export interface ReconstructOptions {
  /**
   * Hash algorithm matching _sd_alg in RFC 9901.
   * Defaults to payload's _sd_alg if present, otherwise "sha-256".
   */
  algorithm?: SupportedDigestAlgorithm;
}

/**
 * Pure transformation function that recursively processes claims data against a credential schema.
 *
 * Requirements per RFC 9901:
 * - Selectively disclosable object claims are replaced with digests in an "_sd" array.
 * - Elements of "_sd" arrays are sorted lexicographically in Unicode code point order.
 * - Empty "_sd" arrays are omitted if no claims are disclosable.
 * - Selectively disclosable array elements are replaced with "..." digest markers.
 * - Disclosures are generated using >= 128-bit CSPRNG salts to satisfy entropy requirements.
 * - Nested objects and array elements with selective disclosure are handled recursively.
 *
 * @param claimsData Raw claims object to transform
 * @param schema Credential schema configuration or claims definition record
 * @param options Transformation options
 * @returns Masked claims payload and generated disclosure strings
 */
/**
 * Reserved SD-JWT claim/marker names prohibited anywhere in caller input claims.
 * Enforced per RFC 9901 to prevent injection
 * of counterfeit digests or array element markers in mapped or unmapped structures.
 */
export const RESERVED_SD_TRANSFORM_KEYS = ["_sd", "_sd_alg", "..."] as const;

/**
 * Recursively asserts that input data contains no reserved SD-JWT keys (_sd, _sd_alg, ...).
 * Prevents callers from smuggling fake disclosure digests or array markers into claims,
 * including nested unmapped objects and arrays.
 *
 * @param val Value to inspect
 * @param currentPath Path prefix for diagnostics
 * @throws Error if any reserved key is found
 */
export function assertNoReservedSdKeys(val: unknown, currentPath = ""): void {
  if (val === null || typeof val !== "object") {
    return;
  }
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) {
      assertNoReservedSdKeys(val[i], `${currentPath}[${i}]`);
    }
    return;
  }
  for (const [key, nestedVal] of Object.entries(val as Record<string, unknown>)) {
    const fullPath = currentPath ? `${currentPath}.${key}` : key;
    if (key === "_sd" || key === "_sd_alg" || key === "...") {
      throw new Error(
        `Input claims data must not contain reserved SD-JWT key '${key}' at path '${fullPath}'`
      );
    }
    assertNoReservedSdKeys(nestedVal, fullPath);
  }
}

export function transformClaims(
  claimsData: Record<string, unknown>,
  schema: CredentialTypeConfig | Record<string, ClaimDef>,
  options: TransformOptions = {}
): TransformedClaimsResult {
  if (
    claimsData === null ||
    typeof claimsData !== "object" ||
    Array.isArray(claimsData)
  ) {
    throw new Error("claimsData must be a non-null object");
  }

  // Recursive guard: reject _sd, _sd_alg, and ... in caller claims at any depth
  assertNoReservedSdKeys(claimsData, "");

  const claimDefs: Record<string, ClaimDef> =
    "claims" in schema &&
    typeof (schema as CredentialTypeConfig).claims === "object"
      ? (schema as CredentialTypeConfig).claims
      : (schema as Record<string, ClaimDef>);

  if (!claimDefs || typeof claimDefs !== "object") {
    throw new Error("Invalid schema: claims definition must be an object");
  }

  const algorithm = normalizeDigestAlgorithm(options.algorithm);
  const saltGen = options.saltGenerator ?? (() => generateSalt());
  const enforceRequired = options.enforceRequired !== false;

  const collectedDisclosures: string[] = [];

  const hashDisclosure = (disc: string): string =>
    computeDisclosureDigestSync(disc, algorithm);

  function transformObject(
    data: Record<string, unknown>,
    propertiesSchema: Record<string, ClaimDef> | undefined,
    currentPath: string
  ): Record<string, unknown> {
    const resultObj: Record<string, unknown> = {};
    const sdDigests: string[] = [];

    // Check required fields defined in schema
    if (propertiesSchema && enforceRequired) {
      for (const [key, def] of Object.entries(propertiesSchema)) {
        if (def.required && data[key] === undefined) {
          const fullPath = currentPath ? `${currentPath}.${key}` : key;
          throw new Error(`Missing required claim: "${fullPath}"`);
        }
      }
    }

    // Process all keys present in data
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) {
        continue;
      }

      const def = propertiesSchema?.[key];
      const fullPath = currentPath ? `${currentPath}.${key}` : key;

      // If key is not in schema, keep as plain claim (pass through)
      if (!def) {
        resultObj[key] = value;
        continue;
      }

      // Handle object claims
      if (def.type === "object") {
        if (value !== null && typeof value === "object" && !Array.isArray(value)) {
          const childTransformed = transformObject(
            value as Record<string, unknown>,
            def.properties,
            fullPath
          );

          if (def.sd === "selectively_disclosable") {
            const salt = saltGen();
            const disclosure = encodeObjectDisclosure(
              salt,
              key,
              childTransformed
            );
            collectedDisclosures.push(disclosure);
            sdDigests.push(hashDisclosure(disclosure));
          } else {
            resultObj[key] = childTransformed;
          }
        } else if (value === null) {
          if (def.sd === "selectively_disclosable") {
            const salt = saltGen();
            const disclosure = encodeObjectDisclosure(salt, key, null);
            collectedDisclosures.push(disclosure);
            sdDigests.push(hashDisclosure(disclosure));
          } else {
            resultObj[key] = null;
          }
        } else {
          throw new Error(
            `Expected object for claim "${fullPath}", received ${typeof value}`
          );
        }
        continue;
      }

      // Handle array claims
      if (def.type === "array") {
        if (!Array.isArray(value)) {
          throw new Error(
            `Expected array for claim "${fullPath}", received ${typeof value}`
          );
        }

        // Check whether array itself should be disclosed as a whole property
        // or whether its elements should be selectively disclosable
        const wholeArrayDisclosable =
          def.sd === "selectively_disclosable" &&
          def.items?.sd === "always_disclosed";

        const childTransformedArray = transformArray(value, def, fullPath);

        if (wholeArrayDisclosable) {
          const salt = saltGen();
          const disclosure = encodeObjectDisclosure(
            salt,
            key,
            childTransformedArray
          );
          collectedDisclosures.push(disclosure);
          sdDigests.push(hashDisclosure(disclosure));
        } else {
          resultObj[key] = childTransformedArray;
        }
        continue;
      }

      // Handle primitive claims (string, number, boolean)
      if (def.sd === "selectively_disclosable") {
        const salt = saltGen();
        const disclosure = encodeObjectDisclosure(salt, key, value);
        collectedDisclosures.push(disclosure);
        sdDigests.push(hashDisclosure(disclosure));
      } else {
        resultObj[key] = value;
      }
    }

    // Include sorted _sd array if disclosable claims were masked
    if (sdDigests.length > 0) {
      sdDigests.sort();
      resultObj._sd = sdDigests;
    }

    return resultObj;
  }

  function transformArray(
    arr: unknown[],
    arrayDef: ClaimDef,
    currentPath: string
  ): unknown[] {
    const isElementsSelectivelyDisclosable =
      (arrayDef.sd === "selectively_disclosable" &&
        arrayDef.items?.sd !== "always_disclosed") ||
      arrayDef.items?.sd === "selectively_disclosable";

    const itemsDef = arrayDef.items;
    const transformedList: unknown[] = [];

    for (let index = 0; index < arr.length; index++) {
      const item = arr[index];
      const itemPath = `${currentPath}[${index}]`;

      let processedItem: unknown = item;

      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        if (itemsDef?.type === "object" && itemsDef.properties) {
          processedItem = transformObject(
            item as Record<string, unknown>,
            itemsDef.properties,
            itemPath
          );
        }
      } else if (Array.isArray(item) && itemsDef?.type === "array") {
        processedItem = transformArray(item, itemsDef, itemPath);
      }

      if (isElementsSelectivelyDisclosable) {
        const salt = saltGen();
        const disclosure = encodeArrayDisclosure(salt, processedItem);
        collectedDisclosures.push(disclosure);
        const digest = hashDisclosure(disclosure);
        transformedList.push({ "...": digest });
      } else {
        transformedList.push(processedItem);
      }
    }

    return transformedList;
  }

  const maskedPayload = transformObject(claimsData, claimDefs, "");

  // Add _sd_alg if non-default algorithm or explicitly requested
  const shouldIncludeSdAlg =
    algorithm !== DEFAULT_DIGEST_ALGORITHM || options.includeSdAlg === true;
  if (shouldIncludeSdAlg) {
    maskedPayload._sd_alg = algorithm;
  }

  return {
    maskedPayload,
    disclosures: collectedDisclosures,
  };
}

/**
 * Reconstructs a full or partially disclosed claims object from a masked payload
 * and a set of presented disclosure strings per RFC 9901 claim reconstruction rules.
 *
 * @param maskedPayload The masked payload containing _sd arrays and/or ... markers
 * @param disclosures Array of base64url disclosure strings presented by the holder
 * @param options Reconstruction options
 * @returns The reconstructed claims object
 */
export function reconstructClaims(
  maskedPayload: Record<string, unknown>,
  disclosures: string[],
  options: ReconstructOptions = {}
): Record<string, unknown> {
  if (
    maskedPayload === null ||
    typeof maskedPayload !== "object" ||
    Array.isArray(maskedPayload)
  ) {
    throw new Error("maskedPayload must be a non-null object");
  }

  const algInPayload = maskedPayload._sd_alg;
  const algorithm = normalizeDigestAlgorithm(
    options.algorithm ?? algInPayload ?? DEFAULT_DIGEST_ALGORITHM
  );

  // Map each disclosure by its computed digest
  const digestMap = new Map<
    string,
    ReturnType<typeof decodeDisclosure>
  >();

  for (const disc of disclosures) {
    if (typeof disc !== "string" || disc.length === 0) {
      continue;
    }
    const decoded = decodeDisclosure(disc);
    const digest = computeDisclosureDigestSync(disc, algorithm);
    digestMap.set(digest, decoded);
  }

  function unmaskValue(val: unknown): unknown {
    if (val === null || typeof val !== "object") {
      return val;
    }

    if (Array.isArray(val)) {
      const unmaskedArray: unknown[] = [];
      for (const item of val) {
        if (
          item !== null &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          Object.keys(item).length === 1 &&
          "..." in item &&
          typeof (item as Record<string, unknown>)["..."] === "string"
        ) {
          const markerDigest = (item as Record<string, unknown>)["..."] as string;
          const matched = digestMap.get(markerDigest);
          if (matched && matched.type === "array") {
            unmaskedArray.push(unmaskValue(matched.value));
          } else {
            // Unrevealed element: preserve marker
            unmaskedArray.push(item);
          }
        } else {
          unmaskedArray.push(unmaskValue(item));
        }
      }
      return unmaskedArray;
    }

    const obj = val as Record<string, unknown>;
    const unmaskedObj: Record<string, unknown> = {};

    // Copy plain properties first
    for (const [k, v] of Object.entries(obj)) {
      if (k === "_sd" || k === "_sd_alg") {
        continue;
      }
      unmaskedObj[k] = unmaskValue(v);
    }

    // Process _sd array if present
    if (Array.isArray(obj._sd)) {
      for (const d of obj._sd) {
        if (typeof d === "string") {
          const matched = digestMap.get(d);
          if (matched && matched.type === "object") {
            if (
              matched.key === "_sd" ||
              matched.key === "..." ||
              matched.key === "_sd_alg"
            ) {
              throw new Error(
                `Invalid disclosure: claim key cannot be reserved identifier "${matched.key}"`
              );
            }
            // A disclosed claim name that already exists in the target object
            // (a cleartext claim, or another disclosure with the same name) must
            // not be assigned over the existing value.
            if (Object.prototype.hasOwnProperty.call(unmaskedObj, matched.key)) {
              throw new Error(
                `Claim collision: claim "${matched.key}" already exists in target object`
              );
            }
            unmaskedObj[matched.key] = unmaskValue(matched.value);
          }
        }
      }
    }

    return unmaskedObj;
  }

  return unmaskValue(maskedPayload) as Record<string, unknown>;
}
