import type { PlaygroundConfig } from "./server.js";

/**
 * Metadata representation of an individual claim discovered from the credential Type Metadata.
 */
export interface DiscoveredClaim {
  path: Array<string | number>;
  pathKey: string;
  label: string;
  category: string;
  description?: string;
  sdPolicy: "selectively_disclosable" | "always_disclosed";
  sd?: "always" | "allowed" | "never";
  mandatory: boolean;
}

/**
 * Discovery response payload representing the discovered schema fields from the Issuer.
 */
export interface PlaygroundDiscoveryResult {
  vct: string;
  credentialName: string;
  claims: DiscoveredClaim[];
}

/**
 * Fallback claims matching the reference graduation-record.v1.yaml credential.
 * Used if the issuer Type Metadata endpoint is temporarily unreachable.
 */
export const FALLBACK_DISCOVERED_CLAIMS: DiscoveredClaim[] = [
  {
    path: ["studentId"],
    pathKey: "studentId",
    label: "Student ID",
    category: "General",
    description: "Internal university student identifier",
    sdPolicy: "always_disclosed",
    sd: "never",
    mandatory: true,
  },
  {
    path: ["fullName"],
    pathKey: "fullName",
    label: "Full Name",
    category: "General",
    description: "Full legal student name",
    sdPolicy: "always_disclosed",
    sd: "never",
    mandatory: true,
  },
  {
    path: ["dateOfBirth"],
    pathKey: "dateOfBirth",
    label: "Date Of Birth",
    category: "General",
    description: "Date of birth (YYYY-MM-DD)",
    sdPolicy: "selectively_disclosable",
    sd: "always",
    mandatory: false,
  },
  {
    path: ["nationalId"],
    pathKey: "nationalId",
    label: "National ID",
    category: "General",
    description: "National ID / citizen number",
    sdPolicy: "selectively_disclosable",
    sd: "always",
    mandatory: false,
  },
  {
    path: ["papers", "diploma", "degreeName"],
    pathKey: "papers.diploma.degreeName",
    label: "Degree Name",
    category: "Papers › Diploma",
    description: "Conferred degree title",
    sdPolicy: "always_disclosed",
    sd: "never",
    mandatory: true,
  },
  {
    path: ["papers", "diploma", "degreeType"],
    pathKey: "papers.diploma.degreeType",
    label: "Degree Type",
    category: "Papers › Diploma",
    description: "Degree classification",
    sdPolicy: "selectively_disclosable",
    sd: "always",
    mandatory: true,
  },
  {
    path: ["papers", "diploma", "programName"],
    pathKey: "papers.diploma.programName",
    label: "Program Name",
    category: "Papers › Diploma",
    description: "Academic major/program",
    sdPolicy: "selectively_disclosable",
    sd: "always",
    mandatory: true,
  },
  {
    path: ["papers", "diploma", "major"],
    pathKey: "papers.diploma.major",
    label: "Major",
    category: "Papers › Diploma",
    description: "Primary academic major",
    sdPolicy: "selectively_disclosable",
    sd: "always",
    mandatory: true,
  },
  {
    path: ["papers", "diploma", "minor"],
    pathKey: "papers.diploma.minor",
    label: "Minor",
    category: "Papers › Diploma",
    description: "Secondary academic minor",
    sdPolicy: "selectively_disclosable",
    sd: "always",
    mandatory: false,
  },
  {
    path: ["papers", "diploma", "graduationDate"],
    pathKey: "papers.diploma.graduationDate",
    label: "Graduation Date",
    category: "Papers › Diploma",
    description: "Official graduation conferral date",
    sdPolicy: "always_disclosed",
    sd: "never",
    mandatory: true,
  },
  {
    path: ["papers", "diploma", "honours"],
    pathKey: "papers.diploma.honours",
    label: "Honours",
    category: "Papers › Diploma",
    description: "Honours classification",
    sdPolicy: "selectively_disclosable",
    sd: "always",
    mandatory: false,
  },
  {
    path: ["papers", "transcript", "transcriptId"],
    pathKey: "papers.transcript.transcriptId",
    label: "Transcript ID",
    category: "Papers › Transcript",
    description: "Official transcript serial number",
    sdPolicy: "always_disclosed",
    sd: "never",
    mandatory: true,
  },
  {
    path: ["papers", "transcript", "cumulativeGPA"],
    pathKey: "papers.transcript.cumulativeGPA",
    label: "Cumulative GPA",
    category: "Papers › Transcript",
    description: "Final cumulative GPA",
    sdPolicy: "selectively_disclosable",
    sd: "always",
    mandatory: false,
  },
  {
    path: ["papers", "transcript", "totalCredits"],
    pathKey: "papers.transcript.totalCredits",
    label: "Total Credits",
    category: "Papers › Transcript",
    description: "Total completed academic credits",
    sdPolicy: "selectively_disclosable",
    sd: "always",
    mandatory: false,
  },
];

/**
 * Formats a camelCase or snake_case key into a clean title.
 */
export function formatClaimLabel(key: string): string {
  const acronyms: Record<string, string> = {
    id: "ID",
    gpa: "GPA",
    url: "URL",
    uri: "URI",
    dob: "DOB",
    vc: "VC",
  };

  const words = key
    .replace(/([A-Z]+)/g, " $1")
    .trim()
    .split(/[\s_]+/);

  return words
    .map((word) => {
      const lower = word.toLowerCase();
      if (acronyms[lower]) {
        return acronyms[lower];
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * Determines whether a claim path represents a leaf claim within a collection of paths.
 * A path is a leaf claim if no other path in the collection has this path as a strict prefix.
 *
 * @param path The candidate claim path.
 * @param allPaths All candidate paths to compare against (including wildcard array paths).
 * @returns True if the path is a leaf claim; false if it is a container / parent path.
 */
export function isLeafClaimPath(
  path: Array<string | number>,
  allPaths: Array<Array<string | number | null>>
): boolean {
  if (path.length === 0) return false;
  return !allPaths.some(
    (other) =>
      other.length > path.length &&
      path.every((segment, idx) => segment === other[idx])
  );
}

/**
 * Derives a human-friendly display group category dynamically from a claim path hierarchy.
 * Top-level claims are grouped under "General", while nested claims derive their category
 * from their parent path segment hierarchy.
 *
 * @param path The claim path segments.
 * @returns Human-friendly display category name.
 */
export function categorizeClaimPath(path: Array<string | number | null>): string {
  if (path.length <= 1) return "General";

  const parentSegments = path
    .slice(0, -1)
    .filter((s): s is string => typeof s === "string" && s.length > 0);

  if (parentSegments.length === 0) {
    return "General";
  }

  return parentSegments.map((s) => formatClaimLabel(s)).join(" › ");
}

/**
 * Resolves the credential schema and disclosable claims by querying the active Issuer service.
 * Falls back to built-in academic credential defaults if the issuer is not yet reachable.
 */
export async function resolveDiscoveryMetadata(
  config: PlaygroundConfig
): Promise<PlaygroundDiscoveryResult> {
  let targetVct = config.vctUrl;
  let credentialName = "Graduation Academic Record";
  let discoveredClaims: DiscoveredClaim[] = [];

  try {
    // 1. Fetch OID4VCI discovery
    const discoveryRes = await fetch(
      `${config.issuerBaseUrl}/.well-known/openid-credential-issuer`,
      { signal: AbortSignal.timeout(2000) }
    );
    if (discoveryRes.ok) {
      const meta = (await discoveryRes.json()) as {
        credential_configurations_supported?: Record<
          string,
          { vct?: string; display?: Array<{ name?: string }> }
        >;
      };
      const configs = meta.credential_configurations_supported || {};
      const activeEntry = Object.entries(configs).find(([id]) => !id.endsWith("_legacy"));
      if (activeEntry) {
        if (typeof activeEntry[1]?.vct === "string") {
          targetVct = activeEntry[1].vct;
        }
        if (Array.isArray(activeEntry[1]?.display) && activeEntry[1].display[0]?.name) {
          credentialName = activeEntry[1].display[0].name;
        }
      }
    }

    // 2. Fetch SD-JWT VC Type Metadata
    const vctUrl = targetVct.startsWith("http")
      ? targetVct
      : `${config.issuerBaseUrl}${targetVct.startsWith("/") ? "" : "/"}${targetVct}`;

    const typeRes = await fetch(vctUrl, { signal: AbortSignal.timeout(2000) });
    if (typeRes.ok) {
      const typeMetadata = (await typeRes.json()) as {
        name?: string;
        claims?: Array<{
          path?: Array<string | number | null>;
          display?: Array<{ name?: string; label?: string; description?: string }>;
          sd?: "always" | "never" | "allowed";
          mandatory?: boolean;
        }>;
      };

      if (typeMetadata.name) {
        credentialName = typeMetadata.name;
      }

      if (Array.isArray(typeMetadata.claims) && typeMetadata.claims.length > 0) {
        // Collect all schema paths directly from type metadata, including wildcard array paths (with null)
        const allSchemaPaths = typeMetadata.claims
          .map((item) => item.path)
          .filter((p): p is Array<string | number | null> => Array.isArray(p) && p.length > 0);

        const parsed: DiscoveredClaim[] = [];
        for (const item of typeMetadata.claims) {
          if (!Array.isArray(item.path) || item.path.length === 0) continue;
          // Ignore array item wildcard paths (ending in null) for top-level claim selection
          if (item.path.includes(null)) continue;

          const path = item.path as Array<string | number>;

          // Only allow genuine leaf claims in UI checkboxes:
          // Exclude parent container objects and array containers with child properties.
          if (!isLeafClaimPath(path, allSchemaPaths)) {
            continue;
          }

          const pathKey = path.join(".");
          const lastSegment = String(path[path.length - 1]);
          const display = Array.isArray(item.display) ? item.display[0] : undefined;
          const label = display?.label || display?.name || formatClaimLabel(lastSegment);
          const category = categorizeClaimPath(path);
          const isSelectable = item.sd === "always" || item.sd === "allowed";
          const sdPolicy = isSelectable ? "selectively_disclosable" : "always_disclosed";

          parsed.push({
            path,
            pathKey,
            label,
            category,
            description: display?.description,
            sdPolicy,
            sd: item.sd ?? (isSelectable ? "always" : "never"),
            mandatory: item.mandatory ?? false,
          });
        }

        if (parsed.length > 0) {
          discoveredClaims = parsed;
        }
      }
    }
  } catch {
    // Retain fallback defaults if issuer cannot be reached
  }

  if (discoveredClaims.length === 0) {
    discoveredClaims = FALLBACK_DISCOVERED_CLAIMS;
  }

  return {
    vct: targetVct,
    credentialName,
    claims: discoveredClaims,
  };
}
