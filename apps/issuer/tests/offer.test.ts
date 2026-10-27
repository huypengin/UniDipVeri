import { describe, expect, it, beforeEach } from "bun:test";
import { join } from "node:path";
import { loadSchemaFromFile } from "@unidipveri/core";
import { SessionManager } from "../src/services/session-manager.js";
import { handleOfferRequest, DEFAULT_CREDENTIAL_CONFIG_ID, type CredentialOfferResponse } from "../src/routes/offer.js";
import type { IssuerConfig } from "../src/config.js";

const FIXTURE_SCHEMA_PATH = join(
  import.meta.dir,
  "../../../schemas/graduation-record.v1.yaml"
);

describe("Credential Offer Endpoint (OpenID4VCI 1.0 Final)", () => {
  let sessionManager: SessionManager;
  let schemaConfig: Awaited<ReturnType<typeof loadSchemaFromFile>>;

  const mockConfig: IssuerConfig = {
    port: 3000,
    baseUrl: "https://issuer.university.edu",
    vctBaseUrl: "https://issuer.university.edu",
    issuerDid: "did:web:issuer.university.edu",
    issuerIdentifierMode: "did",
    keyId: "key-1",
    signingAlgorithm: "ES256",
    schemaPath: FIXTURE_SCHEMA_PATH,
  };

  beforeEach(async () => {
    sessionManager = new SessionManager();
    schemaConfig = await loadSchemaFromFile(FIXTURE_SCHEMA_PATH);
  });

  describe("GET /credential-offer", () => {
    it("generates a compliant credential offer for valid studentId", async () => {
      const req = new Request("http://localhost:3000/credential-offer?studentId=STU-2026-8899", {
        headers: {
          Host: "evil-attacker.com", // Verify Host header spoofing immunity
        },
      });

      const res = await handleOfferRequest(req, mockConfig, sessionManager, schemaConfig);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.headers.get("cache-control")).toBe("no-store");

      const body = (await res.json()) as CredentialOfferResponse;
      expect(body.expires_in).toBe(600);

      // Verify credential_offer structure
      const offer = body.credential_offer;
      expect(offer.credential_issuer).toBe("https://issuer.university.edu"); // Immune to evil-attacker.com
      expect(offer.credential_configuration_ids).toEqual([DEFAULT_CREDENTIAL_CONFIG_ID]);

      const grant = offer.grants["urn:ietf:params:oauth:grant-type:pre-authorized_code"];
      expect(grant).toBeDefined();
      expect(grant["pre-authorized_code"]).toStartWith("poc_");
      expect(grant.tx_code).toBeUndefined();

      // Verify custom URI format for QR scanning
      expect(body.credential_offer_uri).toStartWith("openid-credential-offer://?credential_offer=");
      const uri = new URL(body.credential_offer_uri);
      const encodedOfferParam = uri.searchParams.get("credential_offer");
      expect(encodedOfferParam).toBeDefined();
      const decodedOffer = JSON.parse(encodedOfferParam!);
      expect(decodedOffer).toEqual(offer);

      // Verify session exists in SessionManager
      expect(sessionManager.preAuthCodeCount).toBe(1);
    });

    it("generates credential offer with transaction code (tx_code) metadata when PIN requested", async () => {
      const req = new Request(
        "http://localhost:3000/credential-offer?studentId=STU-2026-8899&tx_code=1234"
      );

      const res = await handleOfferRequest(req, mockConfig, sessionManager, schemaConfig);
      expect(res.status).toBe(200);

      const body = (await res.json()) as CredentialOfferResponse;
      const grant = body.credential_offer.grants["urn:ietf:params:oauth:grant-type:pre-authorized_code"];
      expect(grant.tx_code).toBeDefined();
      expect(grant.tx_code?.length).toBe(4);
      expect(grant.tx_code?.input_mode).toBe("numeric");
      expect(grant.tx_code?.description).toContain("PIN");
    });

    it("rejects request missing studentId parameter with HTTP 400", async () => {
      const req = new Request("http://localhost:3000/credential-offer");
      const res = await handleOfferRequest(req, mockConfig, sessionManager, schemaConfig);

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; error_description: string };
      expect(body.error).toBe("invalid_request");
      expect(body.error_description).toContain("Missing required parameter 'studentId'");
    });

    it("rejects unknown credential_configuration_id with HTTP 400", async () => {
      const req = new Request(
        "http://localhost:3000/credential-offer?studentId=STU-1&credential_configuration_id=unknown_vc"
      );
      const res = await handleOfferRequest(req, mockConfig, sessionManager, schemaConfig);

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("invalid_request");
    });
  });

  describe("POST /credential-offer", () => {
    it("handles POST request with application/json body", async () => {
      const req = new Request("http://localhost:3000/credential-offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: "STU-POST-JSON",
          tx_code: "5678",
        }),
      });

      const res = await handleOfferRequest(req, mockConfig, sessionManager, schemaConfig);
      expect(res.status).toBe(200);

      const body = (await res.json()) as CredentialOfferResponse;
      expect(body.credential_offer.credential_issuer).toBe("https://issuer.university.edu");
      expect(
        body.credential_offer.grants["urn:ietf:params:oauth:grant-type:pre-authorized_code"].tx_code?.length
      ).toBe(4);
    });

    it("handles POST request with application/x-www-form-urlencoded body", async () => {
      const params = new URLSearchParams();
      params.set("studentId", "STU-POST-FORM");

      const req = new Request("http://localhost:3000/credential-offer", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      const res = await handleOfferRequest(req, mockConfig, sessionManager, schemaConfig);
      expect(res.status).toBe(200);

      const body = (await res.json()) as CredentialOfferResponse;
      expect(body.credential_offer.credential_issuer).toBe("https://issuer.university.edu");
    });

    it("returns HTTP 400 on malformed JSON payload", async () => {
      const req = new Request("http://localhost:3000/credential-offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ invalid json ...",
      });

      const res = await handleOfferRequest(req, mockConfig, sessionManager, schemaConfig);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("invalid_request");
    });
  });

  describe("Unsupported Methods", () => {
    it("returns HTTP 405 for PUT and DELETE requests", async () => {
      const req = new Request("http://localhost:3000/credential-offer", { method: "PUT" });
      const res = await handleOfferRequest(req, mockConfig, sessionManager, schemaConfig);
      expect(res.status).toBe(405);
    });
  });
});
