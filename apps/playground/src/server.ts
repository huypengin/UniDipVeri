import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import QRCode from "qrcode";
import {
  resolveDiscoveryMetadata,
  FALLBACK_DISCOVERED_CLAIMS,
  formatClaimLabel,
  categorizeClaimPath,
  isLeafClaimPath,
  type PlaygroundDiscoveryResult,
  type DiscoveredClaim,
} from "./discovery.js";
import {
  DEFAULT_ACADEMIC_PRESETS,
  filterPresetPaths,
  resolveScenarioPresets,
  type ScenarioPreset,
} from "./presets.js";
import {
  buildDcqlQuery,
  validateDcqlQuery,
} from "./dcql.js";

export {
  resolveDiscoveryMetadata,
  FALLBACK_DISCOVERED_CLAIMS,
  formatClaimLabel,
  categorizeClaimPath,
  isLeafClaimPath,
  type PlaygroundDiscoveryResult,
  type DiscoveredClaim,
  DEFAULT_ACADEMIC_PRESETS,
  filterPresetPaths,
  resolveScenarioPresets,
  type ScenarioPreset,
  buildDcqlQuery,
  validateDcqlQuery,
};

export interface PlaygroundConfig {
  port: number;
  waltidBase: string;
  verifierPublicUrl: string;
  issuerBaseUrl: string;
  vctUrl: string;
  logsDir: string;
}

export interface VerificationSessionInfo {
  id: string;
  status: "PENDING" | "SUCCESSFUL" | "FAILED";
  verificationResult?: boolean;
  policy_results?: {
    overallSuccess?: boolean;
    vp_policies?: Record<string, Record<string, { success?: boolean; [key: string]: unknown }>>;
    vc_policies?: Array<{
      policy?: { id?: string; [key: string]: unknown };
      success?: boolean;
      result?: {
        verification_result?: boolean;
        credential_signature?: {
          providedDisclosures?: Array<{
            name?: string;
            value?: unknown;
            location?: string[];
            [key: string]: unknown;
          }>;
          [key: string]: unknown;
        };
        [key: string]: unknown;
      };
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  policyResults?: Record<string, unknown>;
  presentation_validation_results?: Record<string, unknown>;
  presented_raw_data?: {
    vpToken?: unknown;
    state?: string;
    [key: string]: unknown;
  };
  data?: {
    disclosures?: Array<{
      name?: string;
      value?: unknown;
      location?: string[];
    }>;
    [key: string]: unknown;
  };
  failure?: {
    type?: string;
    reason?: string;
    violations?: unknown[];
    [key: string]: unknown;
  };
  authorizationRequest?: {
    client_id: string;
    nonce: string;
    state: string;
    response_uri: string;
    dcql_query: unknown;
  };
  [key: string]: unknown;
}

interface ActiveSessionRecord {
  id: string;
  createdAt: number;
  qrUri: string;
  saved: boolean;
  savedDir?: string;
}

/**
 * Resolves the destination logging directory from environment variables or CLI arguments,
 * matching the pattern used by the UniDipVeri issuer service.
 */
export function resolveLogsDir(): string {
  if (process.env.LOGS_DIR) {
    return process.env.LOGS_DIR;
  }
  if (process.env.LOG_DIR) {
    return process.env.LOG_DIR;
  }
  if (process.env.LOG_FILE) {
    return dirname(process.env.LOG_FILE);
  }
  const args = process.argv;
  const idx = args.findIndex((arg) => arg === "--logs-dir" || arg === "--log-dir");
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  // If running from within apps/playground, default to monorepo root logs
  const monorepoLogs = join(process.cwd(), "..", "..", "logs");
  if (existsSync(join(process.cwd(), "..", "..", "packages"))) {
    return monorepoLogs;
  }
  return join(process.cwd(), "logs");
}

/**
 * Loads configuration from environment variables and active devenv tunnel logs.
 */
export function loadPlaygroundConfig(): PlaygroundConfig {
  const port = parseInt(process.env.PORTAL_PORT || process.env.PORT || "3001", 10);
  const waltidBase = (process.env.WALTID_BASE || "http://localhost:7004").replace(/\/+$/, "");

  // Auto-discover verifier public tunnel if not explicitly provided or if set to localhost
  let verifierPublicUrl = (process.env.VERIFIER_PUBLIC_URL || "").replace(/\/+$/, "");
  if (!verifierPublicUrl || verifierPublicUrl.includes("localhost") || verifierPublicUrl.includes("127.0.0.1")) {
    const candidatePaths = [
      join(process.cwd(), ".devenv", "verifier-tunnel.log"),
      join(process.cwd(), "..", "..", ".devenv", "verifier-tunnel.log"),
    ];
    for (const p of candidatePaths) {
      if (existsSync(p)) {
        try {
          const content = readFileSync(p, "utf-8");
          const match = content.match(/https:\/\/[-a-zA-Z0-9.]+\.trycloudflare\.com/);
          if (match) {
            verifierPublicUrl = match[0];
            break;
          }
        } catch {}
      }
    }
  }
  if (!verifierPublicUrl) {
    verifierPublicUrl = waltidBase;
  }

  // Auto-discover issuer public tunnel if not explicitly provided or if set to localhost
  let issuerBaseUrl = (process.env.ISSUER_BASE_URL || "").replace(/\/+$/, "");
  if (!issuerBaseUrl || issuerBaseUrl.includes("localhost") || issuerBaseUrl.includes("127.0.0.1")) {
    const candidatePaths = [
      join(process.cwd(), ".devenv", "issuer-tunnel.log"),
      join(process.cwd(), "..", "..", ".devenv", "issuer-tunnel.log"),
    ];
    for (const p of candidatePaths) {
      if (existsSync(p)) {
        try {
          const content = readFileSync(p, "utf-8");
          const match = content.match(/https:\/\/[-a-zA-Z0-9.]+\.trycloudflare\.com/);
          if (match) {
            issuerBaseUrl = match[0];
            break;
          }
        } catch {}
      }
    }
  }
  if (!issuerBaseUrl) {
    issuerBaseUrl = "http://localhost:3000";
  }

  const vctType = (process.env.VCT_TYPE || "graduation-record").trim();
  const vctVersion = `v${(process.env.VCT_VERSION || "1").trim().replace(/^[vV]+/, "") || "1"}`;
  const vctPath = `/types/${vctType}/${vctVersion}`;
  const vctUrl = process.env.VCT_URL || `${issuerBaseUrl}${vctPath}`;
  const logsDir = resolveLogsDir();

  return {
    port,
    waltidBase,
    verifierPublicUrl,
    issuerBaseUrl,
    vctUrl,
    logsDir,
  };
}

/**
 * Normalizes authorization request URLs to target public verifier tunnel when available.
 * Handles both plain text and URL-encoded occurrences (e.g. within client_id, response_uri, and request_uri).
 * Preserves the standard OpenID4VP redirect_uri: client identifier prefix for cross-device direct_post flow.
 */
export function rewriteAuthorizationUrl(
  rawUrl: string,
  internalBase: string,
  publicBase: string
): string {
  if (!rawUrl) {
    return rawUrl;
  }
  let res = rawUrl;
  if (internalBase !== publicBase) {
    const cleanInternal = internalBase.replace(/\/+$/, "");
    const cleanPublic = publicBase.replace(/\/+$/, "");

    const internalVariations = [
      cleanInternal,
      cleanInternal.replace("localhost", "127.0.0.1"),
      cleanInternal.replace("127.0.0.1", "localhost"),
    ];

    for (const internal of internalVariations) {
      res = res.replaceAll(internal, cleanPublic);
      res = res.replaceAll(encodeURIComponent(internal), encodeURIComponent(cleanPublic));
    }
  }

  return res;
}

/**
 * Creates an OID4VP cross-device verification session on Walt.id verifier.
 */
export async function createWaltidSession(
  config: PlaygroundConfig,
  customDcqlQuery?: Record<string, unknown>
): Promise<{
  sessionId: string;
  fullAuthorizationRequestUrl: string;
  dcqlQuery: Record<string, unknown>;
}> {
  const isPublicVerifier =
    config.verifierPublicUrl &&
    !config.verifierPublicUrl.includes("localhost") &&
    !config.verifierPublicUrl.includes("127.0.0.1");

  // Dynamically resolve active VCT advertised by the running issuer when reachable
  let targetVct = config.vctUrl;
  try {
    const discoveryRes = await fetch(
      `${config.issuerBaseUrl}/.well-known/openid-credential-issuer`,
      { signal: AbortSignal.timeout(1500) }
    );
    if (discoveryRes.ok) {
      const meta = (await discoveryRes.json()) as {
        credential_configurations_supported?: Record<string, { vct?: string }>;
      };
      const configs = meta.credential_configurations_supported || {};
      const activeEntry = Object.entries(configs).find(([id]) => !id.endsWith("_legacy"));
      if (activeEntry && typeof activeEntry[1]?.vct === "string") {
        targetVct = activeEntry[1].vct;
      }
    }
  } catch {}

  const defaultPaths = [
    ["dateOfBirth"],
    ["papers", "diploma", "degreeName"],
    ["papers", "diploma", "major"],
    ["papers", "diploma", "graduationDate"],
  ];

  const dcqlQuery = customDcqlQuery
    ? (() => {
        const val = validateDcqlQuery(customDcqlQuery);
        return val.normalizedQuery || (customDcqlQuery as Record<string, unknown>);
      })()
    : buildDcqlQuery(targetVct, defaultPaths);

  const payload: Record<string, unknown> = {
    flow_type: "cross_device",
    ...(isPublicVerifier
      ? {
          url_config: {
            url_prefix: `${config.verifierPublicUrl}/verification-session`,
          },
        }
      : {}),
    core_flow: {
      client_metadata: {
        client_name: "UniDipVeri Verifier",
        vp_formats_supported: {
          "dc+sd-jwt": {
            "sd-jwt_alg_values": ["ES256", "EdDSA", "ES384"],
            "kb-jwt_alg_values": ["ES256", "EdDSA", "ES384"],
          },
        },
      },
      dcql_query: dcqlQuery,
      policies: {
        // In OpenID4VP, verification is policy-driven: verifiers only evaluate checks
        // explicitly requested in the verification session configuration.
        // In Walt.id Verifier 2, vc_policies defines credential-level checks:
        // 1. "signature": Validates issuer outer JWS signature against the issuer DID document.
        // 2. "credential-status": Evaluates the Token Status List (draft-ietf-oauth-status-list-21)
        //    requiring value 0 (active/valid). If revoked (value 1), verification fails immediately.
        // Presentation policies (holder binding via kb-jwt_signature, sd_hash verification, nonce, and audience)
        // are automatically configured and enforced by Walt.id Verifier 2 under vp_policies for dc+sd-jwt.
        vc_policies: [
          { policy: "signature" },
          {
            policy: "credential-status",
            argument: {
              discriminator: "ietf",
              value: 0,
            },
          },
        ],
      },
    },
  };

  const res = await fetch(`${config.waltidBase}/verification-session/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create verification session: HTTP ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    sessionId: string;
    bootstrapAuthorizationRequestUrl?: string;
    fullAuthorizationRequestUrl?: string;
  };

  // Prioritize full inlined authorization URL to pass the OID4VP request parameters by value.
  // Passing by value eliminates external request_uri fetching, preventing RFC 9101 JAR 406 Not Acceptable errors in mobile wallets.
  const rawUrl =
    data.fullAuthorizationRequestUrl || data.bootstrapAuthorizationRequestUrl || "";

  const rewrittenUrl = rewriteAuthorizationUrl(
    rawUrl,
    config.waltidBase,
    config.verifierPublicUrl
  );

  return {
    sessionId: data.sessionId,
    fullAuthorizationRequestUrl: rewrittenUrl,
    dcqlQuery,
  };
}

/**
 * Fetches status information for an active verification session from Walt.id verifier.
 */
export async function getWaltidSessionInfo(
  waltidBase: string,
  sessionId: string
): Promise<VerificationSessionInfo> {
  const res = await fetch(`${waltidBase}/verification-session/${sessionId}/info`);
  if (!res.ok) {
    throw new Error(`Failed to query session info: HTTP ${res.status}`);
  }
  return (await res.json()) as VerificationSessionInfo;
}

export interface DisclosedClaim {
  name: string;
  value: unknown;
  location?: string[];
}

export interface PolicyViolation {
  policy: string;
  error: string;
}

export interface ExtractedAuditData {
  verificationResult: boolean;
  policySummary: Record<string, boolean>;
  rawPolicyResults: unknown;
  disclosures: DisclosedClaim[];
  failureReason?: string;
  violations?: PolicyViolation[];
}

/**
 * Extracts normalized audit telemetry, overall verification result, policy outcomes,
 * and selectively disclosed claims from a Walt.id verification session response.
 */
export function extractSessionAuditData(
  sessionInfo: VerificationSessionInfo
): ExtractedAuditData {
  const rawResults = (sessionInfo.policy_results || sessionInfo.policyResults) as
    | {
        overallSuccess?: boolean;
        vp_policies?: Record<string, Record<string, { success?: boolean }>>;
        vc_policies?: Array<{
          policy?: { id?: string };
          success?: boolean;
          result?: {
            credential_signature?: {
              providedDisclosures?: Array<{
                name?: string;
                value?: unknown;
                location?: string[];
              }>;
            };
          };
        }>;
      }
    | undefined;

  const isOverallSuccessful =
    sessionInfo.status === "SUCCESSFUL" &&
    (rawResults?.overallSuccess ?? sessionInfo.verificationResult ?? true);

  // Policy Summary Map
  const policySummary: Record<string, boolean> = {};
  if (rawResults?.vp_policies) {
    for (const [credId, policies] of Object.entries(rawResults.vp_policies)) {
      for (const [policyName, policyObj] of Object.entries(policies)) {
        policySummary[`${credId} (${policyName})`] = policyObj.success ?? false;
      }
    }
  }
  if (Array.isArray(rawResults?.vc_policies)) {
    for (const p of rawResults.vc_policies) {
      const id = p.policy?.id || (p.policy as { policy?: string })?.policy || "signature";
      policySummary[id] = p.success ?? false;
    }
  }

  // Extract human-friendly failure details & violations
  let failureReason: string | undefined = undefined;
  const violations: PolicyViolation[] = [];

  const rawFailure = sessionInfo.failure as {
    reason?: string;
    type?: string;
    violations?: Array<{
      policy?: { id?: string; policy?: string } | string;
      error?: string;
      message?: string;
    }>;
  } | undefined;

  if (rawFailure?.violations && Array.isArray(rawFailure.violations)) {
    for (const v of rawFailure.violations) {
      const polName =
        (typeof v.policy === "object" ? v.policy?.id || v.policy?.policy : v.policy) || "policy";
      const err = v.error || v.message || "Policy check failed";
      violations.push({ policy: polName, error: err });
    }
  }

  if (Array.isArray(rawResults?.vc_policies)) {
    for (const p of rawResults.vc_policies as Array<{
      policy?: { id?: string; policy?: string };
      success?: boolean;
      error?: string;
    }>) {
      if (p.success === false && p.error) {
        const polName = p.policy?.id || p.policy?.policy || "signature";
        if (!violations.some((v) => v.policy === polName && v.error === p.error)) {
          violations.push({ policy: polName, error: p.error });
        }
      }
    }
  }

  if (sessionInfo.status === "FAILED") {
    if (violations.length > 0) {
      const first = violations[0];
      if (first.policy === "credential-status" || first.error.includes("Status validation failed")) {
        failureReason = "Credential Revoked (Token Status List check failed)";
      } else if (first.policy === "signature" || first.error.includes("signature")) {
        failureReason = "Invalid Signature (Issuer verification failed)";
      } else {
        failureReason = `${first.policy}: ${first.error}`;
      }
    } else if (rawFailure?.reason) {
      failureReason = rawFailure.reason;
    } else {
      failureReason = "Presentation rejected by verifier policy";
    }
  }

  // Disclosed Claims Extraction
  const disclosures: DisclosedClaim[] = [];

  // Source A: policy_results vc_policies providedDisclosures (Walt.id native verification result)
  if (Array.isArray(rawResults?.vc_policies)) {
    for (const vc of rawResults.vc_policies) {
      const provided = vc.result?.credential_signature?.providedDisclosures;
      if (Array.isArray(provided)) {
        for (const d of provided) {
          disclosures.push({
            name: d.name || (Array.isArray(d.location) ? d.location.join(".") : "claim"),
            value: d.value,
            location: d.location,
          });
        }
      }
    }
  }

  // Source B: presented_raw_data.vpToken fallback (parse compact SD-JWT disclosure tuples)
  if (disclosures.length === 0 && sessionInfo.presented_raw_data?.vpToken) {
    const vpToken = sessionInfo.presented_raw_data.vpToken;
    const tokens: string[] = [];
    if (typeof vpToken === "string") {
      tokens.push(vpToken);
    } else if (Array.isArray(vpToken)) {
      tokens.push(...vpToken.filter((t): t is string => typeof t === "string"));
    } else if (typeof vpToken === "object" && vpToken !== null) {
      for (const v of Object.values(vpToken)) {
        if (Array.isArray(v)) {
          tokens.push(...v.filter((t): t is string => typeof t === "string"));
        } else if (typeof v === "string") {
          tokens.push(v);
        }
      }
    }

    for (const t of tokens) {
      if (!t.includes("~")) continue;
      const parts = t.split("~");
      for (const b64 of parts.slice(1, -1)) {
        if (!b64) continue;
        try {
          const decoded = JSON.parse(Buffer.from(b64, "base64url").toString("utf-8"));
          if (Array.isArray(decoded) && decoded.length === 3) {
            disclosures.push({ name: String(decoded[1]), value: decoded[2] });
          } else if (Array.isArray(decoded) && decoded.length === 2) {
            disclosures.push({ name: "[array item]", value: decoded[1] });
          }
        } catch {}
      }
    }
  }

  // Source C: legacy data.disclosures
  if (disclosures.length === 0 && sessionInfo.data?.disclosures) {
    for (const d of sessionInfo.data.disclosures) {
      disclosures.push({
        name: d.name || (d.location ? d.location.join(".") : "claim"),
        value: d.value,
        location: d.location,
      });
    }
  }

  return {
    verificationResult: isOverallSuccessful,
    policySummary,
    rawPolicyResults: rawResults ?? {},
    disclosures,
    failureReason,
    violations,
  };
}

/**
 * Formats human-readable markdown audit summary for the verification session.
 */
export function formatAuditSummaryMarkdown(
  sessionId: string,
  sessionInfo: VerificationSessionInfo,
  auditData: ExtractedAuditData
): string {
  const disclosedList =
    auditData.disclosures.length > 0
      ? auditData.disclosures
          .map((d) => {
            if (
              d.value &&
              typeof d.value === "object" &&
              !Array.isArray(d.value) &&
              "_sd" in (d.value as Record<string, unknown>)
            ) {
              const obj = d.value as Record<string, unknown>;
              const sdCount = Array.isArray(obj._sd) ? obj._sd.length : 0;
              const revealedKeys = Object.keys(obj).filter((k) => k !== "_sd");
              const revealedObj: Record<string, unknown> = {};
              for (const k of revealedKeys) {
                revealedObj[k] = obj[k];
              }
              return `- **${d.name}**: \`${JSON.stringify(revealedObj)}\` *(${sdCount} nested claims selectively concealed)*`;
            }
            return `- **${d.name}**: \`${JSON.stringify(d.value)}\``;
          })
          .join("\n")
      : "_No selective disclosures returned._";

  const failureSection = auditData.failureReason
    ? `\n## Rejection Reason\n- **Cause:** ${auditData.failureReason}\n` +
      (auditData.violations && auditData.violations.length > 0
        ? auditData.violations.map((v) => `  - **Policy \`${v.policy}\`**: ${v.error}`).join("\n") + "\n"
        : "")
    : "";

  return `# Verification Session Audit Evidence

- **Session ID:** \`${sessionId}\`
- **Captured At:** \`${new Date().toISOString()}\`
- **Overall Status:** **${sessionInfo.status}**
- **Verification Result:** \`${auditData.verificationResult}\`
${failureSection}
## Policy Verification Results
\`\`\`json
${JSON.stringify(auditData.policySummary, null, 2)}
\`\`\`

## Disclosed Credential Claims
${disclosedList}

## Raw Evidence Files
- Verifier Response: \`verifier-response.json\`
`;
}

/**
 * Persists raw verifier response and human-readable audit summary under logs/sessions/<timestamp>-session-<sessionId>/.
 * Files are marked with restricted permissions and excluded from git.
 */
export function persistSessionEvidence(
  config: PlaygroundConfig,
  sessionId: string,
  sessionInfo: VerificationSessionInfo
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const shortId = sessionId.slice(0, 8);
  const sessionDir = join(config.logsDir, "sessions", `${timestamp}-session-${shortId}`);

  mkdirSync(sessionDir, { recursive: true });
  try {
    chmodSync(sessionDir, 0o700);
  } catch {}

  // 1. Raw verifier response JSON
  const verifierResponsePath = join(sessionDir, "verifier-response.json");
  writeFileSync(verifierResponsePath, JSON.stringify(sessionInfo, null, 2), "utf-8");
  try {
    chmodSync(verifierResponsePath, 0o600);
  } catch {}

  // 2. Human-readable summary
  const auditData = extractSessionAuditData(sessionInfo);
  const summaryPath = join(sessionDir, "audit-summary.md");
  const summaryContent = formatAuditSummaryMarkdown(sessionId, sessionInfo, auditData);

  writeFileSync(summaryPath, summaryContent, "utf-8");
  try {
    chmodSync(summaryPath, 0o600);
  } catch {}

  return sessionDir;
}

/**
 * Generates the Playground HTML portal.
 */
export function renderPlaygroundHtml(
  session: {
    sessionId: string;
    qrUri: string;
    qrSvg: string;
    dcqlQuery?: Record<string, unknown>;
  },
  _config: PlaygroundConfig,
  discovery?: PlaygroundDiscoveryResult,
  presets?: ScenarioPreset[]
): string {
  const { sessionId, qrUri, qrSvg } = session;
  const disc: PlaygroundDiscoveryResult = discovery || {
    vct: _config.vctUrl,
    credentialName: "Graduation Academic Record",
    claims: FALLBACK_DISCOVERED_CLAIMS,
  };
  const activePresets: ScenarioPreset[] = presets || resolveScenarioPresets(disc.claims);

  const activeQuery =
    session.dcqlQuery ||
    buildDcqlQuery(disc.vct, [
      ["dateOfBirth"],
      ["papers", "diploma", "degreeName"],
      ["papers", "diploma", "major"],
      ["papers", "diploma", "graduationDate"],
    ]);

  const activePathsSet = new Set<string>();
  if (Array.isArray(activeQuery.credentials)) {
    const firstCred = activeQuery.credentials[0] as Record<string, unknown>;
    if (Array.isArray(firstCred?.claims)) {
      for (const c of firstCred.claims) {
        if (c && typeof c === "object" && Array.isArray((c as Record<string, unknown>).path)) {
          activePathsSet.add(
            ((c as Record<string, unknown>).path as Array<string | number>).join(".")
          );
        }
      }
    }
  }

  // Group claims by category
  const categories: Record<string, DiscoveredClaim[]> = {};
  for (const claim of disc.claims) {
    if (!categories[claim.category]) {
      categories[claim.category] = [];
    }
    categories[claim.category].push(claim);
  }

  const categoryEntries = Object.entries(categories);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UniDipVeri — Real Mobile Wallet OID4VP Showcase</title>
  <style>
      :root {
        --bg: #f3f6fb;
        --card-bg: #ffffff;
        --border: #dce3ed;
        --text: #1e293b;
        --text-muted: #64748b;
        --primary: #2563eb;
        --primary-hover: #1d4ed8;
        --success: #15803d;
        --success-bg: #f0fdf4;
        --failed: #b91c1c;
        --failed-bg: #fef2f2;
        --pending: #b45309;
        --pending-bg: #fffbeb;
      }

      * {
        box-sizing: border-box;
      }

      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background: var(--bg);
        color: var(--text);
        margin: 0;
        padding: 32px 16px;
        display: flex;
        flex-direction: column;
        align-items: center;
        min-height: 100vh;
      }

      .container {
        max-width: 760px;
        width: 100%;
      }

      .header {
        text-align: center;
        margin-bottom: 24px;
      }

      h1 {
        font-size: 1.75rem;
        font-weight: 700;
        margin: 0 0 8px 0;
        color: var(--primary);
      }

      .subtitle {
        color: var(--text-muted);
        font-size: 0.95rem;
        margin: 0;
      }

      .query-card {
        background: var(--card-bg);
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 24px 28px;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
        margin-bottom: 24px;
        text-align: left;
      }

      .card-header-row {
        margin-bottom: 16px;
      }

      .card-title {
        font-size: 1.25rem;
        font-weight: 700;
        margin: 0 0 4px 0;
        color: var(--text);
      }

      .card-desc {
        color: var(--text-muted);
        font-size: 0.88rem;
        margin: 0;
      }

      .section-heading {
        font-size: 0.78rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-muted);
        margin-bottom: 8px;
      }

      .preset-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 8px;
      }

      .preset-pill {
        background: #f1f5f9;
        border: 1px solid #cbd5e1;
        border-radius: 9999px;
        padding: 7px 16px;
        font-size: 0.84rem;
        font-weight: 600;
        color: #334155;
        cursor: pointer;
        transition: all 0.15s ease-in-out;
      }

      .preset-pill:hover {
        background: #e2e8f0;
        border-color: #94a3b8;
      }

      .preset-pill.active {
        background: var(--primary);
        border-color: var(--primary-hover);
        color: #ffffff;
        box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2);
      }

      .preset-desc {
        font-size: 0.82rem;
        color: #475569;
        margin: 0 0 18px 0;
        min-height: 1.2rem;
        font-style: italic;
      }

      .claims-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
        border-top: 1px solid var(--border);
        padding-top: 14px;
      }

      .claims-toolbar-title {
        font-size: 0.85rem;
        font-weight: 700;
        color: #1e293b;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .selected-count {
        font-weight: normal;
        color: var(--text-muted);
        font-size: 0.8rem;
      }

      .bulk-actions {
        display: flex;
        gap: 12px;
      }

      .btn-text {
        background: none;
        border: none;
        color: var(--primary);
        font-size: 0.8rem;
        font-weight: 600;
        cursor: pointer;
        padding: 0;
      }

      .btn-text:hover {
        text-decoration: underline;
      }

      .claims-categories-wrapper {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 16px;
      }

      .category-card {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 12px 14px;
      }

      .category-header {
        font-size: 0.78rem;
        font-weight: 700;
        color: #334155;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-bottom: 8px;
      }

      .claims-category-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 8px;
      }

      .claim-item {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        padding: 8px 10px;
        transition: border-color 0.15s;
      }

      .claim-item:hover {
        border-color: #93c5fd;
      }

      .claim-label {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        cursor: pointer;
        user-select: none;
        width: 100%;
      }

      .claim-checkbox {
        margin-top: 3px;
        cursor: pointer;
        width: 16px;
        height: 16px;
        accent-color: var(--primary);
      }

      .claim-text-col {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
        min-width: 0;
      }

      .claim-name-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }

      .claim-title {
        font-size: 0.84rem;
        font-weight: 600;
        color: #1e293b;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .badge {
        font-size: 0.68rem;
        font-weight: 700;
        border-radius: 4px;
        padding: 1px 6px;
        letter-spacing: 0.02em;
        flex-shrink: 0;
      }

      .badge-sd {
        color: #1e40af;
        background: #dbeafe;
      }

      .badge-always {
        color: #475569;
        background: #f1f5f9;
        border: 1px solid #e2e8f0;
      }

      .claim-path-code {
        font-family: monospace;
        font-size: 0.74rem;
        color: #64748b;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .raw-dcql-details {
        margin: 14px 0;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: #ffffff;
        overflow: hidden;
      }

      .raw-dcql-details summary {
        padding: 10px 14px;
        font-size: 0.82rem;
        font-weight: 600;
        color: #475569;
        cursor: pointer;
        user-select: none;
        background: #f8fafc;
      }

      .raw-dcql-details summary:hover {
        color: var(--primary);
      }

      .editor-wrapper {
        padding: 12px;
      }

      .raw-dcql-textarea {
        width: 100%;
        min-height: 540px;
        font-family: monospace;
        font-size: 0.8rem;
        background: #0f172a;
        color: #f8fafc;
        border: 1px solid #334155;
        border-radius: 6px;
        padding: 10px;
        box-sizing: border-box;
        resize: vertical;
        line-height: 1.4;
      }

      .dcql-error-msg {
        font-size: 0.8rem;
        color: #b91c1c;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 4px;
        padding: 6px 10px;
        margin-top: 6px;
      }

      .apply-query-btn {
        width: 100%;
        background: var(--primary);
        color: #ffffff;
        border: none;
        border-radius: 8px;
        padding: 12px 20px;
        font-size: 0.95rem;
        font-weight: 700;
        cursor: pointer;
        transition: background 0.15s ease-in-out;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }

      .apply-query-btn:hover {
        background: var(--primary-hover);
      }

      .apply-query-btn:disabled {
        background: #94a3b8;
        cursor: not-allowed;
      }

      .card {
        background: var(--card-bg);
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 32px;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
      }

      .action-bar {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 20px;
        width: 100%;
        justify-content: center;
      }

      .qr-frame {
        background: #ffffff;
        padding: 16px;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        display: inline-block;
        margin: 16px 0;
        box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
      }

      .qr-frame svg {
        display: block;
        width: 256px;
        height: 256px;
      }

      .status-badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 18px;
        border-radius: 9999px;
        font-size: 0.85rem;
        font-weight: 700;
        letter-spacing: 0.025em;
        margin-bottom: 20px;
      }

      .badge-pending {
        background: var(--pending-bg);
        color: var(--pending);
        border: 1px solid #fcd34d;
      }

      .badge-success {
        background: var(--success-bg);
        color: var(--success);
        border: 1px solid #86efac;
      }

      .badge-failed {
        background: var(--failed-bg);
        color: var(--failed);
        border: 1px solid #fca5a5;
      }

      .pulse-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: currentColor;
        animation: pulse 1.5s infinite;
      }

      @keyframes pulse {
        0%, 100% {
          opacity: 1;
          transform: scale(1);
        }
        50% {
          opacity: 0.4;
          transform: scale(0.85);
        }
      }

      .uri-box {
        background: #f8fafc;
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 12px 14px;
        width: 100%;
        text-align: left;
        font-family: monospace;
        font-size: 0.8rem;
        color: #475569;
        word-break: break-all;
        margin-top: 8px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .uri-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }

      .copy-btn,
      .refresh-btn {
        background: #4f46e5;
        color: #ffffff;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        padding: 6px 12px;
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s, border-color 0.2s;
      }

      .copy-btn:hover,
      .refresh-btn:hover {
        background: #4338ca;
        border-color: #818cf8;
      }

      .copy-btn:active,
      .refresh-btn:active {
        transform: scale(0.96);
      }

      .rejection-banner {
        background: var(--failed-bg);
        border: 1px solid #fecaca;
        border-radius: 12px;
        padding: 16px 20px;
        margin: 16px 0;
        width: 100%;
        text-align: left;
      }

      .rejection-header {
        display: flex;
        align-items: flex-start;
        gap: 12px;
      }

      .rejection-icon {
        font-size: 1.5rem;
        line-height: 1;
      }

      .rejection-title {
        color: #b91c1c;
        font-weight: 700;
        font-size: 1.05rem;
        margin-bottom: 4px;
      }

      .rejection-subtitle {
        color: #475569;
        font-size: 0.9rem;
        line-height: 1.5;
      }

      .rejection-details {
        margin-top: 12px;
        font-family: monospace;
        font-size: 0.82rem;
        color: #991b1b;
        background: #fffafa;
        border: 1px solid #fecaca;
        padding: 8px 12px;
        border-radius: 6px;
        word-break: break-word;
      }

      .success-banner {
        background: var(--success-bg);
        border: 1px solid #bbf7d0;
        border-radius: 12px;
        padding: 16px 20px;
        margin: 16px 0;
        width: 100%;
        text-align: left;
      }

      .success-header {
        display: flex;
        align-items: flex-start;
        gap: 12px;
      }

      .success-icon {
        font-size: 1.5rem;
        line-height: 1;
      }

      .success-title {
        color: #166534;
        font-weight: 700;
        font-size: 1.05rem;
        margin-bottom: 4px;
      }

      .success-subtitle {
        color: #475569;
        font-size: 0.9rem;
        line-height: 1.5;
      }

      .results-panel {
        margin-top: 24px;
        width: 100%;
        text-align: left;
        display: none;
      }

      .panel-card {
        background: #ffffff;
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 16px;
        margin-bottom: 12px;
      }

      .panel-title {
        font-size: 0.85rem;
        font-weight: 700;
        color: var(--primary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 12px;
      }

      .policy-chip-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .policy-chip {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 9px 14px;
        border-radius: 8px;
        font-size: 0.85rem;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
      }

      .policy-chip.pass {
        border-color: #bbf7d0;
        background: #f7fef8;
      }

      .policy-chip.fail {
        border-color: #fecaca;
        background: #fff7f7;
      }

      .chip-name {
        font-weight: 600;
        color: #334155;
        font-family: monospace;
        font-size: 0.82rem;
      }

      .chip-status {
        font-weight: 700;
        font-size: 0.78rem;
        padding: 3px 8px;
        border-radius: 4px;
        letter-spacing: 0.03em;
      }

      .chip-status.pass {
        background: #dcfce7;
        color: #166534;
      }

      .chip-status.fail {
        background: #fee2e2;
        color: #991b1b;
      }

      .claims-grid {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .claim-row {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        padding: 8px 12px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        font-size: 0.85rem;
      }

      .claim-key {
        color: #1d4ed8;
        font-weight: 600;
        flex-shrink: 0;
      }

      .claim-val {
        color: #334155;
        word-break: break-word;
        text-align: right;
      }

      details.raw-json {
        margin-top: 10px;
      }

      details.raw-json summary {
        color: #64748b;
        font-size: 0.76rem;
        cursor: pointer;
        user-select: none;
        padding: 2px 0;
      }

      details.raw-json summary:hover {
        color: var(--primary);
      }

      details.raw-json pre {
        margin-top: 8px;
      }

      pre {
        margin: 0;
        font-family: monospace;
        font-size: 0.82rem;
        color: #334155;
        overflow-x: auto;
      }

      .evidence-badge {
        color: var(--success);
        font-weight: 600;
        font-size: 0.85rem;
        margin-top: 12px;
        display: block;
      }

      @media (max-width: 520px) {
        body {
          padding: 20px 12px;
        }

        .query-card,
        .card {
          padding: 20px 14px;
        }

        .qr-frame svg {
          width: min(256px, 100%);
          height: auto;
          aspect-ratio: 1;
        }

        .uri-row,
        .claim-row {
          flex-wrap: wrap;
        }

        .claim-val {
          text-align: left;
          overflow-wrap: anywhere;
        }

        .claims-category-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .pulse-dot {
          animation: none;
        }

        .copy-btn,
        .refresh-btn,
        .preset-pill,
        .apply-query-btn {
          transition: none;
        }
      }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>UniDipVeri Presentation Showcase</h1>
      <p class="subtitle">Present your SD-JWT VC to Walt.id Verifier 2 via OID4VP &amp; DCQL</p>
    </div>

    <!-- Interactive DCQL Verification Query Builder -->
    <div class="query-card">
      <div class="card-header-row">
        <h2 class="card-title">Verification Policy &amp; DCQL Query Builder</h2>
        <p class="card-desc">Select a preset or customize field disclosures discovered from the institutional schema.</p>
      </div>

      <div class="section-heading">Verification Presets</div>
      <div class="preset-pills" id="presetPills">
        ${activePresets.map((preset, idx) => `
          <button
            type="button"
            class="preset-pill ${idx === 0 ? "active" : ""}"
            data-preset-id="${preset.id}"
            title="${preset.description}"
          >
            ${preset.name}
          </button>
        `).join("")}
      </div>
      <p id="presetDescription" class="preset-desc">${activePresets[0]?.description || ""}</p>

      <div class="claims-toolbar">
        <div class="claims-toolbar-title">
          <span>Credential Claims</span>
          <span id="selectedCount" class="selected-count">(${activePathsSet.size} selected)</span>
        </div>
        <div class="bulk-actions">
          <button id="selectAllBtn" type="button" class="btn-text">Select All</button>
          <span>&middot;</span>
          <button id="clearAllBtn" type="button" class="btn-text">Clear All</button>
        </div>
      </div>

      <div class="claims-categories-wrapper">
        ${categoryEntries.map(([catName, catClaims]) => `
          <div class="category-card">
            <div class="category-header">${catName}</div>
            <div class="claims-category-grid">
              ${catClaims.map((claim) => {
                const isChecked = activePathsSet.has(claim.pathKey);
                const isSd = claim.sdPolicy === "selectively_disclosable";
                return `
                  <div class="claim-item">
                    <label class="claim-label">
                      <input
                        type="checkbox"
                        class="claim-checkbox"
                        data-path="${claim.pathKey}"
                        ${isChecked ? "checked" : ""}
                      />
                      <span class="claim-text-col">
                        <span class="claim-name-row">
                          <span class="claim-title">${claim.label}</span>
                          <span class="badge ${isSd ? "badge-sd" : "badge-always"}">
                            ${isSd ? "Selective" : "Always"}
                          </span>
                        </span>
                        <span class="claim-path-code">${claim.pathKey}</span>
                      </span>
                    </label>
                  </div>
                `;
              }).join("")}
            </div>
          </div>
        `).join("")}
      </div>

      <details class="raw-dcql-details">
        <summary>View &amp; Edit Raw DCQL JSON Query</summary>
        <div class="editor-wrapper">
          <p style="margin: 0 0 8px 0; font-size: 0.75rem; color: var(--text-muted);">
            Checkboxes only expose individual leaf claims to prevent accidental over-disclosure. To query parent container objects or entire subtrees, edit the raw DCQL JSON query below.
          </p>
          <textarea id="rawDcqlTextarea" class="raw-dcql-textarea" spellcheck="false">${JSON.stringify(activeQuery, null, 2)}</textarea>
          <div id="dcqlError" class="dcql-error-msg" style="display: none;"></div>
        </div>
      </details>

      <button id="applyQueryBtn" class="apply-query-btn" type="button">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
        <span>Apply Query &amp; Generate QR Code</span>
      </button>
    </div>

    <!-- Active Verification Session & QR Card -->
    <div class="card">
      <div class="action-bar">
        <button id="newSessionBtn" class="refresh-btn">New Verification Session</button>
      </div>

      <div id="statusBadge" class="status-badge badge-pending">
        <span class="pulse-dot"></span>
        <span id="statusText">WAITING FOR WALLET SCAN</span>
      </div>

      <!-- Prominent Rejection Alert for Demos -->
      <div id="rejectionBanner" class="rejection-banner" style="display: none;">
        <div class="rejection-header">
          <span class="rejection-icon">⛔</span>
          <div style="flex: 1;">
            <div class="rejection-title" id="rejectionTitle">Presentation Rejected</div>
            <div class="rejection-subtitle" id="rejectionSubtitle">One or more verification policies failed.</div>
          </div>
        </div>
        <div class="rejection-details" id="rejectionDetails" style="display: none;"></div>
      </div>

      <!-- Prominent Success Alert for Demos -->
      <div id="successBanner" class="success-banner" style="display: none;">
        <div class="success-header">
          <span class="success-icon">✅</span>
          <div style="flex: 1;">
            <div class="success-title">Presentation Verified Successfully</div>
            <div class="success-subtitle">Cryptographic signatures, holder key binding, and active revocation status verified.</div>
          </div>
        </div>
      </div>

      <div class="qr-frame" id="qrContainer">
        ${qrSvg}
      </div>

      <div class="uri-box">
        <div class="uri-row">
          <strong>OpenID4VP Authorization Request URI:</strong>
          <button id="copyUriBtn" class="copy-btn" onclick="copyUri()" title="Copy Verification Request URI to clipboard">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span>Copy</span>
          </button>
        </div>
        <div id="uriText">${qrUri}</div>
      </div>

      <div id="resultsPanel" class="results-panel">
        <div class="panel-card" id="claimsCard">
          <div class="panel-title" id="claimsTitle">Verified Selective Disclosures</div>
          <div id="claimsContainer" class="claims-grid"></div>
          <details class="raw-json">
            <summary>View raw claims JSON</summary>
            <pre id="claimsJson"></pre>
          </details>
        </div>

        <div class="panel-card" id="policiesCard">
          <div class="panel-title">Policy Verification Checklist</div>
          <div id="policiesList" class="policy-chip-list"></div>
          <details class="raw-json">
            <summary>View raw policy JSON</summary>
            <pre id="policiesJson"></pre>
          </details>
        </div>

        <div id="evidenceMessage" class="evidence-badge"></div>
      </div>
    </div>
  </div>

  <!-- Discovery & Initial Query Embeds -->
  <script id="discovery-data" type="application/json">${JSON.stringify({ ...disc, presets: activePresets })}</script>
  <script id="initial-dcql" type="application/json">${JSON.stringify(activeQuery)}</script>

  <script>
    const discovery = JSON.parse(document.getElementById("discovery-data").textContent);
    let currentSessionId = ${JSON.stringify(sessionId)};
    let currentQuery = JSON.parse(document.getElementById("initial-dcql").textContent);
    let activePresetId = "diploma";

    const statusBadge = document.getElementById("statusBadge");
    const statusText = document.getElementById("statusText");
    const rejectionBanner = document.getElementById("rejectionBanner");
    const rejectionTitle = document.getElementById("rejectionTitle");
    const rejectionSubtitle = document.getElementById("rejectionSubtitle");
    const rejectionDetails = document.getElementById("rejectionDetails");
    const successBanner = document.getElementById("successBanner");
    const resultsPanel = document.getElementById("resultsPanel");
    const claimsTitle = document.getElementById("claimsTitle");
    const claimsContainer = document.getElementById("claimsContainer");
    const claimsJson = document.getElementById("claimsJson");
    const policiesList = document.getElementById("policiesList");
    const policiesJson = document.getElementById("policiesJson");
    const evidenceMessage = document.getElementById("evidenceMessage");
    const uriText = document.getElementById("uriText");
    const newSessionBtn = document.getElementById("newSessionBtn");

    const rawDcqlTextarea = document.getElementById("rawDcqlTextarea");
    const dcqlError = document.getElementById("dcqlError");
    const applyQueryBtn = document.getElementById("applyQueryBtn");
    const presetPills = document.querySelectorAll(".preset-pill");
    const presetDescription = document.getElementById("presetDescription");
    const claimCheckboxes = document.querySelectorAll(".claim-checkbox");
    const selectedCountEl = document.getElementById("selectedCount");
    const selectAllBtn = document.getElementById("selectAllBtn");
    const clearAllBtn = document.getElementById("clearAllBtn");

    function copyUri() {
      if (!uriText) return;
      navigator.clipboard.writeText(uriText.innerText).then(() => {
        const btn = document.getElementById('copyUriBtn');
        if (btn) {
          const originalContent = btn.innerHTML;
          btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg><span>Copied!</span>';
          btn.style.background = '#10b981';
          btn.style.borderColor = '#059669';
          setTimeout(() => {
            btn.innerHTML = originalContent;
            btn.style.background = '';
            btn.style.borderColor = '';
          }, 2000);
        }
      }).catch(() => {
        alert('Verification Request URI copied to clipboard!');
      });
    }

    function resetView() {
      statusBadge.className = "status-badge badge-pending";
      statusText.innerText = "WAITING FOR WALLET SCAN";
      rejectionBanner.style.display = "none";
      successBanner.style.display = "none";
      resultsPanel.style.display = "none";
      claimsContainer.innerHTML = "";
      policiesList.innerHTML = "";
      claimsJson.innerText = "";
      policiesJson.innerText = "";
      evidenceMessage.innerText = "";
    }

    function updateSelectedCount() {
      let count = 0;
      claimCheckboxes.forEach(cb => { if (cb.checked) count++; });
      if (selectedCountEl) {
        selectedCountEl.innerText = "(" + count + " selected)";
      }
    }

    function setActivePresetButton(presetId) {
      activePresetId = presetId;
      presetPills.forEach(pill => {
        if (pill.dataset.presetId === presetId) {
          pill.classList.add("active");
        } else {
          pill.classList.remove("active");
        }
      });
      const p = discovery.presets.find(pr => pr.id === presetId);
      if (presetDescription) {
        presetDescription.innerText = p ? p.description : "";
      }
    }

    function detectMatchingPreset(selectedPathKeySet) {
      for (const preset of discovery.presets) {
        if (preset.id === "custom") continue;
        if (preset.id === "full") {
          const allDiscoveredKeys = discovery.claims.map(c => c.pathKey);
          if (allDiscoveredKeys.length > 0 && allDiscoveredKeys.every(k => selectedPathKeySet.has(k)) && selectedPathKeySet.size === allDiscoveredKeys.length) {
            return "full";
          }
          continue;
        }
        const presetKeys = preset.claimPaths.map(p => p.join("."));
        if (presetKeys.length === selectedPathKeySet.size && presetKeys.every(k => selectedPathKeySet.has(k))) {
          return preset.id;
        }
      }
      return "custom";
    }

    function updateQueryFromCheckboxes() {
      const selectedPaths = [];
      const selectedKeySet = new Set();
      claimCheckboxes.forEach(cb => {
        if (cb.checked) {
          selectedPaths.push(cb.dataset.path.split("."));
          selectedKeySet.add(cb.dataset.path);
        }
      });

      const existingId = (currentQuery && currentQuery.credentials && currentQuery.credentials[0] && currentQuery.credentials[0].id)
        ? currentQuery.credentials[0].id
        : undefined;

      currentQuery = {
        credentials: [
          {
            id: existingId || (crypto.randomUUID ? crypto.randomUUID() : "cred-" + Date.now()),
            format: "dc+sd-jwt",
            meta: {
              vct_values: [discovery.vct],
            },
            claims: selectedPaths.map(path => ({ path })),
          },
        ],
      };

      rawDcqlTextarea.value = JSON.stringify(currentQuery, null, 2);
      dcqlError.style.display = "none";
      updateSelectedCount();
      const match = detectMatchingPreset(selectedKeySet);
      setActivePresetButton(match);
    }

    function updateCheckboxesFromQuery(query) {
      const pathSet = new Set();
      if (query && Array.isArray(query.credentials) && query.credentials[0] && Array.isArray(query.credentials[0].claims)) {
        for (const c of query.credentials[0].claims) {
          if (c && Array.isArray(c.path)) {
            pathSet.add(c.path.join("."));
          }
        }
      }
      claimCheckboxes.forEach(cb => {
        cb.checked = pathSet.has(cb.dataset.path);
      });
      updateSelectedCount();
      const match = detectMatchingPreset(pathSet);
      setActivePresetButton(match);
    }

    function setPreset(presetId) {
      const preset = discovery.presets.find(p => p.id === presetId);
      if (!preset) return;

      if (preset.id === "full") {
        claimCheckboxes.forEach(cb => { cb.checked = true; });
      } else if (preset.id === "custom") {
        // preserve current checkbox selections
      } else {
        const targetSet = new Set(preset.claimPaths.map(p => p.join(".")));
        claimCheckboxes.forEach(cb => {
          cb.checked = targetSet.has(cb.dataset.path);
        });
      }
      setActivePresetButton(preset.id);
      updateQueryFromCheckboxes();
    }

    presetPills.forEach(pill => {
      pill.addEventListener("click", () => {
        setPreset(pill.dataset.presetId);
      });
    });

    claimCheckboxes.forEach(cb => {
      cb.addEventListener("change", () => {
        updateQueryFromCheckboxes();
      });
    });

    if (selectAllBtn) {
      selectAllBtn.addEventListener("click", () => {
        setPreset("full");
      });
    }

    if (clearAllBtn) {
      clearAllBtn.addEventListener("click", () => {
        claimCheckboxes.forEach(cb => { cb.checked = false; });
        updateQueryFromCheckboxes();
      });
    }

    rawDcqlTextarea.addEventListener("input", () => {
      try {
        const parsed = JSON.parse(rawDcqlTextarea.value);
        dcqlError.style.display = "none";
        currentQuery = parsed;
        updateCheckboxesFromQuery(parsed);
      } catch (err) {
        dcqlError.innerText = "Invalid JSON: " + err.message;
        dcqlError.style.display = "block";
      }
    });

    async function applyActiveQuery() {
      try {
        currentQuery = JSON.parse(rawDcqlTextarea.value);
        dcqlError.style.display = "none";
      } catch (err) {
        dcqlError.innerText = "Please resolve JSON syntax errors: " + err.message;
        dcqlError.style.display = "block";
        return;
      }

      applyQueryBtn.disabled = true;
      const originalText = applyQueryBtn.innerHTML;
      applyQueryBtn.innerHTML = "<span>Generating Session...</span>";

      try {
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dcql_query: currentQuery }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error_description || "Server returned HTTP " + res.status);
        }
        const data = await res.json();
        currentSessionId = data.sessionId;
        uriText.innerText = data.qrUri;
        document.getElementById("qrContainer").innerHTML = data.qrSvg;
        if (data.dcqlQuery) {
          currentQuery = data.dcqlQuery;
          rawDcqlTextarea.value = JSON.stringify(currentQuery, null, 2);
        }
        resetView();
        document.getElementById("qrContainer").scrollIntoView({ behavior: "smooth", block: "center" });
      } catch (err) {
        alert("Failed to apply query and create session: " + err.message);
      } finally {
        applyQueryBtn.disabled = false;
        applyQueryBtn.innerHTML = originalText;
      }
    }

    applyQueryBtn.addEventListener("click", applyActiveQuery);

    newSessionBtn.addEventListener("click", async () => {
      newSessionBtn.disabled = true;
      newSessionBtn.innerText = "Creating...";
      try {
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dcql_query: currentQuery }),
        });
        const data = await res.json();
        currentSessionId = data.sessionId;
        uriText.innerText = data.qrUri;
        document.getElementById("qrContainer").innerHTML = data.qrSvg;
        resetView();
      } catch (err) {
        alert("Failed to create new session: " + err.message);
      } finally {
        newSessionBtn.disabled = false;
        newSessionBtn.innerText = "New Verification Session";
      }
    });

    function renderClaims(disclosures) {
      if (!disclosures || disclosures.length === 0) {
        claimsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; padding: 4px 0;">No claim disclosures presented.</div>';
        return;
      }
      claimsContainer.innerHTML = disclosures.map(d => {
        let valStr = "";
        if (d.value === null || d.value === undefined) {
          valStr = "—";
        } else if (typeof d.value === "object") {
          if (Array.isArray(d.value)) {
            valStr = JSON.stringify(d.value);
          } else {
            const copy = { ...d.value };
            delete copy._sd;
            delete copy._sd_alg;
            valStr = JSON.stringify(copy);
          }
        } else {
          valStr = String(d.value);
        }
        return '<div class="claim-row">' +
          '<span class="claim-key">' + d.name + '</span>' +
          '<span class="claim-val">' + valStr + '</span>' +
          '</div>';
      }).join("");
    }

    function renderPolicies(policies) {
      const entries = Object.entries(policies);
      if (entries.length === 0) {
        policiesList.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem;">No policy records returned.</div>';
        return;
      }
      policiesList.innerHTML = entries.map(([name, passed]) => {
        let label = passed ? "✓ PASSED" : "✗ FAILED";
        const chipClass = passed ? "pass" : "fail";
        return '<div class="policy-chip ' + chipClass + '">' +
          '<span class="chip-name">' + name + '</span>' +
          '<span class="chip-status ' + chipClass + '">' + label + '</span>' +
          '</div>';
      }).join("");
    }

    const pollInterval = setInterval(async () => {
      if (!currentSessionId) return;
      try {
        const res = await fetch(\`/api/status?sessionId=\${encodeURIComponent(currentSessionId)}\`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.status === "SUCCESSFUL") {
          statusBadge.className = "status-badge badge-success";
          statusText.innerText = "PRESENTATION VERIFIED SUCCESSFULLY";
          rejectionBanner.style.display = "none";
          successBanner.style.display = "block";
          resultsPanel.style.display = "block";
          claimsTitle.innerText = "Verified Selective Disclosures";

          if (data.disclosures && data.disclosures.length > 0) {
            renderClaims(data.disclosures);
            claimsJson.innerText = JSON.stringify(data.disclosures, null, 2);
          } else if (data.data) {
            claimsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; padding: 4px 0;">Credential valid. No selective disclosures returned.</div>';
            claimsJson.innerText = JSON.stringify(data.data, null, 2);
          }

          renderPolicies(data.policyResults || {});
          policiesJson.innerText = JSON.stringify(data.policyResults || {}, null, 2);

          if (data.savedDir) {
            evidenceMessage.innerText = "✓ Audit evidence saved to: " + data.savedDir;
          }
        } else if (data.status === "FAILED") {
          statusBadge.className = "status-badge badge-failed";
          statusText.innerText = "PRESENTATION REJECTED";
          successBanner.style.display = "none";
          rejectionBanner.style.display = "block";

          let title = "Verification Failed";
          let subtitle = "One or more verification policies rejected the presented credential.";
          let detail = "";

          const violations = data.violations || [];
          if (violations.length > 0) {
            const v = violations[0];
            if (v.policy === "credential-status" || (v.error && v.error.includes("Status validation failed"))) {
              title = "Credential Revoked (Status List Failure)";
              subtitle = "The university registrar has revoked this credential in the Token Status List.";
              detail = v.error;
            } else if (v.policy === "signature" || (v.error && v.error.includes("signature"))) {
              title = "Invalid Cryptographic Signature";
              subtitle = "The credential signature could not be verified against the issuer DID.";
              detail = v.error;
            } else if (v.policy && v.policy.includes("kb-jwt")) {
              title = "Key Binding Authentication Failed";
              subtitle = "Holder proof-of-possession binding is invalid or has expired.";
              detail = v.error;
            } else {
              title = "Policy Violation: " + v.policy;
              subtitle = v.error;
              detail = JSON.stringify(v);
            }
          } else if (data.failureReason) {
            title = data.failureReason;
            subtitle = data.failure?.reason || "Presentation was rejected by verifier policies.";
          } else if (data.failure?.reason) {
            title = data.failure.reason;
          }

          rejectionTitle.innerText = title;
          rejectionSubtitle.innerText = subtitle;
          if (detail) {
            rejectionDetails.innerText = "Detail: " + detail;
            rejectionDetails.style.display = "block";
          } else {
            rejectionDetails.style.display = "none";
          }

          resultsPanel.style.display = "block";
          claimsTitle.innerText = "Disclosed Claims (Rejected)";

          if (data.disclosures && data.disclosures.length > 0) {
            renderClaims(data.disclosures);
            claimsJson.innerText = JSON.stringify(data.disclosures, null, 2);
          } else {
            claimsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; padding: 4px 0;">No disclosures accepted due to rejection.</div>';
            claimsJson.innerText = JSON.stringify(data.failure || {}, null, 2);
          }

          renderPolicies(data.policyResults || {});
          policiesJson.innerText = JSON.stringify(data.policyResults || {}, null, 2);

          if (data.savedDir) {
            evidenceMessage.innerText = "⚠️ Rejection audit evidence logged to: " + data.savedDir;
          }
        }
      } catch (err) {
        console.error("Poll error:", err);
      }
    }, 2000);
  </script>
</body>
</html>`;
}

/**
 * Creates the Playground request handler.
 */
export function createPlaygroundApp(config: PlaygroundConfig = loadPlaygroundConfig()) {
  const activeSessions = new Map<string, ActiveSessionRecord>();

  return async function handlePlaygroundRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method.toUpperCase();

    // Route: GET /health
    if (method === "GET" && pathname === "/health") {
      return Response.json({
        status: "ok",
        service: "@unidipveri/playground",
        config: {
          port: config.port,
          waltidBase: config.waltidBase,
          verifierPublicUrl: config.verifierPublicUrl,
          issuerBaseUrl: config.issuerBaseUrl,
        },
      });
    }

    // Route: GET /api/discovery
    if (method === "GET" && pathname === "/api/discovery") {
      try {
        const discovery = await resolveDiscoveryMetadata(config);
        const presets = resolveScenarioPresets(discovery.claims);
        return Response.json(
          {
            ...discovery,
            presets,
          },
          {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-cache, no-store, must-revalidate",
            },
          }
        );
      } catch (err) {
        return Response.json(
          { error: "discovery_failed", error_description: (err as Error).message },
          { status: 500 }
        );
      }
    }

    // Route: POST /api/session
    if (method === "POST" && pathname === "/api/session") {
      try {
        let customDcqlQuery: Record<string, unknown> | undefined;

        if (req.headers.get("content-type")?.includes("application/json")) {
          try {
            const body = (await req.json()) as { dcql_query?: unknown };
            if (body && body.dcql_query) {
              const validation = validateDcqlQuery(body.dcql_query);
              if (!validation.valid) {
                return Response.json(
                  { error: "invalid_dcql_query", error_description: validation.error },
                  { status: 400 }
                );
              }
              customDcqlQuery = (validation.normalizedQuery || body.dcql_query) as Record<
                string,
                unknown
              >;
            }
          } catch {
            return Response.json(
              { error: "invalid_json", error_description: "Request body is not valid JSON" },
              { status: 400 }
            );
          }
        }

        const session = await createWaltidSession(config, customDcqlQuery);
        const qrSvg = await QRCode.toString(session.fullAuthorizationRequestUrl, {
          type: "svg",
          margin: 1,
          errorCorrectionLevel: "L",
          color: { dark: "#0f172a", light: "#ffffff" },
        });

        activeSessions.set(session.sessionId, {
          id: session.sessionId,
          createdAt: Date.now(),
          qrUri: session.fullAuthorizationRequestUrl,
          saved: false,
        });

        return Response.json({
          sessionId: session.sessionId,
          qrUri: session.fullAuthorizationRequestUrl,
          qrSvg,
          dcqlQuery: session.dcqlQuery,
          status: "PENDING",
        });
      } catch (err) {
        return Response.json(
          { error: "session_creation_failed", error_description: (err as Error).message },
          { status: 500 }
        );
      }
    }

    // Route: GET /api/status
    if (method === "GET" && pathname === "/api/status") {
      const sessionId = url.searchParams.get("sessionId");

      if (!sessionId) {
        return Response.json(
          { error: "invalid_request", error_description: "Missing sessionId parameter" },
          { status: 400 }
        );
      }

      try {
        const sessionInfo = await getWaltidSessionInfo(config.waltidBase, sessionId);
        let savedDir: string | undefined = undefined;

        const record = activeSessions.get(sessionId);

        if (
          (sessionInfo.status === "SUCCESSFUL" || sessionInfo.status === "FAILED") &&
          record &&
          !record.saved
        ) {
          savedDir = persistSessionEvidence(config, sessionId, sessionInfo);
          record.saved = true;
          record.savedDir = savedDir;
        } else if (record?.savedDir) {
          savedDir = record.savedDir;
        }

        const auditData = extractSessionAuditData(sessionInfo);

        return Response.json({
          ...sessionInfo,
          verificationResult: auditData.verificationResult,
          policyResults: auditData.policySummary,
          disclosures: auditData.disclosures,
          failureReason: auditData.failureReason,
          violations: auditData.violations,
          savedDir,
        });
      } catch (err) {
        return Response.json(
          { error: "status_query_failed", error_description: (err as Error).message },
          { status: 500 }
        );
      }
    }

    // Route: GET / (Portal HTML)
    if (method === "GET" && pathname === "/") {
      try {
        const discovery = await resolveDiscoveryMetadata(config);
        const presets = resolveScenarioPresets(discovery.claims);
        const diplomaPreset = presets.find((p) => p.id === "diploma");
        const initialPaths =
          diplomaPreset && diplomaPreset.claimPaths.length > 0
            ? diplomaPreset.claimPaths
            : [
                ["dateOfBirth"],
                ["papers", "diploma", "degreeName"],
                ["papers", "diploma", "major"],
                ["papers", "diploma", "graduationDate"],
              ];
        const initialQuery = buildDcqlQuery(discovery.vct, initialPaths);

        const session = await createWaltidSession(config, initialQuery);
        const qrSvg = await QRCode.toString(session.fullAuthorizationRequestUrl, {
          type: "svg",
          margin: 1,
          errorCorrectionLevel: "L",
          color: { dark: "#0f172a", light: "#ffffff" },
        });

        activeSessions.set(session.sessionId, {
          id: session.sessionId,
          createdAt: Date.now(),
          qrUri: session.fullAuthorizationRequestUrl,
          saved: false,
        });

        const html = renderPlaygroundHtml(
          {
            sessionId: session.sessionId,
            qrUri: session.fullAuthorizationRequestUrl,
            qrSvg,
            dcqlQuery: session.dcqlQuery,
          },
          config,
          discovery,
          presets
        );

        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      } catch (err) {
        return new Response(
          `<h1>Walt.id Verifier Unavailable</h1><p>${(err as Error).message}</p><p>Ensure Walt.id verifier is running on ${config.waltidBase}</p>`,
          {
            status: 503,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }
        );
      }
    }

    return new Response("Not Found", { status: 404 });
  };
}

/**
 * Starts the Playground Bun HTTP listener.
 */
export function startPlaygroundServer(config: PlaygroundConfig = loadPlaygroundConfig()) {
  const app = createPlaygroundApp(config);

  const server = Bun.serve({
    port: config.port,
    fetch: app,
  });

  console.log(`[Playground] Listening on http://localhost:${server.port}`);
  console.log(`[Playground] Target Walt.id Verifier: ${config.waltidBase}`);
  console.log(`[Playground] Verifier Public URL:    ${config.verifierPublicUrl}`);
  console.log(`[Playground] Issuer Base URL:        ${config.issuerBaseUrl}`);

  return server;
}

if (import.meta.main) {
  startPlaygroundServer();
}
