import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { loadSchemaFromFile } from "@unidipveri/core";
import {
  generateOpenApiSpec,
  renderSwaggerHtml,
  handleDocsRequest,
} from "../src/routes/docs.js";
import type { IssuerConfig } from "../src/config.js";

describe("OpenAPI Specification & Swagger UI Documentation", () => {
  const schemaPath = join(
    import.meta.dir,
    "../../../schemas/graduation-record.yaml"
  );

  const mockConfig: IssuerConfig = {
    schemaPath,
    signingAlgorithm: "ES256",
    keyId: "key-1",
    issuerDid: "did:web:issuer.university.edu",
    baseUrl: "https://issuer.university.edu",
    vctBaseUrl: "https://issuer.university.edu",
    port: 3000,
  };

  it("generates comprehensive OpenAPI 3.0 specification with all core endpoints", async () => {
    const schemaConfig = await loadSchemaFromFile(schemaPath);
    const spec = generateOpenApiSpec(mockConfig, schemaConfig) as {
      openapi: string;
      info: { title: string; version: string };
      servers: Array<{ url: string }>;
      paths: Record<string, unknown>;
      components: { securitySchemes: Record<string, unknown> };
    };

    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.title).toContain("UniDipVeri");
    expect(spec.servers[0].url).toBe(mockConfig.baseUrl);

    // Verify key protocol endpoints are present in the specification
    const paths = Object.keys(spec.paths);
    expect(paths).toContain("/health");
    expect(paths).toContain("/.well-known/openid-credential-issuer");
    expect(paths).toContain("/.well-known/did.json");
    expect(paths).toContain("/credential-offer");
    expect(paths).toContain("/token");
    expect(paths).toContain("/credential");
    expect(paths).toContain("/status/{id}");
    expect(paths).toContain("/admin/revoke");
    expect(paths).toContain("/admin/status/{idx}");

    expect(spec.components.securitySchemes.BearerAuth).toBeDefined();
  });

  it("renders Swagger UI HTML containing bundle scripts and asset links", () => {
    const html = renderSwaggerHtml("Graduation Academic Record");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("SwaggerUIBundle");
    expect(html).toContain("/docs/openapi.json");
    expect(html).toContain("UniDipVeri Issuer API Explorer");
  });

  it("handles GET /docs/openapi.json returning JSON with cache headers", async () => {
    const schemaConfig = await loadSchemaFromFile(schemaPath);
    const req = new Request("https://issuer.university.edu/docs/openapi.json", {
      method: "GET",
    });

    const res = handleDocsRequest(req, mockConfig, schemaConfig);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Cache-Control")).toContain("max-age=");

    const body = (await res.json()) as { openapi: string };
    expect(body.openapi).toBe("3.0.3");
  });

  it("handles GET /docs and GET /swagger returning HTML documentation page", async () => {
    const schemaConfig = await loadSchemaFromFile(schemaPath);

    for (const path of ["/docs", "/swagger"]) {
      const req = new Request(`https://issuer.university.edu${path}`, {
        method: "GET",
      });

      const res = handleDocsRequest(req, mockConfig, schemaConfig);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      const html = await res.text();
      expect(html).toContain("swagger-ui");
    }
  });

  it("returns 404 for unrecognized documentation paths", async () => {
    const schemaConfig = await loadSchemaFromFile(schemaPath);
    const req = new Request("https://issuer.university.edu/docs/unknown", {
      method: "GET",
    });

    const res = handleDocsRequest(req, mockConfig, schemaConfig);
    expect(res.status).toBe(404);
  });
});
