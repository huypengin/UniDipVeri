import { describe, expect, it } from "bun:test";
import { resolveVct } from "../src/schema/vct.js";

describe("Canonical VCT Resolution (resolveVct)", () => {
  it("joins a path and base URL without trailing slash", () => {
    const resolved = resolveVct(
      "/types/graduation-record/v1",
      "https://issuer.university.edu"
    );
    expect(resolved).toBe(
      "https://issuer.university.edu/types/graduation-record/v1"
    );
  });

  it("joins a path and base URL with trailing slash correctly", () => {
    const resolved = resolveVct(
      "/types/graduation-record/v1",
      "https://issuer.university.edu/"
    );
    expect(resolved).toBe(
      "https://issuer.university.edu/types/graduation-record/v1"
    );
  });

  it("handles base URL with multiple trailing slashes", () => {
    const resolved = resolveVct(
      "/types/graduation-record/v1",
      "https://issuer.university.edu///"
    );
    expect(resolved).toBe(
      "https://issuer.university.edu/types/graduation-record/v1"
    );
  });

  it("handles local development HTTP base URLs with ports", () => {
    const resolved = resolveVct(
      "/types/graduation-record/v1",
      "http://localhost:3000"
    );
    expect(resolved).toBe(
      "http://localhost:3000/types/graduation-record/v1"
    );
  });

  it("rejects vctPath that does not start with leading slash", () => {
    expect(() =>
      resolveVct(
        "types/graduation-record/v1",
        "https://issuer.university.edu"
      )
    ).toThrow(/vctPath must be a non-empty string starting with '\/'/);
  });

  it("rejects non-string or empty vctPath", () => {
    expect(() =>
      resolveVct("", "https://issuer.university.edu")
    ).toThrow(/vctPath must be a non-empty string/);

    expect(() =>
      resolveVct(null as unknown as string, "https://issuer.university.edu")
    ).toThrow(/vctPath must be a non-empty string/);
  });

  it("rejects empty or whitespace-only vctBaseUrl", () => {
    expect(() =>
      resolveVct("/types/v1", "")
    ).toThrow(/vctBaseUrl must be a non-empty string/);

    expect(() =>
      resolveVct("/types/v1", "   ")
    ).toThrow(/vctBaseUrl must be a non-empty string/);
  });

  it("throws descriptive error when base URL is malformed and cannot form a valid URL", () => {
    expect(() =>
      resolveVct("/types/v1", "not-a-valid-url")
    ).toThrow(/Resolved VCT 'not-a-valid-url\/types\/v1' is not a valid URL/);
  });
});
