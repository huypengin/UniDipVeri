import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as fs from "node:fs";
import { createServer as createNetServer } from "node:net";
import * as jose from "jose";
import { decompressAndGetBit } from "../src/services/status-list.js";
import { startServer } from "../src/server.js";

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.listen(0, () => {
      const address = s.address();
      const port = typeof address === "object" && address ? address.port : 0;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

describe("Issuer Restart Persistence (Key Retention & Status List Durability)", () => {
  const schemaPath = join(
    import.meta.dir,
    "../../../schemas/graduation-record.v1.yaml"
  );

  it("refuses to start in non-dev mode (NODE_ENV=production) when ISSUER_PRIVATE_KEY_JWK is missing", () => {
    expect(
      startServer({
        NODE_ENV: "production",
        SCHEMA_PATH: schemaPath,
        ISSUER_BASE_URL: "https://issuer.university.edu",
        VCT_BASE_URL: "https://credentials.university.edu",
      })
    ).rejects.toThrow(
      "Production configuration error: ISSUER_PRIVATE_KEY_JWK must be provided in production mode"
    );
  });

  it("preserves issuer signing key and status list revocation state across server restarts", async () => {
    // 1. Generate persistent ES256 Issuer key pair
    const persistentKeyPair = await jose.generateKeyPair("ES256", {
      extractable: true,
    });
    const persistentPrivJwk = await jose.exportJWK(persistentKeyPair.privateKey);
    persistentPrivJwk.kid = "persistent-key-1";
    const persistentPubJwk = await jose.exportJWK(persistentKeyPair.publicKey);
    persistentPubJwk.kid = "persistent-key-1";
    const privateKeyJwkJson = JSON.stringify(persistentPrivJwk);

    // 2. Setup temporary status list storage path
    const testDir = join(
      tmpdir(),
      `unidipveri-restart-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    );
    const statusListPath = join(testDir, "status-list.json");

    const port1 = await getAvailablePort();
    const baseUrl1 = `http://localhost:${port1}`;
    const did1 = `did:web:localhost%3A${port1}`;

    // 3. Start Server 1 with static key and file storage path
    const runtime1 = await startServer({
      PORT: String(port1),
      ISSUER_BASE_URL: baseUrl1,
      ISSUER_DID: did1,
      SCHEMA_PATH: schemaPath,
      KEY_ID: "persistent-key-1",
      ISSUER_PRIVATE_KEY_JWK: privateKeyJwkJson,
      STATUS_LIST_PATH: statusListPath,
    });

    try {
      // Verify Server 1 DID Document has persistent public key
      const didRes1 = await fetch(`${baseUrl1}/.well-known/did.json`);
      expect(didRes1.status).toBe(200);
      const didDoc1 = (await didRes1.json()) as {
        verificationMethod?: Array<{ publicKeyJwk?: jose.JWK }>;
      };
      expect(didDoc1.verificationMethod?.[0]?.publicKeyJwk?.x).toBe(persistentPubJwk.x);
      expect(didDoc1.verificationMethod?.[0]?.publicKeyJwk?.y).toBe(persistentPubJwk.y);

      // Helper function to issue credential via OpenID4VCI
      async function issueCredential(baseUrl: string, studentId: string) {
        // Step A: Credential Offer
        const offerRes = await fetch(`${baseUrl}/credential-offer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId,
            credential_configuration_id: "graduation_record_sd_jwt_vc",
          }),
        });
        expect(offerRes.status).toBe(200);
        const offerData = (await offerRes.json()) as any;
        const preAuthCode =
          offerData.credential_offer.grants[
            "urn:ietf:params:oauth:grant-type:pre-authorized_code"
          ]["pre-authorized_code"];

        // Step B: Token Exchange
        const tokenRes = await fetch(`${baseUrl}/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:pre-authorized_code",
            "pre-authorized_code": preAuthCode,
          }).toString(),
        });
        expect(tokenRes.status).toBe(200);
        const tokenData = (await tokenRes.json()) as any;
        const accessToken = tokenData.access_token;

        // Step C: DPoP/Proof Nonce
        const nonceRes = await fetch(`${baseUrl}/nonce`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        expect(nonceRes.status).toBe(200);
        const { c_nonce } = (await nonceRes.json()) as { c_nonce: string };

        // Step D: Holder Key and Proof-of-Possession JWT
        const holderKeyPair = await jose.generateKeyPair("ES256", { extractable: true });
        const holderJwk = await jose.exportJWK(holderKeyPair.publicKey);
        const proofJwt = await new jose.SignJWT({
          aud: baseUrl,
          nonce: c_nonce,
          iat: Math.floor(Date.now() / 1000),
        })
          .setProtectedHeader({
            alg: "ES256",
            typ: "openid4vci-proof+jwt",
            jwk: holderJwk,
          })
          .sign(holderKeyPair.privateKey);

        // Step E: Request Credential
        const credRes = await fetch(`${baseUrl}/credential`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            credential_configuration_id: "graduation_record_sd_jwt_vc",
            proofs: {
              jwt: [proofJwt],
            },
          }),
        });
        expect(credRes.status).toBe(200);
        const credData = (await credRes.json()) as {
          credentials: Array<{ credential: string }>;
        };
        const rawCred = credData.credentials[0].credential;
        const issuerJwt = rawCred.split("~")[0];
        const payload = jose.decodeJwt(issuerJwt) as any;
        return {
          credential: rawCred,
          statusIndex: payload.status?.status_list?.idx as number,
        };
      }

      // Issue Credential 1 (studentId: STU-1) -> Expect index 0
      const cred1 = await issueCredential(baseUrl1, "STU-2026-PERSIST-1");
      expect(cred1.statusIndex).toBe(0);

      // Issue Credential 2 (studentId: STU-2) -> Expect index 1
      const cred2 = await issueCredential(baseUrl1, "STU-2026-PERSIST-2");
      expect(cred2.statusIndex).toBe(1);

      // Revoke Credential 1 via Admin API
      const revokeRes = await fetch(`${baseUrl1}/admin/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idx: 0 }),
      });
      expect(revokeRes.status).toBe(200);
      const revokeBody = (await revokeRes.json()) as any;
      expect(revokeBody.revoked).toBe(true);
      expect(revokeBody.idx).toBe(0);

      // Verify status list on Server 1 shows index 0 revoked, index 1 active
      const statusRes1 = await fetch(`${baseUrl1}/status/status-list-1`);
      expect(statusRes1.status).toBe(200);
      const statusToken1 = await statusRes1.text();
      const statusPayload1 = jose.decodeJwt(statusToken1) as any;
      const lst1 = statusPayload1.status_list.lst;
      expect(decompressAndGetBit(lst1, 0)).toBe(1); // revoked
      expect(decompressAndGetBit(lst1, 1)).toBe(0); // active

      // 4. STOP SERVER 1 (simulating process restart)
      await runtime1.server.stop(true);

      // Verify status list file was written to disk
      expect(fs.existsSync(statusListPath)).toBe(true);

      // 5. START SERVER 2 with identical key and file storage path
      const port2 = await getAvailablePort();
      const baseUrl2 = `http://localhost:${port2}`;
      const did2 = `did:web:localhost%3A${port2}`;

      const runtime2 = await startServer({
        PORT: String(port2),
        ISSUER_BASE_URL: baseUrl2,
        ISSUER_DID: did2,
        SCHEMA_PATH: schemaPath,
        KEY_ID: "persistent-key-1",
        ISSUER_PRIVATE_KEY_JWK: privateKeyJwkJson,
        STATUS_LIST_PATH: statusListPath,
      });

      try {
        // Assert Server 2 has identical key context
        expect(runtime2.keyContext.keyId).toBe("persistent-key-1");
        expect(runtime2.keyContext.publicKeyJwk.x).toBe(persistentPubJwk.x);
        expect(runtime2.keyContext.publicKeyJwk.y).toBe(persistentPubJwk.y);

        // Verify Server 2 DID Document returns identical public key coordinates
        const didRes2 = await fetch(`${baseUrl2}/.well-known/did.json`);
        expect(didRes2.status).toBe(200);
        const didDoc2 = (await didRes2.json()) as {
          verificationMethod?: Array<{ publicKeyJwk?: jose.JWK }>;
        };
        expect(didDoc2.verificationMethod?.[0]?.publicKeyJwk?.x).toBe(persistentPubJwk.x);
        expect(didDoc2.verificationMethod?.[0]?.publicKeyJwk?.y).toBe(persistentPubJwk.y);

        // Assert Server 2 restored allocated count and revocation status from disk
        expect(runtime2.statusListService.allocatedCount).toBe(2);
        expect(runtime2.statusListService.isRevoked(0)).toBe(true);
        expect(runtime2.statusListService.isRevoked(1)).toBe(false);

        // Query Status List on Server 2
        const statusRes2 = await fetch(`${baseUrl2}/status/status-list-1`);
        expect(statusRes2.status).toBe(200);
        const statusToken2 = await statusRes2.text();

        // Verify Status List Token JWS signature using the persistent public key
        const importedPublicKey = await jose.importJWK(persistentPubJwk, "ES256");
        const { payload: verifiedPayload2 } = await jose.jwtVerify(statusToken2, importedPublicKey);
        const statusListObj2 = verifiedPayload2.status_list as { bits: number; lst: string };
        expect(decompressAndGetBit(statusListObj2.lst, 0)).toBe(1); // bit 0 retained revoked
        expect(decompressAndGetBit(statusListObj2.lst, 1)).toBe(0); // bit 1 retained active

        // Issue Credential 3 on Server 2: must allocate index 2 (no collision with index 0 or 1)
        const cred3 = await issueCredential(baseUrl2, "STU-2026-PERSIST-3");
        expect(cred3.statusIndex).toBe(2);
        expect(runtime2.statusListService.allocatedCount).toBe(3);

        // Query Status List again on Server 2: bit 0 = 1, bit 1 = 0, bit 2 = 0
        const statusRes3 = await fetch(`${baseUrl2}/status/status-list-1`);
        const statusToken3 = await statusRes3.text();
        const { payload: verifiedPayload3 } = await jose.jwtVerify(statusToken3, importedPublicKey);
        const statusListObj3 = verifiedPayload3.status_list as { bits: number; lst: string };
        expect(decompressAndGetBit(statusListObj3.lst, 0)).toBe(1);
        expect(decompressAndGetBit(statusListObj3.lst, 1)).toBe(0);
        expect(decompressAndGetBit(statusListObj3.lst, 2)).toBe(0);
      } finally {
        await runtime2.server.stop(true);
      }
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
