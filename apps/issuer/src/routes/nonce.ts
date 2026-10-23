import { SessionManager, DEFAULT_C_NONCE_TTL_SECONDS } from "../services/session-manager.js";

/**
 * Handles incoming requests to the OpenID4VCI 1.0 Final Nonce Endpoint (POST /nonce)
 * conforming to OpenID4VCI 1.0 Final nonce endpoint requirements.
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

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  let bearerToken: string | undefined;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    bearerToken = authHeader.slice(7).trim();
  }

  let cNonce: string;
  let cNonceExpiresIn = DEFAULT_C_NONCE_TTL_SECONDS;

  if (bearerToken) {
    const rotated = sessionManager.rotateSessionNonce(bearerToken);
    if (rotated) {
      cNonce = rotated;
    } else {
      const standalone = sessionManager.generateStandaloneNonce();
      cNonce = standalone.cNonce;
      cNonceExpiresIn = standalone.cNonceExpiresIn;
    }
  } else {
    const standalone = sessionManager.generateStandaloneNonce();
    cNonce = standalone.cNonce;
    cNonceExpiresIn = standalone.cNonceExpiresIn;
  }

  return Response.json(
    {
      c_nonce: cNonce,
      c_nonce_expires_in: cNonceExpiresIn,
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
