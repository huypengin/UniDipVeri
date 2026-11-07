import type { DiscoveredClaim } from "./discovery.js";

/**
 * Scenario preset pre-configuring claim paths for common verifier use cases.
 */
export interface ScenarioPreset {
  id: string;
  name: string;
  description: string;
  claimPaths: string[][];
}

/**
 * Default scenario presets matching the reference graduation-record.v1.yaml credential.
 */
export const DEFAULT_ACADEMIC_PRESETS: ScenarioPreset[] = [
  {
    id: "diploma",
    name: "Diploma Verification",
    description: "Verifies degree conferral, major, and graduation date for employment screening.",
    claimPaths: [
      ["dateOfBirth"],
      ["papers", "diploma", "degreeName"],
      ["papers", "diploma", "degreeType"],
      ["papers", "diploma", "programName"],
      ["papers", "diploma", "major"],
      ["papers", "diploma", "graduationDate"],
      ["papers", "diploma", "honours"],
    ],
  },
  {
    id: "transcript",
    name: "Transcript & GPA",
    description: "Verifies cumulative GPA and completed credits for academic admissions.",
    claimPaths: [
      ["dateOfBirth"],
      ["papers", "transcript", "transcriptId"],
      ["papers", "transcript", "cumulativeGPA"],
      ["papers", "transcript", "totalCredits"],
    ],
  },
  {
    id: "identity",
    name: "Student Identity",
    description: "Verifies student identifier and birth date for student pass or event ticketing.",
    claimPaths: [
      ["studentId"],
      ["fullName"],
      ["dateOfBirth"],
    ],
  },
  {
    id: "full",
    name: "Full Academic Record",
    description: "Requests all available disclosable claims in the credential for comprehensive audit.",
    claimPaths: [], // Dynamically populated by resolveScenarioPresets
  },
  {
    id: "custom",
    name: "Custom Selection",
    description: "Manually select individual field checkboxes or edit the raw DCQL JSON query directly.",
    claimPaths: [],
  },
];

/**
 * Filters a preset's candidate claim paths against the set of actively discovered claims.
 * If a field does not exist in the active schema, it is omitted so the DCQL query remains valid.
 */
export function filterPresetPaths(
  presetPaths: string[][],
  discoveredClaims: DiscoveredClaim[]
): string[][] {
  const discoveredKeySet = new Set(discoveredClaims.map((c) => c.pathKey));
  return presetPaths.filter((path) => discoveredKeySet.has(path.join(".")));
}

/**
 * Resolves scenario presets against discovered claims.
 * Populates 'full' with all discovered claim paths and filters other presets for schema resilience.
 */
export function resolveScenarioPresets(
  discoveredClaims: DiscoveredClaim[],
  basePresets: ScenarioPreset[] = DEFAULT_ACADEMIC_PRESETS
): ScenarioPreset[] {
  return basePresets.map((preset) => {
    if (preset.id === "full") {
      return {
        ...preset,
        claimPaths: discoveredClaims.map((c) => c.path.map(String)),
      };
    }
    if (preset.id === "custom") {
      return { ...preset, claimPaths: [] };
    }
    return {
      ...preset,
      claimPaths: filterPresetPaths(preset.claimPaths, discoveredClaims),
    };
  });
}
