import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { loadSchemaFromFile, resolveVct } from "@unidipveri/core";
import { loadIssuerConfig } from "../src/config.js";
import {
  deriveCredentialConfigurationId,
  deriveJsonSchema,
  deriveOid4vciClaims,
  deriveScope,
  formatClaimDisplayName,
  generateIssuerMetadata,
  generateTypeMetadata,
  type Oid4vciIssuerMetadata,
  type SdJwtVcTypeMetadata,
} from "../src/services/claims-metadata.js";
import {
  handleMetadataRequest,
  handleOAuthMetadataRequest,
} from "../src/routes/metadata.js";
import { handleVctRequest } from "../src/routes/vct.js";
import {
  generateJwtVcIssuerMetadata,
  handleJwtVcIssuerRequest,
} from "../src/routes/jwt-vc-issuer.js";
import { generateDidDocument } from "../src/routes/did.js";
import { initializeKeyManager } from "../src/services/key-manager.js";

const schemaPath = join(
  import.meta.dir,
  "../../../schemas/graduation-record.v1.yaml"
);
const schemaConfig = await loadSchemaFromFile(schemaPath);
const issuerConfig = loadIssuerConfig({
  ISSUER_BASE_URL: "https://issuer.university.edu",
  SCHEMA_PATH: schemaPath,
});

describe("OID4VCI & SD-JWT VC Discovery Engine", () => {

  describe("Claim Display & Formatting Helpers", () => {
    it("formats camelCase identifiers into human-readable display labels", () => {
      expect(formatClaimDisplayName("studentId")).toBe("Student ID");
      expect(formatClaimDisplayName("fullName")).toBe("Full Name");
      expect(formatClaimDisplayName("dateOfBirth")).toBe("Date Of Birth");
      expect(formatClaimDisplayName("nationalId")).toBe("National ID");
      expect(formatClaimDisplayName("cumulativeGPA")).toBe("Cumulative GPA");
      expect(formatClaimDisplayName("totalCredits")).toBe("Total Credits");
      expect(formatClaimDisplayName("degreeName")).toBe("Degree Name");
      expect(formatClaimDisplayName("letterGrade")).toBe("Letter Grade");
    });

    it("derives normalized configuration ID from vctPath", () => {
      const configId = deriveCredentialConfigurationId(
        schemaConfig.vctPath,
        schemaConfig.name
      );
      expect(configId).toBe("graduation_record_sd_jwt_vc");
    });

    it("derives scope identifier from credential name", () => {
      const scope = deriveScope(schemaConfig.name);
      expect(scope).toBe("GraduationAcademicRecord");
    });
  });

  describe("OID4VCI Claims Metadata (OID4VCI 1.0 Final)", () => {
    it("derives mandatory and optional claims accurately from schema definition", () => {
      const oid4vciClaims = deriveOid4vciClaims(schemaConfig.claims);

      // Mandatory claims
      expect(oid4vciClaims.studentId.mandatory).toBe(true);
      expect(oid4vciClaims.studentId.value_type).toBe("string");
      expect(oid4vciClaims.studentId.display?.[0].name).toBe("Student ID");
      expect(oid4vciClaims.studentId.display?.[0].locale).toBe("en-US");

      expect(oid4vciClaims.fullName.mandatory).toBe(true);
      expect(oid4vciClaims.papers.mandatory).toBe(true);
      expect(oid4vciClaims.papers.value_type).toBe("object");

      // Selectively disclosable / optional claims
      expect(oid4vciClaims.dateOfBirth.mandatory).toBe(false);
      expect(oid4vciClaims.dateOfBirth.value_type).toBe("string");
      expect(oid4vciClaims.dateOfBirth.display?.[0].name).toBe("Date Of Birth");

      expect(oid4vciClaims.nationalId.mandatory).toBe(false);
    });

    it("generates full compliant OID4VCI Credential Issuer Metadata document", () => {
      const metadata = generateIssuerMetadata(issuerConfig, schemaConfig);

      expect(metadata.credential_issuer).toBe("https://issuer.university.edu");
      expect(metadata.credential_endpoint).toBe(
        "https://issuer.university.edu/credential"
      );
      expect(metadata.token_endpoint).toBe("https://issuer.university.edu/token");
      expect(metadata.authorization_servers).toEqual([
        "https://issuer.university.edu",
      ]);
      expect(metadata.authorization_server).toBe("https://issuer.university.edu");

      const configId = "graduation_record_sd_jwt_vc";
      const config = metadata.credential_configurations_supported[configId];
      expect(config).toBeDefined();

      // draft-ietf-oauth-sd-jwt-vc-19 updated format media type to dc+sd-jwt
      expect(config.format).toBe("dc+sd-jwt");
      expect(config.vct).toBe(
        resolveVct(schemaConfig.vctPath, issuerConfig.vctBaseUrl)
      );
      expect(config.cryptographic_binding_methods_supported).toEqual(["jwk"]);
      expect(config.credential_signing_alg_values_supported).toEqual([
        "ES256",
        "EdDSA",
        "ES384",
      ]);
      expect(
        config.proof_types_supported.jwt.proof_signing_alg_values_supported
      ).toEqual(["ES256", "EdDSA", "ES384"]);

      expect(config.display[0].name).toBe("Graduation Academic Record");
      expect(config.display[0].locale).toBe("en-US");

      expect(config.claims.studentId).toBeDefined();
      expect(config.claims.studentId.mandatory).toBe(true);

      // By default, legacy configuration is omitted
      expect(
        metadata.credential_configurations_supported[`${configId}_legacy`]
      ).toBeUndefined();
      expect(metadata.credentials_supported?.length).toBe(1);
      expect(metadata.credentials_supported?.[0].format).toBe("dc+sd-jwt");
    });

    it("offers both dc+sd-jwt and legacy vc+sd-jwt when enableLegacyVcFormat is true", () => {
      const legacyEnabledConfig = loadIssuerConfig({
        ISSUER_BASE_URL: "https://issuer.university.edu",
        VCT_BASE_URL: "https://credentials.university.edu",
        SCHEMA_PATH: schemaPath,
        ENABLE_LEGACY_VC_FORMAT: "true",
      });

      const metadata = generateIssuerMetadata(legacyEnabledConfig, schemaConfig);
      const configId = "graduation_record_sd_jwt_vc";

      expect(metadata.credential_configurations_supported[configId]).toBeDefined();
      expect(metadata.credential_configurations_supported[configId].format).toBe("dc+sd-jwt");

      const legacyConfig = metadata.credential_configurations_supported[`${configId}_legacy`];
      expect(legacyConfig).toBeDefined();
      expect(legacyConfig.format as string).toBe("vc+sd-jwt");

      expect(metadata.credentials_supported?.length).toBe(2);
      expect(metadata.credentials_supported?.[0].format).toBe("vc+sd-jwt");
      expect(metadata.credentials_supported?.[1].format).toBe("dc+sd-jwt");
    });

    it("handleMetadataRequest returns 200 OK with application/json and CORS headers", async () => {
      const response = handleMetadataRequest(issuerConfig, schemaConfig);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/json");
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");

      const body = (await response.json()) as Oid4vciIssuerMetadata;
      expect(body.credential_issuer).toBe("https://issuer.university.edu");
      expect(
        body.credential_configurations_supported.graduation_record_sd_jwt_vc
      ).toBeDefined();
    });
  });

  describe("SD-JWT VC Type Metadata (draft-ietf-oauth-sd-jwt-vc-19)", () => {
    it("derives valid Draft 2020-12 JSON Schema matching schema hierarchy", () => {
      const jsonSchema = deriveJsonSchema(schemaConfig);

      expect(jsonSchema.$schema).toBe(
        "https://json-schema.org/draft/2020-12/schema"
      );
      expect(jsonSchema.type).toBe("object");

      const props = jsonSchema.properties as Record<string, any>;
      expect(props.studentId.type).toBe("string");
      expect(props.dateOfBirth.type).toBe("string");
      expect(props.dateOfBirth.format).toBe("date");
      expect(props.papers.type).toBe("object");

      // Verify nested object properties under papers.diploma
      expect(props.papers.properties.diploma.type).toBe("object");
      expect(props.papers.properties.diploma.properties.degreeName.type).toBe(
        "string"
      );

      // Verify array items under papers.transcript.courses
      const courses =
        props.papers.properties.transcript.properties.courses;
      expect(courses.type).toBe("array");
      expect(courses.items.type).toBe("object");
      expect(courses.items.properties.code.type).toBe("string");
      expect(courses.items.properties.credits.type).toBe("number");

      // Required properties list
      expect(jsonSchema.required).toContain("studentId");
      expect(jsonSchema.required).toContain("fullName");
      expect(jsonSchema.required).toContain("papers");
      expect(jsonSchema.required).not.toContain("dateOfBirth");
    });

    it("generates Draft-19 Type Metadata document with selective disclosure policies", () => {
      const typeMetadata = generateTypeMetadata(
        schemaConfig,
        issuerConfig.vctBaseUrl
      );

      expect(typeMetadata.vct).toBe(
        resolveVct(schemaConfig.vctPath, issuerConfig.vctBaseUrl)
      );
      expect(typeMetadata.name).toBe("Graduation Academic Record");
      expect(typeMetadata.description).toContain("Official comprehensive graduation");
      expect(typeMetadata.schema).toBeDefined();
      expect(typeMetadata.claims).toBeDefined();

      expect(Array.isArray(typeMetadata.claims)).toBe(true);

      const findByPath = (path: Array<string | number | null>) =>
        typeMetadata.claims.find(
          (c) => JSON.stringify(c.path) === JSON.stringify(path)
        );

      // Verify selective disclosure policies preserved in Type Metadata array per draft-19
      const studentIdClaim = findByPath(["studentId"]);
      expect(studentIdClaim).toBeDefined();
      expect(studentIdClaim?.sd).toBe("never");
      expect(studentIdClaim?.mandatory).toBe(true);

      const dateOfBirthClaim = findByPath(["dateOfBirth"]);
      expect(dateOfBirthClaim).toBeDefined();
      expect(dateOfBirthClaim?.sd).toBe("always");
      expect(dateOfBirthClaim?.mandatory).toBe(false);

      const nationalIdClaim = findByPath(["nationalId"]);
      expect(nationalIdClaim).toBeDefined();
      expect(nationalIdClaim?.sd).toBe("always");

      const diplomaClaim = findByPath(["papers", "diploma"]);
      expect(diplomaClaim).toBeDefined();
      expect(diplomaClaim?.sd).toBe("always");

      const degreeNameClaim = findByPath(["papers", "diploma", "degreeName"]);
      expect(degreeNameClaim).toBeDefined();
      expect(degreeNameClaim?.sd).toBe("never");

      const honoursClaim = findByPath(["papers", "diploma", "honours"]);
      expect(honoursClaim).toBeDefined();
      expect(honoursClaim?.sd).toBe("always");

      const coursesGradeClaim = findByPath([
        "papers",
        "transcript",
        "courses",
        null,
        "grade",
      ]);
      expect(coursesGradeClaim).toBeDefined();
      expect(coursesGradeClaim?.sd).toBe("always");
    });

    it("handleVctRequest serves Type Metadata on exact vct path and /types prefix", async () => {
      // Exact path from vctPath (/types/graduation-record/v1)
      const resExact = handleVctRequest(
        schemaConfig.vctPath,
        schemaConfig,
        issuerConfig.vctBaseUrl
      );
      expect(resExact.status).toBe(200);
      expect(resExact.headers.get("Content-Type")).toBe("application/json");
      expect(resExact.headers.get("Access-Control-Allow-Origin")).toBe("*");
      const bodyExact = (await resExact.json()) as SdJwtVcTypeMetadata;
      expect(bodyExact.vct).toBe(
        resolveVct(schemaConfig.vctPath, issuerConfig.vctBaseUrl)
      );

      // Generic /types path
      const resGeneral = handleVctRequest(
        "/types",
        schemaConfig,
        issuerConfig.vctBaseUrl
      );
      expect(resGeneral.status).toBe(200);
      const bodyGeneral = (await resGeneral.json()) as SdJwtVcTypeMetadata;
      expect(bodyGeneral.vct).toBe(
        resolveVct(schemaConfig.vctPath, issuerConfig.vctBaseUrl)
      );

      // Trailing slash
      const resSlash = handleVctRequest(
        `${schemaConfig.vctPath}/`,
        schemaConfig,
        issuerConfig.vctBaseUrl
      );
      expect(resSlash.status).toBe(200);
    });

    it("handleVctRequest returns 404 for unknown type paths", async () => {
      const resNotFound = handleVctRequest(
        "/types/unregistered-license-type/v2",
        schemaConfig,
        issuerConfig.vctBaseUrl
      );
      expect(resNotFound.status).toBe(404);
      expect(resNotFound.headers.get("Content-Type")).toBe("application/json");
      expect(resNotFound.headers.get("Access-Control-Allow-Origin")).toBe("*");

      const body = (await resNotFound.json()) as { error: string };
      expect(body.error).toBe("not_found");
    });
  });

  describe("OAuth 2.0 Authorization Server Metadata (RFC 8414)", () => {
    it("handleOAuthMetadataRequest returns 200 OK with compliant metadata document", async () => {
      const res = handleOAuthMetadataRequest(issuerConfig);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/json");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");

      const body = (await res.json()) as any;
      expect(body.issuer).toBe("https://issuer.university.edu");
      expect(body.token_endpoint).toBe("https://issuer.university.edu/token");
      expect(body.authorization_endpoint).toBe(
        "https://issuer.university.edu/credential-offer"
      );
      expect(body.grant_types_supported).toEqual([
        "urn:ietf:params:oauth:grant-type:pre-authorized_code",
      ]);
      expect(body.token_endpoint_auth_methods_supported).toEqual(["none"]);
    });
  });

  describe("SD-JWT VC Issuer Metadata Document (/.well-known/jwt-vc-issuer)", () => {
    it("generates compliant metadata with issuer matching baseUrl and identical key to DID doc", async () => {
      const keyContext = await initializeKeyManager(issuerConfig);
      const metadata = generateJwtVcIssuerMetadata(issuerConfig, keyContext);
      const didDoc = generateDidDocument(issuerConfig, keyContext);

      // Issuer must match baseUrl verbatim
      expect(metadata.issuer).toBe(issuerConfig.baseUrl);

      // Must include inline jwks and NOT jwks_uri
      expect(metadata.jwks).toBeDefined();
      expect(Array.isArray(metadata.jwks.keys)).toBe(true);
      expect(metadata.jwks.keys.length).toBe(1);
      expect((metadata as any).jwks_uri).toBeUndefined();

      // Key must carry kid matching keyContext.keyId and match key in DID document
      const key = metadata.jwks.keys[0];
      expect(key.kid).toBe(issuerConfig.keyId);
      expect(key.use).toBe("sig");
      expect(key.alg).toBe(issuerConfig.signingAlgorithm);

      const didKey = didDoc.verificationMethod[0]?.publicKeyJwk;
      expect(key.x).toBe(didKey.x);
      expect(key.y).toBe(didKey.y);
      expect(key.crv).toBe(didKey.crv);
    });

    it("serves GET /.well-known/jwt-vc-issuer with application/json and CORS headers", async () => {
      const keyContext = await initializeKeyManager(issuerConfig);
      const res = handleJwtVcIssuerRequest(issuerConfig, keyContext);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/json");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");

      const body = (await res.json()) as any;
      expect(body.issuer).toBe(issuerConfig.baseUrl);
      expect(body.jwks.keys[0].kid).toBe(issuerConfig.keyId);
    });
  });
});
