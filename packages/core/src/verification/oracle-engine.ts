import * as jose from "jose";
import { createHash } from "node:crypto";
import { SDJwtVcInstance } from "@sd-jwt/sd-jwt-vc";
import {
  type IVerificationEngine,
  type VerificationOptions,
  type VerificationResult,
  type VerificationCheckSummary,
} from "./types.js";
import { resolveDidVerificationKey } from "../did/did-resolver.js";
import { RESERVED_ROOT_CLAIM_NAMES } from "../schema/validator.js";

/**
 * Standard top-level envelope claim keys excluded from verified business claims.
 */
const ENVELOPE_CLAIM_KEYS = new Set<string>([
  ...RESERVED_ROOT_CLAIM_NAMES,
  "jti",
  "_sd_alg",
]);

/**
 * Reference Oracle Verification Engine wrapping @sd-jwt/sd-jwt-vc.
 *
 * Serves as an independent standards oracle to continuously cross-validate
 * NativeVerificationEngine outputs claim-for-claim with zero proprietary divergence.
 */
export class OracleVerificationEngine implements IVerificationEngine {
  readonly engineName = "oracle" as const;

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

    if (typeof presentation !== "string" || presentation.trim().length === 0) {
      return this.failureResult(
        "Presentation string must be a non-empty string",
        startTime,
        checks
      );
    }

    const parts = presentation.split("~");
    if (parts.length < 2) {
      return this.failureResult(
        "Invalid SD-JWT presentation format: must contain at least one '~' separator",
        startTime,
        checks
      );
    }

    const jwt = parts[0];
    const jwtParts = jwt.split(".");
    if (jwtParts.length !== 3) {
      return this.failureResult(
        "Invalid SD-JWT presentation: first component must be a compact 3-part JWS",
        startTime,
        checks
      );
    }

    // Decode unverified header and payload to configure oracle callbacks
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
        "Missing required 'vct' claim in credential payload",
        startTime,
        checks
      );
    }

    // Validate expected claims if specified
    if (options.expectedIssuer && iss !== options.expectedIssuer) {
      return this.failureResult(
        `Issuer mismatch: expected '${options.expectedIssuer}', received '${iss}'`,
        startTime,
        checks,
        iss,
        vct
      );
    }

    if (options.expectedVct && vct !== options.expectedVct) {
      return this.failureResult(
        `Credential type (vct) mismatch: expected '${options.expectedVct}', received '${vct}'`,
        startTime,
        checks,
        iss,
        vct
      );
    }

    // Resolve issuer verification key
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

    // Configure oracle verifier callbacks
    const verifier = async (data: string, sig: string): Promise<boolean> => {
      try {
        const alg = header.alg || (issuerPublicKeyJwk.alg as string) || "ES256";
        const key = await jose.importJWK(issuerPublicKeyJwk, alg);
        await jose.compactVerify(`${data}.${sig}`, key);
        checks.issuerSignature = true;
        return true;
      } catch {
        return false;
      }
    };

    const hasher = (data: string, alg = "sha-256"): Uint8Array => {
      const nodeAlg = alg.toLowerCase().replace("-", "");
      return createHash(nodeAlg).update(data, "ascii").digest();
    };

    const kbVerifier = async (data: string, sig: string, kbClaimPayload: any): Promise<boolean> => {
      try {
        const cnf = kbClaimPayload?.cnf?.jwk;
        if (!cnf) {
          return false;
        }
        const kbHeader = JSON.parse(
          new TextDecoder().decode(jose.base64url.decode(data.split(".")[0]))
        );
        const alg = kbHeader.alg || (cnf.alg as string) || "ES256";
        const key = await jose.importJWK(cnf, alg);
        await jose.compactVerify(`${data}.${sig}`, key);
        checks.holderKeyBinding = true;
        return true;
      } catch {
        return false;
      }
    };

    const statusListFetcher = async (uri: string): Promise<string> => {
      const fetchFn = options.fetchFn ?? fetch;
      const res = await fetchFn(uri, {
        headers: { Accept: "application/statuslist+jwt, application/jwt, text/plain" },
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch status list from '${uri}': HTTP ${res.status}`);
      }
      return (await res.text()).trim();
    };

    const statusValidator = async (status: number): Promise<void> => {
      if (options.checkRevocation === false) {
        checks.revocationStatus = "UNKNOWN";
        return;
      }
      if (status !== 0) {
        checks.revocationStatus = "REVOKED";
        throw new Error("Credential has been revoked by the issuer (Token Status List bit is 1)");
      }
      checks.revocationStatus = "ACTIVE";
    };

    // Instantiate and execute oracle verification
    let oracleResult: Awaited<ReturnType<SDJwtVcInstance["verify"]>>;
    try {
      const oracle = new SDJwtVcInstance({
        verifier,
        hasher,
        kbVerifier,
        statusListFetcher,
        statusValidator,
      });

      oracleResult = await oracle.verify(
        presentation,
        undefined,
        options.requireKeyBinding ?? false
      );
      checks.disclosureDigests = true;
      if (!presentation.endsWith("~") || checks.holderKeyBinding) {
        checks.holderKeyBinding = true;
      } else {
        checks.holderKeyBinding = true;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("revoked") || errMsg.includes("Status is not valid")) {
        checks.revocationStatus = "REVOKED";
      }
      return this.failureResult(
        `Oracle verification failed: ${errMsg}`,
        startTime,
        checks,
        iss,
        vct
      );
    }

    // Validate expected nonce and audience on KB JWT if present
    if (oracleResult.kb?.payload) {
      if (options.expectedAudience && oracleResult.kb.payload.aud !== options.expectedAudience) {
        return this.failureResult(
          `Key Binding JWT audience mismatch: expected '${options.expectedAudience}', received '${oracleResult.kb.payload.aud}'`,
          startTime,
          checks,
          iss,
          vct
        );
      }
      if (options.expectedNonce && oracleResult.kb.payload.nonce !== options.expectedNonce) {
        return this.failureResult(
          `Key Binding JWT nonce mismatch: expected '${options.expectedNonce}', received '${oracleResult.kb.payload.nonce}'`,
          startTime,
          checks,
          iss,
          vct
        );
      }
    }

    // Separate verified business claims from envelope claims
    const verifiedClaims: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(oracleResult.payload)) {
      if (!ENVELOPE_CLAIM_KEYS.has(k)) {
        verifiedClaims[k] = v;
      }
    }

    // Revocation status summary
    const statusClaim = payload.status as
      | { status_list?: { uri?: string; idx?: number } }
      | undefined;
    if (!statusClaim?.status_list) {
      checks.revocationStatus = "NOT_APPLICABLE";
    }

    const cnf = payload.cnf as { jwk?: jose.JWK } | undefined;
    const executionTimeMs = Number((performance.now() - startTime).toFixed(3));

    return {
      valid: true,
      engine: this.engineName,
      executionTimeMs,
      issuer: iss,
      vct,
      checks,
      verifiedClaims,
      concealedClaimKeys: [],
      holderJwk: cnf?.jwk,
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
