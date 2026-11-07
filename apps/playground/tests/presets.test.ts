import { describe, expect, it } from "bun:test";
import {
  DEFAULT_ACADEMIC_PRESETS,
  filterPresetPaths,
  resolveScenarioPresets,
} from "../src/presets.js";
import type { DiscoveredClaim } from "../src/discovery.js";

describe("Playground Scenario Presets & Policy Templates", () => {
  const sampleDiscoveredClaims: DiscoveredClaim[] = [
    {
      path: ["studentId"],
      pathKey: "studentId",
      label: "Student ID",
      category: "Personal Identity",
      sdPolicy: "always_disclosed",
      mandatory: true,
    },
    {
      path: ["fullName"],
      pathKey: "fullName",
      label: "Full Name",
      category: "Personal Identity",
      sdPolicy: "always_disclosed",
      mandatory: true,
    },
    {
      path: ["dateOfBirth"],
      pathKey: "dateOfBirth",
      label: "Date Of Birth",
      category: "Personal Identity",
      sdPolicy: "selectively_disclosable",
      mandatory: false,
    },
    {
      path: ["papers", "diploma", "degreeName"],
      pathKey: "papers.diploma.degreeName",
      label: "Degree Name",
      category: "Diploma Conferral",
      sdPolicy: "always_disclosed",
      mandatory: true,
    },
    {
      path: ["papers", "diploma", "major"],
      pathKey: "papers.diploma.major",
      label: "Major",
      category: "Diploma Conferral",
      sdPolicy: "selectively_disclosable",
      mandatory: true,
    },
  ];

  it("exports standard academic verification presets with non-empty metadata", () => {
    expect(DEFAULT_ACADEMIC_PRESETS.length).toBeGreaterThanOrEqual(5);

    const ids = DEFAULT_ACADEMIC_PRESETS.map((p) => p.id);
    expect(ids).toContain("diploma");
    expect(ids).toContain("transcript");
    expect(ids).toContain("identity");
    expect(ids).toContain("full");
    expect(ids).toContain("custom");

    for (const preset of DEFAULT_ACADEMIC_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(Array.isArray(preset.claimPaths)).toBe(true);
    }
  });

  it("filters candidate preset paths against discovered claims for schema resilience", () => {
    const candidatePresetPaths = [
      ["papers", "diploma", "degreeName"],
      ["papers", "diploma", "major"],
      ["papers", "diploma", "nonExistentField"],
      ["papers", "diploma", "honours"],
    ];

    const filtered = filterPresetPaths(candidatePresetPaths, sampleDiscoveredClaims);
    expect(filtered).toHaveLength(2);
    expect(filtered).toEqual([
      ["papers", "diploma", "degreeName"],
      ["papers", "diploma", "major"],
    ]);
  });

  it("resolves presets dynamically by adapting full preset and filtering candidate fields", () => {
    const resolved = resolveScenarioPresets(sampleDiscoveredClaims);

    expect(resolved.length).toBe(DEFAULT_ACADEMIC_PRESETS.length);

    // Verify 'full' preset is dynamically populated with all discovered claim paths
    const fullPreset = resolved.find((p) => p.id === "full");
    expect(fullPreset).toBeDefined();
    expect(fullPreset?.claimPaths).toHaveLength(sampleDiscoveredClaims.length);
    expect(fullPreset?.claimPaths).toEqual(
      sampleDiscoveredClaims.map((c) => c.path.map(String))
    );

    // Verify 'custom' preset preserves an empty selection
    const customPreset = resolved.find((p) => p.id === "custom");
    expect(customPreset).toBeDefined();
    expect(customPreset?.claimPaths).toEqual([]);

    // Verify 'diploma' preset excludes honours and other missing fields
    const diplomaPreset = resolved.find((p) => p.id === "diploma");
    expect(diplomaPreset).toBeDefined();
    expect(diplomaPreset?.claimPaths).toEqual([
      ["dateOfBirth"],
      ["papers", "diploma", "degreeName"],
      ["papers", "diploma", "major"],
    ]);
  });
});
