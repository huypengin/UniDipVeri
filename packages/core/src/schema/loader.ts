import { parse } from "yaml";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { CredentialTypeConfig } from "./types.js";
import { validateCredentialConfig } from "./validator.js";

/**
 * Parses and validates a credential schema from raw YAML string content.
 * Pure function: no filesystem or environment dependencies.
 */
export function parseSchemaYaml(yamlContent: string): CredentialTypeConfig {
  if (!yamlContent || typeof yamlContent !== "string") {
    throw new Error("YAML schema content must be a non-empty string");
  }

  let parsed: unknown;
  try {
    parsed = parse(yamlContent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse YAML syntax: ${message}`);
  }

  return validateCredentialConfig(parsed);
}

/**
 * Loads and validates a credential schema from an explicitly specified file path.
 * 
 * Architectural Rule:
 * The caller must supply the explicit path. This loader does NOT attempt to guess
 * repository roots or traverse relative monorepo directories.
 */
export async function loadSchemaFromFile(filePath: string): Promise<CredentialTypeConfig> {
  if (!filePath) {
    throw new Error("filePath must be an explicit, non-empty string");
  }

  const resolvedPath = isAbsolute(filePath) ? filePath : resolve(filePath);

  let content: string;
  try {
    content = await readFile(resolvedPath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read schema file at "${resolvedPath}": ${message}`);
  }

  return parseSchemaYaml(content);
}
