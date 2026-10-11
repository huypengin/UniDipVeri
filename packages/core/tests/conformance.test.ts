import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SDJwtInstance } from "@sd-jwt/core";
import { base64url } from "jose";
import { loadSchemaFromFile } from "../src/schema/loader.js";
import { transformClaims } from "../src/sd-jwt/transform.js";
import { generateSalt } from "../src/sd-jwt/salt.js";
import {
  encodeArrayDisclosure,
  encodeObjectDisclosure,
} from "../src/sd-jwt/disclosure.js";
import { computeDisclosureDigestSync } from "../src/sd-jwt/digest.js";

/**
 * Conformance & Oracle Interoperability Suite (RFC 9901 & @sd-jwt/core Oracle)
 *
 * Verifies that UniDipVeri's SD-JWT primitives and transformed payloads adhere strictly
 * to RFC 9901 wire-format and interoperates seamlessly with @sd-jwt/core as an independent oracle.
 */
describe("Oracle Compatibility & Wire-Format Conformance (RFC 9901 & @sd-jwt/core)", () => {
  const schemaPath = join(
    import.meta.dir,
    "../../../schemas/graduation-record.yaml"
  );

  const testRecord = {
    studentId: "STU-2026-0042",
    fullName: "Tran Van B",
    dateOfBirth: "2001-11-20",
    nationalId: "079201004200",
    papers: {
      diploma: {
        degreeName: "Bachelor of Information Technology",
        degreeType: "Bachelor",
        programName: "Computer Networks & Security",
        major: "Information Technology",
        graduationDate: "2025-12-15",
      },
      transcript: {
        transcriptId: "TR-2025-0042",
        cumulativeGPA: 3.75,
        totalCredits: 130,
        courses: [
          {
            code: "NET101",
            title: "Computer Networks Fundamentals",
            credits: 3,
            grade: 88,
            letterGrade: "B+",
          },
        ],
      },
    },
  };

  it("verifies wire-format compatibility (<jwt>~<disc1>~...~<discN>~) with @sd-jwt/core", async () => {
    const schema = await loadSchemaFromFile(schemaPath);
    const { maskedPayload, disclosures } = transformClaims(testRecord, schema);

    // Build standard compact JWS representation
    const header = base64url.encode(
      new TextEncoder().encode(JSON.stringify({ alg: "ES256", typ: "dc+sd-jwt" }))
    );
    const payload = base64url.encode(
      new TextEncoder().encode(JSON.stringify(maskedPayload))
    );
    const dummySignature = base64url.encode(new Uint8Array(64));

    // SD-JWT combined format per RFC 9901 Section 5
    const combinedWireFormat = `${header}.${payload}.${dummySignature}~${disclosures.join("~")}~`;

    expect(combinedWireFormat.endsWith("~")).toBe(true);

    // Feed combined wire format to @sd-jwt/core oracle
    const oracle = new SDJwtInstance({
      hasher: (val) => createHash("sha256").update(val).digest(),
    });

    const decoded = await oracle.decode(combinedWireFormat);
    expect(decoded.jwt).toBeDefined();
    expect(decoded.disclosures?.length).toBe(disclosures.length);

    // Oracle getClaims() reconstructs original claims structure
    const reconstructed = await decoded.getClaims(async (data) =>
      createHash("sha256").update(data).digest()
    );

    expect(reconstructed).toEqual(testRecord);
  });

  it("verifies independent standalone object disclosures against @sd-jwt/core", async () => {
    const salt = generateSalt(16);
    const ourDisclosure = encodeObjectDisclosure(salt, "faculty", "Engineering");
    const digest = computeDisclosureDigestSync(ourDisclosure);

    const oracle = new SDJwtInstance({
      hasher: (val) => createHash("sha256").update(val).digest(),
    });

    const header = base64url.encode(
      new TextEncoder().encode(JSON.stringify({ alg: "ES256" }))
    );
    const payload = base64url.encode(
      new TextEncoder().encode(JSON.stringify({ _sd: [digest] }))
    );
    const wireFormat = `${header}.${payload}.sig~${ourDisclosure}~`;

    const decoded = await oracle.decode(wireFormat);
    expect(decoded.disclosures?.[0]?.key).toBe("faculty");
    expect(decoded.disclosures?.[0]?.value).toBe("Engineering");

    const claims = await decoded.getClaims(async (data) =>
      createHash("sha256").update(data).digest()
    );
    expect(claims).toEqual({ faculty: "Engineering" });
  });

  it("verifies independent standalone array disclosures against @sd-jwt/core", async () => {
    const salt = generateSalt(16);
    const courseObj = { code: "MATH101", credits: 3 };
    const ourDisclosure = encodeArrayDisclosure(salt, courseObj);
    const digest = computeDisclosureDigestSync(ourDisclosure);

    const oracle = new SDJwtInstance({
      hasher: (val) => createHash("sha256").update(val).digest(),
    });

    const header = base64url.encode(
      new TextEncoder().encode(JSON.stringify({ alg: "ES256" }))
    );
    const payload = base64url.encode(
      new TextEncoder().encode(JSON.stringify({ courses: [{ "...": digest }] }))
    );
    const wireFormat = `${header}.${payload}.sig~${ourDisclosure}~`;

    const decoded = await oracle.decode(wireFormat);
    expect(decoded.disclosures?.[0]?.key).toBeUndefined();
    expect(decoded.disclosures?.[0]?.value).toEqual(courseObj);

    const claims = await decoded.getClaims(async (data) =>
      createHash("sha256").update(data).digest()
    );
    expect(claims).toEqual({ courses: [courseObj] });
  });
});
