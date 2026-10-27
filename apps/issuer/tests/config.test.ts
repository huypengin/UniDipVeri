import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import * as jose from "jose";
import {
  generateKeyPair,
  JWK_PRIVATE_KEY_PROPERTIES,
  type SigningAlgorithm,
} from "@unidipveri/core";
import {
  loadIssuerConfig,
  getEffectiveIssuer,
} from "../src/config.js";
import {
  assertCryptographicConsistency,
  initializeKeyManager,
  sanitizePublicJwk,
} from "../src/services/key-manager.js";

describe("Issuer Configuration Loading & Validation", () => {
  const fixtureSchemaPath = join(
    import.meta.dir,
    "../../../schemas/graduation-record.v1.yaml"
  );

  it("loads valid configuration with full environment overrides", () => {
    const config = loadIssuerConfig({
      PORT: "8080",
      ISSUER_BASE_URL: "https://issuer.university.edu/",
      ISSUER_DID: "did:web:issuer.university.edu",
      KEY_ID: "registrar-key-1",
      SIGNING_ALGORITHM: "EdDSA",
      SCHEMA_PATH: fixtureSchemaPath,
    });

    expect(config.port).toBe(8080);
    expect(config.baseUrl).toBe("https://issuer.university.edu"); // Trailing slash stripped
    expect(config.vctBaseUrl).toBe("https://issuer.university.edu");
    expect(config.issuerDid).toBe("did:web:issuer.university.edu");
    expect(config.keyId).toBe("registrar-key-1");
    expect(config.signingAlgorithm).toBe("EdDSA");
    expect(config.schemaPath).toBe(fixtureSchemaPath);
  });

  it("applies standard defaults for optional parameters", () => {
    const config = loadIssuerConfig({
      SCHEMA_PATH: fixtureSchemaPath,
    });

    expect(config.port).toBe(3000);
    expect(config.baseUrl).toBe("http://localhost:3000");
    expect(config.vctBaseUrl).toBe("http://localhost:3000");
    expect(config.issuerDid).toBe("did:web:localhost%3A3000");
    expect(config.keyId).toBe("key-1");
    expect(config.signingAlgorithm).toBe("ES256");
    expect(config.issuerIdentifierMode).toBe("did");
    expect(getEffectiveIssuer(config)).toBe("did:web:localhost%3A3000");
  });

  it("configures HTTPS issuer identifier mode (Variant B)", () => {
    const config = loadIssuerConfig({
      SCHEMA_PATH: fixtureSchemaPath,
      ISSUER_BASE_URL: "https://issuer.university.edu",
      ISSUER_IDENTIFIER_MODE: "https",
    });

    expect(config.issuerIdentifierMode).toBe("https");
    expect(getEffectiveIssuer(config)).toBe("https://issuer.university.edu");
  });

  it("rejects invalid issuer identifier mode", () => {
    expect(() =>
      loadIssuerConfig({
        SCHEMA_PATH: fixtureSchemaPath,
        ISSUER_IDENTIFIER_MODE: "ftp",
      })
    ).toThrow(/issuerIdentifierMode/);
  });

  it("rejects invalid port numbers (out of range or non-integer)", () => {
    expect(() =>
      loadIssuerConfig({
        PORT: "0",
        SCHEMA_PATH: fixtureSchemaPath,
      })
    ).toThrow(/port must be between 1 and 65535/);

    expect(() =>
      loadIssuerConfig({
        PORT: "70000",
        SCHEMA_PATH: fixtureSchemaPath,
      })
    ).toThrow(/port must be between 1 and 65535/);

    expect(() =>
      loadIssuerConfig({
        PORT: "not-a-number",
        SCHEMA_PATH: fixtureSchemaPath,
      })
    ).toThrow(/Expected number/);
  });

  it("rejects invalid baseUrl", () => {
    expect(() =>
      loadIssuerConfig({
        ISSUER_BASE_URL: "invalid-url",
        SCHEMA_PATH: fixtureSchemaPath,
      })
    ).toThrow(/baseUrl must be a valid HTTP or HTTPS URL/);
  });

  it("rejects invalid issuerDid not starting with 'did:'", () => {
    expect(() =>
      loadIssuerConfig({
        ISSUER_DID: "https://not-a-did.com",
        SCHEMA_PATH: fixtureSchemaPath,
      })
    ).toThrow(/issuerDid must start with 'did:'/);
  });

  it("rejects unsupported signing algorithms", () => {
    expect(() =>
      loadIssuerConfig({
        SIGNING_ALGORITHM: "RS256",
        SCHEMA_PATH: fixtureSchemaPath,
      })
    ).toThrow(/Invalid enum value.*ES256/);

    expect(() =>
      loadIssuerConfig({
        SIGNING_ALGORITHM: "none",
        SCHEMA_PATH: fixtureSchemaPath,
      })
    ).toThrow(/Invalid enum value.*ES256/);
  });

  it("rejects configuration when SCHEMA_PATH is missing", () => {
    expect(() =>
      loadIssuerConfig({
        SCHEMA_PATH: undefined,
      })
    ).toThrow(/schemaPath must be provided/);
  });

  describe("VCT_BASE_URL & Protocol Security Constraints", () => {
    it("respects explicit VCT_BASE_URL override and strips trailing slashes", () => {
      const config = loadIssuerConfig({
        SCHEMA_PATH: fixtureSchemaPath,
        ISSUER_BASE_URL: "http://localhost:3000",
        VCT_BASE_URL: "https://credentials.university.edu///",
      });

      expect(config.baseUrl).toBe("http://localhost:3000");
      expect(config.vctBaseUrl).toBe("https://credentials.university.edu");
    });

    it("fails startup in production (NODE_ENV=production) when VCT_BASE_URL uses insecure http://", () => {
      expect(() =>
        loadIssuerConfig({
          NODE_ENV: "production",
          SCHEMA_PATH: fixtureSchemaPath,
          ISSUER_BASE_URL: "https://issuer.university.edu",
          VCT_BASE_URL: "http://insecure-domain.com",
        })
      ).toThrow(/Production configuration error: VCT_BASE_URL must use https:\/\/ in production/);
    });

    it("fails startup in production (NODE_ENV=production) when ISSUER_BASE_URL uses insecure http://", () => {
      expect(() =>
        loadIssuerConfig({
          NODE_ENV: "production",
          SCHEMA_PATH: fixtureSchemaPath,
          ISSUER_BASE_URL: "http://localhost:3000",
          VCT_BASE_URL: "https://credentials.university.edu",
        })
      ).toThrow(/Production configuration error: ISSUER_BASE_URL must use https:\/\/ in production/);
    });

    it("refuses to start in production (NODE_ENV=production) when ISSUER_PRIVATE_KEY_JWK is omitted", () => {
      expect(() =>
        loadIssuerConfig({
          NODE_ENV: "production",
          SCHEMA_PATH: fixtureSchemaPath,
          ISSUER_BASE_URL: "https://issuer.university.edu",
          VCT_BASE_URL: "https://credentials.university.edu",
        })
      ).toThrow(
        /Production configuration error: ISSUER_PRIVATE_KEY_JWK must be provided in production mode/
      );
    });

    it("refuses to start in production (NODE_ENV=production) when ISSUER_PRIVATE_KEY_JWK is empty whitespace", () => {
      expect(() =>
        loadIssuerConfig({
          NODE_ENV: "production",
          SCHEMA_PATH: fixtureSchemaPath,
          ISSUER_BASE_URL: "https://issuer.university.edu",
          VCT_BASE_URL: "https://credentials.university.edu",
          ISSUER_PRIVATE_KEY_JWK: "   ",
        })
      ).toThrow(
        /Production configuration error: ISSUER_PRIVATE_KEY_JWK must be provided in production mode/
      );
    });

    it("succeeds startup in production (NODE_ENV=production) when both use https:// and key is provided", async () => {
      const generated = await generateKeyPair("ES256");
      const config = loadIssuerConfig({
        NODE_ENV: "production",
        SCHEMA_PATH: fixtureSchemaPath,
        ISSUER_BASE_URL: "https://issuer.university.edu",
        VCT_BASE_URL: "https://credentials.university.edu",
        ISSUER_PRIVATE_KEY_JWK: JSON.stringify(generated.privateKeyJwk),
      });

      expect(config.baseUrl).toBe("https://issuer.university.edu");
      expect(config.vctBaseUrl).toBe("https://credentials.university.edu");
      expect(config.privateKeyJwkJson).toBeDefined();
    });

    it("loads optional STATUS_LIST_PATH into config", () => {
      const config = loadIssuerConfig({
        SCHEMA_PATH: fixtureSchemaPath,
        STATUS_LIST_PATH: "/var/data/status-list.json",
      });
      expect(config.statusListPath).toBe("/var/data/status-list.json");
    });

    it("allows loopback http:// (localhost and 127.0.0.1) in development/test", () => {
      const config1 = loadIssuerConfig({
        NODE_ENV: "development",
        SCHEMA_PATH: fixtureSchemaPath,
        ISSUER_BASE_URL: "http://localhost:3000",
        VCT_BASE_URL: "http://localhost:3000",
      });
      expect(config1.vctBaseUrl).toBe("http://localhost:3000");

      const config2 = loadIssuerConfig({
        NODE_ENV: "development",
        SCHEMA_PATH: fixtureSchemaPath,
        ISSUER_BASE_URL: "http://127.0.0.1:3000",
        VCT_BASE_URL: "http://127.0.0.1:3000",
      });
      expect(config2.vctBaseUrl).toBe("http://127.0.0.1:3000");
    });

    it("fails startup in development when using insecure http:// on non-localhost remote host", () => {
      expect(() =>
        loadIssuerConfig({
          NODE_ENV: "development",
          SCHEMA_PATH: fixtureSchemaPath,
          ISSUER_BASE_URL: "http://remote-unencrypted-host.com",
        })
      ).toThrow(/Development configuration error: Insecure HTTP ISSUER_BASE_URL allowed only for localhost\/127\.0\.0\.1/);

      expect(() =>
        loadIssuerConfig({
          NODE_ENV: "development",
          SCHEMA_PATH: fixtureSchemaPath,
          ISSUER_BASE_URL: "http://localhost:3000",
          VCT_BASE_URL: "http://remote-unencrypted-host.com",
        })
      ).toThrow(/Development configuration error: Insecure HTTP VCT_BASE_URL allowed only for localhost\/127\.0\.0\.1/);
    });
  });
});

describe("Issuer KeyManager & Cryptographic Caching", () => {
  const fixtureSchemaPath = join(
    import.meta.dir,
    "../../../schemas/graduation-record.v1.yaml"
  );
  const algorithms: SigningAlgorithm[] = ["ES256", "EdDSA", "ES384"];

  for (const alg of algorithms) {
    describe(`Algorithm Agility: ${alg}`, () => {
      it(`initializes with ephemeral key and pre-imports ${alg} private key`, async () => {
        const config = loadIssuerConfig({
          SIGNING_ALGORITHM: alg,
          KEY_ID: `test-${alg.toLowerCase()}`,
          SCHEMA_PATH: fixtureSchemaPath,
        });

        const keyContext = await initializeKeyManager(config);

        expect(keyContext.keyId).toBe(`test-${alg.toLowerCase()}`);
        expect(keyContext.alg).toBe(alg);
        expect(keyContext.privateKey).toBeDefined();

        // 1. Verify public JWK is sanitized and has no private key parameters
        for (const privateProp of JWK_PRIVATE_KEY_PROPERTIES) {
          expect(
            Object.prototype.hasOwnProperty.call(keyContext.publicKeyJwk, privateProp)
          ).toBe(false);
        }
        expect(keyContext.publicKeyJwk.kid).toBe(`test-${alg.toLowerCase()}`);
        expect(keyContext.publicKeyJwk.alg).toBe(alg);

        // 2. Verify pre-imported privateKey can sign a JWT successfully
        const testPayload = { sub: "test-subject", role: "issuer" };
        const signedJwt = await new jose.SignJWT(testPayload)
          .setProtectedHeader({ alg, kid: keyContext.keyId })
          .setIssuedAt()
          .sign(keyContext.privateKey);

        expect(typeof signedJwt).toBe("string");

        // 3. Verify signature verifies with the public key JWK
        const importedPublic = await jose.importJWK(keyContext.publicKeyJwk, alg);
        const verifyResult = await jose.jwtVerify(signedJwt, importedPublic);
        expect(verifyResult.payload.sub).toBe("test-subject");
      });

      it(`initializes with explicit privateKeyJwkJson for ${alg}`, async () => {
        const generated = await generateKeyPair(alg);
        const config = loadIssuerConfig({
          SIGNING_ALGORITHM: alg,
          KEY_ID: `explicit-${alg.toLowerCase()}`,
          SCHEMA_PATH: fixtureSchemaPath,
          ISSUER_PRIVATE_KEY_JWK: JSON.stringify(generated.privateKeyJwk),
        });

        const keyContext = await initializeKeyManager(config);

        expect(keyContext.keyId).toBe(`explicit-${alg.toLowerCase()}`);
        expect(keyContext.alg).toBe(alg);

        // Public key matches generated public key
        expect(keyContext.publicKeyJwk.x).toBe(generated.publicKeyJwk.x);
        for (const privateProp of JWK_PRIVATE_KEY_PROPERTIES) {
          expect(
            Object.prototype.hasOwnProperty.call(keyContext.publicKeyJwk, privateProp)
          ).toBe(false);
        }

        // Pre-imported key can sign
        const testPayload = { sub: "explicit-test" };
        const signedJwt = await new jose.SignJWT(testPayload)
          .setProtectedHeader({ alg, kid: keyContext.keyId })
          .setIssuedAt()
          .sign(keyContext.privateKey);

        const importedPublic = await jose.importJWK(keyContext.publicKeyJwk, alg);
        const verifyResult = await jose.jwtVerify(signedJwt, importedPublic);
        expect(verifyResult.payload.sub).toBe("explicit-test");
      });
    });
  }

  describe("Public Key Sanitization & Error Enforcements", () => {
    it("sanitizePublicJwk strips all private parameters from a JWK", async () => {
      const generated = await generateKeyPair("ES256");
      expect(generated.privateKeyJwk.d).toBeDefined();

      const sanitized = sanitizePublicJwk(generated.privateKeyJwk);
      expect(sanitized.d).toBeUndefined();
      expect(sanitized.kty).toBe("EC");
      expect(sanitized.crv).toBe("P-256");
      expect(sanitized.x).toBe(generated.publicKeyJwk.x);
      expect(sanitized.y).toBe(generated.publicKeyJwk.y);
    });

    it("rejects invalid JSON string in ISSUER_PRIVATE_KEY_JWK", () => {
      const config = loadIssuerConfig({
        SCHEMA_PATH: fixtureSchemaPath,
        ISSUER_PRIVATE_KEY_JWK: "not-json-content",
      });

      expect(initializeKeyManager(config)).rejects.toThrow(
        /Failed to parse ISSUER_PRIVATE_KEY_JWK as JSON/
      );
    });

    it("rejects JSON that does not contain a valid JWK object", () => {
      const config = loadIssuerConfig({
        SCHEMA_PATH: fixtureSchemaPath,
        ISSUER_PRIVATE_KEY_JWK: JSON.stringify({ someKey: "not-a-jwk" }),
      });

      expect(initializeKeyManager(config)).rejects.toThrow(
        /Parsed private key JWK must be a valid JSON object with a 'kty' property/
      );
    });
  });

  describe("Cryptographic Consistency & Public Key Integrity", () => {
    const algorithms: SigningAlgorithm[] = ["ES256", "EdDSA", "ES384"];

    for (const alg of algorithms) {
      it(`verifies assertCryptographicConsistency succeeds for matching ${alg} keypair`, async () => {
        const kp = await generateKeyPair(alg);
        const privateKey = await jose.importJWK(kp.privateKeyJwk, alg);
        const sanitizedPub = sanitizePublicJwk(kp.privateKeyJwk);

        // Consistency check must succeed without throwing
        expect(
              assertCryptographicConsistency(privateKey, sanitizedPub, alg)
          ).resolves.toBeUndefined();
      });

      it(`verifies assertCryptographicConsistency rejects mismatched ${alg} keypair`, async () => {
        const kp1 = await generateKeyPair(alg);
        const kp2 = await generateKeyPair(alg);
        const privateKey1 = await jose.importJWK(kp1.privateKeyJwk, alg);
        const sanitizedPub2 = sanitizePublicJwk(kp2.privateKeyJwk);

        // Verification using a different public key must fail
        expect(
              assertCryptographicConsistency(privateKey1, sanitizedPub2, alg)
          ).rejects.toThrow(/Cryptographic consistency check failed/);
      });
    }

    it("initializeKeyManager rejects EdDSA private key with tampered public coordinates", async () => {
      const kp1 = await generateKeyPair("EdDSA");
      const kp2 = await generateKeyPair("EdDSA");

      // Construct a hybrid JWK: private key 'd' from kp1, but public coordinate 'x' from kp2
      const tamperedJwk: jose.JWK = {
        ...kp1.privateKeyJwk,
        x: kp2.publicKeyJwk.x,
      };

      const config = loadIssuerConfig({
        SCHEMA_PATH: fixtureSchemaPath,
        SIGNING_ALGORITHM: "EdDSA",
        ISSUER_PRIVATE_KEY_JWK: JSON.stringify(tamperedJwk),
      });

      expect(initializeKeyManager(config)).rejects.toThrow(
            /Cryptographic consistency check failed/
        );
    });

    it("initializeKeyManager rejects ES256 private key with tampered coordinates", async () => {
      const kp1 = await generateKeyPair("ES256");
      const kp2 = await generateKeyPair("ES256");

      // Construct a hybrid JWK with mismatched x and y coordinates
      const tamperedJwk: jose.JWK = {
        ...kp1.privateKeyJwk,
        x: kp2.publicKeyJwk.x,
        y: kp2.publicKeyJwk.y,
      };

      const config = loadIssuerConfig({
        SCHEMA_PATH: fixtureSchemaPath,
        SIGNING_ALGORITHM: "ES256",
        ISSUER_PRIVATE_KEY_JWK: JSON.stringify(tamperedJwk),
      });

      // SubtleCrypto rejects during importJWK with Invalid keyData or consistency check
      expect(initializeKeyManager(config)).rejects.toThrow(
            /Invalid keyData|Cryptographic consistency check failed/
        );
    });

    it("verifies public key can verify tokens and detects payload tampering", async () => {
      const config = loadIssuerConfig({
        SCHEMA_PATH: fixtureSchemaPath,
        SIGNING_ALGORITHM: "ES256",
      });

      const keyContext = await initializeKeyManager(config);
      const publicKey = await jose.importJWK(keyContext.publicKeyJwk, "ES256");

      // Sign payload with private key
      const originalPayload = { sub: "student-12345", role: "graduate" };
      const jws = await new jose.CompactSign(
        new TextEncoder().encode(JSON.stringify(originalPayload))
      )
        .setProtectedHeader({ alg: "ES256", kid: keyContext.keyId })
        .sign(keyContext.privateKey);

      // Verify with public key
      const verified = await jose.compactVerify(jws, publicKey);
      const parsed = JSON.parse(new TextDecoder().decode(verified.payload));
      expect(parsed.sub).toBe("student-12345");

      // Tampered payload fails verification
      const parts = jws.split(".");
      const tamperedPayloadB64 = Buffer.from(
        JSON.stringify({ sub: "attacker", role: "graduate" })
      ).toString("base64url");
      const tamperedJws = `${parts[0]}.${tamperedPayloadB64}.${parts[2]}`;

      expect(jose.compactVerify(tamperedJws, publicKey)).rejects.toThrow(
            /signature verification failed/
        );
    });
  });
});
