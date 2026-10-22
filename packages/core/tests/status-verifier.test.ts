import { describe, expect, it } from "bun:test";
import * as jose from "jose";
import * as zlib from "node:zlib";
import {
  decompressAndGetBit,
  verifyStatusListToken,
  checkCredentialStatus,
  STATUS_LIST_TOKEN_TYP,
} from "../src/verification/status-verifier.js";
import { generateKeyPair } from "../src/signing/signer.js";

describe("Token Status List Verification (draft-ietf-oauth-status-list-21)", () => {
  describe("Bit Decompression & Unpacking", () => {
    it("correctly unpacks bits across varying byte boundaries and bit shifts", () => {
      // 16 bytes = 128 bits
      const bitArray = new Uint8Array(16);
      // Set bit 0 (byte 0, shift 0)
      bitArray[0] |= 1 << 0;
      // Set bit 7 (byte 0, shift 7)
      bitArray[0] |= 1 << 7;
      // Set bit 8 (byte 1, shift 0)
      bitArray[1] |= 1 << 0;
      // Set bit 42 (byte 5, shift 2)
      bitArray[5] |= 1 << 2;
      // Set bit 127 (byte 15, shift 7)
      bitArray[15] |= 1 << 7;

      const compressed = zlib.deflateSync(bitArray);
      const lst = jose.base64url.encode(compressed);

      expect(decompressAndGetBit(lst, 0)).toBe(1);
      expect(decompressAndGetBit(lst, 1)).toBe(0);
      expect(decompressAndGetBit(lst, 6)).toBe(0);
      expect(decompressAndGetBit(lst, 7)).toBe(1);
      expect(decompressAndGetBit(lst, 8)).toBe(1);
      expect(decompressAndGetBit(lst, 9)).toBe(0);
      expect(decompressAndGetBit(lst, 42)).toBe(1);
      expect(decompressAndGetBit(lst, 43)).toBe(0);
      expect(decompressAndGetBit(lst, 126)).toBe(0);
      expect(decompressAndGetBit(lst, 127)).toBe(1);
    });

    it("handles gzip compressed bitstrings transparently", () => {
      const bitArray = new Uint8Array(8);
      bitArray[2] = 0b00000100; // bit 18 (2 * 8 + 2)

      const compressedGzip = zlib.gzipSync(bitArray);
      const lst = jose.base64url.encode(compressedGzip);

      expect(decompressAndGetBit(lst, 18)).toBe(1);
      expect(decompressAndGetBit(lst, 17)).toBe(0);
      expect(decompressAndGetBit(lst, 19)).toBe(0);
    });

    it("throws error when index is out of bounds for the decompressed bitstring", () => {
      const bitArray = new Uint8Array(2); // 16 bits (0..15)
      const compressed = zlib.deflateSync(bitArray);
      const lst = jose.base64url.encode(compressed);

      expect(() => decompressAndGetBit(lst, 16)).toThrow(
        /Index 16 is out of bounds/
      );
      expect(() => decompressAndGetBit(lst, 100)).toThrow(
        /Index 100 is out of bounds/
      );
    });

    it("throws error for negative or non-integer indices", () => {
      const bitArray = new Uint8Array(2);
      const compressed = zlib.deflateSync(bitArray);
      const lst = jose.base64url.encode(compressed);

      expect(() => decompressAndGetBit(lst, -1)).toThrow(
        /index must be a non-negative integer/
      );
      expect(() => decompressAndGetBit(lst, 1.5)).toThrow(
        /index must be a non-negative integer/
      );
    });

    it("throws error for unsupported bit allocations", () => {
      const bitArray = new Uint8Array(2);
      const compressed = zlib.deflateSync(bitArray);
      const lst = jose.base64url.encode(compressed);

      expect(() => decompressAndGetBit(lst, 0, 2)).toThrow(
        /Unsupported bits allocation: 2/
      );
    });

    it("throws error for invalid base64url or corrupt data", () => {
      expect(() => decompressAndGetBit("", 0)).toThrow(
        /lst parameter must be a non-empty string/
      );
      expect(() => decompressAndGetBit("!!!not-base64url!!!", 0)).toThrow();
      expect(() =>
        decompressAndGetBit(jose.base64url.encode(new Uint8Array([1, 2, 3])), 0)
      ).toThrow(/Failed to decompress status list bitstring/);
    });
  });

  describe("Status List Token Verification", () => {
    async function createTestStatusToken(options: {
      issuer?: string;
      sub?: string;
      bits?: number;
      lst?: string;
      typ?: string;
      ttlSeconds?: number;
      keyPair?: Awaited<ReturnType<typeof generateKeyPair>>;
    } = {}) {
      const kp = options.keyPair ?? (await generateKeyPair("ES256"));
      const issuer = options.issuer ?? "did:web:example.edu";
      const sub = options.sub ?? "https://example.edu/status/1";
      const bits = options.bits ?? 1;
      const bitArray = new Uint8Array(16);
      bitArray[0] = 0b00000001; // bit 0 set to 1
      const lst = options.lst ?? jose.base64url.encode(zlib.deflateSync(bitArray));

      const now = Math.floor(Date.now() / 1000);
      const ttl = options.ttlSeconds ?? 300;

      const payload = {
        iss: issuer,
        sub,
        iat: now,
        exp: now + ttl,
        status_list: {
          bits,
          lst,
        },
      };

      const privateKey = await jose.importJWK(kp.privateKeyJwk, "ES256");
      const token = await new jose.SignJWT(payload)
        .setProtectedHeader({
          alg: "ES256",
          typ: options.typ ?? STATUS_LIST_TOKEN_TYP,
          kid: `${issuer}#key-1`,
        })
        .sign(privateKey);

      return { token, kp, issuer, sub, bits, lst };
    }

    it("successfully validates a valid signed Status List Token", async () => {
      const { token, kp, issuer, sub, bits, lst } = await createTestStatusToken();

      const result = await verifyStatusListToken(token, {
        resolveIssuerKey: async () => kp.publicKeyJwk,
      });

      expect(result.issuer).toBe(issuer);
      expect(result.subject).toBe(sub);
      expect(result.bits).toBe(bits);
      expect(result.lst).toBe(lst);
    });

    it("rejects tokens with non-conforming typ header", async () => {
      const { token, kp } = await createTestStatusToken({ typ: "JWT" });

      await expect(
        verifyStatusListToken(token, {
          resolveIssuerKey: async () => kp.publicKeyJwk,
        })
      ).rejects.toThrow(
        /Invalid Status List Token typ header: expected 'statuslist\+jwt'/
      );
    });

    it("rejects expired Status List Tokens", async () => {
      const { token, kp } = await createTestStatusToken({ ttlSeconds: -10 });

      await expect(
        verifyStatusListToken(token, {
          resolveIssuerKey: async () => kp.publicKeyJwk,
        })
      ).rejects.toThrow(/"exp" claim timestamp check failed/);
    });

    it("rejects tokens when signature does not match issuer key", async () => {
      const { token } = await createTestStatusToken();
      const otherKp = await generateKeyPair("ES256");

      await expect(
        verifyStatusListToken(token, {
          resolveIssuerKey: async () => otherKp.publicKeyJwk,
        })
      ).rejects.toThrow(/signature verification failed/);
    });
  });

  describe("End-to-End Credential Status Checking", () => {
    it("resolves active credentials (bit === 0) cleanly", async () => {
      const kp = await generateKeyPair("ES256");
      const issuer = "did:web:example.edu";
      const statusUri = "https://example.edu/status/1";

      const bitArray = new Uint8Array(16); // all zeros
      const lst = jose.base64url.encode(zlib.deflateSync(bitArray));

      const privateKey = await jose.importJWK(kp.privateKeyJwk, "ES256");
      const tokenJwt = await new jose.SignJWT({
        iss: issuer,
        sub: statusUri,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        status_list: { bits: 1, lst },
      })
        .setProtectedHeader({
          alg: "ES256",
          typ: STATUS_LIST_TOKEN_TYP,
          kid: `${issuer}#key-1`,
        })
        .sign(privateKey);

      const mockFetch = async () => new Response(tokenJwt, { status: 200 });

      const evaluation = await checkCredentialStatus(
        { uri: statusUri, idx: 4 },
        {
          resolveIssuerKey: async () => kp.publicKeyJwk,
          fetchFn: mockFetch as any,
        }
      );

      expect(evaluation.revoked).toBe(false);
      expect(evaluation.status).toBe("ACTIVE");
      expect(evaluation.idx).toBe(4);
      expect(evaluation.uri).toBe(statusUri);
    });

    it("resolves revoked credentials (bit === 1) accurately", async () => {
      const kp = await generateKeyPair("ES256");
      const issuer = "did:web:example.edu";
      const statusUri = "https://example.edu/status/1";

      const bitArray = new Uint8Array(16);
      bitArray[0] |= 1 << 5; // set bit 5 to 1 (revoked)
      const lst = jose.base64url.encode(zlib.deflateSync(bitArray));

      const privateKey = await jose.importJWK(kp.privateKeyJwk, "ES256");
      const tokenJwt = await new jose.SignJWT({
        iss: issuer,
        sub: statusUri,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        status_list: { bits: 1, lst },
      })
        .setProtectedHeader({
          alg: "ES256",
          typ: STATUS_LIST_TOKEN_TYP,
          kid: `${issuer}#key-1`,
        })
        .sign(privateKey);

      const mockFetch = async () => new Response(tokenJwt, { status: 200 });

      const evaluation = await checkCredentialStatus(
        { uri: statusUri, idx: 5 },
        {
          resolveIssuerKey: async () => kp.publicKeyJwk,
          fetchFn: mockFetch as any,
        }
      );

      expect(evaluation.revoked).toBe(true);
      expect(evaluation.status).toBe("REVOKED");
      expect(evaluation.idx).toBe(5);
    });

    it("throws error when HTTP dereferencing fails", async () => {
      const mockFetch = async () =>
        new Response("Not Found", { status: 404, statusText: "Not Found" });

      await expect(
        checkCredentialStatus(
          { uri: "https://example.edu/status/missing", idx: 0 },
          { fetchFn: mockFetch as any }
        )
      ).rejects.toThrow(/HTTP status 404 Not Found/);
    });
  });
});
