import type { IssuerConfig } from "../config.js";
import type { KeyContext } from "../services/key-manager.js";
import {
  STATUS_LIST_CONTENT_TYPE,
  type StatusListService,
} from "../services/status-list.js";

export const DEFAULT_STATUS_LIST_ID = "status-list-1";

/**
 * Dependencies required for status and admin revocation handlers.
 */
export interface StatusRouteOptions {
  config: IssuerConfig;
  keyContext: KeyContext;
  statusListService: StatusListService;
  statusListId?: string;
}

/**
 * Handles GET /status/:id per draft-ietf-oauth-status-list-21.
 *
 * Serves the cryptographically signed Status List Token with media type
 * application/statuslist+jwt.
 *
 * @param req Incoming Request
 * @param statusListId Identifier extracted from URL path (e.g. "status-list-1")
 * @param options Route dependencies
 * @returns HTTP Response
 */
export async function handleStatusListRequest(
  req: Request,
  statusListId: string,
  options: StatusRouteOptions
): Promise<Response> {
  const { config, keyContext, statusListService } = options;
  const activeId = options.statusListId ?? DEFAULT_STATUS_LIST_ID;

  if (req.method !== "GET" && req.method !== "HEAD") {
    return Response.json(
      {
        error: "invalid_request",
        error_description: `Method ${req.method} not allowed on status endpoint`,
      },
      {
        status: 405,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Allow: "GET, HEAD",
        },
      }
    );
  }

  if (statusListId !== activeId) {
    return Response.json(
      {
        error: "not_found",
        error_description: `Status list '${statusListId}' not found`,
      },
      {
        status: 404,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  const statusListUri = `${config.baseUrl}/status/${statusListId}`;

  try {
    const token = await statusListService.generateStatusListToken({
      issuer: config.issuerDid ?? config.baseUrl,
      statusListUri,
      keyContext,
      ttlSeconds: 300,
    });

    if (req.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: {
          "Content-Type": STATUS_LIST_CONTENT_TYPE,
          "Cache-Control": "public, max-age=300",
        },
      });
    }

    return new Response(token, {
      status: 200,
      headers: {
        "Content-Type": STATUS_LIST_CONTENT_TYPE,
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      {
        error: "server_error",
        error_description: `Failed to generate status list token: ${message}`,
      },
      {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }
}

/**
 * Handles administrative revocation requests: POST /admin/revoke
 *
 * Body format: { "idx": number } or { "index": number }
 *
 * @param req Incoming Request
 * @param statusListService Status list revocation engine
 * @returns JSON Response with updated status
 */
export async function handleAdminRevokeRequest(
  req: Request,
  statusListService: StatusListService
): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json(
      {
        error: "invalid_request",
        error_description: `Method ${req.method} not allowed on /admin/revoke`,
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

  const rawIdx = body.idx ?? body.index;
  if (typeof rawIdx !== "number" || !Number.isInteger(rawIdx) || rawIdx < 0) {
    return Response.json(
      {
        error: "invalid_request",
        error_description: "Parameter 'idx' must be a non-negative integer",
      },
      {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  try {
    statusListService.revoke(rawIdx);
    return Response.json(
      {
        status: "revoked",
        idx: rawIdx,
        revoked: true,
      },
      {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      {
        error: "invalid_request",
        error_description: message,
      },
      {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }
}

/**
 * Handles administrative status inspection: GET /admin/status/:idx
 */
export function handleAdminStatusQuery(
  idx: number,
  statusListService: StatusListService
): Response {
  try {
    const revoked = statusListService.isRevoked(idx);
    return Response.json(
      {
        idx,
        revoked,
        status: revoked ? "revoked" : "active",
      },
      {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      {
        error: "invalid_request",
        error_description: message,
      },
      {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }
}
