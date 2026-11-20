import type { CredentialTypeConfig } from "@unidipveri/core";
import type { IssuerConfig } from "./config.js";
import type { KeyContext } from "./services/key-manager.js";
import { SessionManager } from "./services/session-manager.js";
import { StudentRecordService } from "./services/student-records.js";
import { StatusListService } from "./services/status-list.js";
import { writeIssuerLog } from "./services/logger.js";
import { handleMetadataRequest, handleOAuthMetadataRequest } from "./routes/metadata.js";
import { handleDidRequest } from "./routes/did.js";
import { handleJwtVcIssuerRequest } from "./routes/jwt-vc-issuer.js";
import { handleVctRequest } from "./routes/vct.js";
import { handleOfferRequest } from "./routes/offer.js";
import { handleTokenRequest } from "./routes/token.js";
import { handleCredentialRequest } from "./routes/credential.js";
import { handleNonceRequest } from "./routes/nonce.js";
import {
  handleStatusListRequest,
  handleAdminRevokeRequest,
  handleAdminStatusQuery,
  handleAdminStudentStatusQuery,
  handleAdminRegistryQuery,
} from "./routes/status.js";
import { handleInteractiveRequest, handleStyleCssRequest } from "./routes/interactive.js";
import { handleBatchRequest } from "./routes/batch.js";
import { handleDocsRequest } from "./routes/docs.js";

/**
 * Standard CORS headers applied to all responses to support web wallets and browser verifiers.
 */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD",
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
 * @param sessionManager SessionManager instance (defaults to new instance)
 * @param studentRecordsService StudentRecordService repository (defaults to new instance)
 * @param statusListService StatusListService revocation engine (defaults to new instance)
 * @returns Pure request handler function
 */
export function createApp(
  config: IssuerConfig,
  keyContext: KeyContext,
  schemaConfig: CredentialTypeConfig,
  sessionManager: SessionManager = new SessionManager(),
  studentRecordsService: StudentRecordService = new StudentRecordService(),
  statusListService: StatusListService = new StatusListService()
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
      const startMs = performance.now();
      const userAgent = req.headers.get("user-agent") || "unknown";

      if (pathname !== "/health") {
        writeIssuerLog(`[UniDipVeri] --> ${method} ${pathname}${url.search ? url.search : ""} (Agent: ${userAgent})`);
      }

      const respond = async (res: Response | Promise<Response>): Promise<Response> => {
        const response = await res;
        if (pathname !== "/health") {
          const durationMs = Math.round(performance.now() - startMs);
          const symbol = response.status >= 400 ? "⚠️" : "✅";
          writeIssuerLog(`[UniDipVeri] <-- ${symbol} ${response.status} ${method} ${pathname} (${durationMs}ms)`);
        }
        return withCors(response);
      };

      // Route: Redirect root / to /interactive-issue
      if ((method === "GET" || method === "HEAD") && pathname === "/") {
        return respond(
          Response.redirect(`${config.baseUrl.replace(/\/+$/, "")}/interactive-issue`, 302)
        );
      }

      // Route: GET /interactive-issue (Interactive Registrar Form)
      if ((method === "GET" || method === "HEAD") && pathname === "/interactive-issue") {
        return respond(handleInteractiveRequest(req, config, schemaConfig));
      }

      // Route: GET /style.css and GET /styles/style.css (Dedicated Shared Stylesheet)
      if (
        (method === "GET" || method === "HEAD") &&
        (pathname === "/style.css" || pathname === "/styles/style.css")
      ) {
        return respond(handleStyleCssRequest(req));
      }

      // Route: GET /batch-issue and POST /batch-issue (Batch Credential Issuance Pipeline)
      if (pathname === "/batch-issue") {
        return respond(
          handleBatchRequest(req, {
            config,
            keyContext,
            schemaConfig,
            sessionManager,
            statusListService,
          })
        );
      }

      // Route: GET /docs, GET /swagger, GET /docs/openapi.json
      if (
        (method === "GET" || method === "HEAD") &&
        (pathname === "/docs" || pathname === "/swagger" || pathname === "/docs/openapi.json")
      ) {
        return respond(handleDocsRequest(req, config, schemaConfig));
      }

      // Route: GET /health
      if (method === "GET" && pathname === "/health") {
        const uptimeSeconds = (Date.now() - bootTimeMs) / 1000;
        return respond(
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
        return respond(handleMetadataRequest(config, schemaConfig));
      }

      // Route: GET /.well-known/oauth-authorization-server, GET /.well-known/openid-configuration
      if (
        method === "GET" &&
        (pathname === "/.well-known/oauth-authorization-server" ||
          pathname === "/.well-known/openid-configuration")
      ) {
        return respond(handleOAuthMetadataRequest(config));
      }

      // Route: GET /.well-known/did.json or /did.json (supports root and subpath did:web)
      if (
        (method === "GET" || method === "HEAD") &&
        (pathname === "/.well-known/did.json" || pathname === "/did.json")
      ) {
        return respond(handleDidRequest(config, keyContext));
      }

      // Route: GET /.well-known/jwt-vc-issuer
      if (
        (method === "GET" || method === "HEAD") &&
        pathname === "/.well-known/jwt-vc-issuer"
      ) {
        return respond(handleJwtVcIssuerRequest(config, keyContext));
      }

      // Route: GET /types/* or matching vctPath
      const vctPath = schemaConfig.vctPath.replace(/\/+$/, "");

      if (
        method === "GET" &&
        (pathname.startsWith("/types") || pathname === vctPath)
      ) {
        return respond(
          handleVctRequest(url.pathname, schemaConfig, config.vctBaseUrl)
        );
      }

      // Route: /credential-offer (GET and POST)
      if (
        (method === "GET" || method === "POST") &&
        pathname === "/credential-offer"
      ) {
        return respond(
          handleOfferRequest(req, config, sessionManager, schemaConfig)
        );
      }

      // Route: /token (POST)
      if (pathname === "/token") {
        return respond(handleTokenRequest(req, sessionManager));
      }

      // Route: /nonce (POST)
      if (pathname === "/nonce") {
        return respond(handleNonceRequest(req, sessionManager));
      }

      // Route: /credential (POST)
      if (pathname === "/credential") {
        return respond(
          handleCredentialRequest(req, {
            config,
            sessionManager,
            keyContext,
            schemaConfig,
            studentRecordsService,
            statusListService,
          })
        );
      }

      // Route: GET /status/:id
      if (pathname.startsWith("/status/")) {
        const statusId = pathname.slice("/status/".length);
        return respond(
          handleStatusListRequest(req, statusId, {
            config,
            keyContext,
            statusListService,
          })
        );
      }

      // Route: POST /admin/revoke
      if (pathname === "/admin/revoke") {
        return respond(handleAdminRevokeRequest(req, statusListService));
      }

      // Route: GET /admin/registry
      if (pathname === "/admin/registry") {
        return respond(handleAdminRegistryQuery(statusListService));
      }

      // Route: GET /admin/status/student/:studentId
      if (pathname.startsWith("/admin/status/student/")) {
        const studentId = pathname.slice("/admin/status/student/".length);
        return respond(
          handleAdminStudentStatusQuery(decodeURIComponent(studentId), statusListService)
        );
      }

      // Route: GET /admin/status?studentId=...
      if (pathname === "/admin/status") {
        const studentId =
          url.searchParams.get("studentId") ?? url.searchParams.get("student_id");
        if (studentId) {
          return respond(
            handleAdminStudentStatusQuery(studentId, statusListService)
          );
        }
      }

      // Route: GET /admin/status/:idx
      if (pathname.startsWith("/admin/status/")) {
        const idxStr = pathname.slice("/admin/status/".length);
        const idx = parseInt(idxStr, 10);
        return respond(handleAdminStatusQuery(idx, statusListService));
      }

      // 404 Route Not Found
      return respond(
        Response.json(
          {
            error: "not_found",
            error_description: `Route ${pathname} not found on this issuer`,
          },
          { status: 404 }
        )
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[UniDipVeri ❌] Unhandled server error: ${message}`);
      return withCors(
        Response.json(
          {
            error: "server_error",
            error_description: `Unhandled issuer internal error: ${message}`,
          },
          { status: 500 }
        )
      );
    }
  };
}
