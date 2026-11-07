import { describe, expect, it } from "bun:test";
import { buildDcqlQuery, validateDcqlQuery } from "../src/dcql.js";

describe("Playground DCQL Query Builder & Validator", () => {
  it("constructs compliant DCQL query with format dc+sd-jwt and valid UUID query identifier", () => {
    const targetVct = "https://issuer.edu/types/degree/v1";
    const paths = [
      ["dateOfBirth"],
      ["papers", "diploma", "degreeName"],
    ];

    const query = buildDcqlQuery(targetVct, paths);
    expect(query).toHaveProperty("credentials");
    const creds = (query as any).credentials;
    expect(Array.isArray(creds)).toBe(true);
    expect(creds).toHaveLength(1);

    const firstCred = creds[0];
    expect(firstCred.format).toBe("dc+sd-jwt");
    expect(firstCred.meta?.vct_values).toEqual([targetVct]);
    expect(firstCred.claims).toEqual([
      { path: ["dateOfBirth"] },
      { path: ["papers", "diploma", "degreeName"] },
    ]);

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(firstCred.id).toMatch(uuidRegex);
  });

  it("preserves explicit query identifier when provided", () => {
    const customId = "550e8400-e29b-41d4-a716-446655440000";
    const query = buildDcqlQuery("https://vct.example.com", [["studentId"]], customId);
    expect((query as any).credentials[0].id).toBe(customId);
  });

  it("validates compliant DCQL query and normalizes credentials identifier", () => {
    const validQuery = {
      credentials: [
        {
          id: "custom-id",
          format: "dc+sd-jwt",
          meta: {
            vct_values: ["https://issuer.example.com/types/graduation-record/v1"],
          },
          claims: [
            { path: ["studentId"] },
            { path: ["papers", "diploma", "degreeName"] },
          ],
        },
      ],
    };

    const res = validateDcqlQuery(validQuery);
    expect(res.valid).toBe(true);
    expect(res.vct).toBe("https://issuer.example.com/types/graduation-record/v1");
    expect(res.claimPaths).toEqual([
      ["studentId"],
      ["papers", "diploma", "degreeName"],
    ]);
    expect(res.normalizedQuery).toBeDefined();

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const normCred = (res.normalizedQuery as any).credentials[0];
    expect(normCred.id).toMatch(uuidRegex);
  });

  it("rejects malformed DCQL query structures with informative error descriptions", () => {
    expect(validateDcqlQuery(null).valid).toBe(false);
    expect(validateDcqlQuery([]).valid).toBe(false);
    expect(validateDcqlQuery({ credentials: [] }).valid).toBe(false);

    expect(
      validateDcqlQuery({
        credentials: [{ format: "mso_mdoc" }],
      }).error
    ).toContain("dc+sd-jwt");

    expect(
      validateDcqlQuery({
        credentials: [{ format: "dc+sd-jwt" }],
      }).error
    ).toContain("meta.vct_values");

    expect(
      validateDcqlQuery({
        credentials: [
          {
            format: "dc+sd-jwt",
            meta: { vct_values: [] },
          },
        ],
      }).error
    ).toContain("at least one VCT");

    expect(
      validateDcqlQuery({
        credentials: [
          {
            format: "dc+sd-jwt",
            meta: { vct_values: ["https://vct.example.com"] },
            claims: [{ path: "not-an-array" }],
          },
        ],
      }).error
    ).toContain("path");
  });
});
