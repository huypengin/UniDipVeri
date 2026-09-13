import type { DegreeLevel } from "@/lib/api/programs";

export interface DegreeLevelOption {
  value: DegreeLevel;
  label: string;
  keywords: string[];
}

export const DEGREE_LEVEL_OPTIONS: DegreeLevelOption[] = [
  {
    value: "BACHELOR",
    label: "Bachelor (e.g. Bachelor of Science)",
    keywords: ["Bachelor"],
  },
  {
    value: "MASTER",
    label: "Master (e.g. Master of Science)",
    keywords: ["Master"],
  },
  {
    value: "DOCTORATE",
    label: "Doctorate / Ph.D. (e.g. Doctor of Philosophy, PhD)",
    keywords: ["Doctor", "PhD"],
  },
  {
    value: "ASSOCIATE",
    label: "Associate (e.g. Associate of Science)",
    keywords: ["Associate"],
  },
];

export function getDegreeLevelLabel(level: DegreeLevel | string): string {
  const option = DEGREE_LEVEL_OPTIONS.find((opt) => opt.value === level);
  return option?.label.split(" (")[0] ?? String(level);
}

export function validateTitleAgainstDegreeLevel(
  fullTitle: string,
  degreeLevel: DegreeLevel,
): string | null {
  if (!fullTitle || !fullTitle.trim()) {
    return "Program full title is required.";
  }

  const option = DEGREE_LEVEL_OPTIONS.find((opt) => opt.value === degreeLevel);
  if (!option) return "Invalid degree level.";

  const titleLower = fullTitle.toLowerCase();
  const matches = option.keywords.some((kw) =>
    titleLower.includes(kw.toLowerCase()),
  );

  if (!matches) {
    return `Full title must contain '${option.keywords.join("' or '")}' to match degree level ${degreeLevel} (FR-PROG-05).`;
  }

  return null;
}
