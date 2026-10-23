import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { loadSchemaFromFile } from "@unidipveri/core";
import { loadIssuerConfig } from "../src/config.js";
import { initializeKeyManager } from "../src/services/key-manager.js";
import { SessionManager } from "../src/services/session-manager.js";
import { createApp } from "../src/app.js";
import type { CredentialOfferResponse } from "../src/routes/offer.js";

const schemaPath = join(
  import.meta.dir,
  "../../../schemas/graduation-record.v1.yaml"
);
const schemaConfig = await loadSchemaFromFile(schemaPath);
const config = loadIssuerConfig({
  ISSUER_BASE_URL: "https://issuer.university.edu",
  ISSUER_DID: "did:web:issuer.university.edu",
  KEY_ID: "key-auth-flow-1",
  SCHEMA_PATH: schemaPath,
});
const keyContext = await initializeKeyManager(config);
const sessionManager = new SessionManager();
const app = createApp(config, keyContext, schemaConfig, sessionManager);

describe("End-to-End Authorization & Security Flow", () => {
  describe("Happy Path: Standard Pre-Authorized Code Issuance Flow", () => {
    it("completes full offer -> token exchange and issues bearer access token with c_nonce", async () => {
      // Step 1: Wallet triggers /credential-offer GET
      const offerReq = new Request(
        "https://issuer.university.edu/credential-offer?studentId=STU-2026-FINAL",
        { method: "GET" }
      );
      const offerRes = await app(offerReq);
      expect(offerRes.status).toBe(200);
      expect(offerRes.headers.get("Content-Type")).toContain("application/json");
      expect(offerRes.headers.get("Access-Control-Allow-Origin")).toBe("*");

      const offerBody = (await offerRes.json()) as CredentialOfferResponse;
      expect(offerBody.credential_offer).toBeDefined();
      expect(offerBody.credential_offer.credential_issuer).toBe(
        "https://issuer.university.edu"
      );
      expect(
        offerBody.credential_offer.credential_configuration_ids
      ).toContain("graduation_record_sd_jwt_vc");

      const grant =
        offerBody.credential_offer.grants[
          "urn:ietf:params:oauth:grant-type:pre-authorized_code"
        ];
      expect(grant).toBeDefined();
      const preAuthorizedCode = grant["pre-authorized_code"];
      expect(typeof preAuthorizedCode).toBe("string");
      expect(preAuthorizedCode.length).toBeGreaterThanOrEqual(32);

      // Verify custom URI format (openid-credential-offer://)
      expect(offerBody.credential_offer_uri).toBeDefined();
      expect(offerBody.credential_offer_uri.startsWith("openid-credential-offer://")).toBe(true);
      const parsedOfferUri = new URL(offerBody.credential_offer_uri);
      const embeddedOfferJson = decodeURIComponent(
        parsedOfferUri.searchParams.get("credential_offer") || ""
      );
      const decodedOffer = JSON.parse(embeddedOfferJson);
      expect(
        decodedOffer.grants["urn:ietf:params:oauth:grant-type:pre-authorized_code"][
          "pre-authorized_code"
        ]
      ).toBe(preAuthorizedCode);

      // Step 2: Wallet exchanges pre-authorized code for Access Token at POST /token
      const tokenParams = new URLSearchParams();
      tokenParams.set(
        "grant_type",
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      );
      tokenParams.set("pre-authorized_code", preAuthorizedCode);

      const tokenReq = new Request("https://issuer.university.edu/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: tokenParams.toString(),
      });

      const tokenRes = await app(tokenReq);
      expect(tokenRes.status).toBe(200);
      expect(tokenRes.headers.get("Content-Type")).toContain("application/json");
      expect(tokenRes.headers.get("Cache-Control")).toBe("no-store");
      expect(tokenRes.headers.get("Access-Control-Allow-Origin")).toBe("*");

      const tokenBody = (await tokenRes.json()) as {
        access_token: string;
        token_type: string;
        expires_in: number;
        c_nonce: string;
        c_nonce_expires_in: number;
      };

      expect(tokenBody.access_token).toBeDefined();
      expect(tokenBody.access_token.length).toBeGreaterThanOrEqual(32);
      expect(tokenBody.token_type).toBe("Bearer");
      expect(tokenBody.expires_in).toBe(600);
      expect(tokenBody.c_nonce).toBeDefined();
      expect(tokenBody.c_nonce.length).toBeGreaterThanOrEqual(32);
      expect(tokenBody.c_nonce_expires_in).toBe(600);

      // Step 3: Validate session manager state for downstream credential issuance
      const session = sessionManager.getAccessTokenSession(tokenBody.access_token);
      expect(session).toBeDefined();
      expect(session?.studentId).toBe("STU-2026-FINAL");
      expect(session?.credentialConfigurationId).toBe(
        "graduation_record_sd_jwt_vc"
      );
      expect(session?.cNonce).toBe(tokenBody.c_nonce);

      // Verify c_nonce rotation
      const rotationResult = sessionManager.validateAndRotateNonce(
        tokenBody.access_token,
        tokenBody.c_nonce
      );
      expect(rotationResult.valid).toBe(true);
      expect(rotationResult.newNonce).toBeDefined();
      expect(rotationResult.newNonce).not.toBe(tokenBody.c_nonce);

      // Previous nonce should now fail
      const reuseOldNonceResult = sessionManager.validateAndRotateNonce(
        tokenBody.access_token,
        tokenBody.c_nonce
      );
      expect(reuseOldNonceResult.valid).toBe(false);
      expect(reuseOldNonceResult.error).toBe("mismatched_nonce");
    });
  });

  describe("Replay Protection & Single-Use Semantics", () => {
    it("strictly rejects reused pre-authorized code on second token request", async () => {
      // 1. Generate offer
      const offerRes = await app(
        new Request(
          "https://issuer.university.edu/credential-offer?studentId=STU-REPLAY-1",
          { method: "GET" }
        )
      );
      const offerBody = (await offerRes.json()) as CredentialOfferResponse;
      const code =
        offerBody.credential_offer.grants[
          "urn:ietf:params:oauth:grant-type:pre-authorized_code"
        ]["pre-authorized_code"];

      // 2. First exchange: succeeds
      const tokenParams = new URLSearchParams();
      tokenParams.set(
        "grant_type",
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      );
      tokenParams.set("pre-authorized_code", code);

      const firstRes = await app(
        new Request("https://issuer.university.edu/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: tokenParams.toString(),
        })
      );
      expect(firstRes.status).toBe(200);

      // 3. Second exchange (replay attack): must return 400 invalid_grant
      const replayRes = await app(
        new Request("https://issuer.university.edu/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: tokenParams.toString(),
        })
      );
      expect(replayRes.status).toBe(400);
      const errorBody = (await replayRes.json()) as {
        error: string;
        error_description: string;
      };
      expect(errorBody.error).toBe("invalid_grant");
      expect(errorBody.error_description).toContain("already been used");
    });
  });

  describe("PIN / Transaction Code (tx_code) Protection", () => {
    async function requestOfferWithPin(studentId: string, txCode: string): Promise<string> {
      const offerRes = await app(
        new Request("https://issuer.university.edu/credential-offer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId,
            txCode,
          }),
        })
      );
      expect(offerRes.status).toBe(200);
      const offerBody = (await offerRes.json()) as CredentialOfferResponse;
      const grant =
        offerBody.credential_offer.grants[
          "urn:ietf:params:oauth:grant-type:pre-authorized_code"
        ];
      expect(grant.tx_code).toBeDefined();
      expect(grant.tx_code?.input_mode).toBe("numeric");
      expect(grant.tx_code?.length).toBe(6);
      return grant["pre-authorized_code"];
    }

    it("rejects token exchange when required tx_code is missing", async () => {
      const code = await requestOfferWithPin("STU-PIN-01", "948205");

      const params = new URLSearchParams();
      params.set(
        "grant_type",
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      );
      params.set("pre-authorized_code", code);

      const res = await app(
        new Request("https://issuer.university.edu/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        })
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("invalid_grant");
    });

    it("rejects token exchange when tx_code is incorrect", async () => {
      const code = await requestOfferWithPin("STU-PIN-02", "948205");

      const params = new URLSearchParams();
      params.set(
        "grant_type",
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      );
      params.set("pre-authorized_code", code);
      params.set("tx_code", "000000");

      const res = await app(
        new Request("https://issuer.university.edu/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        })
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("invalid_grant");
    });

    it("succeeds token exchange when valid tx_code is supplied", async () => {
      const code = await requestOfferWithPin("STU-PIN-03", "948205");

      const params = new URLSearchParams();
      params.set(
        "grant_type",
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      );
      params.set("pre-authorized_code", code);
      params.set("tx_code", "948205");

      const res = await app(
        new Request("https://issuer.university.edu/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        })
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        access_token: string;
      };
      expect(body.access_token).toBeDefined();
    });
  });

  describe("Expiration Enforcement", () => {
    it("rejects token exchange for expired pre-authorized code", async () => {
      // Directly create an already-expired session in SessionManager (TTL: -10 seconds)
      const expiredSession = sessionManager.createPreAuthorizedCode({
        studentId: "STU-EXPIRED",
        credentialConfigurationId: "graduation_record_sd_jwt_vc",
        ttlSeconds: -10,
      });

      const params = new URLSearchParams();
      params.set(
        "grant_type",
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      );
      params.set("pre-authorized_code", expiredSession.code);

      const res = await app(
        new Request("https://issuer.university.edu/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        })
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; error_description: string };
      expect(body.error).toBe("invalid_grant");
      expect(body.error_description).toContain("expired");
    });
  });

  describe("Negative Input & Protocol Hardening", () => {
    it("rejects non-application/x-www-form-urlencoded content-types with OAuth error", async () => {
      const res = await app(
        new Request("https://issuer.university.edu/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ grant_type: "pre-authorized_code" }),
        })
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("invalid_request");
    });

    it("rejects duplicate form parameters per RFC 6749 parameter uniqueness requirement", async () => {
      const res = await app(
        new Request("https://issuer.university.edu/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Apre-authorized_code&grant_type=another_grant",
        })
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; error_description: string };
      expect(body.error).toBe("invalid_request");
      expect(body.error_description).toContain("Duplicate parameter");
    });

    it("rejects requests exceeding maximum payload size limit", async () => {
      const oversizedPayload = "pre-authorized_code=" + "a".repeat(5000);
      const res = await app(
        new Request("https://issuer.university.edu/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": String(oversizedPayload.length),
          },
          body: oversizedPayload,
        })
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; error_description: string };
      expect(body.error).toBe("invalid_request");
      expect(body.error_description).toContain("Request body exceeds maximum allowed size");
    });

    it("rejects unsupported grant types with unsupported_grant_type", async () => {
      const params = new URLSearchParams();
      params.set("grant_type", "authorization_code");
      params.set("code", "xyz");

      const res = await app(
        new Request("https://issuer.university.edu/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        })
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("unsupported_grant_type");
    });

    it("ignores query string parameters and requires code in form body", async () => {
      // Provide valid grant_type in form body, but code only in query string
      const res = await app(
        new Request(
          "https://issuer.university.edu/token?pre-authorized_code=poc_secret123",
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Apre-authorized_code",
          }
        )
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; error_description: string };
      expect(body.error).toBe("invalid_request");
      expect(body.error_description).toContain("Missing required parameter 'pre-authorized_code'");
    });
  });
});
