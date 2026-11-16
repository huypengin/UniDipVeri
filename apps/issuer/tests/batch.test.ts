import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import * as jose from "jose";
import { loadSchemaFromFile } from "@unidipveri/core";
import { loadIssuerConfig } from "../src/config.js";
import { initializeKeyManager } from "../src/services/key-manager.js";
import { SessionManager } from "../src/services/session-manager.js";
import { StatusListService } from "../src/services/status-list.js";
import { createApp } from "../src/app.js";
import { unzipArchive } from "../src/services/zip-archive.js";

const schemaPath = join(
  import.meta.dir,
  "../../../schemas/graduation-record.v1.yaml"
);
const schemaConfig = await loadSchemaFromFile(schemaPath);
const config = loadIssuerConfig({
  ISSUER_BASE_URL: "https://issuer.university.edu",
  ISSUER_DID: "did:web:issuer.university.edu",
  KEY_ID: "key-batch-test",
  SCHEMA_PATH: schemaPath,
});
const keyContext = await initializeKeyManager(config);

function createTestApp() {
  const sessionManager = new SessionManager();
  const statusListService = new StatusListService();
  const app = createApp(
    config,
    keyContext,
    schemaConfig,
    sessionManager,
    undefined,
    statusListService
  );
  return { app, sessionManager, statusListService };
}

const sampleCsvRows = [
  "studentId,fullName,dateOfBirth,nationalId,papers.diploma.degreeName,papers.diploma.degreeType,papers.diploma.programName,papers.diploma.major,papers.diploma.minor,papers.diploma.graduationDate,papers.diploma.honours,papers.transcript.transcriptId,papers.transcript.cumulativeGPA,papers.transcript.totalCredits,papers.transcript.courses",
  'ITIU22001001,Nguyen Van A,2004-05-12,079040001234,Bachelor of Science in Computer Science,Bachelor of Science,Computer Science and Engineering,Computer Science,Data Science,2026-06-30,First Class Honours,TR-2026-01001,3.85,136,"[{""code"":""CS101"",""title"":""Intro"",""credits"":3,""grade"":92.0,""letterGrade"":""A+""}]"',
  'EEIU22001002,Tran Thi B,2004-08-20,079040005678,Bachelor of Science in Electrical Engineering,Bachelor of Science,Electrical and Electronics Engineering,Electrical Engineering,,2026-06-30,,TR-2026-01002,3.65,130,"[{""code"":""EE101"",""title"":""Circuits"",""credits"":4,""grade"":85.0,""letterGrade"":""A""}]"',
].join("\n");

describe("Batch Issuance Engine & Route Endpoints", () => {
  describe("GET /batch-issue (Registrar Batch Portal UI)", () => {
    it("renders the interactive HTML upload interface with schema metadata", async () => {
      const { app } = createTestApp();
      const res = await app(new Request("https://issuer.university.edu/batch-issue"));

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");

      const html = await res.text();
      expect(html).toContain("Batch Academic Credential Issuance Pipeline");
      expect(html).toContain("Graduation Academic Record");
      expect(html).toContain("OID4VCI Bulk Distribution Architecture");
      expect(html).toContain("sample_graduation_batch.csv");
      expect(html).toContain("/batch-issue");
      expect(html).toContain('href="https://issuer.university.edu/style.css"');
    });

    it("serves a ready-to-use sample CSV template on GET /batch-issue?sample=csv", async () => {
      const { app } = createTestApp();
      const res = await app(
        new Request("https://issuer.university.edu/batch-issue?sample=csv")
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/csv");
      expect(res.headers.get("Content-Disposition")).toContain(
        'filename="sample_graduation_batch.csv"'
      );

      const csvContent = await res.text();
      expect(csvContent).toContain("studentId,fullName");
      expect(csvContent).toContain("papers.diploma.degreeName");
      expect(csvContent).toContain("papers.transcript.courses");
      expect(csvContent).toContain("ITIU22001001");
    });
  });

  describe("POST /batch-issue (OID4VCI Batch Pipeline Execution)", () => {
    it("processes a valid batch CSV and returns JSON with base64 ZIP package", async () => {
      const { app } = createTestApp();
      const res = await app(
        new Request("https://issuer.university.edu/batch-issue?format=json", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ csvText: sampleCsvRows }),
        })
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        success: boolean;
        totalRows: number;
        validCount: number;
        invalidCount: number;
        claimMode: string;
        zipBase64: string;
        filename: string;
      };

      expect(data.success).toBe(true);
      expect(data.totalRows).toBe(2);
      expect(data.validCount).toBe(2);
      expect(data.invalidCount).toBe(0);
      expect(data.claimMode).toBe("JIT_ON_OID4VCI_EXCHANGE");
      expect(data.zipBase64).toBeDefined();

      // Unpack base64 ZIP and verify contents
      const zipBuffer = Buffer.from(data.zipBase64, "base64");
      const files = unzipArchive(zipBuffer);

      // Verify presence of all expected files
      expect(files.size).toBe(4);
      expect(files.has("manifest.json")).toBe(true);
      expect(files.has("offers.csv")).toBe(true);
      expect(files.has("qr-codes/ITIU22001001_offer.png")).toBe(true);
      expect(files.has("qr-codes/EEIU22001002_offer.png")).toBe(true);

      // Verify manifest.json
      const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8"));
      expect(manifest.totalRows).toBe(2);
      expect(manifest.validCount).toBe(2);
      expect(manifest.invalidCount).toBe(0);
      expect(manifest.claimMode).toBe("JIT_ON_OID4VCI_EXCHANGE");
      expect(manifest.statusListUri).toBe(
        "https://issuer.university.edu/status/status-list-1"
      );

      // Verify offers.csv
      const offersCsv = files.get("offers.csv")!.toString("utf8");
      expect(offersCsv).toContain("ITIU22001001");
      expect(offersCsv).toContain("openid-credential-offer://");
      expect(offersCsv).toContain("PENDING_CLAIM");

      // Verify QR Code PNG magic bytes (0x89 50 4E 47)
      const qrBytes = files.get("qr-codes/ITIU22001001_offer.png")!;
      expect(qrBytes[0]).toBe(0x89);
      expect(qrBytes[1]).toBe(0x50);
      expect(qrBytes[2]).toBe(0x4e);
      expect(qrBytes[3]).toBe(0x47);
    });

    it("streams binary application/zip response on form submission", async () => {
      const { app } = createTestApp();
      const res = await app(
        new Request("https://issuer.university.edu/batch-issue", {
          method: "POST",
          headers: {
            "Content-Type": "text/csv",
            Accept: "application/zip",
          },
          body: sampleCsvRows,
        })
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/zip");
      expect(res.headers.get("Content-Disposition")).toContain(
        'filename="graduation-batch-'
      );
      expect(res.headers.get("X-Batch-Total")).toBe("2");
      expect(res.headers.get("X-Batch-Valid")).toBe("2");

      const zipArrayBuffer = await res.arrayBuffer();
      const zipBuffer = Buffer.from(zipArrayBuffer);
      const files = unzipArchive(zipBuffer);

      expect(files.size).toBe(4);
      expect(files.has("manifest.json")).toBe(true);
      expect(files.has("offers.csv")).toBe(true);
    });

    it("segregates valid and invalid rows into manifest telemetry while issuing valid rows", async () => {
      const { app } = createTestApp();
      const mixedCsv = [
        "studentId,fullName,dateOfBirth,nationalId,papers.diploma.degreeName,papers.diploma.degreeType,papers.diploma.programName,papers.diploma.major,papers.diploma.minor,papers.diploma.graduationDate,papers.diploma.honours,papers.transcript.transcriptId,papers.transcript.cumulativeGPA,papers.transcript.totalCredits,papers.transcript.courses",
        // Valid row 1
        'STU-GOOD-1,Alice Student,2004-05-12,079040001234,B.S. CS,B.S.,CS,CS,,2026-06-30,,TR-001,3.85,136,"[]"',
        // Invalid row 2 (missing required papers.diploma.major)
        'STU-BAD-2,Bob Student,2004-08-20,079040005678,B.S. CS,B.S.,CS,,,2026-06-30,,TR-002,3.65,130,"[]"',
      ].join("\n");

      const res = await app(
        new Request("https://issuer.university.edu/batch-issue?format=json", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ csvText: mixedCsv }),
        })
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        success: boolean;
        totalRows: number;
        validCount: number;
        invalidCount: number;
        errors: Array<{ rowIndex: number; studentId: string; message: string }>;
        zipBase64: string;
      };

      expect(data.totalRows).toBe(2);
      expect(data.validCount).toBe(1);
      expect(data.invalidCount).toBe(1);
      expect(data.errors.length).toBeGreaterThanOrEqual(1);
      expect(data.errors[0].studentId).toBe("STU-BAD-2");
      expect(data.errors[0].message).toContain('Missing required claim: "papers.diploma.major"');

      // Unpack ZIP and ensure only valid record was packaged
      const files = unzipArchive(Buffer.from(data.zipBase64, "base64"));
      expect(files.size).toBe(3);
      expect(files.has("manifest.json")).toBe(true);
      expect(files.has("offers.csv")).toBe(true);
      expect(files.has("qr-codes/STU-GOOD-1_offer.png")).toBe(true);
      expect(files.has("qr-codes/STU-BAD-2_offer.png")).toBe(false);
    });

    it("returns 400 Bad Request when request body is empty or lacks CSV", async () => {
      const { app } = createTestApp();
      const res = await app(
        new Request("https://issuer.university.edu/batch-issue", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        })
      );

      expect(res.status).toBe(400);
      const err = (await res.json()) as { error: string; error_description: string };
      expect(err.error).toBe("invalid_request");
      expect(err.error_description).toContain("Missing CSV payload");
    });

    it("enables standard OID4VCI token redemption for batch-generated pre-authorized codes", async () => {
      const { app } = createTestApp();

      // 1. Submit batch
      const batchRes = await app(
        new Request("https://issuer.university.edu/batch-issue?format=json", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csvText: sampleCsvRows }),
        })
      );
      expect(batchRes.status).toBe(200);
      const batchData = (await batchRes.json()) as { zipBase64: string };

      // 2. Extract code from offers.csv
      const files = unzipArchive(Buffer.from(batchData.zipBase64, "base64"));
      const offersCsv = files.get("offers.csv")!.toString("utf8");
      const firstLine = offersCsv.split("\n")[1]; // Header is line 0
      const code = firstLine.split(",")[3];
      expect(code).toBeDefined();
      expect(code.length).toBeGreaterThan(10);

      // 3. Redeem code at /token endpoint
      const tokenRes = await app(
        new Request("https://issuer.university.edu/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:pre-authorized_code",
            "pre-authorized_code": code,
          }).toString(),
        })
      );

      expect(tokenRes.status).toBe(200);
      const tokenData = (await tokenRes.json()) as {
        access_token: string;
        token_type: string;
        c_nonce: string;
      };
      expect(tokenData.access_token).toBeDefined();
      expect(tokenData.token_type).toBe("Bearer");
      expect(tokenData.c_nonce).toBeDefined();
    });

    it("allocates status list index Just-In-Time upon wallet redemption and enables revocation by student ID", async () => {
      const { app, statusListService } = createTestApp();

      // 1. Submit batch offers
      const batchRes = await app(
        new Request("https://issuer.university.edu/batch-issue?format=json", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csvText: sampleCsvRows }),
        })
      );
      expect(batchRes.status).toBe(200);

      // Verify zero status list indices are consumed prior to student claim (zero ghost entries)
      expect(statusListService.allocatedCount).toBe(0);

      // 2. Extract code for ITIU22001001 from offers.csv
      const batchData = (await batchRes.json()) as { zipBase64: string };
      const files = unzipArchive(Buffer.from(batchData.zipBase64, "base64"));
      const offersCsv = files.get("offers.csv")!.toString("utf8");
      const lines = offersCsv.split("\n");
      const line1 = lines[1].split(",");
      const studentId = line1[0];
      const preAuthCode = line1[3];
      expect(studentId).toBe("ITIU22001001");
      expect(line1[4]).toBe("PENDING_CLAIM");

      // 3. Student claims offer: Token Exchange (POST /token)
      const tokenRes = await app(
        new Request("https://issuer.university.edu/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:pre-authorized_code",
            "pre-authorized_code": preAuthCode,
          }).toString(),
        })
      );
      expect(tokenRes.status).toBe(200);
      const tokenData = (await tokenRes.json()) as {
        access_token: string;
        c_nonce: string;
      };

      // 4. Student wallet generates PoP and requests credential (POST /credential)
      const holderKeyPair = await jose.generateKeyPair("ES256", { extractable: true });
      const publicJwk = await jose.exportJWK(holderKeyPair.publicKey);
      const proofJwt = await new jose.SignJWT({
        aud: "https://issuer.university.edu",
        iat: Math.floor(Date.now() / 1000),
        nonce: tokenData.c_nonce,
      })
        .setProtectedHeader({
          alg: "ES256",
          typ: "openid-credential-proof+jwt",
          jwk: publicJwk,
        })
        .sign(holderKeyPair.privateKey);

      const credRes = await app(
        new Request("https://issuer.university.edu/credential", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            credential_configuration_id: "graduation_record_sd_jwt_vc",
            proof: { proof_type: "jwt", jwt: proofJwt },
          }),
        })
      );
      expect(credRes.status).toBe(200);

      // Verify that status list index was allocated Just-In-Time upon actual claim
      expect(statusListService.allocatedCount).toBe(1);

      // 5. Query student status via /admin/status/student/:studentId
      const statusRes = await app(
        new Request("https://issuer.university.edu/admin/status/student/ITIU22001001", {
          method: "GET",
        })
      );
      expect(statusRes.status).toBe(200);
      const statusData = (await statusRes.json()) as {
        studentId: string;
        credentials: Array<{ index: number; revoked: boolean; status: string }>;
      };
      expect(statusData.studentId).toBe("ITIU22001001");
      expect(statusData.credentials.length).toBe(1);
      const allocatedIndex = statusData.credentials[0].index;
      expect(allocatedIndex).toBe(0);
      expect(statusData.credentials[0].revoked).toBe(false);

      // 6. Revoke claimed credential by studentId
      const revokeRes = await app(
        new Request("https://issuer.university.edu/admin/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId: "ITIU22001001" }),
        })
      );
      expect(revokeRes.status).toBe(200);
      const revokeData = (await revokeRes.json()) as {
        status: string;
        studentId: string;
        indices: number[];
      };
      expect(revokeData.studentId).toBe("ITIU22001001");
      expect(revokeData.indices).toContain(allocatedIndex);
      expect(statusListService.isRevoked(allocatedIndex)).toBe(true);
    });
  });
});
