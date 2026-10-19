import { describe, expect, it, beforeEach } from "bun:test";
import { join } from "node:path";
import { SDJwtInstance } from "@sd-jwt/core";
import { base64url } from "jose";
import { createHash } from "node:crypto";
import { loadSchemaFromFile } from "../src/schema/loader.js";
import type { CredentialTypeConfig } from "../src/schema/types.js";
import {
  assertNoReservedSdKeys,
  RESERVED_SD_TRANSFORM_KEYS,
  reconstructClaims,
  transformClaims,
} from "../src/sd-jwt/transform.js";
import { decodeDisclosure } from "../src/sd-jwt/disclosure.js";
import { computeDisclosureDigestSync } from "../src/sd-jwt/digest.js";

describe("Claim Masking Transformer (RFC 9901 Section 4.2.4 and Section 6)", () => {
  const schemaPath = join(
    import.meta.dir,
    "../../../schemas/graduation-record.v1.yaml"
  );

  const sampleGraduationClaims = {
    studentId: "STU-2026-8899",
    fullName: "Nguyen Van A",
    dateOfBirth: "2002-05-15",
    nationalId: "001202008899",
    papers: {
      diploma: {
        degreeName: "Bachelor of Computer Science",
        degreeType: "Bachelor",
        programName: "Software Engineering",
        major: "Computer Science",
        minor: "Mathematics",
        graduationDate: "2026-06-30",
        honours: "First Class",
      },
      transcript: {
        transcriptId: "TR-2026-9901",
        cumulativeGPA: 3.88,
        totalCredits: 135,
        courses: [
          {
            code: "CS201",
            title: "Data Structures & Algorithms",
            credits: 4,
            grade: 92,
            letterGrade: "A",
          },
          {
            code: "CS302",
            title: "Distributed Systems & Security",
            credits: 4,
            grade: 96,
            letterGrade: "A+",
          },
        ],
      },
    },
  };

  describe("Basic Object and Field Transformation", () => {
    const simpleSchema: CredentialTypeConfig = {
      vctPath: "/types/simple/v1",
      name: "Simple Credential",
      description: "Simple test credential",
      claims: {
        id: { type: "string", required: true, sd: "always_disclosed" },
        name: { type: "string", required: true, sd: "always_disclosed" },
        email: { type: "string", required: false, sd: "selectively_disclosable" },
        age: { type: "number", required: false, sd: "selectively_disclosable" },
      },
    };

    it("keeps always_disclosed claims as plain properties and masks selectively_disclosable claims into _sd", () => {
      const data = {
        id: "USER-1",
        name: "Alice",
        email: "alice@example.com",
        age: 25,
      };

      const result = transformClaims(data, simpleSchema);

      // Plain properties retained
      expect(result.maskedPayload.id).toBe("USER-1");
      expect(result.maskedPayload.name).toBe("Alice");

      // Selectively disclosable claims removed from plain object
      expect(result.maskedPayload.email).toBeUndefined();
      expect(result.maskedPayload.age).toBeUndefined();

      // _sd array contains exactly 2 digests
      const sd = result.maskedPayload._sd as string[];
      expect(Array.isArray(sd)).toBe(true);
      expect(sd.length).toBe(2);

      // _sd array is sorted lexicographically in Unicode code point order per RFC 9901 Section 4.2.4.1
      const sortedCopy = [...sd].sort();
      expect(sd).toEqual(sortedCopy);

      // Disclosures generated
      expect(result.disclosures.length).toBe(2);

      const decodedDisclosures = result.disclosures.map((d) => decodeDisclosure(d));
      const claimKeys = decodedDisclosures.map((d) => d.key).sort();
      expect(claimKeys).toEqual(["age", "email"]);

      // Reconstructing with all disclosures yields full original claims
      const reconstructed = reconstructClaims(result.maskedPayload, result.disclosures);
      expect(reconstructed).toEqual(data);
    });

    it("does not create an _sd array when no selectively disclosable claims are present", () => {
      const schemaNoSd: CredentialTypeConfig = {
        vctPath: "/types/no-sd/v1",
        name: "No SD Credential",
        description: "All claims always disclosed",
        claims: {
          id: { type: "string", required: true, sd: "always_disclosed" },
          name: { type: "string", required: true, sd: "always_disclosed" },
        },
      };

      const data = { id: "USER-2", name: "Bob" };
      const result = transformClaims(data, schemaNoSd);

      expect(result.maskedPayload._sd).toBeUndefined();
      expect(result.disclosures.length).toBe(0);
      expect(result.maskedPayload).toEqual(data);
    });

    it("omits optional disclosable claims when they are not present in data", () => {
      const data = { id: "USER-3", name: "Carol" }; // email and age omitted
      const result = transformClaims(data, simpleSchema);

      expect(result.maskedPayload._sd).toBeUndefined();
      expect(result.disclosures.length).toBe(0);
      expect(result.maskedPayload.id).toBe("USER-3");
      expect(result.maskedPayload.name).toBe("Carol");
    });

    it("passes through extra unmapped claims as plain claims", () => {
      const data = {
        id: "USER-4",
        name: "Dave",
        customMetadata: "institution-tag",
      };
      const result = transformClaims(data, simpleSchema);

      expect(result.maskedPayload.customMetadata).toBe("institution-tag");
    });
  });

  describe("Array Element Selective Disclosure (RFC 9901 Section 4.2.4.2)", () => {
    const arraySchema: CredentialTypeConfig = {
      vctPath: "/types/array/v1",
      name: "Array Credential",
      description: "Testing array disclosures",
      claims: {
        owner: { type: "string", required: true, sd: "always_disclosed" },
        tags: {
          type: "array",
          sd: "selectively_disclosable",
          items: { type: "string" },
        },
      },
    };

    it("replaces selectively disclosable array elements with '...' digest markers", () => {
      const data = {
        owner: "Eve",
        tags: ["admin", "developer", "maintainer"],
      };

      const result = transformClaims(data, arraySchema);

      expect(result.maskedPayload.owner).toBe("Eve");

      const maskedTags = result.maskedPayload.tags as Array<{ "...": string }>;
      expect(Array.isArray(maskedTags)).toBe(true);
      expect(maskedTags.length).toBe(3);

      for (const item of maskedTags) {
        expect(Object.keys(item)).toEqual(["..."]);
        expect(typeof item["..."]).toBe("string");
        expect(item["..."].length).toBe(43); // base64url sha-256
      }

      expect(result.disclosures.length).toBe(3);
      for (const disc of result.disclosures) {
        const decoded = decodeDisclosure(disc);
        expect(decoded.type).toBe("array");
        expect(decoded.key).toBeUndefined();
        expect(["admin", "developer", "maintainer"]).toContain(
          decoded.value as string
        );
      }

      // Reconstruct restores the entire array
      const reconstructed = reconstructClaims(result.maskedPayload, result.disclosures);
      expect(reconstructed).toEqual(data);
    });

    it("allows selective disclosure of a subset of array items", () => {
      const data = {
        owner: "Frank",
        tags: ["roleA", "roleB", "roleC"],
      };

      const result = transformClaims(data, arraySchema);

      // Present only disclosure for "roleB"
      const roleBDisclosure = result.disclosures.find(
        (d) => decodeDisclosure(d).value === "roleB"
      )!;

      const reconstructed = reconstructClaims(result.maskedPayload, [
        roleBDisclosure,
      ]);

      const reconstructedTags = reconstructed.tags as unknown[];
      expect(reconstructedTags.length).toBe(3);

      // Element 0: remains masked
      expect("..." in (reconstructedTags[0] as object)).toBe(true);

      // Element 1: revealed
      expect(reconstructedTags[1]).toBe("roleB");

      // Element 2: remains masked
      expect("..." in (reconstructedTags[2] as object)).toBe(true);
    });
  });

  describe("Thesis Primary Schema: Graduation Composite Record (graduation-record.v1.yaml)", () => {
    let graduationSchema: CredentialTypeConfig;

    beforeEach(async () => {
      graduationSchema = await loadSchemaFromFile(schemaPath);
    });

    it("transforms complex hierarchical academic record into multi-tier SD-JWT payload", () => {
      const result = transformClaims(sampleGraduationClaims, graduationSchema);

      // Root level checks:
      // Plain claims
      expect(result.maskedPayload.studentId).toBe("STU-2026-8899");
      expect(result.maskedPayload.fullName).toBe("Nguyen Van A");

      // Root level disclosable claims: dateOfBirth, nationalId
      expect(result.maskedPayload.dateOfBirth).toBeUndefined();
      expect(result.maskedPayload.nationalId).toBeUndefined();

      const rootSd = result.maskedPayload._sd as string[];
      expect(Array.isArray(rootSd)).toBe(true);
      expect(rootSd.length).toBe(2); // dateOfBirth and nationalId

      // papers container is always_disclosed
      expect(result.maskedPayload.papers).toBeDefined();
      const papers = result.maskedPayload.papers as Record<string, unknown>;

      // diploma and transcript are selectively disclosable containers inside papers
      expect(papers.diploma).toBeUndefined();
      expect(papers.transcript).toBeUndefined();

      const papersSd = papers._sd as string[];
      expect(Array.isArray(papersSd)).toBe(true);
      expect(papersSd.length).toBe(2); // diploma and transcript digests

      // Inspect disclosures
      const decodedMap = new Map<string, unknown>();
      for (const disc of result.disclosures) {
        const decoded = decodeDisclosure(disc);
        if (decoded.type === "object") {
          decodedMap.set(decoded.key, decoded.value);
        }
      }

      // 1. Diploma disclosure checks
      expect(decodedMap.has("diploma")).toBe(true);
      const diplomaValue = decodedMap.get("diploma") as Record<string, unknown>;
      // Always disclosed inside diploma
      expect(diplomaValue.degreeName).toBe("Bachelor of Computer Science");
      expect(diplomaValue.graduationDate).toBe("2026-06-30");
      // Selectively disclosable inside diploma: degreeType, programName, major, minor, honours
      expect(diplomaValue.degreeType).toBeUndefined();
      expect(diplomaValue.major).toBeUndefined();
      expect(diplomaValue._sd).toBeDefined();
      expect(Array.isArray(diplomaValue._sd)).toBe(true);
      expect((diplomaValue._sd as string[]).length).toBe(5);

      // 2. Transcript disclosure checks
      expect(decodedMap.has("transcript")).toBe(true);
      const transcriptValue = decodedMap.get("transcript") as Record<
        string,
        unknown
      >;
      expect(transcriptValue.transcriptId).toBe("TR-2026-9901");
      expect(transcriptValue.cumulativeGPA).toBeUndefined();
      expect(transcriptValue.totalCredits).toBeUndefined();
      expect((transcriptValue._sd as string[]).length).toBe(2); // cumulativeGPA, totalCredits

      // Courses array inside transcript
      const courses = transcriptValue.courses as Array<{ "...": string }>;
      expect(Array.isArray(courses)).toBe(true);
      expect(courses.length).toBe(2);
      expect("..." in (courses[0] as object)).toBe(true);
      expect("..." in (courses[1] as object)).toBe(true);

      // Reconstruct with all disclosures completely matches original
      const reconstructed = reconstructClaims(
        result.maskedPayload,
        result.disclosures
      );
      expect(reconstructed).toEqual(sampleGraduationClaims);
    });

    it("Thesis Requirement 1 (Container-level SD): reveals Diploma and withholds Transcript", () => {
      const result = transformClaims(sampleGraduationClaims, graduationSchema);

      // Find all disclosures that belong to the Diploma tree
      // (diploma container disclosure + nested diploma fields)
      const diplomaDisclosures: string[] = [];
      const transcriptDisclosures: string[] = [];

      for (const disc of result.disclosures) {
        const decoded = decodeDisclosure(disc);
        if (decoded.type === "object") {
          if (
            [
              "diploma",
              "degreeType",
              "programName",
              "major",
              "minor",
              "honours",
            ].includes(decoded.key)
          ) {
            diplomaDisclosures.push(disc);
          } else if (
            [
              "transcript",
              "cumulativeGPA",
              "totalCredits",
              "grade",
              "letterGrade",
            ].includes(decoded.key)
          ) {
            transcriptDisclosures.push(disc);
          }
        } else if (decoded.type === "array") {
          transcriptDisclosures.push(disc);
        }
      }

      // Present only Diploma disclosures
      const reconstructed = reconstructClaims(
        result.maskedPayload,
        diplomaDisclosures
      );

      // Student identity root fields are present
      expect(reconstructed.studentId).toBe("STU-2026-8899");
      expect(reconstructed.fullName).toBe("Nguyen Van A");

      // dateOfBirth and nationalId are withheld
      expect(reconstructed.dateOfBirth).toBeUndefined();
      expect(reconstructed.nationalId).toBeUndefined();

      const papers = reconstructed.papers as Record<string, unknown>;
      expect(papers).toBeDefined();

      // Diploma is fully revealed
      expect(papers.diploma).toEqual(sampleGraduationClaims.papers.diploma);

      // Transcript is completely absent
      expect(papers.transcript).toBeUndefined();
    });

    it("Thesis Requirement 2 (Field-level SD): reveals degreeName and graduationDate, conceals honours and minor", () => {
      const result = transformClaims(sampleGraduationClaims, graduationSchema);

      // Present only: diploma container disclosure + major and programName (withholding minor and honours)
      const presentedDisclosures = result.disclosures.filter((d) => {
        const decoded = decodeDisclosure(d);
        return (
          decoded.type === "object" &&
          ["diploma", "programName", "major"].includes(decoded.key)
        );
      });

      const reconstructed = reconstructClaims(
        result.maskedPayload,
        presentedDisclosures
      );

      const papers = reconstructed.papers as Record<string, unknown>;
      const diploma = papers.diploma as Record<string, unknown>;

      // Always disclosed fields in diploma
      expect(diploma.degreeName).toBe("Bachelor of Computer Science");
      expect(diploma.graduationDate).toBe("2026-06-30");

      // Disclosed fields
      expect(diploma.programName).toBe("Software Engineering");
      expect(diploma.major).toBe("Computer Science");

      // Withheld fields
      expect(diploma.minor).toBeUndefined();
      expect(diploma.honours).toBeUndefined();
      expect(diploma.degreeType).toBeUndefined();
    });

    it("Thesis Requirement 3 (Array-item SD): reveals only one course (CS201) and conceals the other (CS302)", () => {
      const result = transformClaims(sampleGraduationClaims, graduationSchema);

      // Find the disclosure for the first course (CS201)
      const course1Disclosure = result.disclosures.find((d) => {
        const decoded = decodeDisclosure(d);
        if (decoded.type === "array" && typeof decoded.value === "object" && decoded.value !== null) {
          return (decoded.value as Record<string, unknown>).code === "CS201";
        }
        return false;
      })!;
      expect(course1Disclosure).toBeDefined();

      // Transcript container disclosure
      const transcriptDisclosure = result.disclosures.find((d) => {
        const decoded = decodeDisclosure(d);
        return decoded.type === "object" && decoded.key === "transcript";
      })!;

      // GPA disclosure
      const gpaDisclosure = result.disclosures.find((d) => {
        const decoded = decodeDisclosure(d);
        return decoded.type === "object" && decoded.key === "cumulativeGPA";
      })!;

      // Present: transcript, GPA, and course 1 (without course 1 grade disclosures, without course 2)
      const presented = [transcriptDisclosure, gpaDisclosure, course1Disclosure];

      const reconstructed = reconstructClaims(result.maskedPayload, presented);
      const papers = reconstructed.papers as Record<string, unknown>;
      const transcript = papers.transcript as Record<string, unknown>;

      expect(transcript.transcriptId).toBe("TR-2026-9901");
      expect(transcript.cumulativeGPA).toBe(3.88);
      expect(transcript.totalCredits).toBeUndefined(); // Withheld

      const courses = transcript.courses as unknown[];
      expect(courses.length).toBe(2);

      // Course 0 (CS201): code, title, credits are revealed; grade is withheld
      const course0 = courses[0] as Record<string, unknown>;
      expect(course0.code).toBe("CS201");
      expect(course0.title).toBe("Data Structures & Algorithms");
      expect(course0.credits).toBe(4);
      expect(course0.grade).toBeUndefined();
      expect(course0.letterGrade).toBeUndefined();

      // Course 1 (CS302): completely withheld behind digest marker
      expect("..." in (courses[1] as object)).toBe(true);
    });
  });

  describe("Compatibility with @sd-jwt/core Regression Oracle", () => {
    it("@sd-jwt/core successfully decodes and reconstructs claims transformed by transformClaims", async () => {
      const graduationSchema = await loadSchemaFromFile(schemaPath);
      const result = transformClaims(sampleGraduationClaims, graduationSchema);

      const inst = new SDJwtInstance({
        hasher: (val) => createHash("sha256").update(val).digest(),
      });

      // Construct a mock SD-JWT with our masked payload and all generated disclosures
      const jwtHeader = base64url.encode(
        new TextEncoder().encode(JSON.stringify({ alg: "ES256", typ: "dc+sd-jwt" }))
      );
      const jwtPayload = base64url.encode(
        new TextEncoder().encode(JSON.stringify(result.maskedPayload))
      );

      const disclosuresChain = result.disclosures.join("~");
      const mockSdJwt = `${jwtHeader}.${jwtPayload}.sig~${disclosuresChain}~`;

      const decoded = await inst.decode(mockSdJwt);
      expect(decoded.disclosures).toBeDefined();
      expect(decoded.disclosures!.length).toBe(result.disclosures.length);

      // Reconstruct claims via @sd-jwt/core's oracle getClaims()
      const oracleClaims = await decoded.getClaims(async (data) =>
        createHash("sha256").update(data).digest()
      );

      expect(oracleClaims).toEqual(sampleGraduationClaims);
    });
  });

  describe("Algorithm Agility (_sd_alg)", () => {
    const testSchema: CredentialTypeConfig = {
      vctPath: "/types/alg/v1",
      name: "Alg Credential",
      description: "Testing algorithm agility",
      claims: {
        id: { type: "string", required: true, sd: "always_disclosed" },
        secret: { type: "string", required: true, sd: "selectively_disclosable" },
      },
    };

    it("includes _sd_alg: 'sha-384' and produces 48-byte (64 char) digests", () => {
      const data = { id: "ID-384", secret: "super-secret" };
      const result = transformClaims(data, testSchema, {
        algorithm: "sha-384",
      });

      expect(result.maskedPayload._sd_alg).toBe("sha-384");
      const sd = result.maskedPayload._sd as string[];
      expect(sd.length).toBe(1);
      expect(sd[0].length).toBe(64); // 48 bytes base64url

      const reconstructed = reconstructClaims(
        result.maskedPayload,
        result.disclosures
      );
      expect(reconstructed).toEqual(data);
    });

    it("includes _sd_alg: 'sha-512' and produces 64-byte (86 char) digests", () => {
      const data = { id: "ID-512", secret: "ultra-secret" };
      const result = transformClaims(data, testSchema, {
        algorithm: "sha-512",
      });

      expect(result.maskedPayload._sd_alg).toBe("sha-512");
      const sd = result.maskedPayload._sd as string[];
      expect(sd.length).toBe(1);
      expect(sd[0].length).toBe(86); // 64 bytes base64url

      const reconstructed = reconstructClaims(
        result.maskedPayload,
        result.disclosures
      );
      expect(reconstructed).toEqual(data);
    });

    it("includes _sd_alg: 'sha-256' when includeSdAlg is explicitly true", () => {
      const data = { id: "ID-256", secret: "secret" };
      const result = transformClaims(data, testSchema, {
        algorithm: "sha-256",
        includeSdAlg: true,
      });

      expect(result.maskedPayload._sd_alg).toBe("sha-256");
    });
  });

  describe("Validation & Error Enforcements", () => {
    const strictSchema: CredentialTypeConfig = {
      vctPath: "/types/strict/v1",
      name: "Strict Credential",
      description: "Testing strict validations",
      claims: {
        mandatoryId: { type: "string", required: true, sd: "always_disclosed" },
        mandatorySecret: {
          type: "string",
          required: true,
          sd: "selectively_disclosable",
        },
      },
    };

    it("throws when a required claim is missing and enforceRequired is true", () => {
      const missingData = { mandatoryId: "ID-1" }; // mandatorySecret missing

      expect(() => transformClaims(missingData, strictSchema)).toThrow(
        /Missing required claim: "mandatorySecret"/
      );
    });

    it("does not throw for missing required claim if enforceRequired is false", () => {
      const missingData = { mandatoryId: "ID-1" };

      expect(() =>
        transformClaims(missingData, strictSchema, {
          enforceRequired: false,
        })
      ).not.toThrow();
    });

    it("rejects non-object claimsData", () => {
      expect(() =>
        transformClaims("not-an-object" as unknown as Record<string, unknown>, strictSchema)
      ).toThrow(/claimsData must be a non-null object/);

      expect(() =>
        transformClaims(null as unknown as Record<string, unknown>, strictSchema)
      ).toThrow(/claimsData must be a non-null object/);
    });

    it("throws error in reconstructClaims when plaintext collision occurs (RFC 9901 Section 7.1.3.c.ii.3)", () => {
      // Create a tampered payload that has "email" both as plain claim and in _sd
      const disclosure = decodeDisclosure(
        "WyJ4OHZlM2s5cDFxXzJtUnRWd1phNGJRIiwiZW1haWwiLCJhbGljZUBleGFtcGxlLmNvbSJd"
      );
      const digest = computeDisclosureDigestSync(disclosure.encoded);

      const tamperedPayload = {
        email: "existing-plain@example.com", // Plain collision!
        _sd: [digest],
      };

      expect(() =>
        reconstructClaims(tamperedPayload, [disclosure.encoded])
      ).toThrow(/Collision detected: claim "email" already exists as a plain property/);
    });

    it("rejects reserved SD keys (_sd, _sd_alg, ...) at root level of claimsData", () => {
      for (const reservedKey of RESERVED_SD_TRANSFORM_KEYS) {
        const payloadWithReserved = {
          mandatoryId: "ID-1",
          mandatorySecret: "sec",
          [reservedKey]: "injected",
        };

        expect(() => transformClaims(payloadWithReserved, strictSchema)).toThrow(
          new RegExp(`Input claims data must not contain reserved SD-JWT key '${reservedKey.replace(".", "\\.")}'`)
        );
      }
    });

    it("rejects reserved SD keys nested deeply in unmapped objects and arrays", () => {
      const nestedInUnmappedObject = {
        mandatoryId: "ID-1",
        mandatorySecret: "sec",
        unmappedMetadata: {
          subSection: {
            _sd: ["fake-digest"],
          },
        },
      };

      expect(() =>
        transformClaims(nestedInUnmappedObject, strictSchema)
      ).toThrow(
        /Input claims data must not contain reserved SD-JWT key '_sd' at path 'unmappedMetadata\.subSection\._sd'/
      );

      const nestedInArray = {
        mandatoryId: "ID-1",
        mandatorySecret: "sec",
        itemsList: [
          { validProp: 1 },
          { "...": "fake-marker-digest" },
        ],
      };

      expect(() => transformClaims(nestedInArray, strictSchema)).toThrow(
        /Input claims data must not contain reserved SD-JWT key '\.\.\.' at path 'itemsList\[1\]/
      );
    });

    it("assertNoReservedSdKeys handles primitive values and null safely without error", () => {
      expect(() => assertNoReservedSdKeys(null)).not.toThrow();
      expect(() => assertNoReservedSdKeys("string")).not.toThrow();
      expect(() => assertNoReservedSdKeys(123)).not.toThrow();
      expect(() => assertNoReservedSdKeys(true)).not.toThrow();
      expect(() => assertNoReservedSdKeys({ clean: { nested: [1, 2, 3] } })).not.toThrow();
    });
  });
});
