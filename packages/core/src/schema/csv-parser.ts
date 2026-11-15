import type { CredentialTypeConfig, ClaimDef } from "./types.js";

/**
 * Result of parsing a single student record from CSV.
 */
export interface ParsedStudentRecord {
  /** 1-based data row index in the CSV (excluding header row) */
  rowIndex: number;
  /** Primary student identifier */
  studentId: string;
  /** Full validated claims object matching CredentialTypeConfig */
  claims: Record<string, unknown>;
}

/**
 * Validation error for an invalid CSV row.
 */
export interface CsvRowValidationError {
  /** 1-based data row index in the CSV (excluding header row) */
  rowIndex: number;
  /** Extracted student identifier if available */
  studentId?: string;
  /** Field path where the error occurred */
  field?: string;
  /** Detailed error message */
  message: string;
}

/**
 * Result of batch CSV ingestion.
 */
export interface BatchCsvParseResult {
  /** Records that passed all schema validation checks */
  validRecords: ParsedStudentRecord[];
  /** Records that failed schema validation with descriptive errors */
  invalidRecords: CsvRowValidationError[];
  /** Total number of data rows processed */
  totalRows: number;
}

/**
 * Parses raw RFC 4180 compliant CSV text into an array of string arrays.
 * Handles quoted fields with embedded commas, newlines, and escaped quotes.
 *
 * @param csvText Raw CSV string
 * @returns Array of row arrays
 */
export function parseCsv(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;
  let i = 0;

  const len = csvText.length;
  while (i < len) {
    const char = csvText[i];

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote ("")
        if (i + 1 < len && csvText[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === ",") {
        currentRow.push(currentField);
        currentField = "";
        i++;
        continue;
      } else if (char === "\r") {
        if (i + 1 < len && csvText[i + 1] === "\n") {
          i++; // Consume \r\n
        }
        currentRow.push(currentField);
        currentField = "";
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else if (char === "\n") {
        currentRow.push(currentField);
        currentField = "";
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  // Push final field/row if content remains
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  // Filter out any trailing completely empty rows
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim().length > 0));
}

/**
 * Expands a flat object with dot-notation keys into a deeply nested JavaScript object.
 *
 * Example:
 *   { "papers.diploma.degreeName": "B.S." } -> { papers: { diploma: { degreeName: "B.S." } } }
 *
 * @param flat Flat key-value record
 * @returns Deeply nested object
 */
export function expandDotNotation(flat: Record<string, unknown>): Record<string, unknown> {
  const root: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(flat)) {
    if (!key.includes(".")) {
      root[key] = value;
      continue;
    }

    const segments = key.split(".");
    let current = root;

    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      if (current[seg] === undefined || typeof current[seg] !== "object" || current[seg] === null) {
        current[seg] = {};
      }
      current = current[seg] as Record<string, unknown>;
    }

    current[segments[segments.length - 1]] = value;
  }

  return root;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates and coerces a single value according to a ClaimDef definition.
 *
 * @param val Raw input value
 * @param def Claim definition schema
 * @param currentPath Path label for error reporting
 * @param errors Array to collect validation error messages
 * @returns Coerced value, or undefined if optional and empty
 */
function coerceAndValidateField(
  val: unknown,
  def: ClaimDef,
  currentPath: string,
  errors: string[]
): unknown {
  // Check empty / absent values
  const isAbsent =
    val === undefined ||
    val === null ||
    (typeof val === "string" && val.trim().length === 0);

  if (isAbsent) {
    if (def.required) {
      errors.push(`Missing required claim: "${currentPath}"`);
    }
    return undefined;
  }

  if (def.type === "string") {
    const strVal = String(val).trim();
    if (def.format === "date") {
      if (!DATE_REGEX.test(strVal)) {
        errors.push(`Field "${currentPath}" must be a date in YYYY-MM-DD format (received "${strVal}")`);
      }
    }
    return strVal;
  }

  if (def.type === "number") {
    if (typeof val === "number") {
      if (isNaN(val)) {
        errors.push(`Field "${currentPath}" must be a valid number`);
        return undefined;
      }
      return val;
    }
    const num = Number(String(val).trim());
    if (isNaN(num)) {
      errors.push(`Field "${currentPath}" must be a valid number (received "${String(val)}")`);
      return undefined;
    }
    return num;
  }

  if (def.type === "boolean") {
    if (typeof val === "boolean") {
      return val;
    }
    const lower = String(val).trim().toLowerCase();
    if (lower === "true" || lower === "1") {
      return true;
    }
    if (lower === "false" || lower === "0") {
      return false;
    }
    errors.push(`Field "${currentPath}" must be a boolean (received "${String(val)}")`);
    return undefined;
  }

  if (def.type === "object") {
    if (typeof val !== "object" || Array.isArray(val) || val === null) {
      errors.push(`Field "${currentPath}" must be an object`);
      return undefined;
    }
    const objVal = val as Record<string, unknown>;
    const coercedObj: Record<string, unknown> = {};

    if (def.properties) {
      for (const [propName, propDef] of Object.entries(def.properties)) {
        const childPath = `${currentPath}.${propName}`;
        const childCoerced = coerceAndValidateField(
          objVal[propName],
          propDef,
          childPath,
          errors
        );
        if (childCoerced !== undefined) {
          coercedObj[propName] = childCoerced;
        }
      }
    }
    return coercedObj;
  }

  if (def.type === "array") {
    let arrVal: unknown = val;

    // Parse embedded JSON array string if provided as string
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (trimmed.startsWith("[")) {
        try {
          arrVal = JSON.parse(trimmed);
        } catch (err) {
          errors.push(
            `Failed to parse JSON array in field "${currentPath}": ${
              err instanceof Error ? err.message : String(err)
            }`
          );
          return undefined;
        }
      } else {
        errors.push(`Field "${currentPath}" must be a valid JSON array string starting with "["`);
        return undefined;
      }
    }

    if (!Array.isArray(arrVal)) {
      errors.push(`Field "${currentPath}" must be an array`);
      return undefined;
    }

    if (def.items) {
      const itemDef = def.items;
      const coercedArray: unknown[] = [];

      for (let idx = 0; idx < arrVal.length; idx++) {
        const itemPath = `${currentPath}[${idx}]`;
        const coercedItem = coerceAndValidateField(
          arrVal[idx],
          itemDef,
          itemPath,
          errors
        );
        coercedArray.push(coercedItem);
      }
      return coercedArray;
    }

    return arrVal;
  }

  return val;
}

/**
 * Validates and coerces an expanded student record against a credential schema configuration.
 *
 * @param expandedClaims Raw expanded student claims object
 * @param schemaConfig Validated CredentialTypeConfig
 * @returns Coerced valid claims object, or validation errors
 */
export function validateAndCoerceClaims(
  expandedClaims: Record<string, unknown>,
  schemaConfig: CredentialTypeConfig
): { valid: true; claims: Record<string, unknown> } | { valid: false; errors: string[] } {
  const errors: string[] = [];
  const coerced: Record<string, unknown> = {};

  for (const [claimName, claimDef] of Object.entries(schemaConfig.claims)) {
    const coercedVal = coerceAndValidateField(
      expandedClaims[claimName],
      claimDef,
      claimName,
      errors
    );
    if (coercedVal !== undefined) {
      coerced[claimName] = coercedVal;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, claims: coerced };
}

/**
 * Parses and validates an entire CSV batch file representing student records
 * against a credential type schema configuration.
 *
 * Requirements:
 * - Parses RFC 4180 compliant CSV (handling quotes, newlines, commas inside JSON).
 * - Expands dot-notation headers (e.g. papers.diploma.degreeName) into nested objects.
 * - Deserializes embedded JSON arrays in array columns (e.g. papers.transcript.courses).
 * - Coerces numbers, booleans, and dates based on schema types.
 * - Enforces required claims and type safety.
 *
 * @param csvText Raw CSV content string
 * @param schemaConfig Validated credential schema configuration
 * @returns Structured BatchCsvParseResult
 */
export function parseStudentBatchCsv(
  csvText: string,
  schemaConfig: CredentialTypeConfig
): BatchCsvParseResult {
  const rows = parseCsv(csvText);

  if (rows.length === 0) {
    return {
      validRecords: [],
      invalidRecords: [],
      totalRows: 0,
    };
  }

  const rawHeaders = rows[0].map((h) => h.trim());
  const dataRows = rows.slice(1);

  const validRecords: ParsedStudentRecord[] = [];
  const invalidRecords: CsvRowValidationError[] = [];

  for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
    const row = dataRows[rowIndex];
    const displayRowIndex = rowIndex + 1; // 1-based data row index

    // Build flat row object
    const flatRecord: Record<string, unknown> = {};
    for (let colIdx = 0; colIdx < rawHeaders.length; colIdx++) {
      const header = rawHeaders[colIdx];
      if (header.length > 0) {
        flatRecord[header] = colIdx < row.length ? row[colIdx] : "";
      }
    }

    // Attempt to extract studentId for error reporting context
    const studentIdCandidate =
      typeof flatRecord.studentId === "string" && flatRecord.studentId.trim().length > 0
        ? flatRecord.studentId.trim()
        : undefined;

    // Expand dot notation
    const expanded = expandDotNotation(flatRecord);

    // Validate and coerce against schema
    const validationResult = validateAndCoerceClaims(expanded, schemaConfig);

    if (validationResult.valid) {
      const studentId = String(validationResult.claims.studentId || "");
      validRecords.push({
        rowIndex: displayRowIndex,
        studentId,
        claims: validationResult.claims,
      });
    } else {
      for (const err of validationResult.errors) {
        invalidRecords.push({
          rowIndex: displayRowIndex,
          studentId: studentIdCandidate,
          message: err,
        });
      }
    }
  }

  return {
    validRecords,
    invalidRecords,
    totalRows: dataRows.length,
  };
}
