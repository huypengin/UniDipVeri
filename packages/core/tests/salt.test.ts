import { describe, expect, it } from "bun:test";
import { base64url } from "jose";
import {
  DEFAULT_SALT_BYTE_LENGTH,
  MIN_SALT_BYTE_LENGTH,
  assertMinSaltByteLength,
  assertValidSalt,
  generateSalt,
  isValidSalt,
} from "../src/sd-jwt/salt.js";

describe("CSPRNG Salt Generator (RFC 9901)", () => {
  describe("generateSalt()", () => {
    it("generates a 22-character unpadded base64url string with default 16 bytes (128 bits)", () => {
      const salt = generateSalt();

      expect(typeof salt).toBe("string");
      expect(salt.length).toBe(22);
      expect(salt).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(salt.includes("=")).toBe(false);
      expect(salt.includes("+")).toBe(false);
      expect(salt.includes("/")).toBe(false);

      const decodedBytes = base64url.decode(salt);
      expect(decodedBytes.length).toBe(16);
      expect(decodedBytes.length).toBe(DEFAULT_SALT_BYTE_LENGTH);
    });

    it("generates salts with custom byte lengths >= 16 bytes", () => {
      // 24 bytes = 192 bits -> 32 base64url chars
      const salt24 = generateSalt(24);
      expect(salt24.length).toBe(32);
      expect(salt24).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(base64url.decode(salt24).length).toBe(24);

      // 32 bytes = 256 bits -> 43 base64url chars
      const salt32 = generateSalt(32);
      expect(salt32.length).toBe(43);
      expect(salt32).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(base64url.decode(salt32).length).toBe(32);
    });

    it("enforces minimum 128-bit (16-byte) entropy requirement per RFC 9901", () => {
      expect(() => generateSalt(15)).toThrow(
        `Salt byte length must be an integer >= ${MIN_SALT_BYTE_LENGTH}`
      );
      expect(() => generateSalt(8)).toThrow(
        `Salt byte length must be an integer >= ${MIN_SALT_BYTE_LENGTH}`
      );
      expect(() => generateSalt(0)).toThrow(
        `Salt byte length must be an integer >= ${MIN_SALT_BYTE_LENGTH}`
      );
      expect(() => generateSalt(-1)).toThrow(
        `Salt byte length must be an integer >= ${MIN_SALT_BYTE_LENGTH}`
      );
    });

    it("rejects non-integer byte lengths", () => {
      expect(() => generateSalt(16.5)).toThrow(
        `Salt byte length must be an integer >= ${MIN_SALT_BYTE_LENGTH}`
      );
      expect(() => generateSalt(NaN)).toThrow(
        `Salt byte length must be an integer >= ${MIN_SALT_BYTE_LENGTH}`
      );
    });

    it("guarantees uniqueness across 1,000 consecutively generated salts (zero collisions)", () => {
      const count = 1000;
      const set = new Set<string>();

      for (let i = 0; i < count; i++) {
        set.add(generateSalt());
      }

      expect(set.size).toBe(count);
    });

    it("exhibits high Shannon entropy across generated salt byte distribution", () => {
      // Collect 1000 salts (16,000 bytes) and compute empirical byte entropy:
      // H(X) = - sum(p_i * log2(p_i)). Max theoretical is log2(256) = 8.0.
      const sampleCount = 1000;
      const byteCounts = new Map<number, number>();
      let totalBytes = 0;

      for (let i = 0; i < sampleCount; i++) {
        const bytes = base64url.decode(generateSalt(16));
        for (const byte of bytes) {
          byteCounts.set(byte, (byteCounts.get(byte) || 0) + 1);
          totalBytes++;
        }
      }

      let entropy = 0;
      for (const count of byteCounts.values()) {
        const p = count / totalBytes;
        entropy -= p * Math.log2(p);
      }

      // Shannon entropy should be close to 8.0 bits/byte (well above 7.8)
      expect(entropy).toBeGreaterThan(7.8);
      // Byte values covered should span nearly the entire 0-255 range
      expect(byteCounts.size).toBeGreaterThan(250);
    });
  });

  describe("isValidSalt() (RFC 9901)", () => {
    it("returns true for freshly generated base64url salts", () => {
      expect(isValidSalt(generateSalt())).toBe(true);
      expect(isValidSalt(generateSalt(32))).toBe(true);
    });

    it("returns true for any valid non-empty string salt (UUID, hex, alphanumeric)", () => {
      expect(isValidSalt("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
      expect(isValidSalt("4f53cda18c2b")).toBe(true);
      expect(isValidSalt("any_opaque_string_salt")).toBe(true);
    });

    it("returns false for non-string inputs", () => {
      expect(isValidSalt(null)).toBe(false);
      expect(isValidSalt(undefined)).toBe(false);
      expect(isValidSalt(12345)).toBe(false);
      expect(isValidSalt({})).toBe(false);
      expect(isValidSalt([])).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isValidSalt("")).toBe(false);
    });
  });

  describe("assertValidSalt() (RFC 9901)", () => {
    it("does not throw for valid string salts", () => {
      expect(() => assertValidSalt(generateSalt())).not.toThrow();
      expect(() => assertValidSalt("custom-salt-123")).not.toThrow();
    });

    it("throws for non-string or empty inputs", () => {
      expect(() => assertValidSalt(null)).toThrow("Salt must be a non-empty string");
      expect(() => assertValidSalt("")).toThrow("Salt must be a non-empty string");
      expect(() => assertValidSalt(123 as any)).toThrow("Salt must be a non-empty string");
    });
  });

  describe("assertMinSaltByteLength() (Issuer generation validation)", () => {
    it("accepts freshly generated 128-bit and 256-bit salts", () => {
      expect(() => assertMinSaltByteLength(generateSalt())).not.toThrow();
      expect(() => assertMinSaltByteLength(generateSalt(32))).not.toThrow();
    });

    it("rejects non-base64url formatting", () => {
      expect(() => assertMinSaltByteLength("MDEyMzQ1Njc4OWFiY2RlZg==")).toThrow(
        "Salt must be a valid unpadded base64url string without padding or special characters"
      );
      expect(() => assertMinSaltByteLength("invalid+with/chars")).toThrow(
        "Salt must be a valid unpadded base64url string without padding or special characters"
      );
    });

    it("rejects base64url salts with insufficient decoded byte length (< 16 decoded bytes)", () => {
      const shortSalt = base64url.encode(new Uint8Array(8));
      expect(() => assertMinSaltByteLength(shortSalt)).toThrow(
        "Salt decoded byte length too short: decoded to 8 bytes, minimum recommended is 16 bytes per RFC 9901 entropy recommendations"
      );
    });
  });
});
