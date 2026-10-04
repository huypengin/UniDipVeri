import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { parseSchemaYaml, loadSchemaFromFile } from "../src/schema/loader.js";

describe("Schema Loader & Validator", () => {
  it("parses valid YAML string into CredentialTypeConfig", () => {
    const yaml = `
vct: "https://example.com/v1"
name: "Test"
description: "Test description"
claims:
  testField:
    type: string
    required: true
    sd: always_disclosed
`;
    const config = parseSchemaYaml(yaml);
    expect(config.vct).toBe("https://example.com/v1");
    expect(config.name).toBe("Test");
    expect(config.claims.testField.type).toBe("string");
    expect(config.claims.testField.sd).toBe("always_disclosed");
  });

  it("throws validation error for invalid vct URL", () => {
    const yaml = `
vct: "not-a-url"
name: "Test"
description: "Test description"
claims:
  id:
    type: string
    sd: always_disclosed
`;
    expect(() => parseSchemaYaml(yaml)).toThrow(/vct must be a valid resolvable URL/);
  });

  it("throws validation error for top-level claim missing sd policy", () => {
    const yaml = `
vct: "https://example.com/v1"
name: "Test"
description: "Test description"
claims:
  id:
    type: string
`;
    expect(() => parseSchemaYaml(yaml)).toThrow(/Top-level claim .*id.* must explicitly define an 'sd' policy/);
  });

  it("throws validation error for nested child claim missing sd policy", () => {
    const yaml = `
vct: "https://example.com/v1"
name: "Test"
description: "Test description"
claims:
  diploma:
    type: object
    sd: always_disclosed
    properties:
      degreeName:
        type: string
`;
    expect(() => parseSchemaYaml(yaml)).toThrow(/Child claim .*degreeName.* must explicitly define an 'sd' policy/);
  });

  it("throws validation error for object claim missing properties", () => {
    const yaml = `
vct: "https://example.com/v1"
name: "Test"
description: "Test description"
claims:
  myObj:
    type: object
    sd: always_disclosed
`;
    expect(() => parseSchemaYaml(yaml)).toThrow(/Object claims must define a non-empty 'properties' object/);
  });

  it("throws validation error for array claim missing items", () => {
    const yaml = `
vct: "https://example.com/v1"
name: "Test"
description: "Test description"
claims:
  myList:
    type: array
    sd: selectively_disclosable
`;
    expect(() => parseSchemaYaml(yaml)).toThrow(/Array claims must define an 'items' schema/);
  });

  it("loads graduation-record schema from explicit file path without cwd dependency", async () => {
    const fixturePath = join(import.meta.dir, "fixtures/graduation-record.yaml");
    const config = await loadSchemaFromFile(fixturePath);

    expect(config.name).toBe("Graduation Academic Record");
    expect(config.vct).toBe("https://credentials.university.edu/types/graduation-record/v1");

    // Check root claims
    expect(config.claims.studentId.sd).toBe("always_disclosed");
    expect(config.claims.fullName.sd).toBe("always_disclosed");

    // Check nested container
    const papers = config.claims.papers;
    expect(papers.type).toBe("object");
    expect(papers.properties?.diploma.sd).toBe("selectively_disclosable");
    expect(papers.properties?.transcript.sd).toBe("selectively_disclosable");

    // Check deep nested field in diploma
    const diplomaProps = papers.properties?.diploma.properties;
    expect(diplomaProps?.degreeName.sd).toBe("always_disclosed");

    // Check array in transcript
    const transcriptProps = papers.properties?.transcript.properties;
    expect(transcriptProps?.cumulativeGPA.sd).toBe("selectively_disclosable");
    const courses = transcriptProps?.courses;
    expect(courses?.type).toBe("array");
    expect(courses?.items?.properties?.code.sd).toBe("always_disclosed");
    expect(courses?.items?.properties?.grade.sd).toBe("selectively_disclosable");
  });
});

describe("Declarative Schema Extensibility (Thesis Requirement)", () => {
  it("allows defining a completely novel credential type declaratively without modifying core code", () => {
    const novelSchemaYaml = `
vct: "https://credentials.university.edu/types/enrollment-certificate/v1"
name: "Certificate of Enrollment"
description: "Official attestation of active student enrollment status."
claims:
  studentId:
    type: string
    required: true
    sd: always_disclosed
  academicYear:
    type: string
    required: true
    sd: always_disclosed
  isFullTime:
    type: boolean
    required: true
    sd: selectively_disclosable
  enrolledCredits:
    type: number
    required: true
    sd: selectively_disclosable
  activeSemesters:
    type: array
    required: true
    sd: selectively_disclosable
    items:
      type: string
  advisor:
    type: object
    required: false
    sd: selectively_disclosable
    properties:
      name:
        type: string
        required: true
        sd: always_disclosed
      department:
        type: string
        required: true
        sd: always_disclosed
`;
    const config = parseSchemaYaml(novelSchemaYaml);
    expect(config.vct).toBe("https://credentials.university.edu/types/enrollment-certificate/v1");
    expect(config.name).toBe("Certificate of Enrollment");
    expect(config.claims.isFullTime.type).toBe("boolean");
    expect(config.claims.activeSemesters.items?.type).toBe("string");
    expect(config.claims.advisor.properties?.name.sd).toBe("always_disclosed");
  });

  it("allows modifying and extending credential fields declaratively without code changes", () => {
    const extendedGraduationYaml = `
vct: "https://credentials.university.edu/types/graduation-record/v2"
name: "Graduation Academic Record v2"
description: "Extended with co-curricular and scholastic honor distinctions."
claims:
  studentId:
    type: string
    required: true
    sd: always_disclosed
  coCurricularActivities:
    type: array
    required: false
    sd: selectively_disclosable
    items:
      type: object
      properties:
        activityName:
          type: string
          required: true
          sd: always_disclosed
        hoursCompleted:
          type: number
          required: true
          sd: selectively_disclosable
  latinHonors:
    type: string
    required: false
    sd: selectively_disclosable
`;
    const config = parseSchemaYaml(extendedGraduationYaml);
    expect(config.vct).toBe("https://credentials.university.edu/types/graduation-record/v2");
    expect(config.claims.coCurricularActivities.items?.properties?.hoursCompleted.sd).toBe(
      "selectively_disclosable"
    );
    expect(config.claims.latinHonors.type).toBe("string");
  });
});

describe("Semantic Safety & Engine Boundary Enforcement (Thesis Requirement)", () => {
  it("fails when an unrecognized semantic feature or directive is introduced in a claim", () => {
    const unsupportedFeatureYaml = `
vct: "https://credentials.university.edu/types/unsupported/v1"
name: "Unsupported Feature Attempt"
description: "Tries to invoke an engine feature that does not exist"
claims:
  grade:
    type: number
    sd: selectively_disclosable
    zkpPredicate: ">= 80" # Engine has no zero-knowledge proof compiler!
`;
    expect(() => parseSchemaYaml(unsupportedFeatureYaml)).toThrow(
      /Unrecognized semantic feature or directive in claim definition/
    );
  });

  it("fails when an unsupported SD policy is specified", () => {
    const unsupportedSdPolicyYaml = `
vct: "https://credentials.university.edu/types/unsupported/v1"
name: "Unsupported SD Policy Attempt"
description: "Tries to use a cryptographic policy the engine does not support"
claims:
  gpa:
    type: number
    sd: zero_knowledge_range_proof # Engine only supports 'always_disclosed' | 'selectively_disclosable'
`;
    expect(() => parseSchemaYaml(unsupportedSdPolicyYaml)).toThrow(/invalid_enum_value/);
  });

  it("fails when an unsupported data type outside the engine capability is specified", () => {
    const unsupportedTypeYaml = `
vct: "https://credentials.university.edu/types/unsupported/v1"
name: "Unsupported Type Attempt"
description: "Tries to declare a type the engine cannot merklize/disclose"
claims:
  customProof:
    type: zk_snark_proof # Not in supported primitives
    sd: selectively_disclosable
`;
    expect(() => parseSchemaYaml(unsupportedTypeYaml)).toThrow(/invalid_enum_value/);
  });

  it("fails when an unknown top-level engine directive is introduced", () => {
    const unknownTopLevelYaml = `
vct: "https://credentials.university.edu/types/unsupported/v1"
name: "Unknown Directive Attempt"
description: "Tries to set a top-level engine flag"
engineHook: "post_issuance_wasm_pipeline" # Unknown key
claims:
  id:
    type: string
    sd: always_disclosed
`;
    expect(() => parseSchemaYaml(unknownTopLevelYaml)).toThrow(
      /Unrecognized top-level configuration directive/
    );
  });
});
