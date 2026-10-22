import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import * as jose from "jose";
import * as zlib from "node:zlib";
import { NativeVerificationEngine } from "../src/verification/native-engine.js";
import { loadSchemaFromFile } from "../src/schema/loader.js";
import { issueSdJwtVc } from "../src/signing/vc-issuer.js";
import { generateKeyPair, type SigningAlgorithm } from "../src/signing/signer.js";
import { KEY_BINDING_JWT_TYP, computeSdHashSync } from "../src/verification/kb-verifier.js";
import { STATUS_LIST_TOKEN_TYP } from "../src/verification/status-verifier.js";
import { encodeObjectDisclosure } from "../src/sd-jwt/disclosure.js";

const FIXTURE_SCHEMA_PATH = join(
  import.meta.dir,
  "fixtures/graduation-record.yaml"
);

const SAMPLE_STUDENT_CLAIMS = {
  studentId: "STU-2026-001",
  fullName: "Nguyen Van A",
  papers: {
    diploma: {
      degreeName: "Bachelor of Science in Computer Science",
      graduationDate: "2026-06-30",
    },
    transcript: {
      cumulativeGPA: 3.85,
      courses: [
        { code: "CS101", title: "Introduction to CS", grade: "A" },
        { code: "CS201", title: "Data Structures", grade: "A-" },
      ],
    },
  },
};

describe("Native Verification Engine (NativeVerificationEngine)", () => {
  const engine = new NativeVerificationEngine();
  const algorithms: SigningAlgorithm[] = ["ES256", "EdDSA", "ES384"];

  for (const alg of algorithms) {
    describe(`Algorithm: ${alg}`, () => {
      it("verifies a fully disclosed SD-JWT VC presentation", async () => {
        const schema = await loadSchemaFromFile(FIXTURE_SCHEMA_PATH);
        const issuerKp = await generateKeyPair(alg);
        const issuerDid = `did:web:university.example.edu`;

        const issued = await issueSdJwtVc(SAMPLE_STUDENT_CLAIMS, schema, {
          issuer: issuerDid,
          signingKey: {
            privateKey: issuerKp.privateKeyJwk,
            alg,
            keyId: "key-1",
          },
        });

        const result = await engine.verify(issued.compact, {
          resolveIssuerKey: async () => issuerKp.publicKeyJwk,
        });

        expect(result.valid).toBe(true);
        expect(result.engine).toBe("native");
        expect(result.executionTimeMs).toBeGreaterThan(0);
        expect(result.issuer).toBe(issuerDid);
        expect(result.vct).toContain("/types/graduation-record/v1");
        expect(result.checks.issuerSignature).toBe(true);
        expect(result.checks.disclosureDigests).toBe(true);
        expect(result.checks.holderKeyBinding).toBe(true);

        // Verify unmasked claims contain diploma and transcript
        const claims = result.verifiedClaims as typeof SAMPLE_STUDENT_CLAIMS;
        expect(claims.studentId).toBe("STU-2026-001");
        expect(claims.fullName).toBe("Nguyen Van A");
        expect(claims.papers.diploma.degreeName).toBe(
          "Bachelor of Science in Computer Science"
        );
        expect(claims.papers.transcript.cumulativeGPA).toBe(3.85);
      });
    });
  }

  describe("Selective Disclosure Presentation", () => {
    it("verifies presentation with selectively omitted disclosures", async () => {
      const schema = await loadSchemaFromFile(FIXTURE_SCHEMA_PATH);
      const issuerKp = await generateKeyPair("ES256");
      const issuerDid = "did:web:university.example.edu";

      const issued = await issueSdJwtVc(SAMPLE_STUDENT_CLAIMS, schema, {
        issuer: issuerDid,
        signingKey: {
          privateKey: issuerKp.privateKeyJwk,
          alg: "ES256",
          keyId: "key-1",
        },
      });

      // Filter disclosures: keep only the diploma disclosure, conceal transcript
      // In graduation-record.yaml, diploma and transcript are selectively disclosable
      // Let's decode each disclosure to identify diploma vs transcript
      const keptDisclosures: string[] = [];
      for (const disc of issued.disclosures) {
        const decoded = JSON.parse(
          new TextDecoder().decode(jose.base64url.decode(disc))
        );
        // Object disclosure is [salt, key, value]
        if (Array.isArray(decoded) && decoded[1] === "diploma") {
          keptDisclosures.push(disc);
        }
      }

      // Reassemble presentation with only diploma disclosure
      const selectivePresentation = `${issued.jwt}~${keptDisclosures.join("~")}~`;

      const result = await engine.verify(selectivePresentation, {
        resolveIssuerKey: async () => issuerKp.publicKeyJwk,
      });

      expect(result.valid).toBe(true);
      expect(result.checks.disclosureDigests).toBe(true);

      const claims = result.verifiedClaims as Record<string, any>;
      expect(claims.studentId).toBe("STU-2026-001");
      expect(claims.papers.diploma).toBeDefined();
      expect(claims.papers.diploma.degreeName).toBe(
        "Bachelor of Science in Computer Science"
      );

      // Transcript was concealed
      expect(claims.papers.transcript).toBeUndefined();
      expect(result.concealedClaimKeys.length).toBeGreaterThan(0);
    });
  });

  describe("Holder Key Binding Verification", () => {
    it("successfully verifies presentation containing valid Key Binding JWT", async () => {
      const schema = await loadSchemaFromFile(FIXTURE_SCHEMA_PATH);
      const issuerKp = await generateKeyPair("ES256");
      const holderKp = await generateKeyPair("ES256");
      const issuerDid = "did:web:university.example.edu";
      const verifierAudience = "https://employer.example.com";
      const verifierNonce = "challenge-session-456";

      const issued = await issueSdJwtVc(SAMPLE_STUDENT_CLAIMS, schema, {
        issuer: issuerDid,
        signingKey: {
          privateKey: issuerKp.privateKeyJwk,
          alg: "ES256",
          keyId: "key-1",
        },
        holderConfirmation: {
          jwk: holderKp.publicKeyJwk,
        },
      });

      // Compute sd_hash over presentation preceding KB-JWT
      const presentationWithoutKb = issued.compact; // ends with ~
      const sdHash = computeSdHashSync(presentationWithoutKb);

      // Sign KB-JWT with holder private key
      const holderPrivateKey = await jose.importJWK(
        holderKp.privateKeyJwk,
        "ES256"
      );
      const kbJwt = await new jose.SignJWT({
        iat: Math.floor(Date.now() / 1000),
        aud: verifierAudience,
        nonce: verifierNonce,
        sd_hash: sdHash,
      })
        .setProtectedHeader({
          alg: "ES256",
          typ: KEY_BINDING_JWT_TYP,
        })
        .sign(holderPrivateKey);

      const presentationWithKb = `${presentationWithoutKb}${kbJwt}`;

      const result = await engine.verify(presentationWithKb, {
        resolveIssuerKey: async () => issuerKp.publicKeyJwk,
        expectedAudience: verifierAudience,
        expectedNonce: verifierNonce,
        requireKeyBinding: true,
      });

      expect(result.valid).toBe(true);
      expect(result.checks.holderKeyBinding).toBe(true);
      expect(result.holderJwk).toEqual(holderKp.publicKeyJwk);
    });

    it("rejects presentation when required Key Binding JWT is missing", async () => {
      const schema = await loadSchemaFromFile(FIXTURE_SCHEMA_PATH);
      const issuerKp = await generateKeyPair("ES256");
      const holderKp = await generateKeyPair("ES256");

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

      const result = await engine.verify(issued.compact, {
        resolveIssuerKey: async () => issuerKp.publicKeyJwk,
        requireKeyBinding: true,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/lacks required Holder Key Binding JWT/);
    });
  });

  describe("Token Status List Revocation", () => {
    it("evaluates active status list credentials as valid", async () => {
      const schema = await loadSchemaFromFile(FIXTURE_SCHEMA_PATH);
      const issuerKp = await generateKeyPair("ES256");
      const statusUri = "https://university.example.edu/status/1";

      const issued = await issueSdJwtVc(SAMPLE_STUDENT_CLAIMS, schema, {
        issuer: "did:web:university.example.edu",
        signingKey: {
          privateKey: issuerKp.privateKeyJwk,
          alg: "ES256",
        },
        status: {
          status_list: {
            uri: statusUri,
            idx: 12,
          },
        },
      });

      // Mock status list token with bit 12 = 0 (Active)
      const bitArray = new Uint8Array(16);
      const lst = jose.base64url.encode(zlib.deflateSync(bitArray));
      const issuerPrivateKey = await jose.importJWK(
        issuerKp.privateKeyJwk,
        "ES256"
      );
      const statusJwt = await new jose.SignJWT({
        iss: "did:web:university.example.edu",
        sub: statusUri,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        status_list: { bits: 1, lst },
      })
        .setProtectedHeader({
          alg: "ES256",
          typ: STATUS_LIST_TOKEN_TYP,
        })
        .sign(issuerPrivateKey);

      const mockFetch = async () => new Response(statusJwt, { status: 200 });

      const result = await engine.verify(issued.compact, {
        resolveIssuerKey: async () => issuerKp.publicKeyJwk,
        fetchFn: mockFetch as any,
      });

      expect(result.valid).toBe(true);
      expect(result.checks.revocationStatus).toBe("ACTIVE");
    });

    it("rejects revoked status list credentials immediately", async () => {
      const schema = await loadSchemaFromFile(FIXTURE_SCHEMA_PATH);
      const issuerKp = await generateKeyPair("ES256");
      const statusUri = "https://university.example.edu/status/1";

      const issued = await issueSdJwtVc(SAMPLE_STUDENT_CLAIMS, schema, {
        issuer: "did:web:university.example.edu",
        signingKey: {
          privateKey: issuerKp.privateKeyJwk,
          alg: "ES256",
        },
        status: {
          status_list: {
            uri: statusUri,
            idx: 12,
          },
        },
      });

      // Mock status list token with bit 12 = 1 (Revoked)
      const bitArray = new Uint8Array(16);
      bitArray[1] |= 1 << 4; // bit 12 (1 * 8 + 4)
      const lst = jose.base64url.encode(zlib.deflateSync(bitArray));
      const issuerPrivateKey = await jose.importJWK(
        issuerKp.privateKeyJwk,
        "ES256"
      );
      const statusJwt = await new jose.SignJWT({
        iss: "did:web:university.example.edu",
        sub: statusUri,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        status_list: { bits: 1, lst },
      })
        .setProtectedHeader({
          alg: "ES256",
          typ: STATUS_LIST_TOKEN_TYP,
        })
        .sign(issuerPrivateKey);

      const mockFetch = async () => new Response(statusJwt, { status: 200 });

      const result = await engine.verify(issued.compact, {
        resolveIssuerKey: async () => issuerKp.publicKeyJwk,
        fetchFn: mockFetch as any,
      });

      expect(result.valid).toBe(false);
      expect(result.checks.revocationStatus).toBe("REVOKED");
      expect(result.error).toMatch(/Credential has been revoked by the issuer/);
    });
  });

  describe("Negative Cryptographic and Structural Validation", () => {
    it("rejects presentations with uncommitted or forged disclosures", async () => {
      const schema = await loadSchemaFromFile(FIXTURE_SCHEMA_PATH);
      const issuerKp = await generateKeyPair("ES256");

      const issued = await issueSdJwtVc(SAMPLE_STUDENT_CLAIMS, schema, {
        issuer: "did:web:university.example.edu",
        signingKey: {
          privateKey: issuerKp.privateKeyJwk,
          alg: "ES256",
        },
      });

      // Create a forged disclosure not in the original credential
      const forgedDisc = encodeObjectDisclosure(
        "bogus-salt-value-for-testing",
        "forgedField",
        "forgedValue"
      );

      const tamperedPresentation = `${issued.compact}${forgedDisc}~`;

      const result = await engine.verify(tamperedPresentation, {
        resolveIssuerKey: async () => issuerKp.publicKeyJwk,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/was not committed by issuer/);
    });

    it("rejects presentations when issuer signature is invalid or forged", async () => {
      const schema = await loadSchemaFromFile(FIXTURE_SCHEMA_PATH);
      const issuerKp = await generateKeyPair("ES256");
      const adversaryKp = await generateKeyPair("ES256");

      const issued = await issueSdJwtVc(SAMPLE_STUDENT_CLAIMS, schema, {
        issuer: "did:web:university.example.edu",
        signingKey: {
          privateKey: issuerKp.privateKeyJwk,
          alg: "ES256",
        },
      });

      // Try verifying against adversary public key
      const result = await engine.verify(issued.compact, {
        resolveIssuerKey: async () => adversaryKp.publicKeyJwk,
      });

      expect(result.valid).toBe(false);
      expect(result.checks.issuerSignature).toBe(false);
      expect(result.error).toMatch(/signature verification failed/);
    });

    it("rejects disclosures attempting to define forbidden reserved claims", async () => {
      // Craft a payload where _sd contains the digest of a disclosure redefining 'iss'
      const issuerKp = await generateKeyPair("ES256");
      const illegalDisc = encodeObjectDisclosure(
        "my-secret-salt-1234567890",
        "iss",
        "did:web:hacker.org"
      );
      const digest = jose.base64url.encode(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(illegalDisc)
          )
        )
      );

      const payload = {
        iss: "did:web:university.example.edu",
        vct: "https://university.example.edu/types/record/v1",
        iat: Math.floor(Date.now() / 1000),
        _sd: [digest],
      };

      const privateKey = await jose.importJWK(issuerKp.privateKeyJwk, "ES256");
      const jwt = await new jose.SignJWT(payload)
        .setProtectedHeader({ alg: "ES256", typ: "dc+sd-jwt" })
        .sign(privateKey);

      const presentation = `${jwt}~${illegalDisc}~`;

      const result = await engine.verify(presentation, {
        resolveIssuerKey: async () => issuerKp.publicKeyJwk,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(
        /attempts to define prohibited reserved claim 'iss'/
      );
    });
  });
});
