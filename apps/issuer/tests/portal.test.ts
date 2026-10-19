import { describe, expect, it } from "bun:test";
import type { CredentialTypeConfig } from "@unidipveri/core";
import { loadSchemaFromFile } from "@unidipveri/core";
import { join } from "node:path";
import { loadIssuerConfig } from "../src/config.js";
import {
  formatClaimLabel,
  handlePortalRequest,
  renderPortalHtml,
  renderSchemaFormFields,
} from "../src/routes/portal.js";

const SCHEMA_PATH = join(
  import.meta.dir,
  "../../../schemas/graduation-record.v1.yaml"
);
const graduationSchema = await loadSchemaFromFile(SCHEMA_PATH);

const testConfig = loadIssuerConfig({
  SCHEMA_PATH,
  ISSUER_BASE_URL: "https://issuer.university.edu",
  ISSUER_DID: "did:web:issuer.university.edu",
});

describe("Interactive Registrar Portal Dynamic Schema Rendering", () => {
  it("renders dynamic form controls for all root and nested claims in the schema", () => {
    const html = renderPortalHtml(testConfig, graduationSchema);

    // Root scalar claims
    expect(html).toContain('data-claim-path="studentId"');
    expect(html).toContain('data-claim-path="fullName"');
    expect(html).toContain('data-claim-path="dateOfBirth"');
    expect(html).toContain('data-claim-path="nationalId"');

    // Nested object claims
    expect(html).toContain('data-object-path="papers"');
    expect(html).toContain('data-object-path="papers.diploma"');
    expect(html).toContain('data-claim-path="papers.diploma.degreeName"');
    expect(html).toContain('data-claim-path="papers.diploma.degreeType"');
    expect(html).toContain('data-claim-path="papers.diploma.programName"');
    expect(html).toContain('data-claim-path="papers.diploma.major"');
    expect(html).toContain('data-claim-path="papers.diploma.graduationDate"');

    // Nested transcript claims
    expect(html).toContain('data-object-path="papers.transcript"');
    expect(html).toContain('data-claim-path="papers.transcript.transcriptId"');
    expect(html).toContain('data-claim-path="papers.transcript.cumulativeGPA"');
    expect(html).toContain('data-claim-path="papers.transcript.totalCredits"');
    expect(html).toContain("Cumulative GPA");
    expect(html).not.toContain("Cumulative G P A");
    expect(html).toContain("Transcript ID");
    expect(html).not.toContain("Transcript I D");

    // Nested array claims
    expect(html).toContain('data-array-container="true"');
    expect(html).toContain('data-array-path="papers.transcript.courses"');
    expect(html).toContain('data-array-item-prop="code"');
    expect(html).toContain('data-array-item-prop="title"');
    expect(html).toContain('data-array-item-prop="credits"');
    expect(html).toContain('data-array-item-prop="grade"');
    expect(html).toContain('data-array-item-prop="letterGrade"');
  });

  it("renders accurate selective disclosure policy badges for each claim", () => {
    const html = renderPortalHtml(testConfig, graduationSchema);

    // Verify presence of both badge types
    expect(html).toContain('class="badge-sd"');
    expect(html).toContain('class="badge-plain"');
    expect(html).toContain("Selectively Disclosable");
    expect(html).toContain("Always Disclosed");

    // Diploma is selectively disclosable, while degreeName inside is always disclosed
    expect(html).toContain('data-object-path="papers.diploma"');
  });

  it("dynamically adapts to an arbitrary credential schema without hardcoding", () => {
    const customEmploymentSchema: CredentialTypeConfig = {
      vctPath: "/types/employment-credential/v1",
      name: "Employment Credential",
      description: "Official institutional employment verification.",
      claims: {
        employeeId: {
          type: "string",
          required: true,
          sd: "always_disclosed",
          description: "Internal employee identification code",
        },
        department: {
          type: "string",
          required: true,
          sd: "always_disclosed",
          description: "Assigned department or faculty",
        },
        annualSalary: {
          type: "number",
          required: false,
          sd: "selectively_disclosable",
          description: "Annual compensation in USD",
        },
        isTenured: {
          type: "boolean",
          required: true,
          sd: "selectively_disclosable",
          description: "Faculty tenure status",
        },
        competencies: {
          type: "array",
          required: false,
          sd: "selectively_disclosable",
          description: "Certified skill competencies",
          items: {
            type: "object",
            properties: {
              skillName: {
                type: "string",
                required: true,
                sd: "always_disclosed",
              },
              proficiencyLevel: {
                type: "string",
                required: true,
                sd: "selectively_disclosable",
              },
            },
          },
        },
      },
    };

    const html = renderPortalHtml(testConfig, customEmploymentSchema);

    // Verifies custom schema properties are rendered dynamically
    expect(html).toContain("Employment Credential");
    expect(html).toContain("/types/employment-credential/v1");
    expect(html).toContain('data-claim-path="employeeId"');
    expect(html).toContain('data-claim-path="department"');
    expect(html).toContain('data-claim-path="annualSalary"');
    expect(html).toContain('data-claim-path="isTenured"');
    expect(html).toContain('data-claim-type="boolean"');
    expect(html).toContain('data-array-path="competencies"');
    expect(html).toContain('data-array-item-prop="skillName"');
    expect(html).toContain('data-array-item-prop="proficiencyLevel"');

    // Confirms no academic graduation claims leaked into this custom render
    expect(html).not.toContain('data-claim-path="studentId"');
    expect(html).not.toContain('data-object-path="papers.diploma"');
  });

  it("renders pure schema form fields via renderSchemaFormFields", () => {
    const fieldsHtml = renderSchemaFormFields({
      licenseNumber: {
        type: "string",
        required: true,
        sd: "always_disclosed",
        description: "Official license number",
      },
    });

    expect(fieldsHtml).toContain('data-claim-path="licenseNumber"');
    expect(fieldsHtml).toContain("License Number");
    expect(fieldsHtml).toContain("Official license number");
    expect(fieldsHtml).toContain("Always Disclosed");
  });

  it("handles HTTP GET and HEAD requests returning valid HTML", async () => {
    const reqGet = new Request("https://issuer.university.edu/", {
      method: "GET",
    });
    const resGet = handlePortalRequest(reqGet, testConfig, graduationSchema);
    expect(resGet.status).toBe(200);
    expect(resGet.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    const body = await resGet.text();
    expect(body).toContain("UniDipVeri Registrar Portal");

    const reqHead = new Request("https://issuer.university.edu/issue", {
      method: "HEAD",
    });
    const resHead = handlePortalRequest(reqHead, testConfig, graduationSchema);
    expect(resHead.status).toBe(200);
    expect(resHead.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    const headBody = await resHead.text();
    expect(headBody).toBe("");
  });

  it("rejects non-GET/HEAD HTTP methods with 405 Method Not Allowed", async () => {
    const reqPost = new Request("https://issuer.university.edu/", {
      method: "POST",
    });
    const resPost = handlePortalRequest(reqPost, testConfig, graduationSchema);
    expect(resPost.status).toBe(405);
    expect(resPost.headers.get("Allow")).toBe("GET, HEAD");
    const data = (await resPost.json()) as { error: string };
    expect(data.error).toBe("invalid_request");
  });

  it("formats claim labels cleanly separating letters and numbers", () => {
    expect(formatClaimLabel("gradeIn4.0")).toBe("Grade In 4.0");
    expect(formatClaimLabel("gradeIn10.0")).toBe("Grade In 10.0");
    expect(formatClaimLabel("gradeIn100.0")).toBe("Grade In 100.0");
    expect(formatClaimLabel("course1")).toBe("Course 1");
    expect(formatClaimLabel("level2Course")).toBe("Level 2 Course");
    expect(formatClaimLabel("iso3166Code")).toBe("Iso 3166 Code");
    expect(formatClaimLabel("studentId")).toBe("Student ID");
    expect(formatClaimLabel("cumulativeGPA")).toBe("Cumulative GPA");
  });
});
