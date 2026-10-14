import type { CredentialTypeConfig } from "@unidipveri/core";
import type { IssuerConfig } from "./config.js";
import type { KeyContext } from "./services/key-manager.js";
import { SessionManager } from "./services/session-manager.js";
import { handleMetadataRequest } from "./routes/metadata.js";
import { handleDidRequest } from "./routes/did.js";
import { handleVctRequest } from "./routes/vct.js";
import { handleOfferRequest } from "./routes/offer.js";
import { handleTokenRequest } from "./routes/token.js";

/**
 * Standard CORS headers applied to all responses to support web wallets and browser verifiers.
 */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * Attaches standard CORS headers to any outgoing Response.
 *
 * @param response Raw Response object
 * @returns Modified Response with CORS headers attached
 */
export function withCors(response: Response): Response {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

/**
 * Creates the core HTTP request handler for the OID4VCI Issuer service.
 *
 * Designed as a pure function returning (req: Request) => Promise<Response>,
 * allowing direct integration with Bun.serve and unit/integration testing without network sockets.
 *
 * @param config Validated IssuerConfig
 * @param keyContext Initialized cryptographic KeyContext
 * @param schemaConfig Validated CredentialTypeConfig
 * @param sessionManager Optional SessionManager instance (defaults to new instance)
 * @returns Pure request handler function
 */
export function createApp(
  config: IssuerConfig,
  keyContext: KeyContext,
  schemaConfig: CredentialTypeConfig,
  sessionManager: SessionManager = new SessionManager()
): (req: Request) => Promise<Response> {
  const bootTimeMs = Date.now();

  return async function handleRequest(req: Request): Promise<Response> {
    try {
      // Handle CORS preflight options
      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: CORS_HEADERS,
        });
      }

      const url = new URL(req.url);
      const pathname = url.pathname.replace(/\/+$/, "") || "/";
      const method = req.method.toUpperCase();

      // Route: GET /health
      if (method === "GET" && pathname === "/health") {
        const uptimeSeconds = (Date.now() - bootTimeMs) / 1000;
        return withCors(
          Response.json(
            {
              status: "ok",
              service: "@unidipveri/issuer",
              version: "0.1.0",
              uptime: uptimeSeconds,
            },
            { status: 200 }
          )
        );
      }

      // Route: GET /.well-known/openid-credential-issuer
      if (
        method === "GET" &&
        pathname === "/.well-known/openid-credential-issuer"
      ) {
        return withCors(handleMetadataRequest(config, schemaConfig));
      }

      // Route: GET /.well-known/did.json
      if (method === "GET" && pathname === "/.well-known/did.json") {
        return withCors(handleDidRequest(config, keyContext));
      }

      // Route: GET /types/* or matching vctPath
      const vctPath = schemaConfig.vctPath.replace(/\/+$/, "");

      if (
        method === "GET" &&
        (pathname.startsWith("/types") || pathname === vctPath)
      ) {
        return withCors(
          handleVctRequest(url.pathname, schemaConfig, config.vctBaseUrl)
        );
      }

      // Route: /credential-offer (GET and POST)
      if (
        (method === "GET" || method === "POST") &&
        pathname === "/credential-offer"
      ) {
        return withCors(
          await handleOfferRequest(req, config, sessionManager, schemaConfig)
        );
      }

      // Route: /token (POST)
      if (pathname === "/token") {
        return withCors(await handleTokenRequest(req, sessionManager));
      }

      // Phase 4 stub: POST /credential
      if (method === "POST" && pathname === "/credential") {
        return withCors(
          Response.json(
            {
              error: "not_implemented",
              error_description:
                "Credential issuance endpoint is scheduled for implementation in Phase 4",
            },
            { status: 501 }
          )
        );
      }

      // 404 Route Not Found
      return withCors(
        Response.json(
          {
            error: "not_found",
            error_description: `Route '${pathname}' with method ${method} not found`,
          },
          { status: 404 }
        )
      );
    } catch (err) {
      // 500 Server Error
      return withCors(
        Response.json(
          {
            error: "server_error",
            error_description:
              err instanceof Error ? err.message : String(err),
          },
          { status: 500 }
        )
      );
    }
  };
}
