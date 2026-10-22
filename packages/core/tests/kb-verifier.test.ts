import { describe, expect, it } from "bun:test";
import * as jose from "jose";
import {
  verifyKeyBindingJwt,
  KEY_BINDING_JWT_TYP,
  computeSdHash,
  computeSdHashSync,
} from "../src/verification/kb-verifier.js";
import { generateKeyPair } from "../src/signing/signer.js";

describe("Holder Key Binding JWT Verification (RFC 9901 Section 4.3)", () => {
  describe("sd_hash Computation (Async & Sync)", () => {
    it("computes deterministic base64url sha-256 digest over presentation string (sync)", () => {
      const presentation = "header.payload.signature~disc1~disc2~";
      const hash1 = computeSdHashSync(presentation);
      const hash2 = computeSdHashSync(presentation);

      expect(typeof hash1).toBe("string");
      expect(hash1.length).toBeGreaterThan(0);
      expect(hash1).toBe(hash2);
      expect(/^[A-Za-z0-9_-]+$/.test(hash1)).toBe(true);
    });

    it("computes identical digest using Web Crypto async computeSdHash", async () => {
      const presentation = "header.payload.signature~disc1~disc2~";
      const syncHash = computeSdHashSync(presentation);
      const asyncHash = await computeSdHash(presentation);

      expect(asyncHash).toBe(syncHash);
    });

    it("automatically normalizes presentation strings missing trailing tilde", () => {
      const presentationWithTilde = "header.payload.signature~disc1~";
      const presentationWithoutTilde = "header.payload.signature~disc1";

      const hashWith = computeSdHashSync(presentationWithTilde);
      const hashWithout = computeSdHashSync(presentationWithoutTilde);

      expect(hashWith).toBe(hashWithout);
    });

    it("throws error for empty presentation strings", () => {
      expect(() => computeSdHashSync("")).toThrow(
        /presentationWithoutKb must be a non-empty string/
      );
    });
  });

  describe("Key Binding JWT Verification", () => {
    async function signTestKbJwt(
      presentationWithoutKb: string,
      holderKp: Awaited<ReturnType<typeof generateKeyPair>>,
      options: {
        aud?: string;
        nonce?: string;
        iat?: number;
        typ?: string;
        sdHashOverride?: string;
      } = {}
    ) {
      const privateKey = await jose.importJWK(
        holderKp.privateKeyJwk,
        holderKp.algorithm
      );

      const sdHash =
        options.sdHashOverride ?? computeSdHashSync(presentationWithoutKb);

      const payload: Record<string, unknown> = {
        iat: options.iat ?? Math.floor(Date.now() / 1000),
        sd_hash: sdHash,
      };

      if (options.aud) {
        payload.aud = options.aud;
      }
      if (options.nonce) {
        payload.nonce = options.nonce;
      }

      return new jose.SignJWT(payload)
        .setProtectedHeader({
          alg: holderKp.algorithm,
          typ: options.typ ?? KEY_BINDING_JWT_TYP,
        })
        .sign(privateKey);
    }

    it("successfully verifies a valid Holder Key Binding JWT", async () => {
      const holderKp = await generateKeyPair("ES256");
      const presentation = "jwt.token.sig~disclosureA~disclosureB~";
      const aud = "https://verifier.example.com";
      const nonce = "challenge-xyz-987";

      const kbJwt = await signTestKbJwt(presentation, holderKp, {
        aud,
        nonce,
      });

      const result = await verifyKeyBindingJwt(
        kbJwt,
        presentation,
        holderKp.publicKeyJwk,
        {
          expectedAudience: aud,
          expectedNonce: nonce,
        }
      );

      expect(result.valid).toBe(true);
      expect(result.payload?.aud).toBe(aud);
      expect(result.payload?.nonce).toBe(nonce);
      expect(result.error).toBeUndefined();
    });

    it("fails verification when presentation disclosures are altered (tampered sd_hash)", async () => {
      const holderKp = await generateKeyPair("ES256");
      const originalPresentation = "jwt.token.sig~disclosureA~disclosureB~";
      const alteredPresentation = "jwt.token.sig~disclosureA~"; // disclosure removed

      const kbJwt = await signTestKbJwt(originalPresentation, holderKp);

      const result = await verifyKeyBindingJwt(
        kbJwt,
        alteredPresentation,
        holderKp.publicKeyJwk
      );

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/sd_hash mismatch/);
    });

    it("fails verification when audience does not match verifier expectation", async () => {
      const holderKp = await generateKeyPair("ES256");
      const presentation = "jwt.token.sig~disclosureA~";

      const kbJwt = await signTestKbJwt(presentation, holderKp, {
        aud: "https://attacker.example.com",
      });

      const result = await verifyKeyBindingJwt(
        kbJwt,
        presentation,
        holderKp.publicKeyJwk,
        {
          expectedAudience: "https://legitimate-verifier.example.com",
        }
      );

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/audience mismatch/);
    });

    it("fails verification when challenge nonce does not match verifier session", async () => {
      const holderKp = await generateKeyPair("ES256");
      const presentation = "jwt.token.sig~disclosureA~";

      const kbJwt = await signTestKbJwt(presentation, holderKp, {
        nonce: "stale-nonce-111",
      });

      const result = await verifyKeyBindingJwt(
        kbJwt,
        presentation,
        holderKp.publicKeyJwk,
        {
          expectedNonce: "fresh-nonce-222",
        }
      );

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/nonce mismatch/);
    });

    it("fails verification when signed by an unapproved key (not matching cnf.jwk)", async () => {
      const legitimateHolderKp = await generateKeyPair("ES256");
      const adversaryKp = await generateKeyPair("ES256");
      const presentation = "jwt.token.sig~disclosureA~";

      // Adversary tries to sign with their own key
      const kbJwt = await signTestKbJwt(presentation, adversaryKp);

      const result = await verifyKeyBindingJwt(
        kbJwt,
        presentation,
        legitimateHolderKp.publicKeyJwk
      );

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/signature verification failed/);
    });

    it("fails verification when typ header is not kb+jwt", async () => {
      const holderKp = await generateKeyPair("ES256");
      const presentation = "jwt.token.sig~disclosureA~";

      const kbJwt = await signTestKbJwt(presentation, holderKp, {
        typ: "JWT",
      });

      const result = await verifyKeyBindingJwt(
        kbJwt,
        presentation,
        holderKp.publicKeyJwk
      );

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(
        /expected 'kb\+jwt', received 'JWT'/
      );
    });
  });
});
