import QRCode from "qrcode";
import {
  type CredentialTypeConfig,
  type CsvRowValidationError,
  parseStudentBatchCsv,
} from "@unidipveri/core";
import {
  type IssuerConfig,
} from "../config.js";
import type { KeyContext } from "./key-manager.js";
import type { SessionManager } from "./session-manager.js";
import type { StatusListService } from "./status-list.js";
import { deriveCredentialConfigurationId } from "./claims-metadata.js";
import { createZipArchive, type ZipFileEntry } from "./zip-archive.js";
import { writeIssuerLog } from "./logger.js";

/**
 * Input options required to execute a batch credential issuance process.
 */
export interface BatchIssuanceOptions {
  /** Raw CSV content conforming to the credential schema */
  csvText: string;
  /** Validated credential schema specification */
  schemaConfig: CredentialTypeConfig;
  /** Issuer service configuration */
  config: IssuerConfig;
  /** Optional cryptographic key context (held for interactive OID4VCI exchange) */
  keyContext?: KeyContext;
  /** OID4VCI session manager for creating authorization codes */
  sessionManager: SessionManager;
  /** Optional revocation engine (status indices are allocated JIT on /credential) */
  statusListService?: StatusListService;
}

/**
 * Record representing an individual issued student credential within a batch.
 */
export interface BatchStudentRecordSummary {
  rowIndex: number;
  studentId: string;
  fullName: string;
  offerUri: string;
  preAuthorizedCode: string;
  status: "PENDING_CLAIM";
}

/**
 * Result of executing batch credential issuance.
 */
export interface BatchIssuanceResult {
  /** Total number of data rows evaluated */
  totalRows: number;
  /** Number of records successfully processed and packaged */
  validCount: number;
  /** Number of records rejected due to schema or format errors */
  invalidCount: number;
  /** Summary of valid records */
  validRecords: BatchStudentRecordSummary[];
  /** Detailed validation errors for invalid rows */
  invalidRecords: CsvRowValidationError[];
  /** Manifest object included in the archive */
  manifest: Record<string, unknown>;
  /** Complete in-memory ZIP package buffer */
  zipBuffer: Buffer;
}

/**
 * Helper to escape CSV cell values per RFC 4180.
 */
function escapeCsvCell(val: unknown): string {
  if (val === undefined || val === null) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Processes a batch CSV file of student academic records and produces an OID4VCI batch distribution ZIP archive:
 * 1. Wallet-bound OID4VCI Credential Offers with scannable QR code PNGs for student onboarding.
 * 2. An offers summary roster (offers.csv) for university mail merges and student record tracking.
 * 3. Batch manifest and telemetry log (manifest.json).
 *
 * @param options Batch issuance configuration and dependencies
 * @returns Structured BatchIssuanceResult containing the binary ZIP archive and telemetry
 */
export async function executeBatchIssuance(
  options: BatchIssuanceOptions
): Promise<BatchIssuanceResult> {
  const {
    csvText,
    schemaConfig,
    config,
    sessionManager,
  } = options;

  writeIssuerLog("[Batch Engine 🚀] Initiating batch CSV parsing and ingestion pipeline...");

  // 1. Ingest and validate CSV records against the active schema
  const parseResult = parseStudentBatchCsv(csvText, schemaConfig);

  writeIssuerLog(
    `[Batch Engine 📊] Parsed ${parseResult.totalRows} data rows: ${parseResult.validRecords.length} valid, ${parseResult.invalidRecords.length} invalid.`
  );

  const targetConfigId = deriveCredentialConfigurationId(schemaConfig.vctPath, schemaConfig.name);
  const statusListUri = `${config.baseUrl}/status/status-list-1`;

  const zipEntries: ZipFileEntry[] = [];
  const validRecordsSummary: BatchStudentRecordSummary[] = [];

  // CSV rows for offers.csv (status list indices are allocated Just-In-Time upon wallet redemption)
  const offersCsvRows: string[] = [
    "studentId,fullName,credentialOfferUri,preAuthorizedCode,status",
  ];

  // 2. Process valid student records
  for (const record of parseResult.validRecords) {
    const studentId = record.studentId;
    const fullName = String(record.claims.fullName || studentId);

    // 2a. Create OID4VCI pre-authorized code session (status list index will be allocated JIT upon wallet claim)
    const session = sessionManager.createPreAuthorizedCode({
      studentId,
      credentialConfigurationId: targetConfigId,
      claims: record.claims,
    });

    // 2b. Assemble OID4VCI Credential Offer structure
    const credentialOffer = {
      credential_issuer: config.baseUrl,
      credential_configuration_ids: [targetConfigId],
      credentials: [targetConfigId],
      grants: {
        "urn:ietf:params:oauth:grant-type:pre-authorized_code": {
          "pre-authorized_code": session.code,
        },
      },
    };

    const serializedOffer = JSON.stringify(credentialOffer);
    const offerUri = `openid-credential-offer://?credential_offer=${encodeURIComponent(
      serializedOffer
    )}`;

    // 2c. Render QR code PNG for student credential onboarding
    const qrPngBuffer = await QRCode.toBuffer(offerUri, {
      errorCorrectionLevel: "M",
      type: "png",
      margin: 2,
      width: 400,
    });

    zipEntries.push({
      name: `qr-codes/${studentId}_offer.png`,
      data: qrPngBuffer,
    });

    // Record for offers.csv
    offersCsvRows.push(
      [
        escapeCsvCell(studentId),
        escapeCsvCell(fullName),
        escapeCsvCell(offerUri),
        escapeCsvCell(session.code),
        "PENDING_CLAIM",
      ].join(",")
    );

    validRecordsSummary.push({
      rowIndex: record.rowIndex,
      studentId,
      fullName,
      offerUri,
      preAuthorizedCode: session.code,
      status: "PENDING_CLAIM",
    });
  }

  // 3. Assemble offers.csv
  zipEntries.push({
    name: "offers.csv",
    data: offersCsvRows.join("\n"),
  });

  // 4. Assemble manifest.json
  const manifest = {
    timestamp: new Date().toISOString(),
    vct: schemaConfig.vctPath,
    credentialName: schemaConfig.name,
    totalRows: parseResult.totalRows,
    validCount: parseResult.validRecords.length,
    invalidCount: parseResult.invalidRecords.length,
    claimMode: "JIT_ON_OID4VCI_EXCHANGE",
    statusListUri,
    errors: parseResult.invalidRecords,
  };

  zipEntries.push({
    name: "manifest.json",
    data: JSON.stringify(manifest, null, 2),
  });

  // 5. Build in-memory ZIP package
  const zipBuffer = createZipArchive(zipEntries);

  writeIssuerLog(
    `[Batch Engine ✅] Assembled ZIP package (${zipBuffer.length} bytes) containing ${zipEntries.length} files.`
  );

  return {
    totalRows: parseResult.totalRows,
    validCount: parseResult.validRecords.length,
    invalidCount: parseResult.invalidRecords.length,
    validRecords: validRecordsSummary,
    invalidRecords: parseResult.invalidRecords,
    manifest,
    zipBuffer,
  };
}
