import type { CredentialTypeConfig } from "@unidipveri/core";
import type { IssuerConfig } from "../config.js";
import type { StatusListService } from "../services/status-list.js";

/**
 * Dependencies required for the HTML revocation handler.
 */
export interface RevocationRouteOptions {
  config: IssuerConfig;
  schemaConfig: CredentialTypeConfig;
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
 * Renders the dedicated HTML Revocation Management Console.
 */
export function renderRevocationHtml(
  config: IssuerConfig,
  schemaConfig: CredentialTypeConfig,
  statusListService: StatusListService
): string {
  const entries = statusListService.getAllEntries();
  const totalAllocated = statusListService.allocatedCount;
  const revokedCount = entries.filter((e) => statusListService.isRevoked(e.index)).length;
  const activeCount = totalAllocated - revokedCount;

  const registryRowsHtml =
    entries.length === 0
      ? `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">No credentials have been issued or allocated yet. Issue a credential via Single or Batch Issuance first.</td></tr>`
      : entries
          .map((entry) => {
            const isRevoked = statusListService.isRevoked(entry.index);
            const statusBadge = isRevoked
              ? `<span class="badge-status-revoked">REVOKED</span>`
              : `<span class="badge-status-active">ACTIVE</span>`;
            const studentIdDisplay = entry.studentId
              ? `<code>${escapeHtml(entry.studentId)}</code>`
              : `<span style="color: var(--text-muted);">&mdash;</span>`;
            const degreeDisplay = entry.metadata?.degreeName
              ? escapeHtml(String(entry.metadata.degreeName))
              : `<span style="color: var(--text-muted);">&mdash;</span>`;
            const allocatedDate = entry.allocatedAt
              ? new Date(entry.allocatedAt).toLocaleDateString()
              : "&mdash;";

            const actionBtn = isRevoked
              ? `<button type="button" class="btn-secondary" style="font-size: 0.75rem; padding: 4px 10px;" onclick="loadRecordIntoViewer('${escapeHtml(entry.studentId || String(entry.index))}', ${entry.index}, true)">View Details</button>`
              : `<button type="button" class="btn-danger" style="font-size: 0.75rem; padding: 4px 10px;" onclick="promptRevoke(${entry.index}, '${escapeHtml(entry.studentId || "")}')">Revoke</button>`;

            return `
              <tr data-record-row="${entry.index}">
                <td><code>#${entry.index}</code></td>
                <td>${studentIdDisplay}</td>
                <td>${degreeDisplay}</td>
                <td>${statusBadge}</td>
                <td><span style="font-size: 0.8rem; color: var(--text-secondary);">${allocatedDate}</span></td>
                <td>${actionBtn}</td>
              </tr>
            `;
          })
          .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>UniDipVeri &mdash; Credential Revocation Console</title>
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
        <div class="brand-title">UniDipVeri Issuer Portal</div>
        <div class="brand-sub">${escapeHtml(schemaConfig.name)} &bull; OID4VCI 1.0 Final</div>
      </div>
    </div>
    <nav class="nav-links">
      <a href="${config.baseUrl}/single-issue">Single Issue</a>
      <a href="${config.baseUrl}/batch-issue">Batch Issue</a>
      <a href="${config.baseUrl}/revocation" class="active">Revocation</a>
      <a href="${config.baseUrl}/docs" target="_blank">API Docs</a>
      <a href="${config.baseUrl}/.well-known/openid-credential-issuer" target="_blank">OID4VCI Discovery</a>
      <a href="${config.baseUrl}/.well-known/did.json" target="_blank">DID Document</a>
      <span class="nav-badge">dc+sd-jwt</span>
    </nav>
  </header>

  <main class="container">
    <div class="hero-banner">
      <h1>Credential Status &amp; Revocation Console</h1>
      <p>${escapeHtml(schemaConfig.description)} &bull; Type: <code>${escapeHtml(schemaConfig.vctPath)}</code> &bull; Status List: <code>status-list-1</code></p>
    </div>

    <!-- Telemetry Stats Cards -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; margin-bottom: 28px;">
      <div class="card" style="margin-bottom: 0; padding: 20px;">
        <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Total Allocated Bits</div>
        <div style="font-size: 1.85rem; font-weight: 700; color: var(--text); margin-top: 4px;" id="statTotal">${totalAllocated}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">Just-In-Time Bit Allocations</div>
      </div>
      <div class="card" style="margin-bottom: 0; padding: 20px;">
        <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Active Credentials</div>
        <div style="font-size: 1.85rem; font-weight: 700; color: var(--status-success); margin-top: 4px;" id="statActive">${activeCount}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">Status Bit: 0 (Valid — Not Revoked)</div>
      </div>
      <div class="card" style="margin-bottom: 0; padding: 20px;">
        <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Revoked Credentials</div>
        <div style="font-size: 1.85rem; font-weight: 700; color: var(--status-revoked); margin-top: 4px;" id="statRevoked">${revokedCount}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">Status Bit: 1 (Revoked)</div>
      </div>
    </div>

    <!-- Quick Actions Toolbar -->
    <div class="preset-bar">
      <span class="preset-label">Status Tools:</span>
      <a href="${config.baseUrl}/status/status-list-1" target="_blank" class="preset-btn">&#128269; View Raw Status List Token (JWT)</a>
      <a href="${config.baseUrl}/admin/registry" target="_blank" class="preset-btn">&#128203; View Registry JSON API</a>
      <button type="button" class="preset-btn preset-btn-clear" onclick="window.location.reload()">&#8635; Refresh Records</button>
    </div>

    <div class="portal-grid">
      <!-- Registry Data Table Card -->
      <section class="card">
        <div class="card-title">
          <span>Allocated Credential Status Registry</span>
          <span style="font-size: 0.75rem; font-weight: normal; color: var(--text-muted); font-family: var(--font-mono);" id="registryCount">
            ${entries.length} tracked records
          </span>
        </div>

        <div class="table-responsive">
          <table class="registry-table" id="registryTable">
            <thead>
              <tr>
                <th style="width: 80px;">Bit Index</th>
                <th>Student ID</th>
                <th>Degree / Program</th>
                <th style="width: 120px;">Status</th>
                <th>Allocated Date</th>
                <th style="width: 130px;">Action</th>
              </tr>
            </thead>
            <tbody id="registryTbody">
              ${registryRowsHtml}
            </tbody>
          </table>
        </div>
      </section>

      <!-- Search & Inspection Section -->
      <section class="card">
        <div class="card-title">
          <span>Search &amp; Inspect Credential</span>
          <span style="font-size: 0.75rem; font-weight: normal; color: var(--text-muted); font-family: var(--font-mono);">
            Lookup by Student ID or Bit Index
          </span>
        </div>

        <form id="searchForm" onsubmit="handleSearch(event)">
          <div class="form-group" style="margin-bottom: 16px;">
            <label for="searchQuery" class="form-label">Student ID or Status Bit Index</label>
            <div style="display: flex; gap: 10px; margin-top: 6px;">
              <input type="text" id="searchQuery" name="query" class="form-input" placeholder="e.g. ITIU22001001 or 0" required autofocus>
              <button type="submit" class="btn-submit" style="margin-top: 0; white-space: nowrap; padding: 9px 18px;" id="searchBtn">
                <span>Check Status</span>
              </button>
            </div>
            <div class="field-desc" style="margin-top: 6px;">Accepts student identifiers (e.g. <code>ITIU22001001</code>) or numeric bit positions.</div>
          </div>
        </form>

        <div id="statusViewerCard" style="margin-top: 20px; border: 1px solid var(--border); border-radius: 10px; padding: 20px; background: #f8fafc; display: none;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 10px;">
            <div>
              <div style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;">Credential Record</div>
              <div style="font-size: 1.25rem; font-weight: 700; color: #0f172a; margin-top: 2px;" id="viewerTargetId">&mdash;</div>
            </div>
            <div id="viewerBadgeContainer"></div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 16px;">
            <div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">Status List Index</div>
              <div style="font-family: var(--font-mono); font-size: 0.9rem; font-weight: 600; color: #0f172a; margin-top: 2px;" id="viewerIndex">&mdash;</div>
            </div>
            <div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">Allocated Timestamp</div>
              <div style="font-size: 0.85rem; font-weight: 500; color: #0f172a; margin-top: 2px;" id="viewerAllocated">&mdash;</div>
            </div>
            <div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">Revocation Timestamp</div>
              <div style="font-size: 0.85rem; font-weight: 500; color: #0f172a; margin-top: 2px;" id="viewerRevoked">&mdash;</div>
            </div>
          </div>

          <div id="viewerDegreeSection" style="margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border); display: none;">
            <div style="font-size: 0.75rem; color: var(--text-muted);">Degree / Program</div>
            <div style="font-size: 0.9rem; font-weight: 600; color: #0f172a; margin-top: 2px;" id="viewerDegree">&mdash;</div>
          </div>

          <div style="margin-top: 20px; display: flex; gap: 10px; align-items: center;" id="viewerActionContainer">
            <button type="button" class="btn-danger" id="viewerRevokeBtn" onclick="executeCurrentRevocation()">
              Revoke Credential
            </button>
            <span style="font-size: 0.75rem; color: var(--text-muted);">Immediately sets bit to 1 in Token Status List.</span>
          </div>
        </div>

        <div id="searchPlaceholder" style="margin-top: 20px; padding: 28px; text-align: center; border: 1px dashed var(--border); border-radius: 10px; color: var(--text-muted); font-size: 0.875rem;">
          Enter a Student ID or Status List Index above.
        </div>
      </section>
    </div>
  </main>

  <footer>
    UniDipVeri Standalone SD-JWT Academic Credential System &bull; ${config.baseUrl} &bull; OpenID4VCI 1.0 Final &bull; draft-ietf-oauth-sd-jwt-vc-19
  </footer>

  <script>
    let currentSelectedTarget = null;
    let currentSelectedIndex = null;

    async function handleSearch(e) {
      if (e) e.preventDefault();
      const input = document.getElementById('searchQuery');
      const query = input.value.trim();
      if (!query) return;

      const searchBtn = document.getElementById('searchBtn');
      searchBtn.disabled = true;
      searchBtn.innerText = 'Searching...';

      try {
        const isNumeric = /^\\d+$/.test(query);
        const endpoint = isNumeric
          ? '${config.baseUrl}/admin/status/' + query
          : '${config.baseUrl}/admin/status/student/' + encodeURIComponent(query);

        const res = await fetch(endpoint);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error_description || data.error || 'Record not found');
        }

        if (isNumeric) {
          renderViewerSingle(data);
        } else {
          // Student ID query returns { studentId, totalCredentials, credentials: [...] }
          if (data.credentials && data.credentials.length > 0) {
            const first = data.credentials[0];
            renderViewerSingle({
              studentId: data.studentId,
              idx: first.index,
              revoked: first.revoked,
              allocatedAt: first.allocatedAt,
              revokedAt: first.revokedAt,
              metadata: first.metadata
            });
          } else {
            throw new Error('No credential records found for student ID ' + query);
          }
        }
      } catch (err) {
        alert('Status Query Error: ' + err.message);
      } finally {
        searchBtn.disabled = false;
        searchBtn.innerText = 'Check Status';
      }
    }

    function renderViewerSingle(record) {
      currentSelectedTarget = record.studentId || record.idx;
      currentSelectedIndex = record.idx !== undefined ? record.idx : record.index;

      document.getElementById('searchPlaceholder').style.display = 'none';
      const viewer = document.getElementById('statusViewerCard');
      viewer.style.display = 'block';

      document.getElementById('viewerTargetId').innerText = record.studentId || ('Bit #' + record.idx);
      document.getElementById('viewerIndex').innerText = '#' + (record.idx !== undefined ? record.idx : record.index);
      document.getElementById('viewerAllocated').innerText = record.allocatedAt ? new Date(record.allocatedAt).toLocaleString() : 'N/A';
      document.getElementById('viewerRevoked').innerText = record.revokedAt ? new Date(record.revokedAt).toLocaleString() : 'Active (Not Revoked)';

      const badgeContainer = document.getElementById('viewerBadgeContainer');
      const actionContainer = document.getElementById('viewerActionContainer');

      if (record.revoked) {
        badgeContainer.innerHTML = '<span class="badge-status-revoked">REVOKED</span>';
        actionContainer.innerHTML = '<span style="font-size: 0.85rem; color: var(--status-revoked); font-weight: 600;">&#10006; This credential has already been permanently revoked.</span>';
      } else {
        badgeContainer.innerHTML = '<span class="badge-status-active">ACTIVE (VALID)</span>';
        actionContainer.innerHTML = '<button type="button" class="btn-danger" id="viewerRevokeBtn" onclick="executeCurrentRevocation()">Revoke Credential</button><span style="font-size: 0.75rem; color: var(--text-muted);">Immediately sets bit to 1 in Token Status List.</span>';
      }

      const degreeSection = document.getElementById('viewerDegreeSection');
      if (record.metadata && record.metadata.degreeName) {
        degreeSection.style.display = 'block';
        document.getElementById('viewerDegree').innerText = record.metadata.degreeName;
      } else {
        degreeSection.style.display = 'none';
      }

      viewer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function loadRecordIntoViewer(identifier, idx, isRevoked) {
      document.getElementById('searchQuery').value = identifier;
      handleSearch();
    }

    function promptRevoke(idx, studentId) {
      const targetName = studentId ? ('student ' + studentId + ' (Bit #' + idx + ')') : ('Bit #' + idx);
      if (!confirm('Are you sure you want to permanently revoke ' + targetName + '?\\n\\nThis action invalidates presentations immediately across all verifiers.')) {
        return;
      }

      const payload = studentId ? { studentId } : { idx };
      performRevoke(payload);
    }

    async function executeCurrentRevocation() {
      if (currentSelectedIndex === null && !currentSelectedTarget) return;
      const targetName = currentSelectedTarget ? ('student ' + currentSelectedTarget) : ('Bit #' + currentSelectedIndex);
      if (!confirm('Confirm revocation of ' + targetName + '?\\n\\nThis will immediately invalidate the credential.')) {
        return;
      }

      const payload = (typeof currentSelectedTarget === 'string' && isNaN(Number(currentSelectedTarget)))
        ? { studentId: currentSelectedTarget }
        : { idx: Number(currentSelectedIndex) };

      await performRevoke(payload);
    }

    async function performRevoke(payload) {
      try {
        const res = await fetch('${config.baseUrl}/admin/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error_description || data.error || 'Revocation failed');
        }

        alert('Credential Revoked Successfully! Status list bit has been updated.');
        window.location.reload();
      } catch (err) {
        alert('Revocation Error: ' + err.message);
      }
    }
  </script>
</body>
</html>`;
}

/**
 * Handles incoming HTTP requests for the Revocation Management Console: GET /revocation.
 */
export function handleRevocationRequest(
  req: Request,
  options: RevocationRouteOptions
): Response {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return Response.json(
      {
        error: "invalid_request",
        error_description: `Method ${req.method} not allowed on /revocation`,
      },
      { status: 405, headers: { Allow: "GET, HEAD" } }
    );
  }

  const { config, schemaConfig, statusListService } = options;
  const html = renderRevocationHtml(config, schemaConfig, statusListService);

  if (req.method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  }

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
