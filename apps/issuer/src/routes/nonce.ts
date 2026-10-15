import type { SessionManager } from "../services/session-manager.js";

/**
 * Handles incoming requests to the OpenID4VCI 1.0 Final Nonce Endpoint (POST /nonce)
 * conforming to Section 7.
 *
 * Provides a fresh c_nonce challenge to digital wallets prior to proof construction.
 *
 * @param req Incoming HTTP Request
 * @param sessionManager SessionManager instance
 * @returns HTTP Response with fresh c_nonce payload
 */
export function handleNonceRequest(
  req: Request,
  sessionManager: SessionManager
): Response {
  if (req.method !== "POST") {
    return Response.json(
      {
        error: "invalid_request",
        error_description: `Method ${req.method} not allowed on /nonce; MUST be POST`,
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

  const nonce = sessionManager.generateStandaloneNonce();

  return Response.json(
    {
      c_nonce: nonce.cNonce,
      c_nonce_expires_in: nonce.cNonceExpiresIn,
    },
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    }
  );
}
