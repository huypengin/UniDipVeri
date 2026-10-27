import type { CredentialTypeConfig } from "@unidipveri/core";
import type { IssuerConfig } from "../config.js";

/**
 * Generates an OpenAPI 3.0.3 specification for the UniDipVeri OID4VCI Issuer Service.
 *
 * @param config Issuer runtime configuration
 * @param schemaConfig Loaded credential schema configuration
 * @returns Complete OpenAPI specification object
 */
export function generateOpenApiSpec(
  config: IssuerConfig,
  schemaConfig: CredentialTypeConfig
): Record<string, unknown> {
  const vctPath = schemaConfig.vctPath;

  return {
    openapi: "3.0.3",
    info: {
      title: "UniDipVeri Academic Credential Issuer API",
      version: "1.0.0",
      description:
        "OpenID for Verifiable Credential Issuance 1.0 (Final) & SD-JWT VC (draft-ietf-oauth-sd-jwt-vc-19) Issuer Service with Token Status List Revocation (draft-ietf-oauth-status-list-21).",
      contact: {
        name: "UniDipVeri Academic VC Project",
      },
    },
    servers: [
      {
        url: config.baseUrl,
        description: "Active UniDipVeri Issuer Server",
      },
    ],
    tags: [
      { name: "Discovery & Metadata", description: "OID4VCI and W3C DID metadata endpoints" },
      { name: "Issuance Flow", description: "Credential offer, token exchange, and credential issuance endpoints" },
      { name: "Revocation & Status", description: "Token Status List and administrative revocation" },
      { name: "System", description: "Service health and monitoring" },
    ],
    paths: {
      "/health": {
        get: {
          tags: ["System"],
          summary: "Health Check",
          description: "Returns service status, uptime, and loaded credential schema metadata.",
          responses: {
            "200": {
              description: "Service is healthy and operational",
              content: {
                "application/json": {
                  example: {
                    status: "ok",
                    service: "unidipveri-issuer",
                    version: "1.0.0",
                    uptimeSeconds: 120,
                    schema: {
                      name: schemaConfig.name,
                      vctPath: schemaConfig.vctPath,
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/.well-known/openid-credential-issuer": {
        get: {
          tags: ["Discovery & Metadata"],
          summary: "OID4VCI Issuer Metadata Discovery",
          description:
            "Returns OpenID4VCI 1.0 Final Credential Issuer Metadata, including credential configurations and endpoints.",
          responses: {
            "200": {
              description: "Compliant OID4VCI 1.0 Final Credential Issuer Metadata",
              content: {
                "application/json": {
                  example: {
                    credential_issuer: config.baseUrl,
                    credential_endpoint: `${config.baseUrl}/credential`,
                    token_endpoint: `${config.baseUrl}/token`,
                    credential_configurations_supported: {
                      graduation_record_sd_jwt_vc: {
                        format: "dc+sd-jwt",
                        vct: `${config.vctBaseUrl}${vctPath}`,
                        cryptographic_binding_methods_supported: ["jwk"],
                        credential_signing_alg_values_supported: [config.signingAlgorithm],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/.well-known/did.json": {
        get: {
          tags: ["Discovery & Metadata"],
          summary: "W3C did:web Document",
          description: "Publishes the Issuer's cryptographic verification keys in W3C DID format.",
          responses: {
            "200": {
              description: "W3C Compliant DID Document",
              content: {
                "application/json": {
                  example: {
                    "@context": ["https://www.w3.org/ns/did/v1"],
                    id: config.issuerDid,
                    verificationMethod: [
                      {
                        id: `${config.issuerDid}#${config.keyId}`,
                        type: "JsonWebKey2020",
                        controller: config.issuerDid,
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      "/.well-known/jwt-vc-issuer": {
        get: {
          tags: ["Discovery & Metadata"],
          summary: "SD-JWT VC Issuer Metadata Document",
          description:
            "Publishes Issuer metadata and JWKS per draft-ietf-oauth-sd-jwt-vc for HTTPS issuer identifiers.",
          responses: {
            "200": {
              description: "SD-JWT VC Issuer Metadata Document with inline JWKS",
              content: {
                "application/json": {
                  example: {
                    issuer: config.baseUrl,
                    jwks: {
                      keys: [
                        {
                          kty: "EC",
                          crv: "P-256",
                          kid: config.keyId,
                          use: "sig",
                          alg: config.signingAlgorithm,
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
      [vctPath]: {
        get: {
          tags: ["Discovery & Metadata"],
          summary: "SD-JWT VC Type Metadata Document",
          description: "Draft-19 Type Metadata document specifying claim names and selective disclosure policies.",
          responses: {
            "200": {
              description: "SD-JWT VC Type Metadata",
              content: {
                "application/json": {},
              },
            },
          },
        },
      },
      "/credential-offer": {
        get: {
          tags: ["Issuance Flow"],
          summary: "Create Credential Offer (GET)",
          description: "Initiates a pre-authorized code issuance flow via query parameters.",
          parameters: [
            {
              name: "studentId",
              in: "query",
              required: true,
              schema: { type: "string", example: "STU-2026-FINAL" },
            },
            {
              name: "credential_configuration_id",
              in: "query",
              required: false,
              schema: { type: "string", example: "graduation_record_sd_jwt_vc" },
            },
            {
              name: "tx_code",
              in: "query",
              required: false,
              schema: { type: "string", example: "1234" },
            },
          ],
          responses: {
            "200": {
              description: "OpenID4VCI Credential Offer structure and wallet URI",
              content: {
                "application/json": {},
              },
            },
            "400": { description: "Invalid request or missing studentId" },
          },
        },
        post: {
          tags: ["Issuance Flow"],
          summary: "Create Credential Offer (POST)",
          description: "Initiates a pre-authorized code issuance flow with custom dynamic claims for demonstration.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    studentId: { type: "string", example: "STU-2026-FINAL" },
                    credential_configuration_id: { type: "string", example: "graduation_record_sd_jwt_vc" },
                    tx_code: { type: "string", example: "1234" },
                    claims: {
                      type: "object",
                      description: "Custom academic claims bound to the authorization session",
                    },
                  },
                  required: ["studentId"],
                },
                example: {
                  studentId: "STU-2026-FINAL",
                  credential_configuration_id: "graduation_record_sd_jwt_vc",
                  tx_code: "1234",
                  claims: {
                    studentId: "STU-2026-FINAL",
                    fullName: "Nguyen Van A",
                    papers: {
                      diploma: {
                        degreeName: "Bachelor of Science in Computer Science",
                        degreeType: "Bachelor of Science",
                        major: "Computer Science",
                        graduationDate: "2026-06-30",
                        honours: "Summa Cum Laude",
                      },
                      transcript: {
                        transcriptId: "TR-STU-2026-FINAL",
                        cumulativeGPA: 3.92,
                        totalCredits: 135,
                        courses: [
                          { code: "CS101", title: "Introduction to Computer Science", credits: 3, grade: 4.0, letterGrade: "A" },
                          { code: "CS201", title: "Data Structures and Algorithms", credits: 4, grade: 4.0, letterGrade: "A" },
                          { code: "CS301", title: "Database Systems", credits: 3, grade: 3.8, letterGrade: "A-" },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Credential Offer generated successfully" },
            "400": { description: "Invalid request parameters" },
          },
        },
      },
      "/token": {
        post: {
          tags: ["Issuance Flow"],
          summary: "OAuth 2.0 Token Endpoint",
          description:
            "Burns a single-use pre-authorized code and exchanges it for a scoped Bearer access token and initial c_nonce challenge.",
          requestBody: {
            required: true,
            content: {
              "application/x-www-form-urlencoded": {
                schema: {
                  type: "object",
                  properties: {
                    grant_type: {
                      type: "string",
                      example: "urn:ietf:params:oauth:grant-type:pre-authorized_code",
                    },
                    "pre-authorized_code": {
                      type: "string",
                      example: "poc_1234567890abcdef...",
                    },
                    tx_code: {
                      type: "string",
                      example: "1234",
                    },
                  },
                  required: ["grant_type", "pre-authorized_code"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Access token issued with c_nonce challenge",
              content: {
                "application/json": {
                  example: {
                    access_token: "iat_123456789...",
                    token_type: "Bearer",
                    expires_in: 600,
                    c_nonce: "cnonce_123456789...",
                    c_nonce_expires_in: 600,
                  },
                },
              },
            },
            "400": { description: "Invalid grant, expired code, or missing PIN" },
          },
        },
      },
      "/nonce": {
        post: {
          tags: ["Issuance Flow"],
          summary: "OID4VCI Nonce Endpoint",
          description:
            "Issues a fresh cryptographic c_nonce challenge per OpenID4VCI 1.0 Final for wallets prior to proof signing.",
          responses: {
            "200": {
              description: "Fresh c_nonce challenge returned successfully",
              content: {
                "application/json": {
                  example: {
                    c_nonce: "cnonce_standalone_123456789...",
                    c_nonce_expires_in: 600,
                  },
                },
              },
            },
          },
        },
      },
      "/credential": {
        post: {
          tags: ["Issuance Flow"],
          summary: "OID4VCI Credential Endpoint",
          description:
            "Issues an SD-JWT Verifiable Credential (typ: dc+sd-jwt) with holder key binding (cnf.jwk) and revocation status.",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    credential_configuration_id: {
                      type: "string",
                      example: "graduation_record_sd_jwt_vc",
                    },
                    proof: {
                      type: "object",
                      properties: {
                        proof_type: { type: "string", example: "jwt" },
                        jwt: {
                          type: "string",
                          description: "JWS holder proof token signed with holder's private key",
                        },
                      },
                      required: ["proof_type", "jwt"],
                    },
                  },
                  required: ["credential_configuration_id", "proof"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "SD-JWT VC successfully issued",
              content: {
                "application/json": {
                  example: {
                    credential: "<jwt>~<disc1>~<disc2>~...~",
                    c_nonce: "cnonce_next_rotated_nonce...",
                    c_nonce_expires_in: 600,
                  },
                },
              },
            },
            "400": { description: "Invalid proof, expired nonce, or unsupported credential configuration" },
            "401": { description: "Invalid, missing, or expired access token" },
          },
        },
      },
      "/status/{id}": {
        get: {
          tags: ["Revocation & Status"],
          summary: "Fetch Token Status List",
          description:
            "Returns a cryptographically signed Token Status List Token (draft-ietf-oauth-status-list-21) with media type application/statuslist+jwt.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", example: "status-list-1" },
            },
          ],
          responses: {
            "200": {
              description: "Signed Status List Token JWT",
              content: {
                "application/statuslist+jwt": {
                  schema: { type: "string" },
                },
              },
            },
            "404": { description: "Unknown status list identifier" },
          },
        },
      },
      "/admin/revoke": {
        post: {
          tags: ["Revocation & Status"],
          summary: "Revoke Credential by Status Index",
          description: "Administrative endpoint that toggles the status bit at index idx to 1 (revoked).",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    idx: { type: "integer", minimum: 0, example: 0 },
                  },
                  required: ["idx"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Revocation status updated",
              content: {
                "application/json": {
                  example: { status: "revoked", idx: 0, revoked: true },
                },
              },
            },
            "400": { description: "Invalid index or out of bounds" },
          },
        },
      },
      "/admin/status/{idx}": {
        get: {
          tags: ["Revocation & Status"],
          summary: "Inspect Revocation Status by Index",
          description: "Queries the active revocation status bit at index idx.",
          parameters: [
            {
              name: "idx",
              in: "path",
              required: true,
              schema: { type: "integer", example: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Revocation status of index",
              content: {
                "application/json": {
                  example: { idx: 0, revoked: false, status: "active" },
                },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT or Opaque",
          description: "Bearer access token obtained from /token",
        },
      },
    },
  };
}

/**
 * Serves the Swagger UI HTML interface.
 */
export function renderSwaggerHtml(title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title} - Swagger UI</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <style>
    body {
      margin: 0;
      padding: 0;
      background: #fafafa;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .topbar-wrapper img {
      content: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="%234f46e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/></svg>');
    }
    .swagger-ui .topbar {
      background-color: #1e1e38;
      border-bottom: 2px solid #4f46e5;
    }
    .header-banner {
      background: linear-gradient(135deg, #1e1e38 0%, #2a2a4e 100%);
      color: #fff;
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header-banner h1 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
    }
    .header-banner a {
      color: #a5b4fc;
      text-decoration: none;
      font-size: 0.9rem;
      border: 1px solid #4f46e5;
      padding: 6px 12px;
      border-radius: 6px;
      transition: background 0.2s;
    }
    .header-banner a:hover {
      background: #4f46e5;
      color: #fff;
    }
  </style>
</head>
<body>
  <div class="header-banner">
    <div>
      <h1>UniDipVeri Issuer API Explorer</h1>
      <small style="color: #94a3b8;">OID4VCI 1.0 Final &bull; SD-JWT VC (draft-19) &bull; Token Status List</small>
    </div>
    <div style="display: flex; gap: 12px;">
      <a href="/">&larr; Registrar Portal</a>
      <a href="/docs/openapi.json" target="_blank">OpenAPI JSON</a>
    </div>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: "/docs/openapi.json",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout"
      });
    };
  </script>
</body>
</html>`;
}

/**
 * Handles incoming documentation requests: GET /docs, GET /swagger, GET /docs/openapi.json.
 */
export function handleDocsRequest(
  req: Request,
  config: IssuerConfig,
  schemaConfig: CredentialTypeConfig
): Response {
  const url = new URL(req.url);
  const pathname = url.pathname.replace(/\/+$/, "");

  if (pathname === "/docs/openapi.json") {
    const spec = generateOpenApiSpec(config, schemaConfig);
    return Response.json(spec, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  if (pathname === "/docs" || pathname === "/swagger") {
    const html = renderSwaggerHtml(schemaConfig.name);
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  return Response.json(
    {
      error: "not_found",
      error_description: "Documentation resource not found",
    },
    { status: 404 }
  );
}
