import { describe, expect, it } from "bun:test";
import {
  categorizeClaimPath,
  formatClaimLabel,
  isLeafClaimPath,
  resolveDiscoveryMetadata,
  FALLBACK_DISCOVERED_CLAIMS,
} from "../src/discovery.js";
import type { PlaygroundConfig } from "../src/server.js";

describe("Playground Field Discovery", () => {
  const mockConfig: PlaygroundConfig = {
    port: 3001,
    waltidBase: "http://localhost:7004",
    verifierPublicUrl: "https://verifier-public.trycloudflare.com",
    issuerBaseUrl: "https://issuer-public.trycloudflare.com",
    vctUrl: "https://issuer-public.trycloudflare.com/types/graduation-record/v1",
    logsDir: "/tmp/logs",
  };

  it("identifies leaf claim paths and distinguishes them from parent container paths", () => {
    const allCandidatePaths = [
      ["studentId"],
      ["dateOfBirth"],
      ["papers"],
      ["papers", "diploma"],
      ["papers", "diploma", "degreeName"],
      ["papers", "diploma", "major"],
      ["papers", "transcript"],
      ["papers", "transcript", "cumulativeGPA"],
      ["papers", "transcript", "courses"],
      ["papers", "transcript", "courses", null, "grade"],
    ];

    // Leaf claims should return true
    expect(isLeafClaimPath(["studentId"], allCandidatePaths)).toBe(true);
    expect(isLeafClaimPath(["dateOfBirth"], allCandidatePaths)).toBe(true);
    expect(isLeafClaimPath(["papers", "diploma", "degreeName"], allCandidatePaths)).toBe(true);
    expect(isLeafClaimPath(["papers", "diploma", "major"], allCandidatePaths)).toBe(true);
    expect(isLeafClaimPath(["papers", "transcript", "cumulativeGPA"], allCandidatePaths)).toBe(true);

    // Container/parent paths (including objects and array containers with child items) should return false
    expect(isLeafClaimPath(["papers"], allCandidatePaths)).toBe(false);
    expect(isLeafClaimPath(["papers", "diploma"], allCandidatePaths)).toBe(false);
    expect(isLeafClaimPath(["papers", "transcript"], allCandidatePaths)).toBe(false);
    expect(isLeafClaimPath(["papers", "transcript", "courses"], allCandidatePaths)).toBe(false);

    // Empty path should return false
    expect(isLeafClaimPath([], allCandidatePaths)).toBe(false);
  });

  it("formats camelCase and snake_case keys into readable titles with acronym capitalization", () => {
    expect(formatClaimLabel("studentId")).toBe("Student ID");
    expect(formatClaimLabel("cumulativeGPA")).toBe("Cumulative GPA");
    expect(formatClaimLabel("dateOfBirth")).toBe("Date Of Birth");
    expect(formatClaimLabel("program_name")).toBe("Program Name");
    expect(formatClaimLabel("graduationDate")).toBe("Graduation Date");
    expect(formatClaimLabel("totalCredits")).toBe("Total Credits");
  });

  it("categorizes claim paths dynamically from path hierarchy into schema-agnostic groups", () => {
    expect(categorizeClaimPath(["studentId"])).toBe("General");
    expect(categorizeClaimPath(["fullName"])).toBe("General");
    expect(categorizeClaimPath(["dateOfBirth"])).toBe("General");
    expect(categorizeClaimPath(["papers", "diploma", "degreeName"])).toBe("Papers › Diploma");
    expect(categorizeClaimPath(["papers", "diploma", "graduationDate"])).toBe("Papers › Diploma");
    expect(categorizeClaimPath(["papers", "transcript", "cumulativeGPA"])).toBe("Papers › Transcript");
    expect(categorizeClaimPath(["papers", "otherSection", "field"])).toBe("Papers › Other Section");
    expect(categorizeClaimPath(["address", "street"])).toBe("Address");
    expect(categorizeClaimPath(["organization", "department", "team", "lead"])).toBe("Organization › Department › Team");
    expect(categorizeClaimPath([])).toBe("General");
  });

  it("resolves discovery metadata from issuer endpoints when reachable", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.includes("/.well-known/openid-credential-issuer")) {
          return Response.json({
            credential_issuer: "https://issuer-public.trycloudflare.com",
            credential_configurations_supported: {
              GraduationRecord: {
                vct: "https://issuer-public.trycloudflare.com/types/graduation-record/v1",
                display: [{ name: "University Academic Record" }],
              },
            },
          });
        }

        if (url.includes("/types/graduation-record/v1")) {
          return Response.json({
            vct: "https://issuer-public.trycloudflare.com/types/graduation-record/v1",
            name: "University Academic Record",
            claims: [
              {
                path: ["studentId"],
                display: [{ label: "Student Identifier" }],
                sd: "never",
                mandatory: true,
              },
              {
                path: ["dateOfBirth"],
                display: [{ label: "Date of Birth" }],
                sd: "always",
                mandatory: false,
              },
              {
                path: ["papers"],
                display: [{ label: "Papers Container" }],
                sd: "never",
                mandatory: true,
              },
              {
                path: ["papers", "diploma"],
                display: [{ label: "Diploma Container" }],
                sd: "always",
                mandatory: true,
              },
              {
                path: ["papers", "diploma", "degreeName"],
                display: [{ label: "Conferred Degree" }],
                sd: "never",
                mandatory: true,
              },
              {
                path: ["papers", "diploma", "major"],
                display: [{ label: "Academic Major" }],
                sd: "always",
                mandatory: true,
              },
              {
                path: ["papers", "transcript", "courses"],
                display: [{ label: "Courses Container" }],
                sd: "always",
                mandatory: true,
              },
              {
                path: ["papers", "transcript", "courses", null, "code"],
                display: [{ label: "Course Code" }],
                sd: "always",
              },
            ],
          });
        }

        return new Response("Not Found", { status: 404 });
      }) as unknown as typeof fetch;

      const discovery = await resolveDiscoveryMetadata(mockConfig);

      expect(discovery.vct).toBe(
        "https://issuer-public.trycloudflare.com/types/graduation-record/v1"
      );
      expect(discovery.credentialName).toBe("University Academic Record");

      // Wildcard paths ending in null and intermediate container objects (including courses array) should be filtered out
      expect(discovery.claims).toHaveLength(4);
      expect(discovery.claims.map((c) => c.pathKey)).toEqual([
        "studentId",
        "dateOfBirth",
        "papers.diploma.degreeName",
        "papers.diploma.major",
      ]);
      expect(discovery.claims.some((c) => c.pathKey === "papers")).toBe(false);
      expect(discovery.claims.some((c) => c.pathKey === "papers.diploma")).toBe(false);
      expect(discovery.claims.some((c) => c.pathKey === "papers.transcript.courses")).toBe(false);

      const dobClaim = discovery.claims.find((c) => c.pathKey === "dateOfBirth");
      expect(dobClaim?.sdPolicy).toBe("selectively_disclosable");
      expect(dobClaim?.category).toBe("General");

      const degreeClaim = discovery.claims.find((c) => c.pathKey === "papers.diploma.degreeName");
      expect(degreeClaim?.category).toBe("Papers › Diploma");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("falls back to built-in academic credential defaults when issuer endpoints are unavailable", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        throw new Error("Network connection refused");
      }) as unknown as typeof fetch;

      const discovery = await resolveDiscoveryMetadata(mockConfig);

      expect(discovery.vct).toBe(mockConfig.vctUrl);
      expect(discovery.credentialName).toBe("Graduation Academic Record");
      expect(discovery.claims).toEqual(FALLBACK_DISCOVERED_CLAIMS);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
