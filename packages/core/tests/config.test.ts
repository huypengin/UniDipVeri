import { describe, expect, it } from "bun:test";
import { loadConfigFromEnv } from "../src/config/config.js";

describe("Deployment Configuration Loader", () => {
  it("loads configuration successfully when SCHEMA_PATH is supplied", () => {
    const config = loadConfigFromEnv({
      SCHEMA_PATH: "/etc/unidipveri/schemas/graduation-record.yaml",
      SIGNING_ALGORITHM: "EdDSA",
      KEY_ID: "key-2026",
      ISSUER_DID: "did:web:credentials.university.edu",
    });

    expect(config.schemaPath).toBe("/etc/unidipveri/schemas/graduation-record.yaml");
    expect(config.signingAlgorithm).toBe("EdDSA");
    expect(config.keyId).toBe("key-2026");
    expect(config.issuerDid).toBe("did:web:credentials.university.edu");
  });

  it("applies sensible defaults for optional settings", () => {
    const config = loadConfigFromEnv({
      SCHEMA_PATH: "/some/path/schema.yaml",
    });

    expect(config.signingAlgorithm).toBe("ES256");
    expect(config.keyId).toBe("key-1");
    expect(config.issuerDid).toBe("did:web:example.university.edu");
  });

  it("throws validation error when SCHEMA_PATH is missing", () => {
    expect(() =>
      loadConfigFromEnv({
        SCHEMA_PATH: "",
      })
    ).toThrow(/schemaPath is required/);
  });

  it("throws validation error for invalid signing algorithm", () => {
    expect(() =>
      loadConfigFromEnv({
        SCHEMA_PATH: "/some/path/schema.yaml",
        SIGNING_ALGORITHM: "INVALID_ALG",
      })
    ).toThrow();
  });
});
