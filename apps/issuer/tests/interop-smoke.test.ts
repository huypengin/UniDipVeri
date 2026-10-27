import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createHash } from "node:crypto";
import * as jose from "jose";
import { SDJwtVcInstance } from "@sd-jwt/sd-jwt-vc";
import { loadSchemaFromFile, SD_JWT_VC_TYP, resolveVct } from "@unidipveri/core";
import { createApp } from "../src/app.js";
import { SessionManager } from "../src/services/session-manager.js";
import { StudentRecordService } from "../src/services/student-records.js";
import { StatusListService } from "../src/services/status-list.js";
import { initializeKeyManager } from "../src/services/key-manager.js";
import type { IssuerConfig } from "../src/config.js";

/**
 * Development-Only Regression Smoke Test.
 *
 * NOTE: This test serves strictly as an internal development regression check to
 * ensure our issuer emits wire serialization accepted by an off-the-shelf library.
 * Because it executes in-process and injects local verification callbacks, it is
 * NOT counted as independent third-party interoperability evidence.
 */
describe("Off-The-Shelf SD-JWT VC Library Acceptance Smoke Test (Regression Check Only)", () => {
  const schemaPath = join(
    import.meta.dir,
    "../../../schemas/graduation-record.v1.yaml"
  );

  const mockConfig: IssuerConfig = {
    schemaPath,
    signingAlgorithm: "ES256",
    keyId: "issuer-key-1",
    issuerDid: "did:web:issuer.university.edu",
    baseUrl: "https://issuer.university.edu",
    vctBaseUrl: "https://issuer.university.edu",
    issuerIdentifierMode: "did",
    port: 3000,
    enableLegacyVcFormat: false,
  };

  it("ensures an off-the-shelf SD-JWT VC reference library accepts and validates an issued credential", async () => {
    // 1. Initialize issuer app
    const schemaConfig = await loadSchemaFromFile(schemaPath);
    const keyContext = await initializeKeyManager(mockConfig);
    const sessionManager = new SessionManager();
    const studentRecordsService = new StudentRecordService();
    const statusListService = new StatusListService();

    const app = createApp(
      mockConfig,
      keyContext,
      schemaConfig,
      sessionManager,
      studentRecordsService,
      statusListService
    );

    // 2. Request credential offer for student record
    const offerRes = await app(
      new Request("https://issuer.university.edu/credential-offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: "STU-2026-FINAL",
          credential_configuration_id: "graduation_record_sd_jwt_vc",
        }),
      })
    );
    expect(offerRes.status).toBe(200);
    const offerData = (await offerRes.json()) as {
      credential_offer: {
        grants: {
          "urn:ietf:params:oauth:grant-type:pre-authorized_code": {
            "pre-authorized_code": string;
          };
        };
      };
    };
    const preAuthCode =
      offerData.credential_offer.grants[
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      ]["pre-authorized_code"];

    // 3. Token exchange
    const tokenRes = await app(
      new Request("https://issuer.university.edu/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Apre-authorized_code&pre-authorized_code=${encodeURIComponent(
          preAuthCode
        )}`,
      })
    );
    expect(tokenRes.status).toBe(200);
    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      c_nonce: string;
    };

    // 4. Generate holder key pair and proof of possession
    const holderKeyPair = await jose.generateKeyPair("ES256", { extractable: true });
    const holderPublicJwk = await jose.exportJWK(holderKeyPair.publicKey);
    const proofJwt = await new jose.SignJWT({
      aud: mockConfig.baseUrl,
      nonce: tokenData.c_nonce,
      iat: Math.floor(Date.now() / 1000),
    })
      .setProtectedHeader({
        alg: "ES256",
        typ: "openid-credential-proof+jwt",
        jwk: holderPublicJwk,
      })
      .sign(holderKeyPair.privateKey);

    // 5. Issue credential
    const credRes = await app(
      new Request("https://issuer.university.edu/credential", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          credential_configuration_id: "graduation_record_sd_jwt_vc",
          proof: {
            proof_type: "jwt",
            jwt: proofJwt,
          },
        }),
      })
    );
    expect(credRes.status).toBe(200);
    const credData = (await credRes.json()) as { credential: string };
    const issuedCredential = credData.credential;
    expect(typeof issuedCredential).toBe("string");

    // 6. Fetch published public key from DID document endpoint
    const didRes = await app(
      new Request("https://issuer.university.edu/.well-known/did.json", {
        method: "GET",
      })
    );
    expect(didRes.status).toBe(200);
    const didDoc = (await didRes.json()) as {
      verificationMethod: Array<{ id: string; publicKeyJwk: jose.JWK }>;
    };
    const publishedKey = didDoc.verificationMethod[0]?.publicKeyJwk;
    expect(publishedKey).toBeDefined();

    // 7. Verify using off-the-shelf reference library (@sd-jwt/sd-jwt-vc)
    const hasher = (data: string | ArrayBuffer) =>
      createHash("sha256")
        .update(typeof data === "string" ? data : new Uint8Array(data))
        .digest();

    const verifierCallback = async (data: string, signature: string) => {
      try {
        const key = await jose.importJWK(publishedKey, "ES256");
        await jose.compactVerify(`${data}.${signature}`, key);
        return true;
      } catch {
        return false;
      }
    };

    const offTheShelfInstance = new SDJwtVcInstance({
      verifier: verifierCallback,
      hasher,
    });

    // Decode and verify with the third-party library
    const decoded = await offTheShelfInstance.decode(issuedCredential);

    // Verify outer JWT header conforms to SD-JWT VC profile
    const header = decoded.jwt?.header as Record<string, unknown>;
    expect(header.typ).toBe(SD_JWT_VC_TYP);
    expect(header.alg).toBe("ES256");
    expect(header.kid).toBe(`${mockConfig.issuerDid}#${mockConfig.keyId}`);

    // Verify outer payload contains correct claims and selective disclosure digest structures
    const payload = decoded.jwt?.payload as Record<string, unknown>;
    expect(payload.iss).toBe(mockConfig.issuerDid);
    expect(payload.vct).toBe(
      resolveVct("/types/graduation-record/v1", mockConfig.vctBaseUrl)
    );
    expect(payload.cnf).toBeDefined();
    expect(Array.isArray(payload._sd)).toBe(true);

    // Verify disclosures are non-empty and correctly parsed by reference library
    expect(decoded.disclosures).toBeDefined();
    expect(decoded.disclosures?.length).toBeGreaterThan(0);

    // Verify claim reconstruction using reference library getClaims()
    const claims = (await decoded.getClaims(hasher)) as Record<string, unknown>;
    expect(claims.studentId).toBe("STU-2026-FINAL");
    expect(claims.dateOfBirth).toBe("2002-05-15");
    expect(claims.papers).toBeDefined();

    const papers = claims.papers as { diploma: { degreeName: string } };
    expect(papers.diploma.degreeName).toBe("Bachelor of Science in Computer Science");
  });
});
