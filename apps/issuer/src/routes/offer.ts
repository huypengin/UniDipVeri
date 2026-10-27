import type { CredentialTypeConfig } from "@unidipveri/core";
import type { IssuerConfig } from "../config.js";
import type { SessionManager } from "../services/session-manager.js";
import { writeIssuerLog } from "../services/logger.js";

/**
 * OpenID4VCI 1.0 Final Credential Offer parameters.
 */
export interface Oid4vciCredentialOffer {
  credential_issuer: string;
  credential_configuration_ids: string[];
  credentials?: string[];
  grants: {
    "urn:ietf:params:oauth:grant-type:pre-authorized_code": {
      "pre-authorized_code": string;
      tx_code?: {
        input_mode: "numeric" | "text";
        length?: number;
        description?: string;
      };
    };
  };
}

/**
 * Complete JSON response returned by the /credential-offer endpoint.
 */
export interface CredentialOfferResponse {
  credential_offer: Oid4vciCredentialOffer;
  credential_offer_uri: string;
  expires_in: number;
}

/**
 * Default credential configuration ID used for the academic graduation record.
 */
export const DEFAULT_CREDENTIAL_CONFIG_ID = "graduation_record_sd_jwt_vc";

/**
 * Handles GET and POST requests for /credential-offer.
 *
 * Implements OpenID for Verifiable Credential Issuance 1.0 Final Credential Offer endpoint.
 *
 * @param req Incoming HTTP Request
 * @param config Validated IssuerConfig (source of truth for base URLs)
 * @param sessionManager SessionManager instance tracking pre-authorized codes
 * @param _schemaConfig Validated CredentialTypeConfig
 * @returns HTTP Response with Credential Offer JSON and custom URI
 */
export async function handleOfferRequest(
  req: Request,
  config: IssuerConfig,
  sessionManager: SessionManager,
  _schemaConfig: CredentialTypeConfig
): Promise<Response> {
  let studentId: string | null = null;
  let credentialConfigurationId: string | null = null;
  let txCode: string | undefined = undefined;
  let claims: Record<string, unknown> | undefined = undefined;

  const url = new URL(req.url);

  if (req.method === "GET") {
    studentId = url.searchParams.get("studentId");
    credentialConfigurationId =
      url.searchParams.get("credential_configuration_id") ??
      url.searchParams.get("credentialConfigurationId");
    txCode = url.searchParams.get("tx_code") ?? url.searchParams.get("txCode") ?? undefined;
  } else if (req.method === "POST") {
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      try {
        const body = (await req.json()) as Record<string, unknown>;
        if (typeof body.studentId === "string") studentId = body.studentId;
        if (typeof body.credential_configuration_id === "string") {
          credentialConfigurationId = body.credential_configuration_id;
        } else if (typeof body.credentialConfigurationId === "string") {
          credentialConfigurationId = body.credentialConfigurationId;
        }
        if (typeof body.tx_code === "string") {
          txCode = body.tx_code;
        } else if (typeof body.txCode === "string") {
          txCode = body.txCode;
        }
        if (
          body.claims &&
          typeof body.claims === "object" &&
          !Array.isArray(body.claims)
        ) {
          claims = body.claims as Record<string, unknown>;
        }
      } catch {
        return Response.json(
          {
            error: "invalid_request",
            error_description: "Request body could not be parsed as JSON",
          },
          { status: 400 }
        );
      }
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      try {
        const text = await req.text();
        const params = new URLSearchParams(text);
        studentId = params.get("studentId");
        credentialConfigurationId =
          params.get("credential_configuration_id") ??
          params.get("credentialConfigurationId");
        txCode =
          params.get("tx_code") ??
          params.get("txCode") ??
          undefined;
      } catch {
        return Response.json(
          {
            error: "invalid_request",
            error_description: "Request body could not be parsed as form data",
          },
          { status: 400 }
        );
      }
    } else {
      // Fallback to URL search params if present even on POST
      studentId = url.searchParams.get("studentId");
      credentialConfigurationId =
        url.searchParams.get("credential_configuration_id") ??
        url.searchParams.get("credentialConfigurationId");
      txCode = url.searchParams.get("tx_code") ?? url.searchParams.get("txCode") ?? undefined;
    }
  } else {
    return Response.json(
      {
        error: "invalid_request",
        error_description: `Method ${req.method} not allowed on /credential-offer`,
      },
      { status: 405 }
    );
  }

  // Validate studentId
  if (!studentId || studentId.trim().length === 0) {
    return Response.json(
      {
        error: "invalid_request",
        error_description: "Missing required parameter 'studentId'",
      },
      { status: 400 }
    );
  }

  // Determine credential configuration identifier
  const legacyConfigId = `${DEFAULT_CREDENTIAL_CONFIG_ID}_legacy`;
  const targetConfigId =
    credentialConfigurationId && credentialConfigurationId.trim().length > 0
      ? credentialConfigurationId.trim()
      : DEFAULT_CREDENTIAL_CONFIG_ID;

  if (targetConfigId !== DEFAULT_CREDENTIAL_CONFIG_ID && targetConfigId !== legacyConfigId) {
    return Response.json(
      {
        error: "invalid_request",
        error_description: `Unsupported credential_configuration_id '${targetConfigId}'`,
      },
      { status: 400 }
    );
  }

  // Create pre-authorized code session
  const session = sessionManager.createPreAuthorizedCode({
    studentId: studentId.trim(),
    credentialConfigurationId: targetConfigId,
    txCode: txCode?.trim(),
    claims,
  });

  // Construct OpenID4VCI 1.0 Final Credential Offer structure
  const credentialOffer: Oid4vciCredentialOffer = {
    // Strictly isolate from incoming Host header (using config.baseUrl)
    credential_issuer: config.baseUrl,
    credential_configuration_ids: [targetConfigId],
    credentials: [targetConfigId],
    grants: {
      "urn:ietf:params:oauth:grant-type:pre-authorized_code": {
        "pre-authorized_code": session.code,
        ...(session.txCode
          ? {
              tx_code: {
                input_mode: "numeric",
                length: session.txCode.length,
                description: "Please enter the transaction PIN provided by your university",
              },
            }
          : {}),
      },
    },
  };

  // Construct custom URI scheme for QR scanning
  const serializedOffer = JSON.stringify(credentialOffer);
  const credentialOfferUri = `openid-credential-offer://?credential_offer=${encodeURIComponent(
    serializedOffer
  )}`;

  const responseBody: CredentialOfferResponse = {
    credential_offer: credentialOffer,
    credential_offer_uri: credentialOfferUri,
    expires_in: Math.floor((session.expiresAt - session.createdAt) / 1000),
  };

  writeIssuerLog(
    `[Offer Endpoint ✅] Generated credential offer: studentId="${studentId}", config="${targetConfigId}", code=${session.code.slice(0, 10)}... (PIN: ${session.txCode ?? "none"})`
  );

  return Response.json(responseBody, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}
