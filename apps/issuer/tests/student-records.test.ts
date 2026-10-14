import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  StudentRecordService,
  PRELOADED_STUDENT_RECORDS,
  generateStudentRecord,
} from "../src/services/student-records.js";
import { loadSchemaFromFile, transformClaims } from "@unidipveri/core";

describe("Student Academic Records Repository", () => {
  const schemaPath = join(
    import.meta.dir,
    "../../../schemas/graduation-record.yaml"
  );

  it("retrieves preloaded honors graduate record with expected fields", () => {
    const service = new StudentRecordService();
    const record = service.getStudentRecord("STU-2026-FINAL");

    expect(record.studentId).toBe("STU-2026-FINAL");
    expect(record.fullName).toBe("Nguyen Van A");
    expect(record.papers.diploma.degreeName).toBe(
      "Bachelor of Science in Computer Science"
    );
    expect(record.papers.diploma.honours).toBe("Summa Cum Laude");
    expect(record.papers.transcript.cumulativeGPA).toBe(3.92);
    expect(record.papers.transcript.courses.length).toBeGreaterThan(0);
  });

  it("retrieves preloaded standard graduate record with expected fields", () => {
    const service = new StudentRecordService();
    const record = service.getStudentRecord("STU-2026-0002");

    expect(record.studentId).toBe("STU-2026-0002");
    expect(record.fullName).toBe("Tran Thi B");
    expect(record.papers.diploma.major).toBe("Information Technology");
    expect(record.papers.transcript.cumulativeGPA).toBe(3.25);
  });

  it("generates synthetic academic record for unregistered student identifier", () => {
    const service = new StudentRecordService();
    const record = service.getStudentRecord("STU-NEW-9999");

    expect(record.studentId).toBe("STU-NEW-9999");
    expect(record.fullName).toContain("STU-NEW-9999");
    expect(record.papers.diploma.degreeName).toBeDefined();
    expect(record.papers.transcript.cumulativeGPA).toBe(3.5);
  });

  it("registers and retrieves a custom student record", () => {
    const service = new StudentRecordService({});
    expect(service.hasStudentRecord("STU-CUSTOM-01")).toBe(false);

    const customRecord = generateStudentRecord("STU-CUSTOM-01");
    customRecord.fullName = "Le Van C";
    service.registerStudentRecord(customRecord);

    expect(service.hasStudentRecord("STU-CUSTOM-01")).toBe(true);
    const retrieved = service.getStudentRecord("STU-CUSTOM-01");
    expect(retrieved.fullName).toBe("Le Van C");
  });

  it("rejects registering a student record with missing or empty studentId", () => {
    const service = new StudentRecordService();
    expect(() => {
      service.registerStudentRecord({
        studentId: "",
        fullName: "No ID",
        papers: {} as any,
      });
    }).toThrow("valid non-empty studentId");
  });

  it("transforms all preloaded records successfully against graduation-record schema", async () => {
    const schemaConfig = await loadSchemaFromFile(schemaPath);
    for (const [id, record] of Object.entries(PRELOADED_STUDENT_RECORDS)) {
      const result = transformClaims(record, schemaConfig.claims);
      expect(result.disclosures.length).toBeGreaterThan(0);
      expect(result.maskedPayload.studentId).toBe(id);
      expect(result.maskedPayload.papers).toBeDefined();
    }
  });
});
