import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  loadSchemaFromFile,
  resolveDidVerificationKey,
  resolveDidWeb,
  resolveVct,
  type DidDocument,
} from "@unidipveri/core";
import { loadIssuerConfig } from "../src/config.js";
import { initializeKeyManager } from "../src/services/key-manager.js";
import { createApp } from "../src/app.js";
import { handleDidRequest } from "../src/routes/did.js";
import { startServer } from "../src/server.js";
import type {
  Oid4vciIssuerMetadata,
  SdJwtVcTypeMetadata,
} from "../src/services/claims-metadata.js";

const schemaPath = join(
  import.meta.dir,
  "../../../schemas/graduation-record.v1.yaml"
);
const schemaConfig = await loadSchemaFromFile(schemaPath);
const config = loadIssuerConfig({
  ISSUER_BASE_URL: "https://issuer.university.edu",
  ISSUER_DID: "did:web:issuer.university.edu",
  KEY_ID: "key-test-1",
  SCHEMA_PATH: schemaPath,
});
const keyContext = await initializeKeyManager(config);
const app = createApp(config, keyContext, schemaConfig);

describe("Issuer Application Dispatcher, Routing & Server", () => {
  describe("DID Document Route (/.well-known/did.json)", () => {
    it("handleDidRequest returns 200 OK with W3C-compliant DID Document", async () => {
      const res = handleDidRequest(config, keyContext);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/json");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");

      const doc = (await res.json()) as DidDocument;
      expect(doc.id).toBe("did:web:issuer.university.edu");
      expect(doc["@context"]).toContain("https://www.w3.org/ns/did/v1");

      // Verify verificationMethod
      expect(doc.verificationMethod).toBeDefined();
      expect(doc.verificationMethod?.length).toBe(1);
      const vm = doc.verificationMethod?.[0];
      expect(vm?.id).toBe("did:web:issuer.university.edu#key-test-1");
      expect(vm?.controller).toBe("did:web:issuer.university.edu");
      expect(vm?.publicKeyJwk).toEqual(keyContext.publicKeyJwk);
      expect(vm?.publicKeyJwk?.d).toBeUndefined();

      // Verify authentication and assertionMethod
      expect(doc.authentication).toContain(
        "did:web:issuer.university.edu#key-test-1"
      );
      expect(doc.assertionMethod).toContain(
        "did:web:issuer.university.edu#key-test-1"
      );

      // Verify service endpoint
      expect(doc.service).toBeDefined();
      expect(doc.service?.[0].serviceEndpoint).toBe(
        "https://issuer.university.edu"
      );
    });

    it("interoperability: packages/core resolveDidWeb resolves against the issuer app", async () => {
      // Mock fetch delegating directly to issuer app
      const appFetch = async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        return app(new Request(url, { method: "GET" }));
      };

      const resolved = await resolveDidWeb(
        "did:web:issuer.university.edu",
        appFetch
      );
      expect(resolved.id).toBe("did:web:issuer.university.edu");
      expect(resolved.verificationMethod?.[0].id).toBe(
        "did:web:issuer.university.edu#key-test-1"
      );
    });

    it("interoperability: packages/core resolveDidVerificationKey extracts public key from issuer", async () => {
      const appFetch = async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        return app(new Request(url, { method: "GET" }));
      };

      const keyResult = await resolveDidVerificationKey(
        "did:web:issuer.university.edu",
        "key-test-1",
        appFetch
      );
      expect(keyResult.keyId).toBe("did:web:issuer.university.edu#key-test-1");
      expect(keyResult.publicKeyJwk).toEqual(keyContext.publicKeyJwk);
    });
  });

  describe("Routing Dispatcher & Endpoints", () => {
    it("serves GET /health with 200 OK and uptime metadata", async () => {
      const res = await app(
        new Request("https://issuer.university.edu/health", { method: "GET" })
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/json");

      const body = (await res.json()) as {
        status: string;
        service: string;
        version: string;
        uptime: number;
      };
      expect(body.status).toBe("ok");
      expect(body.service).toBe("@unidipveri/issuer");
      expect(body.version).toBe("0.1.0");
      expect(typeof body.uptime).toBe("number");
    });

    it("serves GET /.well-known/openid-credential-issuer through app dispatcher", async () => {
      const res = await app(
        new Request(
          "https://issuer.university.edu/.well-known/openid-credential-issuer",
          { method: "GET" }
        )
      );
      expect(res.status).toBe(200);

      const body = (await res.json()) as Oid4vciIssuerMetadata;
      expect(body.credential_issuer).toBe("https://issuer.university.edu");
    });

    it("serves GET /.well-known/oauth-authorization-server and /.well-known/openid-configuration", async () => {
      const resOAuth = await app(
        new Request(
          "https://issuer.university.edu/.well-known/oauth-authorization-server",
          { method: "GET" }
        )
      );
      expect(resOAuth.status).toBe(200);
      const oauthBody = (await resOAuth.json()) as any;
      expect(oauthBody.issuer).toBe("https://issuer.university.edu");
      expect(oauthBody.token_endpoint).toBe("https://issuer.university.edu/token");

      const resOidc = await app(
        new Request(
          "https://issuer.university.edu/.well-known/openid-configuration",
          { method: "GET" }
        )
      );
      expect(resOidc.status).toBe(200);
      const oidcBody = (await resOidc.json()) as any;
      expect(oidcBody.issuer).toBe("https://issuer.university.edu");
      expect(oidcBody.token_endpoint).toBe("https://issuer.university.edu/token");
    });

    it("serves GET /.well-known/jwt-vc-issuer through app dispatcher", async () => {
      const res = await app(
        new Request(
          "https://issuer.university.edu/.well-known/jwt-vc-issuer",
          { method: "GET" }
        )
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.issuer).toBe("https://issuer.university.edu");
      expect(body.jwks.keys[0].kid).toBe(config.keyId);
    });

    it("serves GET /types/graduation-record/v1 through app dispatcher", async () => {
      const res = await app(
        new Request(
          "https://issuer.university.edu/types/graduation-record/v1",
          { method: "GET" }
        )
      );
      expect(res.status).toBe(200);

      const body = (await res.json()) as SdJwtVcTypeMetadata;
      expect(body.vct).toBe(
        resolveVct(schemaConfig.vctPath, config.vctBaseUrl)
      );
    });

    it("strictly isolates vct from HTTP Host header (host header spoofing immunity)", async () => {
      const resMeta = await app(
        new Request(
          "https://issuer.university.edu/.well-known/openid-credential-issuer",
          {
            method: "GET",
            headers: {
              Host: "evil-phishing-host.com",
              "X-Forwarded-Host": "attacker.com",
            },
          }
        )
      );
      expect(resMeta.status).toBe(200);
      const meta = (await resMeta.json()) as Oid4vciIssuerMetadata;
      const configId = "graduation_record_sd_jwt_vc";
      expect(meta.credential_configurations_supported[configId].vct).toBe(
        resolveVct(schemaConfig.vctPath, config.vctBaseUrl)
      );
      expect(
        meta.credential_configurations_supported[configId].vct
      ).not.toContain("evil-phishing-host");

      const resVct = await app(
        new Request(
          "https://issuer.university.edu/types/graduation-record/v1",
          {
            method: "GET",
            headers: {
              Host: "evil-phishing-host.com",
            },
          }
        )
      );
      expect(resVct.status).toBe(200);
      const vctDoc = (await resVct.json()) as SdJwtVcTypeMetadata;
      expect(vctDoc.vct).toBe(
        resolveVct(schemaConfig.vctPath, config.vctBaseUrl)
      );
      expect(vctDoc.vct).not.toContain("evil-phishing-host");
    });

    it("normalizes trailing slashes gracefully", async () => {
      const resHealth = await app(
        new Request("https://issuer.university.edu/health/", { method: "GET" })
      );
      expect(resHealth.status).toBe(200);

      const resDid = await app(
        new Request("https://issuer.university.edu/.well-known/did.json/", {
          method: "GET",
        })
      );
      expect(resDid.status).toBe(200);
    });

    it("serves live /credential-offer and /token routes, and enforces authorization on /credential", async () => {
      const resOffer = await app(
        new Request(
          "https://issuer.university.edu/credential-offer?studentId=student-123",
          { method: "GET" }
        )
      );
      expect(resOffer.status).toBe(200);
      const offerData = (await resOffer.json()) as {
        credential_offer: { credential_issuer: string };
      };
      expect(offerData.credential_offer.credential_issuer).toBe(
        "https://issuer.university.edu"
      );

      const resToken = await app(
        new Request("https://issuer.university.edu/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Apre-authorized_code&pre-authorized_code=non-existent-code",
        })
      );
      expect(resToken.status).toBe(400);

      const resCredential = await app(
        new Request("https://issuer.university.edu/credential", {
          method: "POST",
        })
      );
      expect(resCredential.status).toBe(401);
    });

    it("serves interactive registrar portal HTML on GET / and GET /issue", async () => {
      const resRoot = await app(
        new Request("https://issuer.university.edu/", { method: "GET" })
      );
      expect(resRoot.status).toBe(200);
      expect(resRoot.headers.get("Content-Type")).toContain("text/html");
      const rootHtml = await resRoot.text();
      expect(rootHtml).toContain("UniDipVeri Registrar Portal");

      const resIssue = await app(
        new Request("https://issuer.university.edu/issue", { method: "GET" })
      );
      expect(resIssue.status).toBe(200);
      expect(resIssue.headers.get("Content-Type")).toContain("text/html");
    });

    it("serves Swagger UI and OpenAPI 3.0 specification", async () => {
      const resDocs = await app(
        new Request("https://issuer.university.edu/docs", { method: "GET" })
      );
      expect(resDocs.status).toBe(200);
      expect(resDocs.headers.get("Content-Type")).toContain("text/html");
      const docsHtml = await resDocs.text();
      expect(docsHtml).toContain("swagger-ui");

      const resSpec = await app(
        new Request("https://issuer.university.edu/docs/openapi.json", {
          method: "GET",
        })
      );
      expect(resSpec.status).toBe(200);
      expect(resSpec.headers.get("Content-Type")).toContain("application/json");
      const spec = (await resSpec.json()) as { openapi: string; paths: Record<string, unknown> };
      expect(spec.openapi).toStartWith("3.0");
      expect(spec.paths["/credential"]).toBeDefined();
      expect(spec.paths["/status/{id}"]).toBeDefined();
    });

    it("serves Token Status List document and processes admin revocation", async () => {
      const resStatus = await app(
        new Request("https://issuer.university.edu/status/status-list-1", {
          method: "GET",
        })
      );
      expect(resStatus.status).toBe(200);
      expect(resStatus.headers.get("Content-Type")).toBe(
        "application/statuslist+jwt"
      );
      const token = await resStatus.text();
      expect(token.split(".").length).toBe(3);

      const resRevoke = await app(
        new Request("https://issuer.university.edu/admin/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idx: 0 }),
        })
      );
      expect(resRevoke.status).toBe(200);
      const revokeBody = (await resRevoke.json()) as { status: string; idx: number; revoked: boolean };
      expect(revokeBody.status).toBe("revoked");
      expect(revokeBody.idx).toBe(0);
      expect(revokeBody.revoked).toBe(true);

      const resCheck = await app(
        new Request("https://issuer.university.edu/admin/status/0", {
          method: "GET",
        })
      );
      expect(resCheck.status).toBe(200);
      const checkBody = (await resCheck.json()) as { idx: number; revoked: boolean; status: string };
      expect(checkBody.revoked).toBe(true);
    });
  });

  describe("CORS & Preflight Handling", () => {
    it("handles OPTIONS preflight requests with 204 No Content and CORS headers", async () => {
      const res = await app(
        new Request("https://issuer.university.edu/health", {
          method: "OPTIONS",
        })
      );
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
      expect(res.headers.get("Access-Control-Allow-Headers")).toContain(
        "Content-Type"
      );
    });

    it("attaches CORS headers to all GET, POST, and error responses", async () => {
      const res200 = await app(
        new Request("https://issuer.university.edu/health", { method: "GET" })
      );
      expect(res200.headers.get("Access-Control-Allow-Origin")).toBe("*");

      const res404 = await app(
        new Request("https://issuer.university.edu/non-existent-route", {
          method: "GET",
        })
      );
      expect(res404.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });

  describe("Error Handling", () => {
    it("returns 404 with structured JSON for unrecognized routes", async () => {
      const res = await app(
        new Request("https://issuer.university.edu/api/unknown-endpoint", {
          method: "GET",
        })
      );
      expect(res.status).toBe(404);
      expect(res.headers.get("Content-Type")).toContain("application/json");

      const body = (await res.json()) as {
        error: string;
        error_description: string;
      };
      expect(body.error).toBe("not_found");
      expect(body.error_description).toContain("Route");
    });
  });

  describe("Server Startup & Network Listener", () => {
    it("boots Bun HTTP server on an available port and serves actual network requests", async () => {
      const runtime = await startServer({
        PORT: "34567",
        SCHEMA_PATH: schemaPath,
        ISSUER_BASE_URL: "http://localhost:34567",
      });

      try {
        expect(runtime.server).toBeDefined();
        expect(runtime.server.port).toBeGreaterThan(0);

        // Perform real network HTTP GET request
        const res = await fetch(`http://localhost:${runtime.server.port}/health`);
        expect(res.status).toBe(200);

        const body = (await res.json()) as { status: string; service: string };
        expect(body.status).toBe("ok");
        expect(body.service).toBe("@unidipveri/issuer");
      } finally {
        runtime.server.stop();
      }
    });
  });
});
