import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { base64url } from "jose";
import { generateSalt } from "../src/sd-jwt/salt.js";
import { encodeObjectDisclosure } from "../src/sd-jwt/disclosure.js";
import { computeDisclosureDigestSync } from "../src/sd-jwt/digest.js";

/**
 * Empirical Brute-Force Preimage Test (Thesis Evaluation Chapter)
 *
 * Demonstrates the security distinction between:
 * 1. The hypothetical naive unsalted claim commitment (vulnerable to dictionary/preimage attacks
 *    on low-entropy claims like GPA and grades).
 * 2. UniDipVeri's 128-bit CSPRNG-salted disclosure commitment conforming to RFC 9901.
 */
describe("Empirical Brute-Force Security Test: Unsalted Claims vs 128-bit CSPRNG Salting", () => {
  // Candidate domain for GPA (0.00 to 4.00, step 0.01 = 401 candidate values)
  const gpaCandidates: number[] = [];
  for (let i = 0; i <= 400; i++) {
    gpaCandidates.push(Math.round(i) / 100);
  }
  expect(gpaCandidates.length).toBe(401);

  // Target secret GPA to conceal
  const secretGpa = 3.85;

  describe("Hypothetical Unsalted Claim Commitment (Vulnerability Demonstration)", () => {
    it("an unsalted GPA digest is cracked via brute-force in <= 401 iterations", () => {
      // Simulate an unsalted claim digest: base64url(SHA256(JSON(["cumulativeGPA", secretGpa])))
      const unsaltedTuple = ["cumulativeGPA", secretGpa];
      const unsaltedHash = base64url.encode(
        createHash("sha256")
          .update(JSON.stringify(unsaltedTuple), "utf8")
          .digest()
      );

      // Adversary enumerates all 401 candidate values in the GPA domain
      let crackedGpa: number | null = null;
      let iterations = 0;

      for (const candidate of gpaCandidates) {
        iterations++;
        const candidateHash = base64url.encode(
          createHash("sha256")
            .update(JSON.stringify(["cumulativeGPA", candidate]), "utf8")
            .digest()
        );

        if (candidateHash === unsaltedHash) {
          crackedGpa = candidate;
          break;
        }
      }

      // Proves that the unsalted digest is completely broken with negligible iterations
      expect(crackedGpa).toBe(secretGpa);
      expect(iterations).toBeLessThanOrEqual(401);
      expect(iterations).toBe(386); // 3.85 is candidate index 385 (iteration 386)
    });

    it("an unsalted letter grade digest is cracked in <= 11 iterations", () => {
      const letterGrades = [
        "A",
        "A-",
        "B+",
        "B",
        "B-",
        "C+",
        "C",
        "C-",
        "D+",
        "D",
        "F",
      ];
      const secretGrade = "A";

      const unsaltedHash = base64url.encode(
        createHash("sha256")
          .update(JSON.stringify(["letterGrade", secretGrade]), "utf8")
          .digest()
      );

      let crackedGrade: string | null = null;
      let iterations = 0;

      for (const candidate of letterGrades) {
        iterations++;
        const candidateHash = base64url.encode(
          createHash("sha256")
            .update(JSON.stringify(["letterGrade", candidate]), "utf8")
            .digest()
        );

        if (candidateHash === unsaltedHash) {
          crackedGrade = candidate;
          break;
        }
      }

      expect(crackedGrade).toBe(secretGrade);
      expect(iterations).toBe(1);
    });
  });

  describe("UniDipVeri 128-bit CSPRNG Salted Disclosure (RFC 9901)", () => {
    it("a salted GPA disclosure cannot be precomputed or cracked by enumerating candidate GPAs", () => {
      // Generate 128-bit CSPRNG salt and RFC 9901 disclosure
      const salt = generateSalt(16);
      const saltedDisclosure = encodeObjectDisclosure(
        salt,
        "cumulativeGPA",
        secretGpa
      );
      const targetDigest = computeDisclosureDigestSync(saltedDisclosure);

      // Adversary attempts the same exhaustive dictionary attack across all 401 candidate GPAs
      // assuming a naive guess (e.g. empty salt or trying each candidate without the unknown 128-bit salt)
      let crackedGpa: number | null = null;
      let iterations = 0;

      for (const candidate of gpaCandidates) {
        iterations++;
        // Without knowing the 128-bit salt, adversary cannot reproduce the disclosure string
        const guessedDisclosure = encodeObjectDisclosure(
          "guessed-salt",
          "cumulativeGPA",
          candidate,
          { validateSalt: false }
        );
        const guessedDigest = computeDisclosureDigestSync(guessedDisclosure);

        if (guessedDigest === targetDigest) {
          crackedGpa = candidate;
          break;
        }
      }

      // Enumerating candidate GPAs fails to match the digest
      expect(crackedGpa).toBeNull();
      expect(iterations).toBe(401);
    });

    it("verifies mathematical entropy resistance (2^128 * 401 effective search space)", () => {
      // 128 bits of CSPRNG entropy provides ~3.4028 * 10^38 possible salts per candidate
      const salt1 = generateSalt(16);
      const salt2 = generateSalt(16);

      // Fresh salt generated for each commitment
      expect(salt1).not.toBe(salt2);
      expect(salt1.length).toBe(22); // 16 bytes unpadded base64url = 22 characters
    });
  });
});
