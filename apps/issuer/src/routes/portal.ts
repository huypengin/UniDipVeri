import type { CredentialTypeConfig, ClaimDef, SdPolicy } from "@unidipveri/core";
import type { IssuerConfig } from "../config.js";
import { PRELOADED_STUDENT_RECORDS } from "../services/student-records.js";
import { DEFAULT_CREDENTIAL_CONFIG_ID } from "./offer.js";

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
 * Formats a camelCase or snake_case claim property identifier into a clean, human-readable label.
 */
function formatClaimLabel(name: string): string {
  const withSpaces = name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
  return withSpaces
    .split(/\s+/)
    .map((word) => {
      const lower = word.toLowerCase();
      if (lower === "id") return "ID";
      if (lower === "gpa") return "GPA";
      if (lower === "url") return "URL";
      if (lower === "did") return "DID";
      if (lower === "vc") return "VC";
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * Renders an inline Selective Disclosure policy badge indicating whether a claim is salted and hidden behind _sd digests.
 */
function renderSdBadge(sd?: SdPolicy): string {
  if (sd === "selectively_disclosable") {
    return `<span class="badge-sd" title="Selectively Disclosable: Salted, hashed, and hidden behind an _sd digest. Holder chooses whether to disclose.">Selectively Disclosable</span>`;
  }
  if (sd === "always_disclosed") {
    return `<span class="badge-plain" title="Always Disclosed: Publicly visible in the signed credential payload without salt.">Always Disclosed</span>`;
  }
  return "";
}

/**
 * Recursively generates HTML form inputs, fieldsets, and dynamic tables from a ClaimDef dictionary.
 */
function renderClaimControl(
  name: string,
  claim: ClaimDef,
  parentPath: string
): string {
  const fullPath = parentPath ? `${parentPath}.${name}` : name;
  const label = formatClaimLabel(name);
  const sdBadge = renderSdBadge(claim.sd);
  const desc = claim.description
    ? `<div class="field-desc">${escapeHtml(claim.description)}</div>`
    : "";

  if (claim.type === "object") {
    const childFields = claim.properties
      ? renderSchemaFormFields(claim.properties, fullPath)
      : "";
    return `
      <div class="schema-card full-width" data-object-path="${fullPath}">
        <div class="schema-card-header">
          <div class="schema-card-title">
            <span>${escapeHtml(label)}</span>
            ${sdBadge}
          </div>
          ${desc}
        </div>
        <div class="schema-fields-grid">
          ${childFields}
        </div>
      </div>
    `;
  }

  if (claim.type === "array") {
    const itemsDef = claim.items;
    let tableHeaders = "";
    if (itemsDef && itemsDef.type === "object" && itemsDef.properties) {
      tableHeaders =
        Object.entries(itemsDef.properties)
          .map(([pName, pDef]) => {
            const pLabel = formatClaimLabel(pName);
            const pReq = pDef.required ? '<span class="req-star">*</span>' : "";
            const pBadge = renderSdBadge(pDef.sd);
            return `<th>
              <div>${escapeHtml(pLabel)} ${pReq}</div>
              <div style="margin-top: 4px;">${pBadge}</div>
            </th>`;
          })
          .join("\n") + `<th style="width: 44px;"></th>`;
    } else {
      tableHeaders = `<th>Value</th><th style="width: 44px;"></th>`;
    }
    let initialRowHtml = "";
    if (itemsDef && itemsDef.type === "object" && itemsDef.properties) {
      initialRowHtml = `
              <tr class="dynamic-array-row">
                ${Object.entries(itemsDef.properties)
                  .map(([pName, pDef]) => {
                    const pLabel = formatClaimLabel(pName);
                    const reqAttr = pDef.required ? "required" : "";
                    let inputType = "text";
                    let stepAttr = "";
                    if (pDef.type === "number") {
                      inputType = "number";
                      stepAttr = 'step="any"';
                    } else if (pDef.type === "string" && pDef.format === "date") {
                      inputType = "date";
                    }
                    return `<td>
                      <input type="${inputType}"
                             class="array-prop-input"
                             data-array-item-prop="${escapeHtml(pName)}"
                             data-claim-type="${pDef.type}"
                             placeholder="${escapeHtml(pLabel)}"
                             ${stepAttr}
                             ${reqAttr}>
                    </td>`;
                  })
                  .join("\n")}
                <td>
                  <button type="button" class="btn-remove-row" onclick="removeDynamicArrayRow(this)" title="Remove item">&times;</button>
                </td>
              </tr>
      `;
    } else {
      initialRowHtml = `
              <tr class="dynamic-array-row">
                <td>
                  <input type="text" class="array-prop-input" data-array-item-primitive="true" placeholder="Value">
                </td>
                <td>
                  <button type="button" class="btn-remove-row" onclick="removeDynamicArrayRow(this)" title="Remove item">&times;</button>
                </td>
              </tr>
      `;
    }

    return `
      <div class="schema-card full-width" data-array-container="true" data-array-path="${fullPath}">
        <div class="schema-card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <div>
            <div class="schema-card-title">
              <span>${escapeHtml(label)}</span>
              ${sdBadge}
            </div>
            ${desc}
          </div>
          <button type="button" class="btn-add-item" onclick="addDynamicArrayRowByPath('${fullPath}')">+ Add Item</button>
        </div>
        <div class="table-responsive">
          <table class="dynamic-array-table" data-array-table-path="${fullPath}">
            <thead>
              <tr>
                ${tableHeaders}
              </tr>
            </thead>
            <tbody data-tbody-path="${fullPath}">
              ${initialRowHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  const requiredAttr = claim.required ? "required" : "";
  const requiredMark = claim.required ? ' <span class="req-star">*</span>' : "";
  let inputType = "text";
  let stepAttr = "";

  if (claim.type === "number") {
    inputType = "number";
    stepAttr = 'step="any"';
  } else if (claim.type === "string" && claim.format === "date") {
    inputType = "date";
  }

  if (claim.type === "boolean") {
    return `
      <div class="form-group" data-field-group="${fullPath}">
        <div class="field-label-row">
          <label for="field-${fullPath}">${escapeHtml(label)}${requiredMark}</label>
          ${sdBadge}
        </div>
        ${desc}
        <select id="field-${fullPath}" data-claim-path="${fullPath}" data-claim-type="boolean" class="form-input">
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      </div>
    `;
  }

  return `
    <div class="form-group" data-field-group="${fullPath}">
      <div class="field-label-row">
        <label for="field-${fullPath}">${escapeHtml(label)}${requiredMark}</label>
        ${sdBadge}
      </div>
      ${desc}
      <input type="${inputType}"
             id="field-${fullPath}"
             data-claim-path="${fullPath}"
             data-claim-type="${claim.type}"
             class="form-input"
             ${stepAttr}
             ${requiredAttr}
             placeholder="${escapeHtml(label)}">
    </div>
  `;
}

/**
 * Dynamically builds form field HTML from a dictionary of ClaimDefs.
 */
export function renderSchemaFormFields(
  claims: Record<string, ClaimDef>,
  parentPath = ""
): string {
  if (!claims || typeof claims !== "object") {
    return "";
  }
  return Object.entries(claims)
    .map(([key, claim]) => renderClaimControl(key, claim, parentPath))
    .join("\n");
}

/**
 * Generates the HTML for the Interactive Registrar Portal with dynamically schema-driven fields.
 */
export function renderPortalHtml(
  config: IssuerConfig,
  schemaConfig: CredentialTypeConfig
): string {
  const preloadedJson = JSON.stringify(PRELOADED_STUDENT_RECORDS);
  const dynamicFormHtml = renderSchemaFormFields(schemaConfig.claims);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>UniDipVeri &mdash; ${escapeHtml(schemaConfig.name)} Registrar</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #4f46e5;
      --primary-hover: #4338ca;
      --primary-light: #eef2ff;
      --bg-dark: #0f172a;
      --card-bg: #ffffff;
      --border: #e2e8f0;
      --text: #0f172a;
      --text-muted: #64748b;
      --success: #10b981;
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font-sans);
      background-color: #f8fafc;
      color: var(--text);
      line-height: 1.5;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* Navbar */
    .navbar {
      background: var(--bg-dark);
      color: #fff;
      padding: 16px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    .nav-brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .nav-brand svg {
      width: 32px;
      height: 32px;
      fill: none;
      stroke: #818cf8;
      stroke-width: 2;
    }
    .brand-title {
      font-size: 1.15rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .brand-sub {
      font-size: 0.75rem;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .nav-links {
      display: flex;
      gap: 16px;
      align-items: center;
    }
    .nav-links a {
      color: #cbd5e1;
      text-decoration: none;
      font-size: 0.875rem;
      font-weight: 500;
      transition: color 0.15s;
    }
    .nav-links a:hover {
      color: #fff;
    }
    .nav-badge {
      background: rgba(79, 70, 229, 0.2);
      color: #a5b4fc;
      border: 1px solid rgba(129, 140, 248, 0.3);
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-family: var(--font-mono);
    }

    /* Main Container */
    .container {
      max-width: 1240px;
      margin: 32px auto;
      padding: 0 24px;
      flex: 1;
      width: 100%;
    }

    .hero-banner {
      margin-bottom: 24px;
    }
    .hero-banner h1 {
      font-size: 1.85rem;
      font-weight: 700;
      letter-spacing: -0.03em;
      color: #1e293b;
    }
    .hero-banner p {
      color: var(--text-muted);
      margin-top: 4px;
      font-size: 0.95rem;
    }

    /* Preset Toolbar */
    .preset-bar {
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 28px;
      display: flex;
      align-items: center;
      gap: 12px;
      box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
      flex-wrap: wrap;
    }
    .preset-label {
      font-weight: 600;
      font-size: 0.85rem;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .preset-btn {
      background: var(--primary-light);
      color: var(--primary);
      border: 1px solid rgba(79, 70, 229, 0.2);
      padding: 7px 14px;
      border-radius: 8px;
      font-size: 0.825rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }
    .preset-btn:hover {
      background: var(--primary);
      color: #fff;
    }
    .preset-btn-clear {
      background: #f1f5f9;
      color: #475569;
      border: 1px solid #cbd5e1;
    }
    .preset-btn-clear:hover {
      background: #e2e8f0;
      color: #1e293b;
    }

    /* Grid Layout */
    .portal-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.75fr);
      gap: 28px;
      align-items: start;
    }
    @media (max-width: 960px) {
      .portal-grid { grid-template-columns: 1fr; }
    }

    /* Form Card */
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 24px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      min-width: 0;
    }

    /* Sticky Offer Card */
    .offer-card {
      position: sticky;
      top: 24px;
      max-height: calc(100vh - 48px);
      overflow-y: auto;
    }
    @media (max-width: 960px) {
      .offer-card {
        position: static;
        max-height: none;
      }
    }
    .card-title {
      font-size: 1.15rem;
      font-weight: 700;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: #1e293b;
    }

    /* Schema Driven Hierarchy */
    .schema-card {
      background: #f8fafc;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px;
      margin-top: 14px;
    }
    .schema-card-header {
      margin-bottom: 12px;
    }
    .schema-card-title {
      font-size: 0.95rem;
      font-weight: 700;
      color: #1e293b;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .schema-fields-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    @media (max-width: 640px) {
      .schema-fields-grid { grid-template-columns: 1fr; }
    }
    .full-width {
      grid-column: 1 / -1;
    }

    .form-group {
      margin-bottom: 4px;
    }
    .field-label-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
      gap: 8px;
    }
    .field-desc {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-bottom: 4px;
    }
    .req-star {
      color: #ef4444;
      font-weight: bold;
    }

    label {
      font-size: 0.825rem;
      font-weight: 600;
      color: #334155;
    }
    .form-input, select {
      width: 100%;
      padding: 9px 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 0.875rem;
      font-family: inherit;
      color: #0f172a;
      background: #fdfdfd;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .form-input:focus, select:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.15);
      background: #fff;
    }

    /* Badges */
    .badge-sd {
      background: #f5f3ff;
      color: #6d28d9;
      border: 1px solid #ddd6fe;
      padding: 2px 7px;
      border-radius: 9999px;
      font-size: 0.7rem;
      font-weight: 600;
      white-space: nowrap;
    }
    .badge-plain {
      background: #eff6ff;
      color: #1d4ed8;
      border: 1px solid #bfdbfe;
      padding: 2px 7px;
      border-radius: 9999px;
      font-size: 0.7rem;
      font-weight: 600;
      white-space: nowrap;
    }

    /* Dynamic Array Tables */
    .table-responsive {
      overflow-x: auto;
      margin-top: 8px;
    }
    .dynamic-array-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
      background: #fff;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    .dynamic-array-table th {
      text-align: left;
      padding: 8px 10px;
      background: #f1f5f9;
      color: #475569;
      font-weight: 600;
      border-bottom: 1px solid var(--border);
      font-size: 0.75rem;
    }
    .dynamic-array-table td {
      padding: 6px 6px;
      vertical-align: middle;
      border-bottom: 1px solid #f1f5f9;
    }
    .dynamic-array-table input {
      width: 100%;
      padding: 6px 8px;
      font-size: 0.8rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      font-family: inherit;
    }
    .dynamic-array-table input:focus {
      outline: none;
      border-color: var(--primary);
    }
    .btn-remove-row {
      background: #fee2e2;
      color: #b91c1c;
      border: 1px solid #fecaca;
      border-radius: 6px;
      width: 28px;
      height: 28px;
      font-size: 1.1rem;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-weight: 700;
      transition: background 0.15s;
    }
    .btn-remove-row:hover {
      background: #fca5a5;
    }
    .btn-add-item {
      background: var(--primary-light);
      color: var(--primary);
      border: 1px solid rgba(79, 70, 229, 0.3);
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 0.775rem;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s;
    }
    .btn-add-item:hover {
      background: var(--primary);
      color: #fff;
    }

    .form-section-title {
      font-size: 0.85rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
      margin: 20px 0 12px 0;
      padding-bottom: 6px;
      border-bottom: 1px solid #f1f5f9;
    }

    .btn-submit {
      width: 100%;
      background: var(--primary);
      color: #fff;
      border: none;
      padding: 12px 20px;
      border-radius: 10px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      margin-top: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: background 0.15s, transform 0.05s;
    }
    .btn-submit:hover {
      background: var(--primary-hover);
    }
    .btn-submit:active {
      transform: scale(0.99);
    }

    /* Output Card */
    .qr-container {
      background: #f8fafc;
      border: 1px dashed #cbd5e1;
      border-radius: 12px;
      padding: 20px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 220px;
    }
    #qrcode {
      background: #fff;
      padding: 12px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
      margin-bottom: 14px;
    }
    #qrcode img, #qrcode canvas {
      display: block;
      margin: 0 auto;
    }
    .uri-wrapper {
      position: relative;
      width: 100%;
      margin-top: 14px;
    }
    .uri-box {
      width: 100%;
      background: #0f172a;
      color: #cbd5e1;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      padding: 12px 14px;
      border-radius: 8px;
      word-break: break-all;
      overflow-wrap: anywhere;
      max-height: 110px;
      overflow-y: auto;
      text-align: left;
      border: 1px solid #334155;
    }
    .copy-btn {
      position: absolute;
      top: 8px;
      right: 20px;
      z-index: 10;
      background: #4f46e5;
      color: #ffffff;
      border: 1px solid #6366f1;
      padding: 5px 11px;
      border-radius: 6px;
      font-size: 0.725rem;
      font-weight: 600;
      cursor: pointer;
      font-family: var(--font-sans);
      display: inline-flex;
      align-items: center;
      gap: 5px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
      transition: background 0.15s, border-color 0.15s, transform 0.05s;
    }
    .copy-btn:hover {
      background: #4338ca;
      border-color: #818cf8;
    }
    .copy-btn:active {
      transform: scale(0.96);
    }
    .pin-badge {
      display: inline-block;
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fde68a;
      padding: 4px 12px;
      border-radius: 6px;
      font-weight: 700;
      font-family: var(--font-mono);
      font-size: 0.85rem;
      margin-top: 10px;
    }
    .open-wallet-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #059669;
      color: #fff;
      text-decoration: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 600;
      margin-top: 12px;
      transition: background 0.15s;
    }
    .open-wallet-btn:hover {
      background: #047857;
    }
    .json-details {
      margin-top: 14px;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      background: #f8fafc;
    }
    .json-summary {
      font-size: 0.8rem;
      font-weight: 600;
      color: #475569;
      padding: 8px 12px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #f1f5f9;
      user-select: none;
    }
    .json-summary:hover {
      background: #e2e8f0;
    }
    .json-preview {
      background: #0f172a;
      color: #a5b4fc;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      padding: 12px;
      max-height: 220px;
      overflow-y: auto;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
      margin: 0;
      text-align: left;
    }

    footer {
      text-align: center;
      padding: 24px;
      font-size: 0.8rem;
      color: var(--text-muted);
      border-top: 1px solid var(--border);
      background: #fff;
    }
  </style>
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
      <a href="/docs" target="_blank">Swagger API</a>
      <a href="/.well-known/openid-credential-issuer" target="_blank">OID4VCI Discovery</a>
      <a href="/.well-known/did.json" target="_blank">DID Document</a>
      <span class="nav-badge">dc+sd-jwt</span>
    </nav>
  </header>

  <main class="container">
    <div class="hero-banner">
      <h1>${escapeHtml(schemaConfig.name)}</h1>
      <p>${escapeHtml(schemaConfig.description)} &bull; Type: <code>${escapeHtml(schemaConfig.vctPath)}</code></p>
    </div>

    <!-- Presets Toolbar -->
    <div class="preset-bar">
      <span class="preset-label">Quick Presets:</span>
      <button type="button" class="preset-btn" onclick="applyPreset('STU-2026-FINAL')">&#127891; Honors CS Graduate (GPA 3.92)</button>
      <button type="button" class="preset-btn" onclick="applyPreset('STU-2026-0002')">&#128220; Standard Graduate (GPA 3.25)</button>
      <button type="button" class="preset-btn" onclick="applyMinimalPreset()">&#9889; Minimal Claims</button>
      <button type="button" class="preset-btn preset-btn-clear" onclick="clearForm()">&#128465; Blank Form</button>
    </div>

    <div class="portal-grid">
      <!-- Input Form -->
      <section class="card">
        <div class="card-title">
          <span>Schema-Driven Credential Claims</span>
          <span style="font-size: 0.75rem; font-weight: normal; color: var(--text-muted); font-family: var(--font-mono);">
            ${Object.keys(schemaConfig.claims).length} root claims
          </span>
        </div>

        <form id="issueForm" onsubmit="handleIssue(event)">
          <div class="schema-fields-grid" id="dynamicClaimsContainer">
            ${dynamicFormHtml}
          </div>

          <div class="form-section-title">Issuance Security &amp; Options</div>
          <div class="form-group" style="margin-bottom: 14px;">
            <div class="field-label-row">
              <label for="txCode">Issuance PIN Challenge (tx_code)</label>
              <span class="badge-plain">Optional</span>
            </div>
            <div class="field-desc">Optional 4-digit PIN for Holder Wallet authorization.</div>
            <input type="text" id="txCode" name="txCode" class="form-input" placeholder="e.g. 1234">
          </div>

          <button type="submit" class="btn-submit" id="submitBtn">
            <span>Generate Credential Offer</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
        </form>
      </section>

      <!-- Offer & QR Display -->
      <section class="card offer-card" id="offerCard">
        <h2 class="card-title">
          <span>Wallet QR Code &amp; Offer</span>
        </h2>
        <div class="qr-container" id="qrContainer">
          <div id="qrPlaceholder" style="color: #94a3b8; font-size: 0.9rem;">
            Click <strong>Generate Credential Offer</strong> to create an instant OID4VCI offer.
          </div>
          <div id="qrcode" style="display: none;"></div>
          <div id="pinNotice" style="display: none;"></div>
          <div id="openWalletContainer" style="display: none;"></div>
          <div id="uriContainer" class="uri-wrapper" style="display: none;">
            <button type="button" class="copy-btn" id="copyUriBtn" onclick="copyUri()" title="Copy Offer URI to clipboard">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              <span>Copy</span>
            </button>
            <div class="uri-box">
              <span id="uriText"></span>
            </div>
          </div>
        </div>

        <details id="jsonPreviewContainer" class="json-details" style="display: none;">
          <summary class="json-summary">
            <span>OID4VCI Credential Offer JSON</span>
            <span style="font-size: 0.7rem; font-weight: normal; color: #64748b;">(Click to view)</span>
          </summary>
          <pre class="json-preview" id="jsonPreview"></pre>
        </details>
      </section>
    </div>
  </main>

  <footer>
    UniDipVeri Standalone SD-JWT Academic Credential System &bull; ${config.baseUrl} &bull; OpenID4VCI 1.0 Final &bull; draft-ietf-oauth-sd-jwt-vc-19
  </footer>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
  <script>
    const SCHEMA_CONFIG = ${JSON.stringify(schemaConfig)};
    const PRELOADED = ${preloadedJson};
    let currentOfferUri = "";

    function formatClaimLabel(name) {
      const withSpaces = name
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ")
        .trim();
      return withSpaces.split(/\\s+/).map(w => {
        const lower = w.toLowerCase();
        if (lower === "id") return "ID";
        if (lower === "gpa") return "GPA";
        if (lower === "url") return "URL";
        if (lower === "did") return "DID";
        return w.charAt(0).toUpperCase() + w.slice(1);
      }).join(" ");
    }

    function escapeHtmlAttr(str) {
      if (str === null || str === undefined) return '';
      return String(str).replace(/"/g, '&quot;');
    }

    function getDeepValue(obj, path) {
      if (!obj) return undefined;
      const parts = path.split('.');
      let cur = obj;
      for (const p of parts) {
        if (cur === undefined || cur === null) return undefined;
        cur = cur[p];
      }
      return cur;
    }

    function setDeepValue(obj, path, value) {
      const parts = path.split('.');
      let cur = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (!cur[p] || typeof cur[p] !== 'object') {
          cur[p] = {};
        }
        cur = cur[p];
      }
      cur[parts[parts.length - 1]] = value;
    }

    function getClaimDefByPath(path) {
      const parts = path.split('.');
      let currentClaims = SCHEMA_CONFIG.claims;
      let def = null;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!currentClaims || !currentClaims[part]) return null;
        def = currentClaims[part];
        if (def.type === 'object' && def.properties) {
          currentClaims = def.properties;
        } else if (def.type === 'array' && def.items && def.items.properties) {
          currentClaims = def.items.properties;
        }
      }
      return def;
    }

    function createArrayRow(arrayPath, itemData = {}) {
      const def = getClaimDefByPath(arrayPath);
      const tr = document.createElement('tr');
      tr.className = 'dynamic-array-row';

      if (def && def.items && def.items.type === 'object' && def.items.properties) {
        const props = def.items.properties;
        let html = '';
        for (const [propName, propDef] of Object.entries(props)) {
          const val = itemData[propName] !== undefined ? itemData[propName] : '';
          let inputType = 'text';
          let stepAttr = '';
          if (propDef.type === 'number') {
            inputType = 'number';
            stepAttr = 'step="any"';
          } else if (propDef.type === 'string' && propDef.format === 'date') {
            inputType = 'date';
          }
          const reqAttr = propDef.required ? 'required' : '';
          html += '<td>' +
            '<input type="' + inputType + '" ' +
                   'class="array-prop-input" ' +
                   'data-array-item-prop="' + propName + '" ' +
                   'data-claim-type="' + propDef.type + '" ' +
                   'value="' + escapeHtmlAttr(val) + '" ' +
                   'placeholder="' + formatClaimLabel(propName) + '" ' +
                   stepAttr + ' ' +
                   reqAttr + '>' +
          '</td>';
        }
        html += '<td>' +
          '<button type="button" class="btn-remove-row" onclick="removeDynamicArrayRow(this)" title="Remove item">&times;</button>' +
        '</td>';
        tr.innerHTML = html;
      } else {
        const val = itemData !== undefined ? itemData : '';
        tr.innerHTML = '<td>' +
          '<input type="text" class="array-prop-input" data-array-item-primitive="true" value="' + escapeHtmlAttr(val) + '" placeholder="Value">' +
        '</td>' +
        '<td>' +
          '<button type="button" class="btn-remove-row" onclick="removeDynamicArrayRow(this)" title="Remove item">&times;</button>' +
        '</td>';
      }
      return tr;
    }

    function addDynamicArrayRowByPath(arrayPath, itemData) {
      const tbody = document.querySelector('tbody[data-tbody-path="' + arrayPath + '"]');
      if (!tbody) return;
      tbody.appendChild(createArrayRow(arrayPath, itemData));
    }

    function removeDynamicArrayRow(btn) {
      const row = btn.closest('tr');
      const tbody = row.parentElement;
      if (tbody.children.length > 1) {
        row.remove();
      } else {
        alert('Credential must have at least one entry in this list.');
      }
    }

    function populateFormFromRecord(record) {
      if (!record) return;

      // 1. Populate scalar inputs
      const inputs = document.querySelectorAll('input[data-claim-path], select[data-claim-path]');
      inputs.forEach(input => {
        const path = input.getAttribute('data-claim-path');
        const val = getDeepValue(record, path);
        if (val !== undefined && val !== null) {
          input.value = val;
        } else {
          input.value = '';
        }
      });

      // 2. Populate array containers
      const arrayContainers = document.querySelectorAll('[data-array-container]');
      arrayContainers.forEach(container => {
        const arrayPath = container.getAttribute('data-array-path');
        const items = getDeepValue(record, arrayPath);
        const tbody = container.querySelector('tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (Array.isArray(items) && items.length > 0) {
          items.forEach(item => {
            tbody.appendChild(createArrayRow(arrayPath, item));
          });
        } else {
          tbody.appendChild(createArrayRow(arrayPath, {}));
        }
      });

      const txEl = document.getElementById('txCode');
      if (txEl) txEl.value = '';
    }

    function applyPreset(studentId) {
      const record = PRELOADED[studentId];
      if (record) {
        populateFormFromRecord(record);
      }
    }

    function applyMinimalPreset() {
      const minimalRecord = {
        studentId: 'STU-MINIMAL',
        fullName: 'Alex Doe',
        papers: {
          diploma: {
            degreeName: 'Bachelor of Science',
            degreeType: 'Bachelor of Science',
            programName: 'Undergraduate Program',
            major: 'Computer Science',
            graduationDate: '2026-06-30'
          },
          transcript: {
            transcriptId: 'TR-STU-MINIMAL',
            courses: [
              { code: 'CS101', title: 'Intro to Computer Science', credits: 3, grade: 3.5, letterGrade: 'B+' }
            ]
          }
        }
      };
      populateFormFromRecord(minimalRecord);
    }

    function clearForm() {
      populateFormFromRecord({});
    }

    function buildClaimsFromDynamicForm() {
      const claims = {};

      // 1. Extract scalar inputs
      const inputs = document.querySelectorAll('input[data-claim-path], select[data-claim-path]');
      inputs.forEach(input => {
        const path = input.getAttribute('data-claim-path');
        const type = input.getAttribute('data-claim-type');
        const rawVal = input.value.trim();
        if (rawVal === '') {
          return;
        }
        let val = rawVal;
        if (type === 'number') {
          const num = Number(rawVal);
          if (isNaN(num)) return;
          val = num;
        } else if (type === 'boolean') {
          val = rawVal === 'true';
        }
        setDeepValue(claims, path, val);
      });

      // 2. Extract dynamic array items
      const arrayContainers = document.querySelectorAll('[data-array-container]');
      arrayContainers.forEach(container => {
        const arrayPath = container.getAttribute('data-array-path');
        const rows = container.querySelectorAll('.dynamic-array-row');
        const items = [];
        rows.forEach(row => {
          const itemInputs = row.querySelectorAll('[data-array-item-prop]');
          if (itemInputs.length > 0) {
            const itemObj = {};
            let hasData = false;
            itemInputs.forEach(input => {
              const propName = input.getAttribute('data-array-item-prop');
              const propType = input.getAttribute('data-claim-type');
              const rawVal = input.value.trim();
              if (rawVal !== '') {
                let val = rawVal;
                if (propType === 'number') {
                  const num = Number(rawVal);
                  if (!isNaN(num)) val = num;
                } else if (propType === 'boolean') {
                  val = rawVal === 'true';
                }
                itemObj[propName] = val;
                hasData = true;
              }
            });
            if (hasData) {
              items.push(itemObj);
            }
          } else {
            const primInput = row.querySelector('[data-array-item-primitive]');
            if (primInput && primInput.value.trim() !== '') {
              items.push(primInput.value.trim());
            }
          }
        });
        if (items.length > 0) {
          setDeepValue(claims, arrayPath, items);
        }
      });

      return claims;
    }

    async function handleIssue(e) {
      e.preventDefault();
      const btn = document.getElementById('submitBtn');
      btn.disabled = true;
      btn.innerHTML = '<span>Generating...</span>';

      try {
        const claims = buildClaimsFromDynamicForm();

        const firstInput = document.querySelector('input[data-claim-path]');
        const subjectId = claims.studentId || claims.employeeId || (firstInput ? firstInput.value.trim() : 'SUBJ-' + Date.now());
        const txCodeInput = document.getElementById('txCode');
        const txCode = txCodeInput ? txCodeInput.value.trim() : '';

        const payload = {
          studentId: String(subjectId),
          credential_configuration_id: '${DEFAULT_CREDENTIAL_CONFIG_ID}',
          claims
        };
        if (txCode) payload.tx_code = txCode;

        const res = await fetch('/credential-offer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error_description || data.error || 'Failed to create offer');

        currentOfferUri = data.credential_offer_uri || '';

        // Render QR Code
        document.getElementById('qrPlaceholder').style.display = 'none';
        const qrEl = document.getElementById('qrcode');
        qrEl.innerHTML = '';
        qrEl.style.display = 'block';

        if (typeof QRCode !== 'undefined') {
          new QRCode(qrEl, {
            text: currentOfferUri,
            width: 200,
            height: 200,
            colorDark: '#0f172a',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
          });
        } else {
          qrEl.innerHTML = '<p style="color: #64748b;">(QR library offline, use link below)</p>';
        }

        // Show PIN badge if tx_code set
        const pinNotice = document.getElementById('pinNotice');
        if (txCode) {
          pinNotice.innerHTML = '<span class="pin-badge">Wallet PIN Challenge: ' + txCode + '</span>';
          pinNotice.style.display = 'block';
        } else {
          pinNotice.style.display = 'none';
        }

        // Show open in wallet button
        const openContainer = document.getElementById('openWalletContainer');
        openContainer.innerHTML = '<a href="' + currentOfferUri + '" class="open-wallet-btn">Open in Wallet &rarr;</a>';
        openContainer.style.display = 'block';

        // Show raw URI
        const uriContainer = document.getElementById('uriContainer');
        document.getElementById('uriText').innerText = currentOfferUri;
        uriContainer.style.display = 'block';

        // Show JSON preview
        const jsonDetails = document.getElementById('jsonPreviewContainer');
        jsonDetails.style.display = 'block';
        jsonDetails.open = false;
        document.getElementById('jsonPreview').innerText = JSON.stringify(data.credential_offer, null, 2);

        // Smooth scroll to offer card on mobile screens
        if (window.innerWidth <= 960) {
          document.getElementById('offerCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

      } catch (err) {
        alert('Error generating credential offer: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>Generate Credential Offer</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
      }
    }

    function copyUri() {
      if (!currentOfferUri) return;
      navigator.clipboard.writeText(currentOfferUri).then(() => {
        const btn = document.getElementById('copyUriBtn');
        if (btn) {
          const originalContent = btn.innerHTML;
          btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg><span>Copied!</span>';
          btn.style.background = '#10b981';
          btn.style.borderColor = '#059669';
          setTimeout(() => {
            btn.innerHTML = originalContent;
            btn.style.background = '';
            btn.style.borderColor = '';
          }, 2000);
        }
      }).catch(() => {
        alert('Offer URI copied to clipboard!');
      });
    }

    window.addEventListener('DOMContentLoaded', () => {
      if (PRELOADED['STU-2026-FINAL']) {
        applyPreset('STU-2026-FINAL');
      } else {
        clearForm();
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Handles incoming Interactive Registrar Portal requests: GET / and GET /issue.
 */
export function handlePortalRequest(
  req: Request,
  config: IssuerConfig,
  schemaConfig: CredentialTypeConfig
): Response {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return Response.json(
      {
        error: "invalid_request",
        error_description: `Method ${req.method} not allowed on portal route`,
      },
      { status: 405, headers: { Allow: "GET, HEAD" } }
    );
  }

  const html = renderPortalHtml(config, schemaConfig);

  if (req.method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  }

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
