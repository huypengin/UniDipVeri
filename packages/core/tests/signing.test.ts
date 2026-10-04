import { describe, expect, it } from "bun:test";
import {
  generateKeyPair,
  signJwt,
  verifyJwt,
  type SigningAlgorithm,
} from "../src/signing/signer.js";

describe("Signing Algorithm Agility", () => {
  const algorithms: SigningAlgorithm[] = ["ES256", "EdDSA", "ES384"];

  for (const alg of algorithms) {
    it(`generates key pair, signs and verifies JWT with ${alg}`, async () => {
      const { publicKeyJwk, privateKeyJwk, algorithm } = await generateKeyPair(alg);

      expect(algorithm).toBe(alg);
      expect(publicKeyJwk.alg).toBe(alg);
      expect(privateKeyJwk.alg).toBe(alg);

      const payload = {
        sub: "did:web:student.example.edu",
        iss: "did:web:university.example.edu",
        degree: "Bachelor of Computer Science",
        gpa: 3.85,
      };

      const jwt = await signJwt(payload, privateKeyJwk, alg, {
        issuer: "did:web:university.example.edu",
        keyId: "key-1",
      });

      expect(typeof jwt).toBe("string");
      expect(jwt.split(".").length).toBe(3);

      const result = await verifyJwt(jwt, publicKeyJwk, alg);
      expect(result.payload.sub).toBe("did:web:student.example.edu");
      expect(result.payload.degree).toBe("Bachelor of Computer Science");
      expect(result.payload.gpa).toBe(3.85);
      expect(result.protectedHeader.alg).toBe(alg);
    });
  }

  it("fails verification when payload is tampered", async () => {
    const { publicKeyJwk, privateKeyJwk } = await generateKeyPair("ES256");

    const jwt = await signJwt({ test: "original" }, privateKeyJwk, "ES256");
    const [header, , sig] = jwt.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({ test: "tampered" })).toString("base64url");
    const tamperedJwt = `${header}.${tamperedPayload}.${sig}`;

    expect(verifyJwt(tamperedJwt, publicKeyJwk, "ES256")).rejects.toThrow();
  });

  it("fails verification when algorithm expectation does not match", async () => {
    const { privateKeyJwk } = await generateKeyPair("ES256");
    const { publicKeyJwk: es384Pub } = await generateKeyPair("ES384");

    const jwt = await signJwt({ test: "original" }, privateKeyJwk, "ES256");

    expect(verifyJwt(jwt, es384Pub, "ES384")).rejects.toThrow();
  });
});
