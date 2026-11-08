/**
 * @file scripts/benchmark.ts
 *
 * Synthetic Micro-Benchmark Suite for Empirical Performance & Security Proofs.
 *
 * Runs experimental measurements, security proofs, and cryptographic benchmarks:
 *
 * 1. Preimage Resistance & Dictionary Attack Hardness (Naive unsalted claim hashing vs RFC 9901 CSPRNG salting)
 * 2. Cryptographic Latency Benchmark across Algorithms (ES256, EdDSA, ES384)
 * 3. Payload Size and Selective Disclosure Overhead Comparison
 */

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateSalt } from "../packages/core/src/sd-jwt/salt.js";
import { encodeObjectDisclosure, decodeDisclosure } from "../packages/core/src/sd-jwt/disclosure.js";
import { computeDisclosureDigestSync } from "../packages/core/src/sd-jwt/digest.js";
import { transformClaims } from "../packages/core/src/sd-jwt/transform.js";
import { generateKeyPair, type SigningAlgorithm } from "../packages/core/src/signing/signer.js";
import { signSdJwtVc } from "../packages/core/src/signing/vc-issuer.js";
import { loadSchemaFromFile } from "../packages/core/src/schema/loader.js";

const toBase64Url = (buf: Buffer | Uint8Array | string): string =>
  Buffer.from(typeof buf === "string" ? buf : buf).toString("base64url");

interface BenchmarkResult {
  timestamp: string;
  securityProof: {
    unsaltedGpaCrackedTimeMs: number;
    unsaltedGpaIterations: number;
    unsaltedGradeCrackedTimeMs: number;
    unsaltedGradeIterations: number;
    saltedSampleIterations: number;
    saltedCrackedCount: number;
    theoreticalEntropyBits: number;
  };
  algorithmLatency: Record<
    SigningAlgorithm,
    {
      keyGenMs: number;
      claimTransformMs: number;
      jwtSignMs: number;
      totalIssuanceMs: number;
    }
  >;
  payloadMetrics: {
    plainJwtBytes: number;
    sdJwtIssuerTokenBytes: number;
    disclosuresTotalBytes: number;
    fullPresentationBytes: number;
    selectiveDegreeOnlyBytes: number;
    selectiveGpaOnlyBytes: number;
  };
}

async function runEvaluation(): Promise<BenchmarkResult> {
  console.log("==================================================================");
  console.log("  UniDipVeri Synthetic Micro-Benchmark Suite                      ");
  console.log("==================================================================\n");

  // -------------------------------------------------------------------------
  // 1. Empirical Security Hardness: Unsalted vs CSPRNG Salting
  // -------------------------------------------------------------------------
  console.log("[1/3] Running Preimage Resistance & Brute-Force Benchmark...");

  const gpaCandidates: number[] = [];
  for (let i = 0; i <= 400; i++) {
    gpaCandidates.push(Math.round(i) / 100);
  }
  const secretGpa = 3.85;

  // Naive Unsalted GPA Preimage Benchmark (Theoretical Baseline)
  const unsaltedGpaStart = performance.now();
  const unsaltedGpaHash = toBase64Url(
    createHash("sha256")
      .update(JSON.stringify(["cumulativeGPA", secretGpa]), "utf8")
      .digest()
  );

  let unsaltedGpaIterations = 0;
  let crackedGpa: number | null = null;
  for (const candidate of gpaCandidates) {
    unsaltedGpaIterations++;
    const candidateHash = toBase64Url(
      createHash("sha256")
        .update(JSON.stringify(["cumulativeGPA", candidate]), "utf8")
        .digest()
    );
    if (candidateHash === unsaltedGpaHash) {
      crackedGpa = candidate;
      break;
    }
  }
  const unsaltedGpaEnd = performance.now();
  const unsaltedGpaDuration = unsaltedGpaEnd - unsaltedGpaStart;
  if (crackedGpa !== secretGpa) {
    throw new Error(`Preimage attack failed: expected ${secretGpa}, got ${crackedGpa}`);
  }

  // Naive Unsalted Grade Preimage Benchmark (Theoretical Baseline)
  const gradeCandidates = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "F"];
  const secretGrade = "A";

  const unsaltedGradeStart = performance.now();
  const unsaltedGradeHash = toBase64Url(
    createHash("sha256")
      .update(JSON.stringify(["letterGrade", secretGrade]), "utf8")
      .digest()
  );

  let unsaltedGradeIterations = 0;
  let crackedGrade: string | null = null;
  for (const candidate of gradeCandidates) {
    unsaltedGradeIterations++;
    const candidateHash = toBase64Url(
      createHash("sha256")
        .update(JSON.stringify(["letterGrade", candidate]), "utf8")
        .digest()
    );
    if (candidateHash === unsaltedGradeHash) {
      crackedGrade = candidate;
      break;
    }
  }
  const unsaltedGradeEnd = performance.now();
  const unsaltedGradeDuration = unsaltedGradeEnd - unsaltedGradeStart;
  if (crackedGrade !== secretGrade) {
    throw new Error(`Preimage attack failed: expected ${secretGrade}, got ${crackedGrade}`);
  }

  // RFC 9901 CSPRNG Salting Benchmark (UniDipVeri model)
  const saltedSalt = generateSalt(16);
  const saltedEncoded = encodeObjectDisclosure(saltedSalt, "cumulativeGPA", secretGpa);
  const saltedDigest = computeDisclosureDigestSync(saltedEncoded, "sha-256");

  let saltedCrackedCount = 0;
  const sampleIterations = 10000;
  for (let i = 0; i < sampleIterations; i++) {
    const candidate = gpaCandidates[i % gpaCandidates.length];
    const trialSalt = generateSalt(16);
    const trialEncoded = encodeObjectDisclosure(trialSalt, "cumulativeGPA", candidate);
    const trialDigest = computeDisclosureDigestSync(trialEncoded, "sha-256");
    if (trialDigest === saltedDigest) {
      saltedCrackedCount++;
    }
  }

  console.log(`  - Unsalted GPA (Domain: 401 values): Cracked in ${unsaltedGpaDuration.toFixed(3)} ms (${unsaltedGpaIterations} iterations).`);
  console.log(`  - Unsalted Grade (Domain: 11 values): Cracked in ${unsaltedGradeDuration.toFixed(3)} ms (${unsaltedGradeIterations} iterations).`);
  console.log(`  - RFC 9901 128-bit Salted GPA: ${sampleIterations} online attempts -> ${saltedCrackedCount} cracked (Search space: 2^128 * 401 ≈ 1.36e+41).`);

  // -------------------------------------------------------------------------
  // 2. Cryptographic Latency Benchmark (ES256, EdDSA, ES384)
  // -------------------------------------------------------------------------
  console.log("\n[2/3] Running Cryptographic Latency Benchmarks across Algorithms...");

  const schemaPath = join(import.meta.dir, "../schemas/graduation-record.v1.yaml");
  const schema = await loadSchemaFromFile(schemaPath);

  const sampleAcademicRecord = {
    studentId: "STU-2026-FINAL",
    fullName: "Nguyen Van A",
    dateOfBirth: "2002-05-15",
    nationalId: "001202008899",
    papers: {
      diploma: {
        degreeName: "Bachelor of Science in Computer Science",
        degreeType: "Bachelor of Science",
        programName: "Honors Program in Software Engineering",
        major: "Computer Science",
        minor: "Mathematics",
        graduationDate: "2026-06-30",
        honours: "Summa Cum Laude"
      },
      transcript: {
        transcriptId: "TR-2026-FINAL",
        cumulativeGPA: 3.92,
        totalCredits: 135,
        courses: [
          {
            code: "CS101",
            title: "Introduction to Computer Science",
            credits: 3,
            grade: 4.0,
            letterGrade: "A"
          }
        ]
      }
    }
  };

  const algorithms: SigningAlgorithm[] = ["ES256", "EdDSA", "ES384"];
  const algorithmLatency = {} as BenchmarkResult["algorithmLatency"];

  for (const alg of algorithms) {
    const rounds = 50;

    // Key Generation
    const t0 = performance.now();
    for (let r = 0; r < rounds; r++) {
      await generateKeyPair(alg);
    }
    const keyGenMs = (performance.now() - t0) / rounds;

    // Fixed key for signing
    const keyPair = await generateKeyPair(alg);

    // Claim Masking / Transform
    const t1 = performance.now();
    for (let r = 0; r < rounds; r++) {
      transformClaims(sampleAcademicRecord, schema.claims);
    }
    const claimTransformMs = (performance.now() - t1) / rounds;

    // SD-JWT VC Signing
    const transformed = transformClaims(sampleAcademicRecord, schema.claims);
    const t2 = performance.now();
    for (let r = 0; r < rounds; r++) {
      await signSdJwtVc({
        payload: {
          ...transformed.maskedPayload,
          iss: "https://issuer.example.edu",
          vct: "https://issuer.example.edu/types/graduation-record/v1"
        },
        disclosures: transformed.disclosures,
        signingKey: {
          alg,
          keyId: `key-${alg.toLowerCase()}`,
          privateKey: keyPair.privateKeyJwk
        }
      });
    }
    const jwtSignMs = (performance.now() - t2) / rounds;

    algorithmLatency[alg] = {
      keyGenMs: Number(keyGenMs.toFixed(3)),
      claimTransformMs: Number(claimTransformMs.toFixed(3)),
      jwtSignMs: Number(jwtSignMs.toFixed(3)),
      totalIssuanceMs: Number((claimTransformMs + jwtSignMs).toFixed(3))
    };

    console.log(`  - ${alg.padEnd(5)}: Transform: ${claimTransformMs.toFixed(3)} ms | JWS Sign: ${jwtSignMs.toFixed(3)} ms | Total Issuance: ${(claimTransformMs + jwtSignMs).toFixed(3)} ms`);
  }

  // -------------------------------------------------------------------------
  // 3. Payload Wire Size & Selective Disclosure Reduction
  // -------------------------------------------------------------------------
  console.log("\n[3/3] Measuring Payload Size and Selective Disclosure Overhead...");

  const defaultKeyPair = await generateKeyPair("ES256");
  const transformed = transformClaims(sampleAcademicRecord, schema.claims);

  const plainJwtString = JSON.stringify(sampleAcademicRecord);
  const sdJwtResult = await signSdJwtVc({
    payload: {
      ...transformed.maskedPayload,
      iss: "https://issuer.example.edu",
      vct: "https://issuer.example.edu/types/graduation-record/v1"
    },
    disclosures: transformed.disclosures,
    signingKey: {
      alg: "ES256",
      keyId: "key-default",
      privateKey: defaultKeyPair.privateKeyJwk
    }
  });

  const sdJwtPayloadString = sdJwtResult.jwt;
  const fullPresentation = sdJwtResult.compact;
  const disclosuresCombined = transformed.disclosures.join("~");

  // Filter for Degree-Only Presentation
  const decodedDisclosures = transformed.disclosures.map(d => ({
    raw: d,
    decoded: decodeDisclosure(d)
  }));

  const degreeDisclosures = decodedDisclosures.filter(d => {
    return d.decoded.type === "object" && (d.decoded.key === "diploma" || d.decoded.key === "degreeName");
  });
  const degreeOnlyPresentation = `${sdJwtPayloadString}~${degreeDisclosures.map(d => d.raw).join("~")}~`;

  // Filter for GPA-Only Presentation
  const gpaDisclosures = decodedDisclosures.filter(d => {
    return d.decoded.type === "object" && (d.decoded.key === "transcript" || d.decoded.key === "cumulativeGPA");
  });
  const gpaOnlyPresentation = `${sdJwtPayloadString}~${gpaDisclosures.map(d => d.raw).join("~")}~`;

  const payloadMetrics = {
    plainJwtBytes: Buffer.byteLength(plainJwtString, "utf8"),
    sdJwtIssuerTokenBytes: Buffer.byteLength(sdJwtPayloadString, "utf8"),
    disclosuresTotalBytes: Buffer.byteLength(disclosuresCombined, "utf8"),
    fullPresentationBytes: Buffer.byteLength(fullPresentation, "utf8"),
    selectiveDegreeOnlyBytes: Buffer.byteLength(degreeOnlyPresentation, "utf8"),
    selectiveGpaOnlyBytes: Buffer.byteLength(gpaOnlyPresentation, "utf8")
  };

  console.log(`  - Plain Unmasked JSON Payload:          ${payloadMetrics.plainJwtBytes} bytes`);
  console.log(`  - SD-JWT Payload (with _sd digests):   ${payloadMetrics.sdJwtIssuerTokenBytes} bytes`);
  console.log(`  - All Salted Disclosures:               ${payloadMetrics.disclosuresTotalBytes} bytes`);
  console.log(`  - Full Presentation (all claims):       ${payloadMetrics.fullPresentationBytes} bytes`);
  console.log(`  - Selective Presentation (Degree only): ${payloadMetrics.selectiveDegreeOnlyBytes} bytes (${Math.round((payloadMetrics.selectiveDegreeOnlyBytes / payloadMetrics.fullPresentationBytes) * 100)}% of full size)`);
  console.log(`  - Selective Presentation (GPA only):    ${payloadMetrics.selectiveGpaOnlyBytes} bytes (${Math.round((payloadMetrics.selectiveGpaOnlyBytes / payloadMetrics.fullPresentationBytes) * 100)}% of full size)`);

  const result: BenchmarkResult = {
    timestamp: new Date().toISOString(),
    securityProof: {
      unsaltedGpaCrackedTimeMs: Number(unsaltedGpaDuration.toFixed(3)),
      unsaltedGpaIterations,
      unsaltedGradeCrackedTimeMs: Number(unsaltedGradeDuration.toFixed(3)),
      unsaltedGradeIterations,
      saltedSampleIterations: sampleIterations,
      saltedCrackedCount,
      theoreticalEntropyBits: 128
    },
    algorithmLatency,
    payloadMetrics
  };

  // Write JSON artifact
  const outputPath = join(import.meta.dir, "../docs/benchmark-results.json");
  writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf8");

  console.log("\n------------------------------------------------------------------");
  console.log("  Formatted Markdown Tables for Paper Drafts                     ");
  console.log("------------------------------------------------------------------\n");

  console.log("### Table 1: Preimage Resistance (Naive Unsalted Hashing vs RFC 9901 CSPRNG Salting)");
  console.log("| Commit Scheme | Attribute Domain | Search Space | Time to Crack | Outcome |");
  console.log("| :--- | :--- | :--- | :--- | :--- |");
  console.log(`| Naive Unsalted Hashing | GPA (0.00-4.00) | 401 candidate values | ${unsaltedGpaDuration.toFixed(2)} ms (${unsaltedGpaIterations} iter) | Vulnerable |`);
  console.log(`| Naive Unsalted Hashing | Grade (A-F) | 11 candidate values | ${unsaltedGradeDuration.toFixed(2)} ms (${unsaltedGradeIterations} iter) | Vulnerable |`);
  console.log(`| UniDipVeri (RFC 9901) | GPA (0.00-4.00) | 2¹²⁸ × 401 ≈ 1.36 × 10⁴¹ | > 10²³ years (${saltedCrackedCount} / ${sampleIterations} cracked) | Infeasible |`);

  console.log("\n### Table 2: Cryptographic Latency across Curves (50 Iterations)");
  console.log("| Algorithm | Curve / Family | Masking (ms) | JWS Sign (ms) | Total Issuance (ms) |");
  console.log("| :--- | :--- | :--- | :--- | :--- |");
  for (const alg of algorithms) {
    const m = algorithmLatency[alg];
    console.log(`| ${alg} | ${alg === "ES256" ? "NIST P-256" : alg === "EdDSA" ? "Ed25519" : "NIST P-384"} | ${m.claimTransformMs.toFixed(2)} ms | ${m.jwtSignMs.toFixed(2)} ms | ${m.totalIssuanceMs.toFixed(2)} ms |`);
  }

  console.log("\n### Table 3: Payload Size and Selective Disclosure Reduction");
  console.log("| Artifact | Size (bytes) | % of Full | Redaction Scope |");
  console.log("| :--- | :--- | :--- | :--- |");
  console.log(`| Unmasked Plain JSON | ${payloadMetrics.plainJwtBytes} B | — | No selective disclosure |`);
  console.log(`| SD-JWT Masked Root | ${payloadMetrics.sdJwtIssuerTokenBytes} B | ${Math.round((payloadMetrics.sdJwtIssuerTokenBytes / payloadMetrics.fullPresentationBytes) * 100)}% | Digests only |`);
  console.log(`| Full Presentation | ${payloadMetrics.fullPresentationBytes} B | 100% | All claims revealed |`);
  console.log(`| Selective (Degree Only) | ${payloadMetrics.selectiveDegreeOnlyBytes} B | ${Math.round((payloadMetrics.selectiveDegreeOnlyBytes / payloadMetrics.fullPresentationBytes) * 100)}% | Redacts GPA, birthdate, coursework |`);
  console.log(`| Selective (GPA Only) | ${payloadMetrics.selectiveGpaOnlyBytes} B | ${Math.round((payloadMetrics.selectiveGpaOnlyBytes / payloadMetrics.fullPresentationBytes) * 100)}% | Redacts diploma honors, birthdate |`);

  console.log("\n==================================================================");
  console.log("  NOTICE: This benchmark is a synthetic micro-benchmark designed  ");
  console.log("  for relative comparison and empirical research demonstration.   ");
  console.log("  It is NOT a real-world benchmark tool, production load test, or ");
  console.log("  official standard conformance test suite.                       ");
  console.log("==================================================================\n");

  return result;
}

runEvaluation().catch(err => {
  console.error("Micro-benchmark execution failed:", err);
  process.exit(1);
});
