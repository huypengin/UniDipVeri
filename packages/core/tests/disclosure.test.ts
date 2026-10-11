import { describe, expect, it } from "bun:test";
import { SDJwtInstance } from "@sd-jwt/core";
import { base64url } from "jose";
import { generateSalt } from "../src/sd-jwt/salt.js";
import {
  canonicalJsonStringify,
  decodeDisclosure,
  encodeArrayDisclosure,
  encodeDisclosure,
  encodeObjectDisclosure,
  isValidDisclosure,
} from "../src/sd-jwt/disclosure.js";

describe("Disclosure Serialization & Parsing (RFC 9901 Section 4.2)", () => {
  const sampleSalt = "X8fL3k9P1q_2mRtVwZa4bQ"; // 22 chars = 16 bytes base64url

  describe("canonicalJsonStringify()", () => {
    it("sorts object keys lexicographically", () => {
      const unordered = { z: 1, a: 2, m: 3 };
      expect(canonicalJsonStringify(unordered)).toBe('{"a":2,"m":3,"z":1}');
    });

    it("sorts nested object keys recursively", () => {
      const nested = {
        b: { y: 10, x: 20 },
        a: { d: 1, c: 2 },
      };
      expect(canonicalJsonStringify(nested)).toBe(
        '{"a":{"c":2,"d":1},"b":{"x":20,"y":10}}'
      );
    });

    it("preserves array element ordering while sorting internal object keys", () => {
      const arr = [{ b: 2, a: 1 }, { d: 4, c: 3 }, "plain"];
      expect(canonicalJsonStringify(arr)).toBe(
        '[{"a":1,"b":2},{"c":3,"d":4},"plain"]'
      );
    });

    it("ignores undefined properties in objects", () => {
      const withUndefined = { a: 1, b: undefined, c: 3 };
      expect(canonicalJsonStringify(withUndefined)).toBe('{"a":1,"c":3}');
    });
  });

  describe("Object Property Disclosures ([salt, key, value])", () => {
    it("encodes and decodes a primitive string claim", () => {
      const encoded = encodeObjectDisclosure(
        sampleSalt,
        "degreeName",
        "Bachelor of Computer Science"
      );

      expect(typeof encoded).toBe("string");
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(encoded.includes("=")).toBe(false);

      const decoded = decodeDisclosure(encoded);
      expect(decoded.type).toBe("object");
      expect(decoded.salt).toBe(sampleSalt);
      expect(decoded.key).toBe("degreeName");
      expect(decoded.value).toBe("Bachelor of Computer Science");
      expect(decoded.tuple).toEqual([
        sampleSalt,
        "degreeName",
        "Bachelor of Computer Science",
      ]);
    });

    it("encodes and decodes numerical claims including decimals and zeroes", () => {
      const gpaEncoded = encodeObjectDisclosure(sampleSalt, "gpa", 3.85);
      const decodedGpa = decodeDisclosure(gpaEncoded);
      expect(decodedGpa.value).toBe(3.85);

      const zeroEncoded = encodeObjectDisclosure(sampleSalt, "retakes", 0);
      const decodedZero = decodeDisclosure(zeroEncoded);
      expect(decodedZero.value).toBe(0);
    });

    it("encodes and decodes boolean and null claims", () => {
      const boolEncoded = encodeObjectDisclosure(sampleSalt, "graduatedWithHonors", true);
      const decodedBool = decodeDisclosure(boolEncoded);
      expect(decodedBool.value).toBe(true);

      const nullEncoded = encodeObjectDisclosure(sampleSalt, "disciplinaryActions", null);
      const decodedNull = decodeDisclosure(nullEncoded);
      expect(decodedNull.value).toBeNull();
    });

    it("encodes and decodes complex nested object values", () => {
      const complexValue = {
        major: "Software Engineering",
        faculty: "School of Computer Science & Engineering",
        accreditations: ["ABET", "AUN-QA"],
      };

      const encoded = encodeObjectDisclosure(sampleSalt, "academicProgram", complexValue);
      const decoded = decodeDisclosure(encoded);

      expect(decoded.type).toBe("object");
      expect(decoded.key).toBe("academicProgram");
      expect(decoded.value).toEqual(complexValue);
    });

    it("produces identical byte-for-byte disclosure strings regardless of input object key order", () => {
      const obj1 = { beta: 2, alpha: 1, gamma: { delta: 4, epsilon: 3 } };
      const obj2 = { alpha: 1, gamma: { epsilon: 3, delta: 4 }, beta: 2 };

      const encoded1 = encodeObjectDisclosure(sampleSalt, "metadata", obj1);
      const encoded2 = encodeObjectDisclosure(sampleSalt, "metadata", obj2);

      expect(encoded1).toBe(encoded2);
    });
  });

  describe("Array Element Disclosures ([salt, value])", () => {
    it("encodes and decodes an anonymous array item disclosure", () => {
      const course = { code: "CS201", title: "Data Structures", grade: 88 };
      const encoded = encodeArrayDisclosure(sampleSalt, course);

      expect(typeof encoded).toBe("string");
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);

      const decoded = decodeDisclosure(encoded);
      expect(decoded.type).toBe("array");
      expect(decoded.salt).toBe(sampleSalt);
      expect(decoded.key).toBeUndefined();
      expect(decoded.value).toEqual(course);
      expect(decoded.tuple).toEqual([sampleSalt, course]);
    });

    it("encodes primitive array items (strings, numbers)", () => {
      const stringItemEncoded = encodeArrayDisclosure(sampleSalt, "Dean's List 2024");
      const decodedItem = decodeDisclosure(stringItemEncoded);
      expect(decodedItem.type).toBe("array");
      expect(decodedItem.value).toBe("Dean's List 2024");

      const numberItemEncoded = encodeArrayDisclosure(sampleSalt, 100);
      const decodedNumber = decodeDisclosure(numberItemEncoded);
      expect(decodedNumber.type).toBe("array");
      expect(decodedNumber.value).toBe(100);
    });
  });

  describe("Unicode & Internationalization Integrity", () => {
    it("encodes and decodes Vietnamese diacritics without distortion", () => {
      const studentName = "Nguyễn Văn Quốc Anh";
      const university = "Trường Đại học Quốc tế — Đại học Quốc gia TP.HCM";

      const nameEncoded = encodeObjectDisclosure(sampleSalt, "fullName", studentName);
      const decodedName = decodeDisclosure(nameEncoded);
      expect(decodedName.value).toBe(studentName);

      const uniEncoded = encodeObjectDisclosure(sampleSalt, "institution", university);
      const decodedUni = decodeDisclosure(uniEncoded);
      expect(decodedUni.value).toBe(university);
    });
  });

  describe("Validation & Error Enforcement", () => {
    it("rejects non-array tuple input in encodeDisclosure", () => {
      expect(() => encodeDisclosure("invalid" as any)).toThrow(
        "Disclosure tuple must be an array"
      );
    });

    it("rejects tuples with invalid element counts", () => {
      expect(() => encodeDisclosure([sampleSalt] as any)).toThrow(
        "Invalid disclosure tuple length: expected 2 (array element) or 3 (object property)"
      );
      expect(() =>
        encodeDisclosure([sampleSalt, "k", "v", "extra"] as any)
      ).toThrow("Invalid disclosure tuple length");
    });

    it("accepts arbitrary non-empty string salts per RFC 9901 Section 4.2.1", () => {
      // UUID as salt
      const uuidSalt = "550e8400-e29b-41d4-a716-446655440000";
      const encoded = encodeObjectDisclosure(uuidSalt, "degree", "CS");
      const decoded = decodeDisclosure(encoded);
      expect(decoded.salt).toBe(uuidSalt);

      // Custom alphanumeric string as salt
      const customSalt = "salt_string_123";
      const encodedArr = encodeArrayDisclosure(customSalt, { test: 1 });
      const decodedArr = decodeDisclosure(encodedArr);
      expect(decodedArr.salt).toBe(customSalt);
    });

    it("rejects non-string or empty salts in encodeDisclosure", () => {
      expect(() => encodeObjectDisclosure("", "degree", "CS")).toThrow(
        "Salt must be a non-empty string"
      );
      expect(() => encodeObjectDisclosure(123 as any, "degree", "CS")).toThrow(
        "Salt must be a non-empty string"
      );
    });

    it("rejects empty or non-string claim keys for object disclosures", () => {
      expect(() => encodeObjectDisclosure(sampleSalt, "", "value")).toThrow(
        "Object disclosure claim key must be a non-empty string"
      );
      expect(() =>
        encodeObjectDisclosure(sampleSalt, 123 as any, "value")
      ).toThrow("Object disclosure claim key must be a non-empty string");
    });

    it("rejects reserved claim names '_sd' and '...' per RFC 9901 Section 4.2.1", () => {
      expect(() => encodeObjectDisclosure(sampleSalt, "_sd", "value")).toThrow(
        'Claim key cannot be reserved identifier "_sd"'
      );
      expect(() => encodeObjectDisclosure(sampleSalt, "...", "value")).toThrow(
        'Claim key cannot be reserved identifier "..."'
      );
    });

    it("rejects undefined claim values", () => {
      expect(() =>
        encodeObjectDisclosure(sampleSalt, "degree", undefined)
      ).toThrow("Disclosure claim value cannot be undefined");
      expect(() => encodeArrayDisclosure(sampleSalt, undefined)).toThrow(
        "Disclosure claim value cannot be undefined"
      );
    });

    it("rejects malformed disclosure strings during decoding", () => {
      expect(() => decodeDisclosure("")).toThrow("Disclosure must be a non-empty string");
      expect(() => decodeDisclosure("invalid+with/base64==")).toThrow(
        "not a valid unpadded base64url string"
      );

      // Valid base64url, but payload is not JSON
      const notJson = base64url.encode(new TextEncoder().encode("Hello World"));
      expect(() => decodeDisclosure(notJson)).toThrow("is not valid JSON");

      // Valid JSON, but not an array
      const jsonObject = base64url.encode(
        new TextEncoder().encode(JSON.stringify({ salt: sampleSalt }))
      );
      expect(() => decodeDisclosure(jsonObject)).toThrow("must be an array");

      // Array with invalid length
      const singleItemArray = base64url.encode(
        new TextEncoder().encode(JSON.stringify([sampleSalt]))
      );
      expect(() => decodeDisclosure(singleItemArray)).toThrow(
        "Invalid disclosure tuple length"
      );
    });

    it("rejects decoded disclosures with reserved claim keys", () => {
      const reservedTuple = [sampleSalt, "_sd", "malicious"];
      const b64 = base64url.encode(
        new TextEncoder().encode(JSON.stringify(reservedTuple))
      );
      expect(() => decodeDisclosure(b64)).toThrow(
        'Invalid disclosure: claim key cannot be reserved identifier "_sd"'
      );
    });
  });

  describe("isValidDisclosure()", () => {
    it("returns true for valid object and array disclosures", () => {
      const objDisc = encodeObjectDisclosure(sampleSalt, "degree", "CS");
      expect(isValidDisclosure(objDisc)).toBe(true);

      const arrDisc = encodeArrayDisclosure(sampleSalt, { code: "CS101" });
      expect(isValidDisclosure(arrDisc)).toBe(true);
    });

    it("returns false for invalid inputs", () => {
      expect(isValidDisclosure(null)).toBe(false);
      expect(isValidDisclosure("")).toBe(false);
      expect(isValidDisclosure("not-base64==")).toBe(false);
      expect(isValidDisclosure("YWJj")).toBe(false); // base64url("abc") not JSON array
    });
  });

  describe("Tested compatibility against @sd-jwt/core legacy regression oracle", () => {
    it("decodes disclosures generated by @sd-jwt/core", async () => {
      const inst = new SDJwtInstance({
        hasher: () => new Uint8Array(32),
        saltGenerator: () => generateSalt(),
        signer: async () => "dummySig",
        signAlg: "ES256",
      });

      const issued = await inst.issue(
        { degree: "Bachelor of Science", gpa: 3.92 },
        { _sd: ["degree", "gpa"] }
      );

      // Issued SD-JWT format: <jwt>~<disc1>~<disc2>~
      const parts = issued.split("~").filter(Boolean);
      const disclosureTokens = parts.slice(1);

      expect(disclosureTokens.length).toBe(2);

      for (const disc of disclosureTokens) {
        expect(isValidDisclosure(disc)).toBe(true);
        const decoded = decodeDisclosure(disc);
        expect(decoded.type).toBe("object");
        if (decoded.type === "object") {
          expect(["degree", "gpa"].includes(decoded.key)).toBe(true);
          if (decoded.key === "degree") {
            expect(decoded.value).toBe("Bachelor of Science");
          } else if (decoded.key === "gpa") {
            expect(decoded.value).toBe(3.92);
          }
        }
      }
    });

    it("@sd-jwt/core can decode disclosures generated by our encodeObjectDisclosure", async () => {
      const ourSalt = generateSalt();
      const ourDisclosure = encodeObjectDisclosure(
        ourSalt,
        "faculty",
        "Computer Science"
      );

      const inst = new SDJwtInstance({
        hasher: () => new Uint8Array(32),
      });

      // Construct a mock SD-JWT with our disclosure
      const jwtHeader = base64url.encode(
        new TextEncoder().encode(JSON.stringify({ alg: "ES256" }))
      );
      const jwtPayload = base64url.encode(
        new TextEncoder().encode(JSON.stringify({ _sd: ["mockDigest"] }))
      );
      const mockSdJwt = `${jwtHeader}.${jwtPayload}.sig~${ourDisclosure}~`;

      const decoded = await inst.decode(mockSdJwt);
      expect(decoded.disclosures).toBeDefined();
      expect(decoded.disclosures!.length).toBe(1);

      const d = decoded.disclosures![0];
      expect(d.salt).toBe(ourSalt);
      expect(d.key).toBe("faculty");
      expect(d.value).toBe("Computer Science");
      expect(d.encode()).toBe(ourDisclosure);
    });

    it("@sd-jwt/core can decode array disclosures generated by our encodeArrayDisclosure", async () => {
      const ourSalt = generateSalt();
      const course = { code: "CS302", grade: 95 };
      const ourArrayDisclosure = encodeArrayDisclosure(ourSalt, course);

      const inst = new SDJwtInstance({
        hasher: () => new Uint8Array(32),
      });

      const jwtHeader = base64url.encode(
        new TextEncoder().encode(JSON.stringify({ alg: "ES256" }))
      );
      const jwtPayload = base64url.encode(
        new TextEncoder().encode(
          JSON.stringify({ courses: [{ "...": "mockDigest" }] })
        )
      );
      const mockSdJwt = `${jwtHeader}.${jwtPayload}.sig~${ourArrayDisclosure}~`;

      const decoded = await inst.decode(mockSdJwt);
      expect(decoded.disclosures).toBeDefined();
      expect(decoded.disclosures!.length).toBe(1);

      const d = decoded.disclosures![0];
      expect(d.salt).toBe(ourSalt);
      expect(d.key).toBeUndefined();
      expect(d.value).toEqual(course);
      expect(d.encode()).toBe(ourArrayDisclosure);
    });
  });
});
