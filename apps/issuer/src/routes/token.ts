import { InvalidGrantError, type SessionManager } from "../services/session-manager.js";

/**
 * Standard grant type identifier for OpenID4VCI Pre-Authorized Code Flow.
 */
export const PRE_AUTHORIZED_CODE_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:pre-authorized_code";

/**
 * Maximum permitted size in bytes for the /token entity-body (4 KB).
 *
 * Mitigates denial-of-service and memory exhaustion from unbounded requests.
 */
export const MAX_TOKEN_REQUEST_SIZE_BYTES = 4096;

/**
 * OpenID4VCI 1.0 Final Token Response payload.
 */
export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  c_nonce: string;
  c_nonce_expires_in: number;
}

/**
 * RFC 6749 Error Response payload.
 */
export interface TokenErrorResponse {
  error: string;
  error_description?: string;
}

/**
 * Creates an RFC 6749-compliant JSON error response for token endpoint failures.
 *
 * Always attaches Cache-Control: no-store and Pragma: no-cache headers.
 */
function tokenErrorResponse(
  status: number,
  error: string,
  description: string
): Response {
  return Response.json(
    {
      error,
      error_description: description,
    },
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    }
  );
}

/**
 * Handles POST requests to the OAuth 2.0 Token endpoint (/token).
 *
 * Implements OpenID for Verifiable Credential Issuance 1.0 Final Token Response & RFC 6749 token exchange.
 *
 * Security & Protocol Controls:
 * 1. Strict Content-Type enforcement: Requires application/x-www-form-urlencoded (allowing charset suffix).
 * 2. Body size limit: Rejects payloads exceeding MAX_TOKEN_REQUEST_SIZE_BYTES (4 KB).
 * 3. Parameter uniqueness: Prohibits duplicate parameters per RFC 6749.
 * 4. Body-only parameter extraction: Ignores query string to prevent credential exposure in access logs.
 * 5. Exact grant type matching: Rejects mismatches with unsupported_grant_type.
 *
 * @param req Incoming HTTP Request
 * @param sessionManager SessionManager instance managing session lifecycle
 * @returns HTTP Response with token details or standard OAuth error envelope
 */
export async function handleTokenRequest(
  req: Request,
  sessionManager: SessionManager
): Promise<Response> {
  // Enforce HTTP POST method
  if (req.method !== "POST") {
    return tokenErrorResponse(
      405,
      "invalid_request",
      `Method ${req.method} not allowed on token endpoint; MUST be POST`
    );
  }

  // 1. Strict Content-Type check: Require application/x-www-form-urlencoded
  const contentType = req.headers.get("content-type") || "";
  const isFormUrlEncoded = /^application\/x-www-form-urlencoded(\s*;.*)?$/i.test(
    contentType.trim()
  );

  if (!isFormUrlEncoded) {
    return tokenErrorResponse(
      400,
      "invalid_request",
      "Content-Type must be application/x-www-form-urlencoded"
    );
  }

  // 2. Body size check: Verify Content-Length header if present
  const contentLengthHeader = req.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const declaredLength = parseInt(contentLengthHeader, 10);
    if (isNaN(declaredLength) || declaredLength > MAX_TOKEN_REQUEST_SIZE_BYTES) {
      return tokenErrorResponse(
        400,
        "invalid_request",
        `Request body exceeds maximum allowed size of ${MAX_TOKEN_REQUEST_SIZE_BYTES} bytes`
      );
    }
  }

  // Read raw entity body
  let rawText: string;
  try {
    rawText = await req.text();
  } catch {
    return tokenErrorResponse(
      400,
      "invalid_request",
      "Request body could not be read"
    );
  }

  // 2b. Body size check: Verify actual string byte length
  const actualByteLength = Buffer.byteLength(rawText, "utf-8");
  if (actualByteLength > MAX_TOKEN_REQUEST_SIZE_BYTES) {
    return tokenErrorResponse(
      400,
      "invalid_request",
      `Request body exceeds maximum allowed size of ${MAX_TOKEN_REQUEST_SIZE_BYTES} bytes`
    );
  }

  // Parse form-urlencoded parameters
  const params = new URLSearchParams(rawText);

  // 3. Reject duplicate parameters per RFC 6749 parameter uniqueness requirement
  for (const key of new Set(params.keys())) {
    if (params.getAll(key).length > 1) {
      return tokenErrorResponse(
        400,
        "invalid_request",
        `Duplicate parameter '${key}' is prohibited by RFC 6749`
      );
    }
  }

  // 4. Extract parameters strictly from entity-body (never query string)
  const grantType = params.get("grant_type");
  const code = params.get("pre-authorized_code");
  const txCode = params.get("tx_code") ?? undefined;

  // 5. Validate required parameter: grant_type
  if (!grantType || grantType.trim().length === 0) {
    return tokenErrorResponse(
      400,
      "invalid_request",
      "Missing required parameter 'grant_type'"
    );
  }

  if (grantType !== PRE_AUTHORIZED_CODE_GRANT_TYPE) {
    return tokenErrorResponse(
      400,
      "unsupported_grant_type",
      `Unsupported grant_type '${grantType}'. Only '${PRE_AUTHORIZED_CODE_GRANT_TYPE}' is supported`
    );
  }

  // 5b. Validate required parameter: pre-authorized_code
  if (!code || code.trim().length === 0) {
    return tokenErrorResponse(
      400,
      "invalid_request",
      "Missing required parameter 'pre-authorized_code'"
    );
  }

  // 6. Atomically exchange pre-authorized code for access token and c_nonce
  try {
    const result = sessionManager.exchangePreAuthorizedCode({
      code: code.trim(),
      txCode: txCode?.trim(),
    });

    const responseBody: TokenResponse = {
      access_token: result.accessToken,
      token_type: "Bearer",
      expires_in: result.expiresIn,
      c_nonce: result.cNonce,
      c_nonce_expires_in: result.cNonceExpiresIn,
    };

    console.log(
      `[Token Endpoint ✅] Pre-authorized code exchanged: access_token=${result.accessToken.slice(0, 10)}..., c_nonce=${result.cNonce.slice(0, 14)}... (expires in ${result.expiresIn}s)`
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
    if (err instanceof InvalidGrantError) {
      console.warn(`[Token Endpoint ⚠️] Code exchange rejected: ${err.message}`);
      return tokenErrorResponse(400, "invalid_grant", err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Token Endpoint ❌] Unexpected server error: ${message}`);
    return tokenErrorResponse(
      500,
      "server_error",
      message
    );
  }
}
