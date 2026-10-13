import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SDJwtInstance } from "@sd-jwt/core";
import { decodeProtectedHeader } from "jose";
import { loadSchemaFromFile } from "../src/schema/loader.js";
import {
  generateKeyPair,
  verifyJwt,
  type SigningAlgorithm,
} from "../src/signing/signer.js";
import {
  issueSdJwtVc,
  signSdJwtVc,
  assertNoReservedClaims,
  SD_JWT_VC_TYP,
  RESERVED_TOP_LEVEL_CLAIMS,
} from "../src/signing/vc-issuer.js";
import { resolveVct } from "../src/schema/vct.js";
import { transformClaims } from "../src/sd-jwt/transform.js";

describe("Outer JWS SD-JWT VC Issuance Engine (draft-ietf-oauth-sd-jwt-vc-19 & RFC 9901)", () => {
  const schemaPath = join(
    import.meta.dir,
    "../../../schemas/graduation-record.yaml"
  );

  const testStudentClaims = {
    studentId: "STU-2026-8899",
    fullName: "Nguyen Van A",
    dateOfBirth: "2002-05-15",
    nationalId: "001202008899",
    papers: {
      diploma: {
        degreeName: "Bachelor of Science in Computer Science",
        degreeType: "Bachelor",
        programName: "Honors Program in Software Engineering",
        major: "Computer Science",
        graduationDate: "2026-06-30",
      },
      transcript: {
        transcriptId: "TR-2026-8899",
        cumulativeGPA: 3.88,
        totalCredits: 135,
        courses: [
          {
            code: "CS101",
            title: "Introduction to Computer Science",
            credits: 3,
            grade: 4.0,
            letterGrade: "A",
          },
          {
            code: "CS201",
            title: "Data Structures and Algorithms",
            credits: 4,
            grade: 4.0,
            letterGrade: "A",
          },
        ],
      },
    },
  };

  const algorithms: SigningAlgorithm[] = ["ES256", "EdDSA", "ES384"];

  for (const alg of algorithms) {
    describe(`Algorithm Agility: ${alg}`, () => {
      it(`successfully issues SD-JWT VC with ${alg} conforming to draft-19`, async () => {
        const schema = await loadSchemaFromFile(schemaPath);
        const { publicKeyJwk, privateKeyJwk } = await generateKeyPair(alg);

        const issuerDid = "did:web:credentials.university.edu";
        const keyId = `key-${alg.toLowerCase()}-1`;

        const result = await issueSdJwtVc(testStudentClaims, schema, {
          issuer: issuerDid,
          signingKey: {
            privateKey: privateKeyJwk,
            alg,
            keyId,
          },
          validitySeconds: 31536000, // 1 year
        });

        // 1. Result interface completeness
        expect(result.compact).toBeDefined();
        expect(result.jwt).toBeDefined();
        expect(result.disclosures).toBeArray();
        expect(result.disclosures.length).toBeGreaterThan(0);
        expect(result.payload).toBeDefined();

        // 2. Wire format ends with delimiter "~" per RFC 9901 Section 5
        expect(result.compact.endsWith("~")).toBe(true);
        expect(result.compact).toBe(
          `${result.jwt}~${result.disclosures.join("~")}~`
        );

        // 3. Header check: typ MUST be "dc+sd-jwt" per draft-19
        const header = decodeProtectedHeader(result.jwt);
        expect(header.typ).toBe(SD_JWT_VC_TYP);
        expect(header.typ).toBe("dc+sd-jwt");
        expect(header.alg).toBe(alg);
        expect(header.kid).toBe(keyId);

        // 4. Outer JWS signature verification with jose
        const verifyResult = await verifyJwt(result.jwt, publicKeyJwk, alg);
        expect(verifyResult.payload).toBeDefined();
        expect(verifyResult.payload.iss).toBe(issuerDid);
        expect(verifyResult.payload.vct).toBe(
          resolveVct(schema.vctPath, "https://credentials.university.edu")
        );
        expect(verifyResult.payload.iat).toBeNumber();
        expect(verifyResult.payload.nbf).toBeNumber();
        expect(verifyResult.payload.exp).toBeNumber();
        expect(verifyResult.payload.jti).toBeString();

        // 5. Always-disclosed claims are visible in payload, selectively-disclosable claims are in _sd
        expect(verifyResult.payload.studentId).toBe("STU-2026-8899");
        expect(verifyResult.payload.fullName).toBe("Nguyen Van A");
        expect(verifyResult.payload.dateOfBirth).toBeUndefined(); // disclosable -> in _sd
        expect(verifyResult.payload._sd).toBeArray();

        // 6. Oracle compatibility: verify with @sd-jwt/core
        const oracle = new SDJwtInstance({
          hasher: (val) => createHash("sha256").update(val).digest(),
        });
        const decoded = await oracle.decode(result.compact);
        expect(decoded.jwt).toBeDefined();
        expect(decoded.disclosures?.length).toBe(result.disclosures.length);

        const reconstructed = (await decoded.getClaims(async (data) =>
          createHash("sha256").update(data).digest()
        )) as Record<string, unknown>;
        expect(reconstructed.studentId).toBe("STU-2026-8899");
        expect(reconstructed.dateOfBirth).toBe("2002-05-15");
      });
    });
  }

  describe("Holder Key Confirmation (cnf) Binding", () => {
    it("injects cnf.jwk into outer signed payload per draft-19 Section 3.2.1", async () => {
      const schema = await loadSchemaFromFile(schemaPath);
      const issuerKeys = await generateKeyPair("ES256");
      const holderKeys = await generateKeyPair("ES256");

      const result = await issueSdJwtVc(testStudentClaims, schema, {
        issuer: "did:web:university.edu",
        signingKey: {
          privateKey: issuerKeys.privateKeyJwk,
          alg: "ES256",
        },
        holderConfirmation: {
          jwk: holderKeys.publicKeyJwk,
        },
      });

      const verifyResult = await verifyJwt(
        result.jwt,
        issuerKeys.publicKeyJwk,
        "ES256"
      );
      expect(verifyResult.payload.cnf).toBeDefined();
      const cnf = verifyResult.payload.cnf as Record<string, unknown>;
      expect(cnf.jwk).toEqual(holderKeys.publicKeyJwk);
    });

    it("injects cnf.kid when holder key is identified by URI", async () => {
      const schema = await loadSchemaFromFile(schemaPath);
      const issuerKeys = await generateKeyPair("ES256");

      const result = await issueSdJwtVc(testStudentClaims, schema, {
        issuer: "did:web:university.edu",
        signingKey: {
          privateKey: issuerKeys.privateKeyJwk,
          alg: "ES256",
        },
        holderConfirmation: {
          kid: "did:jwk:holder-key#key-1",
        },
      });

      const verifyResult = await verifyJwt(
        result.jwt,
        issuerKeys.publicKeyJwk,
        "ES256"
      );
      const cnf = verifyResult.payload.cnf as Record<string, unknown>;
      expect(cnf.kid).toBe("did:jwk:holder-key#key-1");
    });

    it("rejects invalid cnf without jwk or kid", async () => {
      const schema = await loadSchemaFromFile(schemaPath);
      const issuerKeys = await generateKeyPair("ES256");

      expect(
        issueSdJwtVc(testStudentClaims, schema, {
          issuer: "did:web:university.edu",
          signingKey: {
            privateKey: issuerKeys.privateKeyJwk,
            alg: "ES256",
          },
          holderConfirmation: {} as any,
        })
      ).rejects.toThrow();
    });

    it("rejects cnf.jwk containing private key material in issueSdJwtVc", async () => {
      const schema = await loadSchemaFromFile(schemaPath);
      const issuerKeys = await generateKeyPair("ES256");
      const holderKeys = await generateKeyPair("ES256");

      expect(
        issueSdJwtVc(testStudentClaims, schema, {
          issuer: "did:web:university.edu",
          signingKey: {
            privateKey: issuerKeys.privateKeyJwk,
            alg: "ES256",
          },
          holderConfirmation: {
            jwk: holderKeys.privateKeyJwk, // Contains private parameter 'd'
          },
        })
      ).rejects.toThrow(/cnf\.jwk must not contain private key material/);
    });

    it("rejects payload.cnf containing private key material in signSdJwtVc", async () => {
      const issuerKeys = await generateKeyPair("ES256");
      const holderKeys = await generateKeyPair("ES256");

      expect(
        signSdJwtVc({
          payload: {
            iss: "did:web:university.edu",
            vct: "https://credentials.university.edu/plain/v1",
            cnf: {
              jwk: holderKeys.privateKeyJwk, // Contains private parameter 'd'
            },
          },
          disclosures: [],
          signingKey: {
            privateKey: issuerKeys.privateKeyJwk,
            alg: "ES256",
          },
        })
      ).rejects.toThrow(/cnf\.jwk must not contain private key material/);
    });
  });

  describe("Token Status List (status) Revocation Binding", () => {
    it("injects status.status_list into payload per draft-ietf-oauth-status-list-21", async () => {
      const schema = await loadSchemaFromFile(schemaPath);
      const issuerKeys = await generateKeyPair("ES256");

      const statusClaim = {
        status_list: {
          idx: 42,
          uri: "https://issuer.university.edu/status/status-list-1",
        },
      };

      const result = await issueSdJwtVc(testStudentClaims, schema, {
        issuer: "did:web:university.edu",
        signingKey: {
          privateKey: issuerKeys.privateKeyJwk,
          alg: "ES256",
        },
        status: statusClaim,
      });

      const verifyResult = await verifyJwt(
        result.jwt,
        issuerKeys.publicKeyJwk,
        "ES256"
      );
      expect(verifyResult.payload.status).toBeDefined();
      expect(verifyResult.payload.status).toEqual(statusClaim);
    });

    it("rejects status with negative idx or invalid URI", async () => {
      const schema = await loadSchemaFromFile(schemaPath);
      const issuerKeys = await generateKeyPair("ES256");

      expect(
        issueSdJwtVc(testStudentClaims, schema, {
          issuer: "did:web:university.edu",
          signingKey: {
            privateKey: issuerKeys.privateKeyJwk,
            alg: "ES256",
          },
          status: {
            status_list: {
              idx: -1,
              uri: "https://issuer.university.edu/status/1",
            },
          },
        })
      ).rejects.toThrow();

      expect(
        issueSdJwtVc(testStudentClaims, schema, {
          issuer: "did:web:university.edu",
          signingKey: {
            privateKey: issuerKeys.privateKeyJwk,
            alg: "ES256",
          },
          status: {
            status_list: {
              idx: 10,
              uri: "not-a-valid-url",
            },
          },
        })
      ).rejects.toThrow();
    });
  });

  describe("Reserved Top-Level Claim Guards", () => {
    it("rejects caller claims containing reserved keys", () => {
      for (const reservedKey of RESERVED_TOP_LEVEL_CLAIMS) {
        const maliciousClaims = {
          ...testStudentClaims,
          [reservedKey]: "injected-value",
        };

        expect(() => assertNoReservedClaims(maliciousClaims)).toThrow(
          new RegExp(`reserved top-level claim '${reservedKey.replace(".", "\\.")}'`)
        );
      }
    });

    it("rejects issueSdJwtVc when caller claims contain reserved keys", async () => {
      const schema = await loadSchemaFromFile(schemaPath);
      const issuerKeys = await generateKeyPair("ES256");

      const claimsWithInjectedIss = {
        ...testStudentClaims,
        iss: "did:web:attacker.edu",
      };

      expect(
        issueSdJwtVc(claimsWithInjectedIss, schema, {
          issuer: "did:web:university.edu",
          signingKey: {
            privateKey: issuerKeys.privateKeyJwk,
            alg: "ES256",
          },
        })
      ).rejects.toThrow(/reserved top-level claim 'iss'/);
    });
  });

  describe("Timestamp and Token Identifier Configuration", () => {
    it("respects explicit iat, notBeforeSeconds, validitySeconds, and jti", async () => {
      const schema = await loadSchemaFromFile(schemaPath);
      const issuerKeys = await generateKeyPair("ES256");

      const explicitIat = Math.floor(Date.now() / 1000) - 10;
      const explicitJti = "urn:uuid:custom-token-id-12345";

      const result = await issueSdJwtVc(testStudentClaims, schema, {
        issuer: "did:web:university.edu",
        signingKey: {
          privateKey: issuerKeys.privateKeyJwk,
          alg: "ES256",
        },
        iat: explicitIat,
        notBeforeSeconds: 5, // nbf = iat + 5
        validitySeconds: 3600, // exp = iat + 3600
        jti: explicitJti,
      });

      const verifyResult = await verifyJwt(
        result.jwt,
        issuerKeys.publicKeyJwk,
        "ES256"
      );
      expect(verifyResult.payload.iat).toBe(explicitIat);
      expect(verifyResult.payload.nbf).toBe(explicitIat + 5);
      expect(verifyResult.payload.exp).toBe(explicitIat + 3600);
      expect(verifyResult.payload.jti).toBe(explicitJti);
    });

    it("rejects non-positive validitySeconds in issueSdJwtVc", async () => {
      const schema = await loadSchemaFromFile(schemaPath);
      const issuerKeys = await generateKeyPair("ES256");

      expect(
        issueSdJwtVc(testStudentClaims, schema, {
          issuer: "did:web:university.edu",
          signingKey: {
            privateKey: issuerKeys.privateKeyJwk,
            alg: "ES256",
          },
          validitySeconds: 0,
        })
      ).rejects.toThrow(/options\.validitySeconds must be a positive number/);

      expect(
        issueSdJwtVc(testStudentClaims, schema, {
          issuer: "did:web:university.edu",
          signingKey: {
            privateKey: issuerKeys.privateKeyJwk,
            alg: "ES256",
          },
          validitySeconds: -60,
        })
      ).rejects.toThrow(/options\.validitySeconds must be a positive number/);
    });

    it("rejects when nbf > exp in issueSdJwtVc", async () => {
      const schema = await loadSchemaFromFile(schemaPath);
      const issuerKeys = await generateKeyPair("ES256");

      expect(
        issueSdJwtVc(testStudentClaims, schema, {
          issuer: "did:web:university.edu",
          signingKey: {
            privateKey: issuerKeys.privateKeyJwk,
            alg: "ES256",
          },
          validitySeconds: 100,
          notBeforeSeconds: 200, // nbf = iat + 200 > exp = iat + 100
        })
      ).rejects.toThrow(/Invalid timestamps: nbf .* cannot be greater than exp/);
    });

    it("rejects when payload.nbf > payload.exp in signSdJwtVc", async () => {
      const issuerKeys = await generateKeyPair("ES256");

      expect(
        signSdJwtVc({
          payload: {
            iss: "did:web:university.edu",
            vct: "https://credentials.university.edu/plain/v1",
            iat: 1000,
            nbf: 1500,
            exp: 1200,
          },
          disclosures: [],
          signingKey: {
            privateKey: issuerKeys.privateKeyJwk,
            alg: "ES256",
          },
        })
      ).rejects.toThrow(/Invalid timestamps: nbf .* cannot be greater than exp/);
    });
  });

  describe("Low-Level signSdJwtVc() Signer", () => {
    it("signs pre-masked payload with reproducible disclosures", async () => {
      const schema = await loadSchemaFromFile(schemaPath);
      const issuerKeys = await generateKeyPair("ES256");

      // Deterministic transform using custom salt generator
      let saltIndex = 0;
      const fixedSalts = ["salt1_fixed_12345678", "salt2_fixed_12345678"];
      const transformResult = transformClaims(testStudentClaims, schema, {
        saltGenerator: () => fixedSalts[saltIndex++ % fixedSalts.length],
      });

      const assembledPayload: Record<string, unknown> = {
        ...transformResult.maskedPayload,
        iss: "did:web:university.edu",
        vct: resolveVct(schema.vctPath, "https://university.edu"),
        iat: 1750000000,
      };

      const result = await signSdJwtVc({
        payload: assembledPayload,
        disclosures: transformResult.disclosures,
        signingKey: {
          privateKey: issuerKeys.privateKeyJwk,
          alg: "ES256",
          keyId: "key-deterministic",
        },
      });

      expect(result.compact.endsWith("~")).toBe(true);
      const header = decodeProtectedHeader(result.jwt);
      expect(header.typ).toBe(SD_JWT_VC_TYP);
      expect(header.alg).toBe("ES256");
      expect(header.kid).toBe("key-deterministic");
    });

    it("handles payload with 0 disclosures properly", async () => {
      const issuerKeys = await generateKeyPair("ES256");

      const allPlainPayload = {
        iss: "did:web:university.edu",
        vct: "https://credentials.university.edu/plain/v1",
        studentId: "STU-001",
      };

      const result = await signSdJwtVc({
        payload: allPlainPayload,
        disclosures: [],
        signingKey: {
          privateKey: issuerKeys.privateKeyJwk,
          alg: "ES256",
        },
      });

      // Per RFC 9901 Section 5, 0 disclosures results in <jwt>~
      expect(result.compact).toBe(`${result.jwt}~`);
      expect(result.disclosures).toEqual([]);
    });

    it("throws error when payload is missing iss or vct", async () => {
      const issuerKeys = await generateKeyPair("ES256");

      expect(
        signSdJwtVc({
          payload: { vct: "https://example.com/vct" },
          disclosures: [],
          signingKey: {
            privateKey: issuerKeys.privateKeyJwk,
            alg: "ES256",
          },
        })
      ).rejects.toThrow(/Payload must contain a non-empty 'iss' claim/);

      expect(
        signSdJwtVc({
          payload: { iss: "did:web:example.com" },
          disclosures: [],
          signingKey: {
            privateKey: issuerKeys.privateKeyJwk,
            alg: "ES256",
          },
        })
      ).rejects.toThrow(/Payload must contain a non-empty 'vct' claim/);
    });

    it("resolves vct using explicit vctBaseUrl correctly", async () => {
      const issuerKeys = await generateKeyPair("ES256");
      const schema = await loadSchemaFromFile(schemaPath);

      const result = await issueSdJwtVc(
        testStudentClaims,
        schema,
        {
          issuer: "did:web:example.com",
          vctBaseUrl: "http://localhost:3000",
          signingKey: {
            privateKey: issuerKeys.privateKeyJwk,
            alg: "ES256",
          },
        }
      );

      expect(result.payload.vct).toBe("http://localhost:3000/types/graduation-record/v1");
    });

    it("resolves vct with explicit relative vct path in options", async () => {
      const issuerKeys = await generateKeyPair("ES256");
      const schema = await loadSchemaFromFile(schemaPath);

      const result = await issueSdJwtVc(
        testStudentClaims,
        schema,
        {
          issuer: "did:web:example.com",
          vctBaseUrl: "https://custom-host.edu",
          vct: "/types/special-award/v1",
          signingKey: {
            privateKey: issuerKeys.privateKeyJwk,
            alg: "ES256",
          },
        }
      );

      expect(result.payload.vct).toBe("https://custom-host.edu/types/special-award/v1");
    });
  });
});
