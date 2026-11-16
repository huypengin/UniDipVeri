import type { CredentialTypeConfig } from "@unidipveri/core";
import type { IssuerConfig } from "../config.js";
import type { KeyContext } from "../services/key-manager.js";
import type { SessionManager } from "../services/session-manager.js";
import type { StatusListService } from "../services/status-list.js";
import { executeBatchIssuance } from "../services/batch-issuer.js";

/**
 * Service dependencies required to handle batch issuance requests.
 */
export interface BatchRouteDependencies {
  config: IssuerConfig;
  keyContext: KeyContext;
  schemaConfig: CredentialTypeConfig;
  sessionManager: SessionManager;
  statusListService: StatusListService;
}

/**
 * Escapes characters for safe HTML inclusion.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Generates a valid sample CSV string for the active credential schema.
 */
function generateSampleCsv(schemaConfig: CredentialTypeConfig): string {
  const isDefaultGraduation = schemaConfig.vctPath.includes("graduation-record");

  if (isDefaultGraduation) {
    return [
      "studentId,fullName,dateOfBirth,nationalId,papers.diploma.degreeName,papers.diploma.degreeType,papers.diploma.programName,papers.diploma.major,papers.diploma.minor,papers.diploma.graduationDate,papers.diploma.honours,papers.transcript.transcriptId,papers.transcript.cumulativeGPA,papers.transcript.totalCredits,papers.transcript.courses",
      'ITIU22001001,Nguyen Van An,2004-05-12,079040001234,Bachelor of Science in Computer Science,Bachelor of Science,Computer Science and Engineering,Computer Science,Data Science,2026-06-30,First Class Honours,TR-2026-01001,3.85,136,"[{""code"":""CS101"",""title"":""Introduction to Computing"",""credits"":3,""grade"":92.0,""letterGrade"":""A+""},{""code"":""CS102"",""title"":""Object-Oriented Programming"",""credits"":4,""grade"":88.0,""letterGrade"":""A""}]"',
      'EEIU22001002,Tran Thi Binh,2004-08-20,079040005678,Bachelor of Science in Electrical Engineering,Bachelor of Science,Electrical and Electronics Engineering,Electrical Engineering,,2026-06-30,Second Class Honours (Upper),TR-2026-01002,3.65,130,"[{""code"":""EE101"",""title"":""Circuits and Analysis"",""credits"":4,""grade"":85.0,""letterGrade"":""A""}]"',
      'BAIU22001003,Le Hoang Cuong,2004-01-15,079040009012,Bachelor of Business Administration in Finance,Bachelor of Business Administration,School of Business,Finance and Banking,Financial Analytics,2026-06-30,,TR-2026-01003,3.45,132,"[{""code"":""BA101"",""title"":""Principles of Management"",""credits"":3,""grade"":82.0,""letterGrade"":""B+""}]"',
    ].join("\n");
  }

  // Fallback for minimal fixture schema
  return [
    "studentId,fullName,papers.diploma.degreeName,papers.diploma.graduationDate,papers.transcript.cumulativeGPA,papers.transcript.courses",
    'ITIU22001001,Nguyen Van An,B.S. in Computer Science,2026-06-30,3.85,"[{""code"":""CS101"",""grade"":92.0}]"',
    'ITIU22001002,Tran Thi Binh,B.S. in Computer Science,2026-06-30,3.65,"[{""code"":""CS101"",""grade"":85.0}]"',
  ].join("\n");
}

/**
 * Renders the University Registrar Batch Issuance HTML page.
 * Uses the exact same design tokens, navbar branding, typography, and card palette as the Interactive Portal.
 */
function renderBatchHtml(config: IssuerConfig, schemaConfig: CredentialTypeConfig): string {
  const sampleCsvEscaped = escapeHtml(generateSampleCsv(schemaConfig));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>UniDipVeri &mdash; Batch Academic Credential Issuance</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="${config.baseUrl}/style.css">
</head>
<body>
  <header class="navbar">
    <div class="nav-brand">
      <svg viewBox="0 0 24 24"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/></svg>
      <div>
        <div class="brand-title">UniDipVeri Registrar Portal</div>
        <div class="brand-sub">${escapeHtml(schemaConfig.name)} &bull; OID4VCI 1.0 Final</div>
      </div>
    </div>
    <nav class="nav-links">
      <a href="${config.baseUrl}/interactive-issue">Interactive Issuance</a>
      <a href="${config.baseUrl}/batch-issue" class="active">Batch Issuance</a>
      <a href="${config.baseUrl}/docs" target="_blank">Swagger API</a>
      <a href="${config.baseUrl}/.well-known/openid-credential-issuer" target="_blank">OID4VCI Discovery</a>
      <a href="${config.baseUrl}/.well-known/did.json" target="_blank">DID Document</a>
      <span class="nav-badge">dc+sd-jwt</span>
    </nav>
  </header>

  <main class="container">
    <div class="hero-banner">
      <h1>Batch Academic Credential Issuance Pipeline</h1>
      <p>Bulk ingestion for university SIS/ERP records conforming to <code>${escapeHtml(schemaConfig.name)}</code> (${escapeHtml(schemaConfig.vctPath)})</p>
    </div>

    <div class="dual-output-banner">
      <div class="dual-output-icon">&#128161;</div>
      <div>
        <div class="dual-output-title">OID4VCI Bulk Distribution Architecture</div>
        <div class="dual-output-desc">
          The batch engine generates <strong>scannable OID4VCI Credential Offers (QR codes)</strong> for student digital wallets (Walt.id, Sphereon, Paradym), an <strong>offers roster (offers.csv)</strong> for registrar distribution and mail merges, and an audit manifest (manifest.json), bundled into a ready-to-distribute ZIP package.
        </div>
      </div>
    </div>

    <!-- Presets & Actions Toolbar -->
    <div class="preset-bar">
      <span class="preset-label">Quick Actions:</span>
      <button type="button" class="preset-btn" onclick="loadSampleCsv()">&#128203; Load Sample CSV</button>
      <a href="${config.baseUrl}/batch-issue?sample=csv" download="sample_graduation_batch.csv" class="preset-btn">&#11015; Download CSV Template</a>
      <button type="button" class="preset-btn preset-btn-clear" onclick="clearCsv()">&#128465; Clear Editor</button>
    </div>

    <section class="card">
      <div class="card-title">
        <span>University CSV Data Source</span>
        <span style="font-size: 0.75rem; font-weight: normal; color: var(--text-muted); font-family: var(--font-mono);">
          RFC 4180 &bull; Dot-Notation &bull; JSON Course Arrays
        </span>
      </div>

      <form id="batchForm" onsubmit="handleBatchSubmit(event)">
        <div class="dropzone" id="dropzone" onclick="document.getElementById('fileInput').click()">
          <div class="dropzone-icon">&#128196;</div>
          <div class="dropzone-title">Click to upload or drag and drop university CSV export</div>
          <div class="dropzone-desc">Supports standard RFC 4180 CSV with dot-notation headers and JSON course arrays</div>
          <input type="file" id="fileInput" accept=".csv,text/csv" style="display: none;" onchange="handleFileSelected(event)">
          <button type="button" class="preset-btn" onclick="event.stopPropagation(); document.getElementById('fileInput').click()">Select CSV File</button>
        </div>

        <label for="csvEditor" class="form-label">
          CSV Data Editor / Direct Ingestion:
        </label>
        <textarea id="csvEditor" name="csv" class="csv-editor" placeholder="Paste or edit RFC 4180 CSV records here..."></textarea>

        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
          <div id="fileStatus" style="font-size: 0.85rem; color: var(--text-muted);">No file selected</div>
          <button type="submit" class="btn-submit" id="processBtn">
            <span>&#9881; Process Batch &amp; Generate ZIP Package</span>
          </button>
        </div>
      </form>

      <div class="output-card" id="outputCard">
        <div class="output-header">
          <div style="font-weight: 700; font-size: 1rem; color: #1e293b;" id="outputTitle">Batch Execution Complete</div>
          <div id="outputBadge"></div>
        </div>
        <div id="outputMessage" style="font-size: 0.875rem; margin-bottom: 14px; color: var(--text-muted); line-height: 1.5;"></div>
        <div>
          <a id="downloadZipLink" class="open-wallet-btn" style="display: none;">&#11015; Download Batch Package (ZIP)</a>
        </div>
      </div>
    </section>
  </main>

  <footer>
    UniDipVeri Standalone SD-JWT VC Credential Engine &bull; Conforming to RFC 9901 and draft-ietf-oauth-sd-jwt-vc-19
  </footer>

  <script>
    const sampleCsvData = ${JSON.stringify(sampleCsvEscaped)};

    function loadSampleCsv() {
      const editor = document.getElementById('csvEditor');
      editor.value = sampleCsvData;
      document.getElementById('fileStatus').textContent = 'Loaded sample template with 3 student records';
    }

    function clearCsv() {
      document.getElementById('csvEditor').value = '';
      document.getElementById('fileStatus').textContent = 'Editor cleared';
      document.getElementById('outputCard').classList.remove('show');
    }

    function handleFileSelected(event) {
      const file = event.target.files[0];
      if (!file) return;
      document.getElementById('fileStatus').textContent = 'Loaded: ' + file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';
      const reader = new FileReader();
      reader.onload = function(e) {
        document.getElementById('csvEditor').value = e.target.result;
      };
      reader.readAsText(file);
    }

    // Drag and drop handlers
    const dropzone = document.getElementById('dropzone');
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];
        document.getElementById('fileStatus').textContent = 'Loaded: ' + file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';
        const reader = new FileReader();
        reader.onload = (ev) => { document.getElementById('csvEditor').value = ev.target.result; };
        reader.readAsText(file);
      }
    });

    async function handleBatchSubmit(event) {
      event.preventDefault();
      const csvText = document.getElementById('csvEditor').value.trim();
      if (!csvText) {
        alert('Please select a CSV file or enter CSV data in the editor.');
        return;
      }

      const processBtn = document.getElementById('processBtn');
      processBtn.disabled = true;
      processBtn.innerHTML = '<span>&#9203; Processing batch...</span>';

      try {
        const response = await fetch('${config.baseUrl}/batch-issue', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ csvText })
        });

        const result = await response.json();
        const outputCard = document.getElementById('outputCard');
        outputCard.classList.add('show');

        if (response.ok && result.success) {
          document.getElementById('outputTitle').textContent = 'Batch Processed Successfully';
          document.getElementById('outputBadge').innerHTML = '<span class="badge-sd">' + result.validCount + ' Offers Generated</span>';
          document.getElementById('outputMessage').textContent = 'Processed ' + result.totalRows + ' rows (' + result.validCount + ' valid, ' + result.invalidCount + ' invalid). Generated OID4VCI credential offers with Just-In-Time status list allocation. ZIP package assembled with wallet offers, offers roster (offers.csv), and manifest.';

          const downloadBtn = document.getElementById('downloadZipLink');
          downloadBtn.href = 'data:application/zip;base64,' + result.zipBase64;
          downloadBtn.download = result.filename || 'graduation_batch.zip';
          downloadBtn.style.display = 'inline-flex';
        } else {
          document.getElementById('outputTitle').textContent = 'Batch Processing Error';
          document.getElementById('outputBadge').innerHTML = '<span class="badge-danger">Failed</span>';
          document.getElementById('outputMessage').textContent = result.error_description || result.message || 'An error occurred during batch processing';
          document.getElementById('downloadZipLink').style.display = 'none';
        }
      } catch (err) {
        alert('Batch submission failed: ' + err.message);
      } finally {
        processBtn.disabled = false;
        processBtn.innerHTML = '<span>&#9881; Process Batch &amp; Generate ZIP Package</span>';
      }
    }
  </script>
</body>
</html>`;
}

/**
 * Handles GET and POST requests for /batch-issue.
 *
 * Provides:
 * - GET /batch-issue: Renders the interactive Registrar Batch Issuance HTML page.
 * - GET /batch-issue?sample=csv: Returns a downloadable CSV template.
 * - POST /batch-issue: Ingests CSV records and returns either direct application/zip or JSON with base64 ZIP.
 *
 * @param req Incoming HTTP Request
 * @param deps Batch route dependencies
 * @returns HTTP Response
 */
export async function handleBatchRequest(
  req: Request,
  deps: BatchRouteDependencies
): Promise<Response> {
  const { config, keyContext, schemaConfig, sessionManager, statusListService } = deps;
  const url = new URL(req.url);

  // 1. Handle GET requests
  if (req.method === "GET") {
    // Check if requesting sample CSV template
    if (url.searchParams.get("sample") === "csv") {
      const sampleCsv = generateSampleCsv(schemaConfig);
      return new Response(sampleCsv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="sample_graduation_batch.csv"',
          "Cache-Control": "no-cache",
        },
      });
    }

    // Render HTML page
    const html = renderBatchHtml(config, schemaConfig);
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  }

  // 2. Handle POST requests
  if (req.method === "POST") {
    let csvText = "";
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      try {
        const body = (await req.json()) as Record<string, unknown>;
        if (typeof body.csvText === "string") {
          csvText = body.csvText;
        } else if (typeof body.csv === "string") {
          csvText = body.csv;
        }
      } catch {
        return Response.json(
          {
            error: "invalid_request",
            error_description: "Failed to parse JSON request body",
          },
          { status: 400 }
        );
      }
    } else if (contentType.includes("multipart/form-data")) {
      try {
        const formData = await req.formData();
        const fileEntry = formData.get("file") || formData.get("csv");
        if (fileEntry instanceof File) {
          csvText = await fileEntry.text();
        } else if (typeof fileEntry === "string") {
          csvText = fileEntry;
        }
      } catch {
        return Response.json(
          {
            error: "invalid_request",
            error_description: "Failed to parse multipart form data",
          },
          { status: 400 }
        );
      }
    } else if (contentType.includes("text/csv")) {
      csvText = await req.text();
    } else {
      csvText = await req.text();
    }

    if (!csvText || csvText.trim().length === 0) {
      return Response.json(
        {
          error: "invalid_request",
          error_description: "Missing CSV payload in request body",
        },
        { status: 400 }
      );
    }

    try {
      const batchResult = await executeBatchIssuance({
        csvText,
        schemaConfig,
        config,
        keyContext,
        sessionManager,
        statusListService,
      });

      const acceptHeader = req.headers.get("accept") || "";
      const isJsonRequested =
        url.searchParams.get("format") === "json" ||
        (acceptHeader.includes("application/json") && !acceptHeader.includes("application/zip"));

      const timestampStr = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `graduation-batch-${timestampStr}.zip`;

      if (isJsonRequested) {
        return Response.json(
          {
            success: true,
            totalRows: batchResult.totalRows,
            validCount: batchResult.validCount,
            invalidCount: batchResult.invalidCount,
            claimMode: batchResult.manifest.claimMode,
            errors: batchResult.invalidRecords,
            filename,
            zipBase64: batchResult.zipBuffer.toString("base64"),
          },
          {
            status: 200,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
            },
          }
        );
      }

      // Stream binary application/zip response
      return new Response(batchResult.zipBuffer, {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": String(batchResult.zipBuffer.length),
          "X-Batch-Total": String(batchResult.totalRows),
          "X-Batch-Valid": String(batchResult.validCount),
          "X-Batch-Invalid": String(batchResult.invalidCount),
          "Cache-Control": "no-store",
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json(
        {
          error: "server_error",
          error_description: `Batch issuance pipeline failed: ${message}`,
        },
        { status: 500 }
      );
    }
  }

  return Response.json(
    {
      error: "invalid_request",
      error_description: `Method ${req.method} not allowed on /batch-issue`,
    },
    { status: 405 }
  );
}
