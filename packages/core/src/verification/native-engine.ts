import * as jose from "jose";
import {
  type IVerificationEngine,
  type VerificationOptions,
  type VerificationResult,
  type VerificationCheckSummary,
} from "./types.js";
import {
  DEFAULT_DIGEST_ALGORITHM,
  computeDisclosureDigestSync,
  normalizeDigestAlgorithm,
  type SupportedDigestAlgorithm,
} from "../sd-jwt/digest.js";
import { decodeDisclosure } from "../sd-jwt/disclosure.js";
import { reconstructClaims } from "../sd-jwt/transform.js";
import { resolveDidVerificationKey } from "../did/did-resolver.js";
import { verifyKeyBindingJwt } from "./kb-verifier.js";
import { checkCredentialStatus } from "./status-verifier.js";
import { RESERVED_ROOT_CLAIM_NAMES } from "../schema/validator.js";

/**
 * Standard top-level metadata claims excluded from verified business claims.
 */
const ENVELOPE_CLAIM_KEYS = new Set<string>([
  ...RESERVED_ROOT_CLAIM_NAMES,
  "jti",
  "_sd_alg",
]);

/**
 * Disallowed claim keys inside disclosures per RFC 9901 Section 4.2.1 and Section 7.1.3.
 */
const DISALLOWED_DISCLOSURE_KEYS = new Set<string>([
  ...RESERVED_ROOT_CLAIM_NAMES,
  "jti",
  "_sd",
  "_sd_alg",
  "...",
]);

/**
 * Parsed presentation wire components per RFC 9901 Section 5.
 */
interface ParsedPresentation {
  jwt: string;
  disclosures: string[];
  kbJwt?: string;
  presentationWithoutKb: string;
}

/**
 * Parses an SD-JWT presentation wire string per RFC 9901 Section 5.
 *
 * Wire formats:
 * - With disclosures, without KB: `<jwt>~<disc1>~...~<discN>~`
 * - With disclosures, with KB:    `<jwt>~<disc1>~...~<discN>~<kb-jwt>`
 * - Without disclosures, with KB: `<jwt>~<kb-jwt>`
 * - Without disclosures or KB:   `<jwt>~`
 */
function parsePresentationString(presentation: string): ParsedPresentation {
  if (typeof presentation !== "string" || presentation.trim().length === 0) {
    throw new Error("Presentation string must be a non-empty string");
  }

  const parts = presentation.split("~");
  if (parts.length < 2) {
    throw new Error(
      "Invalid SD-JWT presentation format: must contain at least one '~' separator (RFC 9901 Section 5)"
    );
  }

  const jwt = parts[0];
  if (!jwt || jwt.split(".").length !== 3) {
    throw new Error("Invalid SD-JWT presentation: first component must be a compact 3-part JWS");
  }

  let kbJwt: string | undefined;
  let presentationWithoutKb: string;
  let rawDisclosures: string[];

  if (presentation.endsWith("~")) {
    // No Key Binding JWT present
    kbJwt = undefined;
    presentationWithoutKb = presentation;
    rawDisclosures = parts.slice(1, parts.length - 1);
  } else {
    // Key Binding JWT is the last component
    kbJwt = parts[parts.length - 1];
    rawDisclosures = parts.slice(1, parts.length - 1);
    const lastTildeIdx = presentation.lastIndexOf("~");
    presentationWithoutKb = presentation.slice(0, lastTildeIdx + 1);
  }

  const disclosures = rawDisclosures.filter((d) => d.length > 0);

  return {
    jwt,
    disclosures,
    kbJwt,
    presentationWithoutKb,
  };
}

/**
 * Traverses a masked payload and presented disclosure values to collect all committed _sd and ... digests
 * per RFC 9901 Section 4.2.4 and Section 6 (Recursive Disclosures).
 */
function collectCommittedDigests(payload: unknown, disclosures: string[]): Set<string> {
  const digests = new Set<string>();

  function walk(val: unknown): void {
    if (val === null || typeof val !== "object") {
      return;
    }

    if (Array.isArray(val)) {
      for (const item of val) {
        if (
          item !== null &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          "..." in item &&
          typeof (item as Record<string, unknown>)["..."] === "string"
        ) {
          digests.add((item as Record<string, unknown>)["..."] as string);
        } else {
          walk(item);
        }
      }
      return;
    }

    const obj = val as Record<string, unknown>;
    if (Array.isArray(obj._sd)) {
      for (const d of obj._sd) {
        if (typeof d === "string") {
          digests.add(d);
        }
      }
    }

    for (const v of Object.values(obj)) {
      walk(v);
    }
  }

  // 1. Walk root masked payload
  walk(payload);

  // 2. Walk values of presented disclosures to reveal recursively committed digests (RFC 9901 Section 6)
  for (const disc of disclosures) {
    try {
      const decoded = decodeDisclosure(disc);
      walk(decoded.value);
    } catch {
      // Decoding errors will be caught in the verification loop
    }
  }

  return digests;
}

/**
 * Pure TypeScript Native Verification Engine.
 *
 * Implements full RFC 9901, draft-ietf-oauth-sd-jwt-vc-19, and draft-ietf-oauth-status-list-21
 * verification logic with raw US-ASCII disclosure digests and sub-millisecond benchmarking.
 */
export class NativeVerificationEngine implements IVerificationEngine {
  readonly engineName = "native" as const;

  async verify(
    presentation: string,
    options: VerificationOptions = {}
  ): Promise<VerificationResult> {
    const startTime = performance.now();

    const checks: VerificationCheckSummary = {
      issuerSignature: false,
      disclosureDigests: false,
      holderKeyBinding: false,
      revocationStatus: "NOT_APPLICABLE",
    };

    let parsed: ParsedPresentation;
    try {
      parsed = parsePresentationString(presentation);
    } catch (err) {
      return this.failureResult(
        err instanceof Error ? err.message : String(err),
        startTime,
        checks
      );
    }

    const { jwt, disclosures, kbJwt, presentationWithoutKb } = parsed;

    // 1. Decode outer JWS protected header and payload
    const jwtParts = jwt.split(".");
    let header: { alg?: string; typ?: string; kid?: string; [key: string]: unknown };
    let payload: Record<string, unknown>;

    try {
      header = JSON.parse(new TextDecoder().decode(jose.base64url.decode(jwtParts[0])));
      payload = JSON.parse(new TextDecoder().decode(jose.base64url.decode(jwtParts[1])));
    } catch (err) {
      return this.failureResult(
        `Failed to decode JWS header or payload: ${err instanceof Error ? err.message : String(err)}`,
        startTime,
        checks
      );
    }

    const iss = payload.iss;
    if (typeof iss !== "string" || iss.trim().length === 0) {
      return this.failureResult(
        "Missing required 'iss' claim in credential payload",
        startTime,
        checks
      );
    }

    const vct = payload.vct;
    if (typeof vct !== "string" || vct.trim().length === 0) {
      return this.failureResult(
        "Missing required 'vct' claim in credential payload (draft-ietf-oauth-sd-jwt-vc-19 Section 3.2.2.1)",
        startTime,
        checks
      );
    }

    // Check expectedIssuer
    if (options.expectedIssuer && iss !== options.expectedIssuer) {
      return this.failureResult(
        `Issuer mismatch: expected '${options.expectedIssuer}', received '${iss}'`,
        startTime,
        checks,
        iss,
        vct
      );
    }

    // Check expectedVct
    if (options.expectedVct && vct !== options.expectedVct) {
      return this.failureResult(
        `Credential type (vct) mismatch: expected '${options.expectedVct}', received '${vct}'`,
        startTime,
        checks,
        iss,
        vct
      );
    }

    // 2. Resolve Issuer Verification Key
    let issuerPublicKeyJwk: jose.JWK;
    try {
      if (options.resolveIssuerKey) {
        issuerPublicKeyJwk = await options.resolveIssuerKey(iss, header.kid);
      } else if (iss.startsWith("did:web:")) {
        const resolved = await resolveDidVerificationKey(
          iss,
          header.kid,
          options.fetchFn
        );
        issuerPublicKeyJwk = resolved.publicKeyJwk;
      } else {
        return this.failureResult(
          `No key resolver available for issuer '${iss}'`,
          startTime,
          checks,
          iss,
          vct
        );
      }
    } catch (err) {
      return this.failureResult(
        `Failed to resolve issuer key for '${iss}': ${err instanceof Error ? err.message : String(err)}`,
        startTime,
        checks,
        iss,
        vct
      );
    }

    // 3. Verify Outer JWS Signature & Expiration
    const alg = header.alg || (issuerPublicKeyJwk.alg as string) || "ES256";
    try {
      const issuerKey = await jose.importJWK(issuerPublicKeyJwk, alg);
      await jose.jwtVerify(jwt, issuerKey, {
        algorithms: [alg],
        clockTolerance: options.clockToleranceSeconds ?? 0,
      });
      checks.issuerSignature = true;
    } catch (err) {
      return this.failureResult(
        `Issuer JWS signature verification failed: ${err instanceof Error ? err.message : String(err)}`,
        startTime,
        checks,
        iss,
        vct
      );
    }

    // 4. Verify Disclosures & Digest Matching (RFC 9901 Section 4.2.3 & Section 7.1.3)
    const digestAlg = normalizeDigestAlgorithm(
      payload._sd_alg as SupportedDigestAlgorithm | undefined ?? DEFAULT_DIGEST_ALGORITHM
    );

    const committedDigests = collectCommittedDigests(payload, disclosures);
    const seenDigests = new Set<string>();

    for (const disc of disclosures) {
      // Calculate digest directly over raw US-ASCII bytes per RFC 9901 Section 4.2.3
      let digest: string;
      try {
        digest = computeDisclosureDigestSync(disc, digestAlg);
      } catch (err) {
        return this.failureResult(
          `Invalid disclosure string: ${err instanceof Error ? err.message : String(err)}`,
          startTime,
          checks,
          iss,
          vct
        );
      }

      if (seenDigests.has(digest)) {
        return this.failureResult(
          `Duplicate disclosure digest detected in presentation: '${digest}' (RFC 9901 Section 7.1.3.c.ii.1)`,
          startTime,
          checks,
          iss,
          vct
        );
      }
      seenDigests.add(digest);

      if (!committedDigests.has(digest)) {
        return this.failureResult(
          `Disclosure digest '${digest}' was not committed by issuer in credential (RFC 9901 Section 7.1.3)`,
          startTime,
          checks,
          iss,
          vct
        );
      }

      // Check decoded disclosure for forbidden reserved keys
      let decoded: ReturnType<typeof decodeDisclosure>;
      try {
        decoded = decodeDisclosure(disc);
      } catch (err) {
        return this.failureResult(
          `Failed to decode disclosure tuple: ${err instanceof Error ? err.message : String(err)}`,
          startTime,
          checks,
          iss,
          vct
        );
      }

      if (decoded.type === "object") {
        if (DISALLOWED_DISCLOSURE_KEYS.has(decoded.key)) {
          return this.failureResult(
            `Disclosure attempts to define prohibited reserved claim '${decoded.key}' (RFC 9901 Section 4.2.1)`,
            startTime,
            checks,
            iss,
            vct
          );
        }
      }
    }

    checks.disclosureDigests = true;

    // 5. Unmask and Reconstruct Claims (RFC 9901 Section 7.1)
    let reconstructed: Record<string, unknown>;
    try {
      reconstructed = reconstructClaims(payload, disclosures, {
        algorithm: digestAlg,
      });
    } catch (err) {
      return this.failureResult(
        `Failed to reconstruct claims: ${err instanceof Error ? err.message : String(err)}`,
        startTime,
        checks,
        iss,
        vct
      );
    }

    // Separate envelope metadata from verified business claims
    const verifiedClaims: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(reconstructed)) {
      if (!ENVELOPE_CLAIM_KEYS.has(k)) {
        verifiedClaims[k] = v;
      }
    }

    // Compute concealed claim digests that were not disclosed
    const concealedClaimKeys: string[] = [];
    for (const d of committedDigests) {
      if (!seenDigests.has(d)) {
        concealedClaimKeys.push(d);
      }
    }

    // 6. Holder Key Binding Verification (RFC 9901 Section 4.3)
    const cnf = payload.cnf as { jwk?: jose.JWK; kid?: string } | undefined;
    const holderJwk = cnf?.jwk;

    if (options.requireKeyBinding) {
      if (!kbJwt) {
        return this.failureResult(
          "Presentation lacks required Holder Key Binding JWT (policy enforced)",
          startTime,
          checks,
          iss,
          vct
        );
      }
      if (!holderJwk) {
        return this.failureResult(
          "Credential lacks 'cnf.jwk' claim required for Key Binding verification",
          startTime,
          checks,
          iss,
          vct
        );
      }
    }

    if (kbJwt) {
      if (!holderJwk) {
        return this.failureResult(
          "Holder Key Binding JWT was presented but credential lacks 'cnf.jwk' claim",
          startTime,
          checks,
          iss,
          vct
        );
      }

      const kbResult = await verifyKeyBindingJwt(
        kbJwt,
        presentationWithoutKb,
        holderJwk,
        {
          expectedAudience: options.expectedAudience,
          expectedNonce: options.expectedNonce,
          clockToleranceSeconds: options.clockToleranceSeconds,
          digestAlgorithm: digestAlg,
        }
      );

      if (!kbResult.valid) {
        return this.failureResult(
          `Holder Key Binding verification failed: ${kbResult.error}`,
          startTime,
          checks,
          iss,
          vct
        );
      }
      checks.holderKeyBinding = true;
    } else {
      // No KB-JWT presented and not required
      checks.holderKeyBinding = true;
    }

    // 7. Token Status List Revocation Evaluation (draft-ietf-oauth-status-list-21)
    const statusClaim = payload.status as
      | { status_list?: { uri?: string; idx?: number } }
      | undefined;
    const statusListRef = statusClaim?.status_list;

    if (statusListRef && typeof statusListRef.uri === "string" && typeof statusListRef.idx === "number") {
      if (options.checkRevocation !== false) {
        try {
          const evalResult = await checkCredentialStatus(
            { uri: statusListRef.uri, idx: statusListRef.idx },
            {
              resolveIssuerKey: options.resolveIssuerKey,
              clockToleranceSeconds: options.clockToleranceSeconds,
              fetchFn: options.fetchFn,
            }
          );

          checks.revocationStatus = evalResult.status;
          if (evalResult.revoked) {
            return this.failureResult(
              "Credential has been revoked by the issuer (Token Status List bit is 1)",
              startTime,
              checks,
              iss,
              vct
            );
          }
        } catch (err) {
          checks.revocationStatus = "UNKNOWN";
          return this.failureResult(
            `Status List verification failed: ${err instanceof Error ? err.message : String(err)}`,
            startTime,
            checks,
            iss,
            vct
          );
        }
      } else {
        checks.revocationStatus = "UNKNOWN";
      }
    } else {
      checks.revocationStatus = "NOT_APPLICABLE";
    }

    const executionTimeMs = Number((performance.now() - startTime).toFixed(3));

    return {
      valid: true,
      engine: this.engineName,
      executionTimeMs,
      issuer: iss,
      vct,
      checks,
      verifiedClaims,
      concealedClaimKeys,
      holderJwk,
    };
  }

  private failureResult(
    error: string,
    startTime: number,
    checks: VerificationCheckSummary,
    issuer = "unknown",
    vct = "unknown"
  ): VerificationResult {
    return {
      valid: false,
      engine: this.engineName,
      executionTimeMs: Number((performance.now() - startTime).toFixed(3)),
      issuer,
      vct,
      checks,
      verifiedClaims: {},
      concealedClaimKeys: [],
      error,
    };
  }
}
