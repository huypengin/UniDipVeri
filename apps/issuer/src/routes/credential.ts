import {
  issueSdJwtVc,
  type CredentialTypeConfig,
} from "@unidipveri/core";
import type { IssuerConfig } from "../config.js";
import type { SessionManager } from "../services/session-manager.js";
import type { KeyContext } from "../services/key-manager.js";
import type { StudentRecordService } from "../services/student-records.js";
import type { StatusListService } from "../services/status-list.js";
import {
  verifyHolderProof,
  InvalidProofError,
} from "../services/proof-validator.js";

/**
 * Context options passed into handleCredentialRequest.
 */
export interface HandleCredentialRequestOptions {
  config: IssuerConfig;
  sessionManager: SessionManager;
  keyContext: KeyContext;
  schemaConfig: CredentialTypeConfig;
  studentRecordsService: StudentRecordService;
  statusListService: StatusListService;
}

/**
 * Response structure returned on successful credential issuance
 * per OpenID4VCI 1.0 Final Section 7.3.
 */
export interface Oid4vciCredentialResponse {
  credential: string;
  c_nonce: string;
  c_nonce_expires_in: number;
}

/**
 * Extracts the bearer token from the Authorization header.
 */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    return null;
  }

  return parts[1];
}

/**
 * Handles incoming OpenID4VCI 1.0 Final Credential Endpoint requests (POST /credential).
 *
 * Enforces:
 * 1. Method guard (POST only).
 * 2. Bearer access token verification (validates expiration, burns/replays).
 * 3. Content-Type (application/json).
 * 4. Credential configuration identifier validation.
 * 5. Cryptographic Holder Proof-of-Possession verification.
 * 6. Dynamic c_nonce rotation on the session.
 * 7. Claims resolution (prefers session-bound custom claims, falls back to registrar repository).
 * 8. Status list revocation bit allocation.
 * 9. Core SD-JWT VC issuance with cnf.jwk and status_list claim.
 *
 * @param req Incoming HTTP Request
 * @param options Dependencies and services
 * @returns HTTP Response
 */
export async function handleCredentialRequest(
  req: Request,
  options: HandleCredentialRequestOptions
): Promise<Response> {
  const {
    config,
    sessionManager,
    keyContext,
    schemaConfig,
    studentRecordsService,
    statusListService,
  } = options;

  if (req.method !== "POST") {
    return Response.json(
      {
        error: "invalid_request",
        error_description: `Method ${req.method} not allowed on /credential`,
      },
      {
        status: 405,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Allow: "POST",
        },
      }
    );
  }

  // 1. Bearer Token Verification
  const accessToken = extractBearerToken(req);
  if (!accessToken) {
    return Response.json(
      {
        error: "invalid_token",
        error_description: "Missing or malformed Authorization header with Bearer token",
      },
      {
        status: 401,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "WWW-Authenticate": 'Bearer error="invalid_token", error_description="Missing or malformed token"',
        },
      }
    );
  }

  const session = sessionManager.getAccessTokenSession(accessToken);
  if (!session) {
    return Response.json(
      {
        error: "invalid_token",
        error_description: "The access token is expired, invalid, or has been revoked",
      },
      {
        status: 401,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "WWW-Authenticate": 'Bearer error="invalid_token", error_description="Token expired or invalid"',
        },
      }
    );
  }

  // 2. Content-Type check
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return Response.json(
      {
        error: "invalid_request",
        error_description: "Content-Type must be application/json",
      },
      {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  // 3. Body Parsing
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json(
      {
        error: "invalid_request",
        error_description: "Request body could not be parsed as JSON",
      },
      {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  // 4. Credential Configuration ID Validation
  let requestedConfigId: string | undefined = undefined;
  if (typeof body.credential_configuration_id === "string") {
    requestedConfigId = body.credential_configuration_id.trim();
  } else if (typeof body.credential_identifier === "string") {
    requestedConfigId = body.credential_identifier.trim();
  } else if (
    body.format === "dc+sd-jwt" ||
    body.format === "vc+sd-jwt" ||
    body.vct !== undefined ||
    body.credential_definition !== undefined ||
    body.types !== undefined
  ) {
    // Graceful fallback for Draft 11/13 wallets that identify credentials via format/types/vct
    requestedConfigId = session.credentialConfigurationId;
  }

  if (!requestedConfigId) {
    return Response.json(
      {
        error: "invalid_request",
        error_description: "Missing required parameter 'credential_configuration_id'",
      },
      {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  if (
    requestedConfigId !== session.credentialConfigurationId &&
    requestedConfigId !== `${session.credentialConfigurationId}_legacy`
  ) {
    return Response.json(
      {
        error: "unsupported_credential_configuration_id",
        error_description: `Requested credential configuration '${requestedConfigId}' does not match authorized configuration '${session.credentialConfigurationId}'`,
      },
      {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  // 5. Holder Proof-of-Possession Verification
  let verifiedProof;
  try {
    const validAudiences = [
      config.baseUrl,
      config.baseUrl.replace(/\/+$/, ""),
      `${config.baseUrl.replace(/\/+$/, "")}/credential`,
      config.issuerDid,
    ];

    verifiedProof = await verifyHolderProof(
      body,
      validAudiences,
      session.cNonce
    );

    console.log(
      `[Credential Endpoint ✅] Proof verified: holder alg=${verifiedProof.header.alg}, jwk=${verifiedProof.holderJwk.kty}/${verifiedProof.holderJwk.crv ?? "rsa"}, aud="${String(verifiedProof.payload.aud)}"`
    );
  } catch (err) {
    const freshNonce = sessionManager.rotateSessionNonce(accessToken);
    if (err instanceof InvalidProofError) {
      console.warn(`[Credential Endpoint ⚠️] Proof validation rejected: ${err.message}`);
      console.warn(`[Credential Endpoint ⚠️] Request body was:`, JSON.stringify(body, null, 2));
      return Response.json(
        {
          error: err.code,
          error_description: err.message,
          ...(freshNonce ? { c_nonce: freshNonce, c_nonce_expires_in: 86400 } : {}),
        },
        {
          status: 400,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        }
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Credential Endpoint ❌] Unexpected proof error: ${message}`);
    console.error(`[Credential Endpoint ❌] Request body was:`, JSON.stringify(body, null, 2));
    return Response.json(
      {
        error: "invalid_or_missing_proof",
        error_description: `Holder proof verification failed: ${message}`,
        ...(freshNonce ? { c_nonce: freshNonce, c_nonce_expires_in: 86400 } : {}),
      },
      {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  // 6. Nonce Rotation
  const proofNonce = verifiedProof.payload.nonce as string;
  const rotation = sessionManager.validateAndRotateNonce(accessToken, proofNonce);
  if (!rotation.valid || !rotation.newNonce) {
    return Response.json(
      {
        error: "invalid_nonce",
        error_description: "The c_nonce challenge is invalid or has expired",
        c_nonce: rotation.newNonce,
        c_nonce_expires_in: 86400,
      },
      {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  // 7. Resolve Academic Claims
  let rawClaims: Record<string, unknown>;
  if (session.claims && Object.keys(session.claims).length > 0) {
    rawClaims = session.claims;
  } else {
    rawClaims = studentRecordsService.getStudentRecord(session.studentId);
  }

  // 8. Allocate Status List Revocation Index
  let revocationIndex: number;
  try {
    revocationIndex = statusListService.allocateIndex();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      {
        error: "server_error",
        error_description: `Revocation engine capacity exhausted: ${message}`,
      },
      {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  const statusListUri = `${config.baseUrl}/status/status-list-1`;

  // 9. Issue SD-JWT VC via Core Engine
  try {
    const issued = await issueSdJwtVc(rawClaims, schemaConfig, {
      issuer: config.issuerDid,
      signingKey: {
        privateKey: keyContext.privateKey,
        alg: keyContext.alg,
        keyId: keyContext.keyId,
      },
      vctBaseUrl: config.vctBaseUrl,
      holderConfirmation: {
        jwk: verifiedProof.holderJwk,
      },
      status: {
        status_list: {
          idx: revocationIndex,
          uri: statusListUri,
        },
      },
      validitySeconds: 31536000, // 1 year
    });

    const responseBody: Oid4vciCredentialResponse = {
      credential: issued.compact,
      c_nonce: rotation.newNonce,
      c_nonce_expires_in: 86400,
    };

    console.log(
      `[Credential Endpoint 🎓] SD-JWT VC issued successfully: studentId="${session.studentId}", statusIndex=${revocationIndex}, disclosures=${issued.disclosures.length}`
    );

    return Response.json(responseBody, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      {
        error: "server_error",
        error_description: `Failed to issue credential: ${message}`,
      },
      {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }
}
