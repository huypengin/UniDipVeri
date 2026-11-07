import { randomUUID } from "node:crypto";

/**
 * Constructs an RFC-compliant DCQL query payload for a set of claim paths.
 */
export function buildDcqlQuery(
  targetVct: string,
  selectedPaths: Array<Array<string | number>>,
  queryId: string = randomUUID()
): Record<string, unknown> {
  return {
    credentials: [
      {
        id: queryId,
        format: "dc+sd-jwt",
        meta: {
          vct_values: [targetVct],
        },
        claims: selectedPaths.map((path) => ({ path })),
      },
    ],
  };
}

/**
 * Validates a user-supplied raw DCQL query object.
 */
export function validateDcqlQuery(query: unknown): {
  valid: boolean;
  error?: string;
  vct?: string;
  claimPaths?: string[][];
  normalizedQuery?: Record<string, unknown>;
} {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return { valid: false, error: "DCQL query must be a valid JSON object" };
  }
  const q = JSON.parse(JSON.stringify(query)) as Record<string, unknown>;
  if (!Array.isArray(q.credentials) || q.credentials.length === 0) {
    return { valid: false, error: "DCQL query must contain a non-empty 'credentials' array" };
  }
  const cred = q.credentials[0] as Record<string, unknown>;
  if (!cred || typeof cred !== "object") {
    return { valid: false, error: "Credential query entry must be an object" };
  }
  if (cred.format !== "dc+sd-jwt") {
    return { valid: false, error: "First credential query must specify format 'dc+sd-jwt'" };
  }
  if (!cred.meta || typeof cred.meta !== "object" || !Array.isArray((cred.meta as Record<string, unknown>).vct_values)) {
    return { valid: false, error: "Credential query must specify 'meta.vct_values' array" };
  }
  const vctValues = (cred.meta as Record<string, unknown>).vct_values as unknown[];
  if (vctValues.length === 0 || typeof vctValues[0] !== "string") {
    return { valid: false, error: "'meta.vct_values' must contain at least one VCT URI string" };
  }
  if (cred.claims !== undefined && !Array.isArray(cred.claims)) {
    return { valid: false, error: "'claims' must be an array of claim path objects" };
  }

  // Ensure UUID id for Walt.id verifier compatibility
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!cred.id || typeof cred.id !== "string" || !uuidRegex.test(cred.id)) {
    cred.id = randomUUID();
  }

  const claimPaths: string[][] = [];
  if (Array.isArray(cred.claims)) {
    for (const c of cred.claims) {
      if (!c || typeof c !== "object" || !Array.isArray((c as Record<string, unknown>).path)) {
        return { valid: false, error: "Each claim entry must be an object with an array 'path'" };
      }
      claimPaths.push((c as Record<string, unknown>).path as string[]);
    }
  }

  return { valid: true, vct: vctValues[0] as string, claimPaths, normalizedQuery: q };
}
