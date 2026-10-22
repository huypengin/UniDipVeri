import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import * as jose from "jose";
import { createVerificationEngine } from "../src/verification/index.js";
import { loadSchemaFromFile } from "../src/schema/loader.js";
import { issueSdJwtVc } from "../src/signing/vc-issuer.js";
import { generateKeyPair, type SigningAlgorithm } from "../src/signing/signer.js";
import { KEY_BINDING_JWT_TYP, computeSdHashSync } from "../src/verification/kb-verifier.js";

const FIXTURE_SCHEMA_PATH = join(
  import.meta.dir,
  "fixtures/graduation-record.yaml"
);

const SAMPLE_STUDENT_CLAIMS = {
  studentId: "STU-2026-8899",
  fullName: "Nguyen Van A",
  papers: {
    diploma: {
      degreeName: "Bachelor of Science in Computer Science",
      graduationDate: "2026-06-30",
    },
    transcript: {
      cumulativeGPA: 3.92,
      courses: [
        { code: "CS101", title: "Introduction to Computer Science", grade: "A" },
        { code: "CS201", title: "Data Structures & Algorithms", grade: "A" },
        { code: "CS301", title: "Operating Systems", grade: "A-" },
      ],
    },
  },
};

describe("Pluggable Engine Equivalence: Native vs Oracle", () => {
  const nativeEngine = createVerificationEngine("native");
  const oracleEngine = createVerificationEngine("oracle");

  const algorithms: SigningAlgorithm[] = ["ES256", "EdDSA", "ES384"];

  for (const alg of algorithms) {
    describe(`Algorithm Parity: ${alg}`, () => {
      it("yields identical verification validity and unmasked claims on fully disclosed presentation", async () => {
        const schema = await loadSchemaFromFile(FIXTURE_SCHEMA_PATH);
        const issuerKp = await generateKeyPair(alg);
        const issuerDid = "did:web:university.example.edu";

        const issued = await issueSdJwtVc(SAMPLE_STUDENT_CLAIMS, schema, {
          issuer: issuerDid,
          signingKey: {
            privateKey: issuerKp.privateKeyJwk,
            alg,
            keyId: "main-key",
          },
        });

        const options = {
          resolveIssuerKey: async () => issuerKp.publicKeyJwk,
        };

        const nativeResult = await nativeEngine.verify(issued.compact, options);
        const oracleResult = await oracleEngine.verify(issued.compact, options);

        // 1. Both engines agree on overall validity
        expect(nativeResult.valid).toBe(true);
        expect(oracleResult.valid).toBe(true);

        // 2. Metadata agreement
        expect(nativeResult.issuer).toBe(oracleResult.issuer);
        expect(nativeResult.vct).toBe(oracleResult.vct);

        // 3. Check summaries match
        expect(nativeResult.checks.issuerSignature).toBe(
          oracleResult.checks.issuerSignature
        );
        expect(nativeResult.checks.disclosureDigests).toBe(
          oracleResult.checks.disclosureDigests
        );
        expect(nativeResult.checks.holderKeyBinding).toBe(
          oracleResult.checks.holderKeyBinding
        );

        // 4. Exact claims parity (field for field, claim for claim)
        expect(nativeResult.verifiedClaims).toEqual(oracleResult.verifiedClaims);

        // 5. Native engine execution time is instrumented
        expect(nativeResult.executionTimeMs).toBeGreaterThan(0);
        expect(oracleResult.executionTimeMs).toBeGreaterThan(0);
      });
    });
  }

  describe("Selective Disclosure Parity", () => {
    it("yields identical claim subsets when partial disclosures are presented", async () => {
      const schema = await loadSchemaFromFile(FIXTURE_SCHEMA_PATH);
      const issuerKp = await generateKeyPair("ES256");
      const issuerDid = "did:web:university.example.edu";

      const issued = await issueSdJwtVc(SAMPLE_STUDENT_CLAIMS, schema, {
        issuer: issuerDid,
        signingKey: {
          privateKey: issuerKp.privateKeyJwk,
          alg: "ES256",
        },
      });

      // Present only the diploma disclosure, keeping transcript concealed
      const keptDisclosures: string[] = [];
      for (const disc of issued.disclosures) {
        const decoded = JSON.parse(
          new TextDecoder().decode(jose.base64url.decode(disc))
        );
        if (Array.isArray(decoded) && decoded[1] === "diploma") {
          keptDisclosures.push(disc);
        }
      }

      const presentation = `${issued.jwt}~${keptDisclosures.join("~")}~`;
      const options = {
        resolveIssuerKey: async () => issuerKp.publicKeyJwk,
      };

      const nativeResult = await nativeEngine.verify(presentation, options);
      const oracleResult = await oracleEngine.verify(presentation, options);

      expect(nativeResult.valid).toBe(true);
      expect(oracleResult.valid).toBe(true);
      expect(nativeResult.verifiedClaims).toEqual(oracleResult.verifiedClaims);

      const claims = nativeResult.verifiedClaims as Record<string, any>;
      expect(claims.papers.diploma).toBeDefined();
      expect(claims.papers.transcript).toBeUndefined();
    });
  });

  describe("Holder Key Binding Parity", () => {
    it("both engines verify valid Holder Key Binding JWT", async () => {
      const schema = await loadSchemaFromFile(FIXTURE_SCHEMA_PATH);
      const issuerKp = await generateKeyPair("ES256");
      const holderKp = await generateKeyPair("ES256");
      const audience = "https://auditor.example.edu";
      const nonce = "test-challenge-nonce-12345";

      const issued = await issueSdJwtVc(SAMPLE_STUDENT_CLAIMS, schema, {
        issuer: "did:web:university.example.edu",
        signingKey: {
          privateKey: issuerKp.privateKeyJwk,
          alg: "ES256",
        },
        holderConfirmation: {
          jwk: holderKp.publicKeyJwk,
        },
      });

      const sdHash = computeSdHashSync(issued.compact);
      const holderPrivateKey = await jose.importJWK(
        holderKp.privateKeyJwk,
        "ES256"
      );
      const kbJwt = await new jose.SignJWT({
        iat: Math.floor(Date.now() / 1000),
        aud: audience,
        nonce,
        sd_hash: sdHash,
      })
        .setProtectedHeader({
          alg: "ES256",
          typ: KEY_BINDING_JWT_TYP,
        })
        .sign(holderPrivateKey);

      const presentation = `${issued.compact}${kbJwt}`;
      const options = {
        resolveIssuerKey: async () => issuerKp.publicKeyJwk,
        expectedAudience: audience,
        expectedNonce: nonce,
        requireKeyBinding: true,
      };

      const nativeResult = await nativeEngine.verify(presentation, options);
      const oracleResult = await oracleEngine.verify(presentation, options);

      expect(nativeResult.valid).toBe(true);
      expect(oracleResult.valid).toBe(true);
      expect(nativeResult.checks.holderKeyBinding).toBe(true);
      expect(oracleResult.checks.holderKeyBinding).toBe(true);
      expect(nativeResult.verifiedClaims).toEqual(oracleResult.verifiedClaims);
    });
  });

  describe("Failure Mode Equivalence", () => {
    it("both engines agree to reject presentations with invalid signatures", async () => {
      const schema = await loadSchemaFromFile(FIXTURE_SCHEMA_PATH);
      const issuerKp = await generateKeyPair("ES256");
      const fakeKp = await generateKeyPair("ES256");

      const issued = await issueSdJwtVc(SAMPLE_STUDENT_CLAIMS, schema, {
        issuer: "did:web:university.example.edu",
        signingKey: {
          privateKey: issuerKp.privateKeyJwk,
          alg: "ES256",
        },
      });

      // Try verifying with wrong key
      const options = {
        resolveIssuerKey: async () => fakeKp.publicKeyJwk,
      };

      const nativeResult = await nativeEngine.verify(issued.compact, options);
      const oracleResult = await oracleEngine.verify(issued.compact, options);

      expect(nativeResult.valid).toBe(false);
      expect(oracleResult.valid).toBe(false);
      expect(nativeResult.checks.issuerSignature).toBe(false);
      expect(oracleResult.checks.issuerSignature).toBe(false);
    });
  });
});
