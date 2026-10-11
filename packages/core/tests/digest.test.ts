import { describe, expect, it } from "bun:test";
import {
  DEFAULT_DIGEST_ALGORITHM,
  computeDisclosureDigest,
  computeDisclosureDigestSync,
  isValidDigestAlgorithm,
  normalizeDigestAlgorithm,
  verifyDisclosureDigest,
  verifyDisclosureDigestSync,
} from "../src/sd-jwt/digest.js";

describe("Disclosure Digest Computer (RFC 9901 Section 4.1.1 and Section 4.2.3)", () => {
  // Official test vector from RFC 9901 Section 4.2.3
  const rfcVectorDisclosure =
    "WyJfMjZiYzRMVC1hYzZxMktJNmNCVzVlcyIsICJmYW1pbHlfbmFtZSIsICJNw7ZiaXVzIl0";
  const rfcVectorExpectedSha256 = "X9yH0Ajrdm1Oij4tWso9UzzKJvPoDxwmuEcO3XAdRC0";

  // Official test vectors from RFC 9901 Section 6.1 and Section 6.2
  const rfcAddressDisclosure =
    "WyIyR0xDNDJzS1F2ZUNmR2ZyeU5STjl3IiwgImFkZHJlc3MiLCB7InN0cmVldF9hZGRyZXNzIjogIlNjaHVsc3RyLiAxMiIsICJsb2NhbGl0eSI6ICJTY2h1bHBmb3J0YSIsICJyZWdpb24iOiAiU2FjaHNlbi1BbmhhbHQiLCAiY291bnRyeSI6ICJERSJ9XQ";
  const rfcAddressExpectedSha256 = "fOBUSQvo46yQO-wRwXBcGqvnbKIueISEL961_Sjd4do";

  const rfcStreetDisclosure =
    "WyIyR0xDNDJzS1F2ZUNmR2ZyeU5STjl3IiwgInN0cmVldF9hZGRyZXNzIiwgIlNjaHVsc3RyLiAxMiJd";
  const rfcStreetExpectedSha256 = "9gjVuXtdFROCgRrtNcGUXmF65rdezi_6Er_j76kmYyM";

  const rfcRegionDisclosure =
    "WyI2SWo3dE0tYTVpVlBHYm9TNXRtdlZBIiwgInJlZ2lvbiIsICJTYWNoc2VuLUFuaGFsdCJd";
  const rfcRegionExpectedSha256 = "KURDPh4ZC19-3tiz-Df39V8eidy1oV3a3H1Da2N0g88";

  const rfcCountryDisclosure =
    "WyJlSThaV205UW5LUHBOUGVOZW5IZGhRIiwgImNvdW50cnkiLCAiREUiXQ";
  const rfcCountryExpectedSha256 = "WN9r9dCBJ8HTCsS2jKASxTjEyW5m5x65_Z_2ro2jfXM";

  describe("Official RFC 9901 Test Vectors", () => {
    it("computes exact SHA-256 digest matching RFC 9901 Section 4.2.3 example (family_name)", async () => {
      const asyncDigest = await computeDisclosureDigest(rfcVectorDisclosure);
      expect(asyncDigest).toBe(rfcVectorExpectedSha256);

      const syncDigest = computeDisclosureDigestSync(rfcVectorDisclosure);
      expect(syncDigest).toBe(rfcVectorExpectedSha256);
    });

    it("computes exact SHA-256 digest matching RFC 9901 Section 6.1 example (address block)", async () => {
      const asyncDigest = await computeDisclosureDigest(rfcAddressDisclosure);
      expect(asyncDigest).toBe(rfcAddressExpectedSha256);

      const syncDigest = computeDisclosureDigestSync(rfcAddressDisclosure);
      expect(syncDigest).toBe(rfcAddressExpectedSha256);
    });

    it("computes exact SHA-256 digests matching RFC 9901 Section 6.2 examples (street_address, region, country)", async () => {
      expect(await computeDisclosureDigest(rfcStreetDisclosure)).toBe(
        rfcStreetExpectedSha256
      );
      expect(computeDisclosureDigestSync(rfcStreetDisclosure)).toBe(
        rfcStreetExpectedSha256
      );

      expect(await computeDisclosureDigest(rfcRegionDisclosure)).toBe(
        rfcRegionExpectedSha256
      );
      expect(computeDisclosureDigestSync(rfcRegionDisclosure)).toBe(
        rfcRegionExpectedSha256
      );

      expect(await computeDisclosureDigest(rfcCountryDisclosure)).toBe(
        rfcCountryExpectedSha256
      );
      expect(computeDisclosureDigestSync(rfcCountryDisclosure)).toBe(
        rfcCountryExpectedSha256
      );
    });
  });

  describe("Algorithm Agility (_sd_alg)", () => {
    it("defaults to sha-256 when algorithm parameter is omitted", async () => {
      expect(DEFAULT_DIGEST_ALGORITHM).toBe("sha-256");
      const digest = await computeDisclosureDigest(rfcVectorDisclosure);
      expect(digest).toBe(rfcVectorExpectedSha256);
      expect(digest.length).toBe(43); // 32 bytes SHA-256 base64url unpadded
    });

    it("computes valid digests using sha-384 (48 bytes -> 64 chars)", async () => {
      const digestAsync = await computeDisclosureDigest(
        rfcVectorDisclosure,
        "sha-384"
      );
      const digestSync = computeDisclosureDigestSync(
        rfcVectorDisclosure,
        "sha-384"
      );

      expect(digestAsync).toBe(digestSync);
      expect(digestAsync.length).toBe(64);
      expect(digestAsync).toMatch(/^[A-Za-z0-9_-]{64}$/);
      expect(digestAsync.includes("=")).toBe(false);
    });

    it("computes valid digests using sha-512 (64 bytes -> 86 chars)", async () => {
      const digestAsync = await computeDisclosureDigest(
        rfcVectorDisclosure,
        "sha-512"
      );
      const digestSync = computeDisclosureDigestSync(
        rfcVectorDisclosure,
        "sha-512"
      );

      expect(digestAsync).toBe(digestSync);
      expect(digestAsync.length).toBe(86);
      expect(digestAsync).toMatch(/^[A-Za-z0-9_-]{86}$/);
      expect(digestAsync.includes("=")).toBe(false);
    });
  });

  describe("Validation & Normalization", () => {
    it("normalizes undefined and null algorithm to sha-256 per RFC 9901 Section 4.1.1", () => {
      expect(normalizeDigestAlgorithm(undefined)).toBe("sha-256");
      expect(normalizeDigestAlgorithm(null)).toBe("sha-256");
      expect(normalizeDigestAlgorithm("")).toBe("sha-256");
      expect(normalizeDigestAlgorithm("sha-256")).toBe("sha-256");
      expect(normalizeDigestAlgorithm("sha-384")).toBe("sha-384");
      expect(normalizeDigestAlgorithm("sha-512")).toBe("sha-512");
    });

    it("rejects unsupported or insecure algorithms", () => {
      expect(() => normalizeDigestAlgorithm("md5")).toThrow(
        'Unsupported _sd_alg hash algorithm: "md5"'
      );
      expect(() => normalizeDigestAlgorithm("sha-1")).toThrow(
        'Unsupported _sd_alg hash algorithm: "sha-1"'
      );
      expect(() => normalizeDigestAlgorithm("none")).toThrow(
        'Unsupported _sd_alg hash algorithm: "none"'
      );
      expect(() => normalizeDigestAlgorithm("SHA-256")).toThrow(
        'Unsupported _sd_alg hash algorithm: "SHA-256"'
      );
    });

    it("validates algorithms via isValidDigestAlgorithm()", () => {
      expect(isValidDigestAlgorithm("sha-256")).toBe(true);
      expect(isValidDigestAlgorithm("sha-384")).toBe(true);
      expect(isValidDigestAlgorithm("sha-512")).toBe(true);
      expect(isValidDigestAlgorithm("sha-1")).toBe(false);
      expect(isValidDigestAlgorithm("md5")).toBe(false);
      expect(isValidDigestAlgorithm(null)).toBe(false);
    });

    it("rejects empty or non-string disclosure inputs", async () => {
      expect(computeDisclosureDigest("")).rejects.toThrow(
        "Disclosure string must be a non-empty string"
      );
      expect(computeDisclosureDigest(123 as any)).rejects.toThrow(
        "Disclosure string must be a non-empty string"
      );
      expect(() => computeDisclosureDigestSync("")).toThrow(
        "Disclosure string must be a non-empty string"
      );
    });

    it("rejects disclosure strings with invalid base64url characters or padding", async () => {
      expect(computeDisclosureDigest("invalid+chars/==")).rejects.toThrow(
        "must be a valid unpadded base64url string"
      );
      expect(() =>
        computeDisclosureDigestSync("invalid+chars/==")
      ).toThrow("must be a valid unpadded base64url string");
    });
  });

  describe("Digest Verification Helpers", () => {
    it("returns true for matching disclosure and digest", async () => {
      const okAsync = await verifyDisclosureDigest(
        rfcVectorDisclosure,
        rfcVectorExpectedSha256
      );
      expect(okAsync).toBe(true);

      const okSync = verifyDisclosureDigestSync(
        rfcVectorDisclosure,
        rfcVectorExpectedSha256
      );
      expect(okSync).toBe(true);
    });

    it("returns false for mismatched digest or tampered disclosure", async () => {
      expect(
        await verifyDisclosureDigest(rfcVectorDisclosure, "wrongDigest123")
      ).toBe(false);
      expect(
        verifyDisclosureDigestSync(rfcVectorDisclosure, "wrongDigest123")
      ).toBe(false);

      // Same disclosure, but wrong algorithm
      expect(
        await verifyDisclosureDigest(
          rfcVectorDisclosure,
          rfcVectorExpectedSha256,
          "sha-384"
        )
      ).toBe(false);
    });

    it("returns false gracefully on invalid inputs", async () => {
      expect(await verifyDisclosureDigest("", rfcVectorExpectedSha256)).toBe(
        false
      );
      expect(await verifyDisclosureDigest(rfcVectorDisclosure, "")).toBe(false);
      expect(verifyDisclosureDigestSync("", rfcVectorExpectedSha256)).toBe(
        false
      );
      expect(verifyDisclosureDigestSync(rfcVectorDisclosure, "")).toBe(false);
    });
  });
});
