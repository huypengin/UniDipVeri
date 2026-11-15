import {
  type IssuerConfig,
  getEffectiveIssuer,
} from "../config.js";
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
    const effectiveIssuer = getEffectiveIssuer(config);
    const ttlSeconds = config.statusListTtlSeconds;
    const token = await statusListService.generateStatusListToken({
      issuer: effectiveIssuer,
      statusListUri,
      keyContext,
      ttlSeconds,
    });

    const cacheControl =
      ttlSeconds === 0
        ? "no-cache, no-store, must-revalidate"
        : `public, max-age=${ttlSeconds}`;

    const headers = {
      "Content-Type": STATUS_LIST_CONTENT_TYPE,
      "Cache-Control": cacheControl,
    };

    if (req.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers,
      });
    }

    return new Response(token, {
      status: 200,
      headers,
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
 * Accepts either:
 * - Direct index: { "idx": number } or { "index": number }
 * - Student ID: { "studentId": string } or { "student_id": string }
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

  // Check if studentId is provided for subject-level revocation
  const rawStudentId = body.studentId ?? body.student_id;
  if (typeof rawStudentId === "string" && rawStudentId.trim().length > 0) {
    try {
      const revokedIndices = statusListService.revokeByStudentId(rawStudentId);
      return Response.json(
        {
          status: "revoked",
          studentId: rawStudentId.trim(),
          indices: revokedIndices,
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
          error: "not_found",
          error_description: message,
        },
        {
          status: 404,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        }
      );
    }
  }

  // Fallback to index-based revocation
  const rawIdx = body.idx ?? body.index;
  if (typeof rawIdx !== "number" || !Number.isInteger(rawIdx) || rawIdx < 0) {
    return Response.json(
      {
        error: "invalid_request",
        error_description: "Parameter 'idx' (integer) or 'studentId' (string) must be provided",
      },
      {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  try {
    statusListService.revoke(rawIdx);
    const entry = statusListService.getEntryByIndex(rawIdx);
    return Response.json(
      {
        status: "revoked",
        idx: rawIdx,
        ...(entry?.studentId ? { studentId: entry.studentId } : {}),
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
 * Handles administrative status inspection by index: GET /admin/status/:idx
 */
export function handleAdminStatusQuery(
  idx: number,
  statusListService: StatusListService
): Response {
  try {
    const revoked = statusListService.isRevoked(idx);
    const entry = statusListService.getEntryByIndex(idx);
    return Response.json(
      {
        idx,
        revoked,
        status: revoked ? "revoked" : "active",
        ...(entry?.studentId
          ? {
              studentId: entry.studentId,
              allocatedAt: entry.allocatedAt,
              revokedAt: entry.revokedAt,
              metadata: entry.metadata,
            }
          : {}),
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
 * Handles administrative status query by student ID: GET /admin/status/student/:studentId
 */
export function handleAdminStudentStatusQuery(
  studentId: string,
  statusListService: StatusListService
): Response {
  const cleanId = studentId.trim();
  const entries = statusListService.getEntriesByStudentId(cleanId);
  if (entries.length === 0) {
    return Response.json(
      {
        error: "not_found",
        error_description: `No credential status records found for student ID '${cleanId}'`,
      },
      {
        status: 404,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  return Response.json(
    {
      studentId: cleanId,
      totalCredentials: entries.length,
      credentials: entries.map((entry) => ({
        index: entry.index,
        revoked: statusListService.isRevoked(entry.index),
        status: statusListService.isRevoked(entry.index) ? "revoked" : "active",
        allocatedAt: entry.allocatedAt,
        revokedAt: entry.revokedAt,
        metadata: entry.metadata,
      })),
    },
    {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }
  );
}

/**
 * Handles administrative registry catalog query: GET /admin/registry
 */
export function handleAdminRegistryQuery(
  statusListService: StatusListService
): Response {
  const entries = statusListService.getAllEntries();
  return Response.json(
    {
      totalAllocated: statusListService.allocatedCount,
      totalTracked: entries.length,
      entries: entries.map((e) => ({
        index: e.index,
        studentId: e.studentId,
        revoked: statusListService.isRevoked(e.index),
        status: statusListService.isRevoked(e.index) ? "revoked" : "active",
        allocatedAt: e.allocatedAt,
        revokedAt: e.revokedAt,
        metadata: e.metadata,
      })),
    },
    {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }
  );
}
