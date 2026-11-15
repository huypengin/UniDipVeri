import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  parseCsv,
  expandDotNotation,
  validateAndCoerceClaims,
  parseStudentBatchCsv,
} from "../src/schema/csv-parser.js";
import { loadSchemaFromFile } from "../src/schema/loader.js";
import type { CredentialTypeConfig } from "../src/schema/types.js";

const graduationSchemaPath = join(
  import.meta.dir,
  "../../../schemas/graduation-record.v1.yaml"
);

describe("CSV Batch Ingestion Engine", () => {
  describe("RFC 4180 CSV Parsing (parseCsv)", () => {
    it("parses simple comma-delimited rows without quotes", () => {
      const csv = "col1,col2,col3\nval1,val2,val3\nval4,val5,val6";
      const rows = parseCsv(csv);
      expect(rows).toEqual([
        ["col1", "col2", "col3"],
        ["val1", "val2", "val3"],
        ["val4", "val5", "val6"],
      ]);
    });

    it("parses fields containing embedded commas within double quotes", () => {
      const csv = 'studentId,fullName,honours\nIT001,"Nguyen, Van A","First Class, Honours"';
      const rows = parseCsv(csv);
      expect(rows).toEqual([
        ["studentId", "fullName", "honours"],
        ["IT001", "Nguyen, Van A", "First Class, Honours"],
      ]);
    });

    it("handles escaped double quotes within quoted fields", () => {
      const csv = 'id,payload\n1,"[{""code"":""CS101"",""title"":""Intro""}]"';
      const rows = parseCsv(csv);
      expect(rows).toEqual([
        ["id", "payload"],
        ["1", '[{"code":"CS101","title":"Intro"}]'],
      ]);
    });

    it("handles multi-line quoted fields and CRLF line endings", () => {
      const csv = "id,notes\r\n1,\"Line 1\r\nLine 2\"\r\n2,\"Simple\"";
      const rows = parseCsv(csv);
      expect(rows).toEqual([
        ["id", "notes"],
        ["1", "Line 1\r\nLine 2"],
        ["2", "Simple"],
      ]);
    });

    it("ignores empty trailing rows gracefully", () => {
      const csv = "a,b\n1,2\n\n   \n";
      const rows = parseCsv(csv);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toEqual(["1", "2"]);
    });
  });

  describe("Dot-Notation Header Expansion (expandDotNotation)", () => {
    it("expands single-level and multi-level dotted keys into nested objects", () => {
      const flat = {
        studentId: "STU-001",
        "papers.diploma.degreeName": "B.S. in Computer Science",
        "papers.diploma.graduationDate": "2026-06-30",
        "papers.transcript.cumulativeGPA": 3.85,
      };

      const nested = expandDotNotation(flat);
      expect(nested).toEqual({
        studentId: "STU-001",
        papers: {
          diploma: {
            degreeName: "B.S. in Computer Science",
            graduationDate: "2026-06-30",
          },
          transcript: {
            cumulativeGPA: 3.85,
          },
        },
      });
    });

    it("preserves flat keys that do not contain dots", () => {
      const flat = { a: 1, b: "hello", c: true };
      const nested = expandDotNotation(flat);
      expect(nested).toEqual(flat);
    });
  });

  describe("Schema Validation & Coercion (validateAndCoerceClaims)", () => {
    const miniSchema: CredentialTypeConfig = {
      vctPath: "/types/test/v1",
      name: "Test Schema",
      description: "Test Schema for validation unit tests",
      claims: {
        id: { type: "string", required: true, sd: "always_disclosed" },
        gpa: { type: "number", required: false, sd: "selectively_disclosable" },
        gradDate: {
          type: "string",
          format: "date",
          required: true,
          sd: "always_disclosed",
        },
        isActive: { type: "boolean", required: false, sd: "always_disclosed" },
        courses: {
          type: "array",
          required: true,
          sd: "selectively_disclosable",
          items: {
            type: "object",
            properties: {
              code: { type: "string", required: true, sd: "always_disclosed" },
              credits: { type: "number", required: true, sd: "always_disclosed" },
              grade: { type: "number", required: true, sd: "selectively_disclosable" },
            },
          },
        },
      },
    };

    it("coerces string numbers and embedded JSON arrays into typed claims", () => {
      const raw = {
        id: "STU-100",
        gpa: "3.92",
        gradDate: "2026-06-30",
        isActive: "true",
        courses: '[{"code":"CS101","credits":"3","grade":"88.5"}]',
      };

      const result = validateAndCoerceClaims(raw, miniSchema);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.claims.id).toBe("STU-100");
        expect(result.claims.gpa).toBe(3.92);
        expect(result.claims.gradDate).toBe("2026-06-30");
        expect(result.claims.isActive).toBe(true);
        expect(result.claims.courses).toEqual([
          { code: "CS101", credits: 3, grade: 88.5 },
        ]);
      }
    });

    it("omits empty optional string fields cleanly", () => {
      const raw = {
        id: "STU-101",
        gpa: "",
        gradDate: "2026-06-30",
        courses: "[]",
      };

      const result = validateAndCoerceClaims(raw, miniSchema);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.claims.id).toBe("STU-101");
        expect(result.claims.gpa).toBeUndefined();
      }
    });

    it("records descriptive errors when required claims are missing", () => {
      const raw = {
        gpa: "3.5",
        gradDate: "2026-06-30",
        courses: "[]",
      };

      const result = validateAndCoerceClaims(raw, miniSchema);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('Missing required claim: "id"');
      }
    });

    it("rejects invalid date format strings", () => {
      const raw = {
        id: "STU-102",
        gradDate: "30-06-2026", // Invalid format (not YYYY-MM-DD)
        courses: "[]",
      };

      const result = validateAndCoerceClaims(raw, miniSchema);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes("must be a date in YYYY-MM-DD format"))).toBe(true);
      }
    });

    it("rejects non-numeric values for numeric fields", () => {
      const raw = {
        id: "STU-103",
        gpa: "excellent", // Not a valid number
        gradDate: "2026-06-30",
        courses: "[]",
      };

      const result = validateAndCoerceClaims(raw, miniSchema);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('Field "gpa" must be a valid number'))).toBe(true);
      }
    });

    it("rejects malformed JSON strings in array claims", () => {
      const raw = {
        id: "STU-104",
        gradDate: "2026-06-30",
        courses: '[{ invalid json string',
      };

      const result = validateAndCoerceClaims(raw, miniSchema);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('Failed to parse JSON array in field "courses"'))).toBe(true);
      }
    });
  });

  describe("End-to-End Batch CSV Ingestion (parseStudentBatchCsv)", () => {
    it("handles an empty CSV string with zero records", async () => {
      const schema = await loadSchemaFromFile(graduationSchemaPath);
      const result = parseStudentBatchCsv("", schema);
      expect(result.totalRows).toBe(0);
      expect(result.validRecords).toHaveLength(0);
      expect(result.invalidRecords).toHaveLength(0);
    });

    it("correctly ingests a multi-row graduation CSV batch conforming to graduation schema", async () => {
      const schema = await loadSchemaFromFile(graduationSchemaPath);
      const csvInput = [
        "studentId,fullName,dateOfBirth,nationalId,papers.diploma.degreeName,papers.diploma.degreeType,papers.diploma.programName,papers.diploma.major,papers.diploma.minor,papers.diploma.graduationDate,papers.diploma.honours,papers.transcript.transcriptId,papers.transcript.cumulativeGPA,papers.transcript.totalCredits,papers.transcript.courses",
        'ITIU22001001,Nguyen Van A,2004-05-12,079040001234,Bachelor of Science in Computer Science,Bachelor of Science,Computer Science and Engineering,Computer Science,Data Science,2026-06-30,First Class Honours,TR-2026-01001,3.85,136,"[{""code"":""CS101"",""title"":""Intro"",""credits"":3,""grade"":92.0,""letterGrade"":""A+""},{""code"":""CS102"",""title"":""OOP"",""credits"":4,""grade"":88.0,""letterGrade"":""A""}]"',
        'EEIU22001002,Tran Thi B,2004-08-20,079040005678,Bachelor of Science in Electrical Engineering,Bachelor of Science,Electrical and Electronics Engineering,Electrical Engineering,,2026-06-30,,TR-2026-01002,3.65,130,"[{""code"":""EE101"",""title"":""Circuits"",""credits"":4,""grade"":85.0,""letterGrade"":""A""}]"',
      ].join("\n");

      const result = parseStudentBatchCsv(csvInput, schema);

      expect(result.totalRows).toBe(2);
      expect(result.validRecords).toHaveLength(2);
      expect(result.invalidRecords).toHaveLength(0);

      // Verify structure of first record
      const first = result.validRecords[0];
      expect(first.rowIndex).toBe(1);
      expect(first.studentId).toBe("ITIU22001001");
      expect(first.claims.fullName).toBe("Nguyen Van A");
      expect(first.claims.dateOfBirth).toBe("2004-05-12");

      const papers = first.claims.papers as Record<string, unknown>;
      expect(papers).toBeDefined();

      const diploma = papers.diploma as Record<string, unknown>;
      expect(diploma.degreeName).toBe("Bachelor of Science in Computer Science");
      expect(diploma.degreeType).toBe("Bachelor of Science");
      expect(diploma.programName).toBe("Computer Science and Engineering");
      expect(diploma.major).toBe("Computer Science");
      expect(diploma.graduationDate).toBe("2026-06-30");

      const transcript = papers.transcript as Record<string, unknown>;
      expect(transcript.transcriptId).toBe("TR-2026-01001");
      expect(transcript.cumulativeGPA).toBe(3.85);
      expect(transcript.totalCredits).toBe(136);

      const courses = transcript.courses as Array<Record<string, unknown>>;
      expect(Array.isArray(courses)).toBe(true);
      expect(courses.length).toBe(2);
      expect(courses[0].code).toBe("CS101");
      expect(courses[0].credits).toBe(3);
      expect(courses[0].grade).toBe(92.0);
      expect(courses[0].letterGrade).toBe("A+");
    });

    it("correctly ingests records conforming to an alternative schema structure", async () => {
      const fixtureSchemaPath = join(
        import.meta.dir,
        "fixtures/graduation-record.yaml"
      );
      const schema = await loadSchemaFromFile(fixtureSchemaPath);

      const csvInput = [
        "studentId,fullName,papers.diploma.degreeName,papers.diploma.graduationDate,papers.transcript.cumulativeGPA,papers.transcript.courses",
        'ITIU22001003,Le Van C,B.S. Computer Science,2026-06-30,3.7,"[{""code"":""CS101"",""grade"":89.5}]"',
      ].join("\n");

      const result = parseStudentBatchCsv(csvInput, schema);

      expect(result.totalRows).toBe(1);
      expect(result.validRecords).toHaveLength(1);
      expect(result.invalidRecords).toHaveLength(0);

      const first = result.validRecords[0];
      expect(first.studentId).toBe("ITIU22001003");
      expect(first.claims.fullName).toBe("Le Van C");

      const papers = first.claims.papers as Record<string, unknown>;
      const diploma = papers.diploma as Record<string, unknown>;
      expect(diploma.degreeName).toBe("B.S. Computer Science");
      expect(diploma.graduationDate).toBe("2026-06-30");

      const transcript = papers.transcript as Record<string, unknown>;
      expect(transcript.cumulativeGPA).toBe(3.7);

      const courses = transcript.courses as Array<Record<string, unknown>>;
      expect(Array.isArray(courses)).toBe(true);
      expect(courses.length).toBe(1);
      expect(courses[0].code).toBe("CS101");
      expect(courses[0].grade).toBe(89.5);
      expect(courses[0].credits).toBeUndefined();
    });

    it("segregates valid and invalid rows with row numbers and specific error messages", async () => {
      const schema = await loadSchemaFromFile(graduationSchemaPath);

      const testCsv = [
        "studentId,fullName,dateOfBirth,nationalId,papers.diploma.degreeName,papers.diploma.degreeType,papers.diploma.programName,papers.diploma.major,papers.diploma.minor,papers.diploma.graduationDate,papers.diploma.honours,papers.transcript.transcriptId,papers.transcript.cumulativeGPA,papers.transcript.totalCredits,papers.transcript.courses",
        // Valid row 1
        'STU-VALID-1,Alice Student,2003-01-15,079011111,B.S. CS,B.S.,CS,CS,,2026-06-30,Honours,TR-001,3.9,136,"[{""code"":""CS101"",""title"":""Intro"",""credits"":3,""grade"":90}]"',
        // Invalid row 2: Missing required papers.diploma.major
        'STU-INVALID-2,Bob Student,2003-02-15,079022222,B.S. CS,B.S.,CS,,,2026-06-30,,TR-002,3.5,130,"[{""code"":""CS101"",""title"":""Intro"",""credits"":3,""grade"":85}]"',
        // Valid row 3
        'STU-VALID-3,Carol Student,2003-03-15,079033333,B.S. CS,B.S.,CS,CS,,2026-06-30,,TR-003,3.7,135,"[{""code"":""CS101"",""title"":""Intro"",""credits"":3,""grade"":88}]"',
        // Invalid row 4: Invalid graduation date format
        'STU-INVALID-4,David Student,2003-04-15,079044444,B.S. CS,B.S.,CS,CS,,June 30 2026,,TR-004,3.2,132,"[]"',
      ].join("\n");

      const result = parseStudentBatchCsv(testCsv, schema);

      expect(result.totalRows).toBe(4);
      expect(result.validRecords).toHaveLength(2);
      expect(result.validRecords.map((r) => r.studentId)).toEqual([
        "STU-VALID-1",
        "STU-VALID-3",
      ]);

      expect(result.invalidRecords.length).toBeGreaterThanOrEqual(2);
      const row2Errors = result.invalidRecords.filter((e) => e.rowIndex === 2);
      expect(row2Errors.some((e) => e.message.includes('Missing required claim: "papers.diploma.major"'))).toBe(true);
      expect(row2Errors[0].studentId).toBe("STU-INVALID-2");

      const row4Errors = result.invalidRecords.filter((e) => e.rowIndex === 4);
      expect(row4Errors.some((e) => e.message.includes("must be a date in YYYY-MM-DD format"))).toBe(true);
      expect(row4Errors[0].studentId).toBe("STU-INVALID-4");
    });
  });
});
