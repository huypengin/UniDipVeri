import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import * as jose from "jose";
import * as zlib from "node:zlib";
import { OracleVerificationEngine } from "../src/verification/oracle-engine.js";
import { loadSchemaFromFile } from "../src/schema/loader.js";
import { issueSdJwtVc } from "../src/signing/vc-issuer.js";
import { generateKeyPair } from "../src/signing/signer.js";
import { KEY_BINDING_JWT_TYP, computeSdHashSync } from "../src/verification/kb-verifier.js";
import { STATUS_LIST_TOKEN_TYP } from "../src/verification/status-verifier.js";

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

describe("Reference Oracle Verification Engine (OracleVerificationEngine)", () => {
  const engine = new OracleVerificationEngine();

  it("verifies a valid fully disclosed SD-JWT VC presentation", async () => {
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

    const result = await engine.verify(issued.compact, {
      resolveIssuerKey: async () => issuerKp.publicKeyJwk,
    });

    expect(result.valid).toBe(true);
    expect(result.engine).toBe("oracle");
    expect(result.issuer).toBe(issuerDid);
    expect(result.checks.issuerSignature).toBe(true);
    expect(result.checks.disclosureDigests).toBe(true);

    const claims = result.verifiedClaims as Record<string, any>;
    expect(claims.studentId).toBe("STU-2026-001");
    expect(claims.papers?.diploma?.degreeName).toBe(
      "Bachelor of Science in Computer Science"
    );
  });

  it("verifies presentation with selective disclosure via oracle", async () => {
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

    // Keep only diploma disclosure
    const keptDisclosures: string[] = [];
    for (const disc of issued.disclosures) {
      const decoded = JSON.parse(
        new TextDecoder().decode(jose.base64url.decode(disc))
      );
      if (Array.isArray(decoded) && decoded[1] === "diploma") {
        keptDisclosures.push(disc);
      }
    }

    const selectivePresentation = `${issued.jwt}~${keptDisclosures.join("~")}~`;

    const result = await engine.verify(selectivePresentation, {
      resolveIssuerKey: async () => issuerKp.publicKeyJwk,
    });

    expect(result.valid).toBe(true);
    const claims = result.verifiedClaims as Record<string, any>;
    expect(claims.studentId).toBe("STU-2026-001");
    expect(claims.papers.diploma).toBeDefined();
    expect(claims.papers.transcript).toBeUndefined();
  });

  it("verifies presentation with Holder Key Binding JWT via oracle", async () => {
    const schema = await loadSchemaFromFile(FIXTURE_SCHEMA_PATH);
    const issuerKp = await generateKeyPair("ES256");
    const holderKp = await generateKeyPair("ES256");
    const issuerDid = "did:web:university.example.edu";
    const verifierAudience = "https://verifier.example.com";
    const verifierNonce = "oracle-nonce-789";

    const issued = await issueSdJwtVc(SAMPLE_STUDENT_CLAIMS, schema, {
      issuer: issuerDid,
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
      aud: verifierAudience,
      nonce: verifierNonce,
      sd_hash: sdHash,
    })
      .setProtectedHeader({
        alg: "ES256",
        typ: KEY_BINDING_JWT_TYP,
      })
      .sign(holderPrivateKey);

    const presentation = `${issued.compact}${kbJwt}`;

    const result = await engine.verify(presentation, {
      resolveIssuerKey: async () => issuerKp.publicKeyJwk,
      expectedAudience: verifierAudience,
      expectedNonce: verifierNonce,
      requireKeyBinding: true,
    });

    expect(result.valid).toBe(true);
    expect(result.checks.holderKeyBinding).toBe(true);
  });

  it("evaluates live Status List revocation accurately via oracle", async () => {
    const schema = await loadSchemaFromFile(FIXTURE_SCHEMA_PATH);
    const issuerKp = await generateKeyPair("ES256");
    const statusUri = "https://university.example.edu/status/oracle-list";

    const issued = await issueSdJwtVc(SAMPLE_STUDENT_CLAIMS, schema, {
      issuer: "did:web:university.example.edu",
      signingKey: {
        privateKey: issuerKp.privateKeyJwk,
        alg: "ES256",
      },
      status: {
        status_list: {
          uri: statusUri,
          idx: 20,
        },
      },
    });

    // Create revoked bitstring with bit 20 = 1
    const bitArray = new Uint8Array(16);
    bitArray[2] |= 1 << 4; // 2 * 8 + 4 = 20
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
  });

  it("fails verification when issuer signature is forged", async () => {
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

    const result = await engine.verify(issued.compact, {
      resolveIssuerKey: async () => adversaryKp.publicKeyJwk,
    });

    expect(result.valid).toBe(false);
    expect(result.checks.issuerSignature).toBe(false);
  });
});
