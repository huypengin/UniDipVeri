import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  createPlaygroundApp,
  createWaltidSession,
  loadPlaygroundConfig,
  persistSessionEvidence,
  rewriteAuthorizationUrl,
  resolveLogsDir,
  extractSessionAuditData,
  formatAuditSummaryMarkdown,
  type PlaygroundConfig,
  type VerificationSessionInfo,
} from "../src/server.js";

describe("Playground Showcase Service (apps/playground)", () => {
  const testLogsDir = join(import.meta.dir, ".tmp-test-logs");

  const mockConfig: PlaygroundConfig = {
    port: 3001,
    waltidBase: "http://localhost:7004",
    verifierPublicUrl: "https://verifier-public.trycloudflare.com",
    issuerBaseUrl: "https://issuer-public.trycloudflare.com",
    vctUrl: "https://issuer-public.trycloudflare.com/types/graduation-record/v1",
    logsDir: testLogsDir,
  };

  it("loads configuration with appropriate defaults and overrides", () => {
    const originalEnv = { ...process.env };
    try {
      process.env.PORTAL_PORT = "7777";
      process.env.WALTID_BASE = "http://internal-verifier:7004/";
      process.env.VERIFIER_PUBLIC_URL = "https://custom-tunnel.trycloudflare.com/";
      process.env.ISSUER_BASE_URL = "https://custom-issuer.edu/";
      process.env.VCT_TYPE = "graduation-record"

      const config = loadPlaygroundConfig();
      expect(config.port).toBe(7777);
      expect(config.waltidBase).toBe("http://internal-verifier:7004");
      expect(config.verifierPublicUrl).toBe("https://custom-tunnel.trycloudflare.com");
      expect(config.issuerBaseUrl).toBe("https://custom-issuer.edu");
      expect(config.vctUrl).toBe(
        "https://custom-issuer.edu/types/graduation-record/v1"
      );

      // Verify VCT_TYPE and VCT_VERSION resolution (without reading host SCHEMA_PATH)
      process.env.VCT_TYPE = "show-all-policy";
      process.env.VCT_VERSION = "2";
      delete process.env.VCT_URL;
      const customConfig = loadPlaygroundConfig();
      expect(customConfig.vctUrl).toBe(
        "https://custom-issuer.edu/types/show-all-policy/v2"
      );
    } finally {
      process.env = originalEnv;
    }
  });

  it("rewrites internal verifier URLs to public tunnel URLs accurately (literal and encoded)", () => {
    const rawUrl =
      "openid4vp://authorize?client_id=redirect_uri%3Ahttp%3A%2F%2Flocalhost%3A7004%2Fresponse&request_uri=http%3A%2F%2Flocalhost%3A7004%2Frequest";
    const rewritten = rewriteAuthorizationUrl(
      rawUrl,
      "http://localhost:7004",
      "https://verifier-public.trycloudflare.com"
    );

    expect(rewritten).toBe(
      "openid4vp://authorize?client_id=redirect_uri%3Ahttps%3A%2F%2Fverifier-public.trycloudflare.com%2Fresponse&request_uri=https%3A%2F%2Fverifier-public.trycloudflare.com%2Frequest"
    );
    expect(rewritten).not.toContain("localhost");
  });

  it("preserves standard redirect_uri client identifier prefix for OpenID4VP cross-device direct post requests", () => {
    const rawUrl =
      "openid4vp://authorize?response_type=vp_token&client_id=redirect_uri%3Ahttps%3A%2F%2Fverifier-public.trycloudflare.com%2Fresponse&response_uri=https%3A%2F%2Fverifier-public.trycloudflare.com%2Fresponse&nonce=123";
    const rewritten = rewriteAuthorizationUrl(
      rawUrl,
      "http://localhost:7004",
      "https://verifier-public.trycloudflare.com"
    );

    const parsed = new URL(rewritten);
    expect(parsed.searchParams.get("client_id")).toBe(
      "redirect_uri:https://verifier-public.trycloudflare.com/response"
    );
    expect(parsed.searchParams.get("response_uri")).toBe(
      "https://verifier-public.trycloudflare.com/response"
    );
  });

  it("serves GET /health with 200 OK and service metadata", async () => {
    const app = createPlaygroundApp(mockConfig);
    const res = await app(new Request("http://localhost:3001/health"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("@unidipveri/playground");
  });

  it("creates a verification session via POST /api/session and returns SVG QR code", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/verification-session/create")) {
          return Response.json({
            sessionId: "session-test-xyz",
            bootstrapAuthorizationRequestUrl:
              "openid4vp://?client_id=http://localhost:7004/test",
            fullAuthorizationRequestUrl:
              "openid4vp://?client_id=http://localhost:7004/test&nonce=abc123",
          });
        }
        return new Response("Not Found", { status: 404 });
      }) as unknown as typeof fetch;

      const app = createPlaygroundApp(mockConfig);
      const res = await app(
        new Request("http://localhost:3001/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: "Paradym" }),
        })
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        sessionId: string;
        qrUri: string;
        qrSvg: string;
        status: string;
      };

      expect(data.sessionId).toBe("session-test-xyz");
      expect(data.qrUri).toContain("https://verifier-public.trycloudflare.com/test");
      expect(data.qrSvg).toContain("<svg");
      expect(data.status).toBe("PENDING");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("creates DCQL query with a unique UUID query credential id scoped strictly to the verification session", async () => {
    const originalFetch = globalThis.fetch;
    try {
      let capturedPayload: Record<string, any> | null = null;

      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/verification-session/create")) {
          if (init?.body) {
            capturedPayload = JSON.parse(init.body as string);
          }
          return Response.json({
            sessionId: "session-uuid-test",
            bootstrapAuthorizationRequestUrl: "openid4vp://?client_id=http://localhost:7004/test",
            fullAuthorizationRequestUrl: "openid4vp://?client_id=http://localhost:7004/test&nonce=456",
          });
        }
        return new Response("Not Found", { status: 404 });
      }) as unknown as typeof fetch;

      await createWaltidSession(mockConfig);

      expect(capturedPayload).not.toBeNull();
      if (!capturedPayload) {
        throw new Error("Verification session payload was not captured");
      }
      const credQuery = (capturedPayload as Record<string, any>).core_flow?.dcql_query?.credentials?.[0];
      expect(credQuery).toBeDefined();
      expect(credQuery?.id).toBeDefined();
      expect(typeof credQuery?.id).toBe("string");
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(credQuery?.id).toMatch(uuidRegex);

      const vcPolicies = (capturedPayload as Record<string, any>).core_flow?.policies?.vc_policies;
      expect(Array.isArray(vcPolicies)).toBe(true);
      const statusPolicy = vcPolicies.find((p: any) => p.policy === "credential-status");
      expect(statusPolicy).toBeDefined();
      expect(statusPolicy.argument).toEqual({ discriminator: "ietf", value: 0 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("resolves logging directory from environment variables and defaults", () => {
    const originalEnv = { ...process.env };
    try {
      delete process.env.LOGS_DIR;
      delete process.env.LOG_DIR;
      delete process.env.LOG_FILE;

      const expectedDefaultLogs = existsSync(join(process.cwd(), "..", "..", "packages"))
        ? join(process.cwd(), "..", "..", "logs")
        : join(process.cwd(), "logs");
      expect(resolveLogsDir()).toBe(expectedDefaultLogs);

      process.env.LOGS_DIR = "/custom/logs/dir";
      expect(resolveLogsDir()).toBe("/custom/logs/dir");

      delete process.env.LOGS_DIR;
      process.env.LOG_DIR = "/secondary/logs/dir";
      expect(resolveLogsDir()).toBe("/secondary/logs/dir");

      delete process.env.LOG_DIR;
      process.env.LOG_FILE = "/var/log/unidipveri/issuer.log";
      expect(resolveLogsDir()).toBe("/var/log/unidipveri");
    } finally {
      process.env = originalEnv;
    }
  });

  it("extracts verification telemetry, policy results, and disclosures from native Walt.id format", () => {
    const waltidNativeResponse: VerificationSessionInfo = {
      id: "session-waltid-1",
      status: "SUCCESSFUL",
      policy_results: {
        overallSuccess: true,
        vp_policies: {
          graduation_cred: {
            "dc+sd-jwt/audience-check": { success: true },
            "dc+sd-jwt/kb-jwt_signature": { success: true },
            "dc+sd-jwt/sd_hash-check": { success: true },
          },
        },
        vc_policies: [
          {
            policy: { id: "signature" },
            success: true,
            result: {
              credential_signature: {
                providedDisclosures: [
                  { name: "dateOfBirth", value: "2002-05-15", location: ["dateOfBirth"] },
                  {
                    name: "diploma",
                    value: {
                      _sd: ["hash1", "hash2"],
                      degreeName: "Bachelor of Science in Computer Science",
                    },
                    location: ["papers", "diploma"],
                  },
                ],
              },
            },
          },
        ],
      },
    };

    const auditData = extractSessionAuditData(waltidNativeResponse);
    expect(auditData.verificationResult).toBe(true);
    expect(auditData.policySummary["signature"]).toBe(true);
    expect(auditData.policySummary["graduation_cred (dc+sd-jwt/kb-jwt_signature)"]).toBe(true);
    expect(auditData.disclosures).toHaveLength(2);
    expect(auditData.disclosures[0].name).toBe("dateOfBirth");
    expect(auditData.disclosures[0].value).toBe("2002-05-15");

    const markdown = formatAuditSummaryMarkdown(
      "session-waltid-1",
      waltidNativeResponse,
      auditData
    );
    expect(markdown).toContain("Overall Status:** **SUCCESSFUL**");
    expect(markdown).toContain("Verification Result:** `true`");
    expect(markdown).toContain("dateOfBirth");
    expect(markdown).toContain("Bachelor of Science in Computer Science");
    expect(markdown).toContain("2 nested claims selectively concealed");
    expect(markdown).not.toContain("issuer.log");
  });

  it("extracts human-readable failure reason and violations on policy rejection", () => {
    const failedSessionResponse: VerificationSessionInfo = {
      id: "session-revoked-1",
      status: "FAILED",
      verificationResult: false,
      failure: {
        type: "vc_policy_violations",
        reason: "1 credential policy violation(s)",
        violations: [
          {
            policy: {
              id: "credential-status",
              policy: "credential-status",
            },
            error: "Status validation failed: expected one of [0], but got 1",
          },
        ],
      },
      policy_results: {
        overallSuccess: false,
        vc_policies: [
          {
            policy: { id: "signature" },
            success: true,
          },
          {
            policy: { id: "credential-status" },
            success: false,
            error: "Status validation failed: expected one of [0], but got 1",
          },
        ],
      },
    };

    const auditData = extractSessionAuditData(failedSessionResponse);
    expect(auditData.verificationResult).toBe(false);
    expect(auditData.failureReason).toContain("Credential Revoked");
    expect(auditData.violations).toBeDefined();
    expect(auditData.violations).toHaveLength(1);
    expect(auditData.violations![0].policy).toBe("credential-status");
    expect(auditData.violations![0].error).toContain("expected one of [0], but got 1");

    const markdown = formatAuditSummaryMarkdown(
      "session-revoked-1",
      failedSessionResponse,
      auditData
    );
    expect(markdown).toContain("Overall Status:** **FAILED**");
    expect(markdown).toContain("Rejection Reason");
    expect(markdown).toContain("Credential Revoked");
    expect(markdown).toContain("expected one of [0], but got 1");
  });

  it("persists raw verifier evidence and audit summary to disk without copying issuer logs", () => {
    try {
      const mockSessionInfo: VerificationSessionInfo = {
        id: "session-evidence-1",
        status: "SUCCESSFUL",
        verificationResult: true,
        policyResults: {
          graduation_cred: [
            { policy: "signature", is_success: true },
            { policy: "dc+sd-jwt/kb-jwt_signature", is_success: true },
            { policy: "dc+sd-jwt/sd_hash-check", is_success: true },
          ],
        },
        data: {
          disclosures: [
            { name: "dateOfBirth", value: "2001-05-14" },
            { name: "degreeName", value: "Bachelor of Science in Computer Science" },
          ],
        },
      };

      const savedDir = persistSessionEvidence(
        mockConfig,
        "session-evidence-1",
        mockSessionInfo
      );

      expect(existsSync(savedDir)).toBe(true);

      const verifierFile = join(savedDir, "verifier-response.json");
      expect(existsSync(verifierFile)).toBe(true);
      const verifierContent = JSON.parse(readFileSync(verifierFile, "utf-8"));
      expect(verifierContent.status).toBe("SUCCESSFUL");

      // Verify that issuer.log is NOT created in playground session folder
      const issuerLogFile = join(savedDir, "issuer.log");
      expect(existsSync(issuerLogFile)).toBe(false);

      const summaryFile = join(savedDir, "audit-summary.md");
      expect(existsSync(summaryFile)).toBe(true);
      const summaryText = readFileSync(summaryFile, "utf-8");
      expect(summaryText).toContain("session-evidence-1");
      expect(summaryText).toContain("Overall Status:** **SUCCESSFUL**");
      expect(summaryText).toContain("Verification Result:** `true`");
      expect(summaryText).toContain("dateOfBirth");
      expect(summaryText).toContain("degreeName");
      expect(summaryText).not.toContain("issuer.log");

      // Verify file permissions (0600)
      const fileStat = statSync(verifierFile);
      const fileMode = fileStat.mode & 0o777;
      expect(fileMode).toBe(0o600);
    } finally {
      if (existsSync(testLogsDir)) {
        rmSync(testLogsDir, { recursive: true, force: true });
      }
    }
  });

  it("automatically saves session evidence upon polling successful status on GET /api/status", async () => {
    const originalFetch = globalThis.fetch;
    try {
      let createCallCount = 0;
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/verification-session/create")) {
          createCallCount++;
          return Response.json({
            sessionId: "session-auto-save-1",
            bootstrapAuthorizationRequestUrl:
              "openid4vp://?client_id=http://localhost:7004/test",
            fullAuthorizationRequestUrl:
              "openid4vp://?client_id=http://localhost:7004/test&nonce=123",
          });
        }
        if (url.includes("/verification-session/session-auto-save-1/info")) {
          return Response.json({
            id: "session-auto-save-1",
            status: "SUCCESSFUL",
            verificationResult: true,
            policyResults: {
              graduation_cred: [{ policy: "signature", is_success: true }],
            },
          });
        }
        return new Response("Not Found", { status: 404 });
      }) as unknown as typeof fetch;

      const app = createPlaygroundApp(mockConfig);

      // 1. Create session
      await app(
        new Request("http://localhost:3001/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })
      );

      // 2. Poll status
      const statusRes = await app(
        new Request(
          "http://localhost:3001/api/status?sessionId=session-auto-save-1"
        )
      );
      expect(statusRes.status).toBe(200);
      const statusData = (await statusRes.json()) as {
        status: string;
        savedDir?: string;
      };

      expect(statusData.status).toBe("SUCCESSFUL");
      expect(statusData.savedDir).toBeDefined();
      expect(existsSync(statusData.savedDir!)).toBe(true);
      expect(existsSync(join(statusData.savedDir!, "verifier-response.json"))).toBe(
        true
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (existsSync(testLogsDir)) {
        rmSync(testLogsDir, { recursive: true, force: true });
      }
    }
  });

  it("renders the interactive HTML portal on GET /", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/verification-session/create")) {
          return Response.json({
            sessionId: "session-portal-1",
            fullAuthorizationRequestUrl:
              "openid4vp://?client_id=http://localhost:7004/test",
          });
        }
        return new Response("Not Found", { status: 404 });
      }) as unknown as typeof fetch;

      const app = createPlaygroundApp(mockConfig);
      const res = await app(new Request("http://localhost:3001/"));

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      const html = await res.text();
      expect(html).toContain("UniDipVeri Presentation Showcase");
      expect(html).toContain("<svg");
      expect(html).toContain("rejectionBanner");
      expect(html).toContain("rejectionTitle");
      expect(html).toContain("successBanner");
      expect(html).toContain("Policy Verification Checklist");
      expect(html).toContain("session-portal-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
