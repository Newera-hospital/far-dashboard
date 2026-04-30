/*  sheets.js  Google Sheets reader/writer for the FAR portal
 *
 *  Reads tabs from a public (Anyone-with-link-Viewer) Google Sheet using the
 *  gviz/tq endpoint. No API key, no OAuth; the sheet just needs to be readable
 *  by link.
 *
 *  Writes (audit mirror, disposal mirror, Asset_ID write-back, etc.) go through
 *  a Google Apps Script Web App deployed against the same sheet. The browser
 *  POSTs the job (tab, op, values/cell, value) directly to that Web App URL and
 *  the script writes to the sheet. No Node.js, no Cloud Functions, no service
 *  account, no Firebase Blaze plan required.
 *
 *  The script source is in setup_sheet.gs (function doPost). Configure the
 *  deployed exec URL in firebase-config.js as APPS_SCRIPT_URL.
 */

import { SHEET_ID, SHEET_TABS, APPS_SCRIPT_URL } from "./firebase-config.js";

// Maps whatever text is in the Asset_State column  internal enum value.
// Handles both human-readable ("Active - Tagged") and raw enum ("active_tagged").
function normalizeState(raw) {
  if (!raw) return "active_untagged";
  const s = raw.trim().toLowerCase().replace(/\s*[-]\s*/g, "_").replace(/\s+/g, "_").replace(/[^a-z_]/g, "").replace(/_+/g, "_").replace(/^_|_$/g, "");
  const map = {
    active_untagged:   "active_untagged",
    active_tagged:     "active_tagged",
    under_maintenance: "under_maintenance",
    disposed:          "disposed",
    written_off:       "written_off",
    destroyed:         "destroyed",
    transferred_out:   "transferred_out",
    pending_review:    "pending_review",
    blocked:           "blocked",
    // human-readable variants from Masters
    pending_review:    "pending_review",
    reprint_requested: "active_tagged",
  };
  return map[s] || s || "active_untagged";
}

const GVIZ_BASE = id =>
  `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json`;

/* Strip the gviz JSONP wrapper:
 *   /*O_o* /\ngoogle.visualization.Query.setResponse({...});
 * Returns the inner JSON object, or throws.
 */
function parseGviz(text) {
  const start = text.indexOf("{");
  const end   = text.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("sheet response is not JSON");
  return JSON.parse(text.slice(start, end + 1));
}

/* Convert a gviz cell value to a plain string.
 * gviz encodes dates as "Date(yyyy,mm,dd)" where mm is 0-indexed  we flatten
 * to a readable dd-Mon-yyyy string.
 */
function cellToString(cell) {
  if (!cell || cell.v === null || cell.v === undefined) return "";
  if (cell.f) return String(cell.f).trim();               // formatted value wins
  const v = cell.v;
  if (typeof v === "string" && v.startsWith("Date(")) {
    const m = v.match(/Date\((\d+),(\d+),(\d+)/);
    if (m) {
      const d = new Date(+m[1], +m[2], +m[3]);
      return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    }
  }
  return String(v).trim();
}

function headerKey(name) {
  return String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function pick(row, aliases) {
  for (const name of aliases) {
    const value = row[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  const wanted = aliases.map(headerKey).filter(Boolean);
  for (const [key, value] of Object.entries(row)) {
    const normalized = headerKey(key);
    if (
      wanted.some(alias => normalized === alias || normalized.endsWith(alias)) &&
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
    ) {
      return String(value).trim();
    }
  }
  return "";
}

/* Classify a fetch/parse failure so the UI can show actionable guidance
 * instead of the browser's generic "Failed to fetch".
 */
function describeFetchFailure(err) {
  if (location.protocol === "file:") {
    return "This page is running from file://  browsers block fetches to Google Sheets from file URLs. " +
           "Open the page through a local server (e.g. `npx serve` in the folder, or VS Code Live Server).";
  }
  const msg = err && err.message ? err.message : String(err);
  // Chrome/Firefox use "Failed to fetch" / "NetworkError" for both offline
  // and CORS-blocked responses. The #1 cause here is the sheet not being
  // shared as "Anyone with the link  Viewer".
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return "Cannot reach Google Sheets. Most likely the sheet is not shared as " +
           "\"Anyone with the link  Viewer\". Open the sheet  Share  General access  " +
           "change to Anyone with the link  Viewer, then retry. " +
           "(Alternate causes: offline, or an extension blocking docs.google.com.)";
  }
  return msg;
}

/* Low-level reader: fetches one sheet tab and returns an array of row objects
 * keyed by the column labels from the header row.
 *
 *   opts.headers   1 or 2 (default 2; template has a banner in row 1)
 *   opts.range     optional A1 range (e.g. "A2:X")
 *   opts.gid       fallback numeric gid if the tab-name form fails
 */
export async function fetchSheet(tabName, opts = {}) {
  if (!SHEET_ID) throw new Error("SHEET_ID is not configured");
  const headers = opts.headers ?? 2;

  const attempt = async (params) => {
    const qs = new URLSearchParams({ ...params, headers: String(headers), _: String(Date.now()) });
    if (opts.range) qs.set("range", opts.range);
    const url = `${GVIZ_BASE(SHEET_ID)}&${qs.toString()}`;
    const res = await fetch(url, { credentials: "omit", cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Sheet returned HTTP ${res.status}. Ensure the sheet is shared "Anyone with the link  Viewer".`);
    }
    return parseGviz(await res.text());
  };

  let data;
  try {
    data = await attempt({ sheet: tabName });
  } catch (e1) {
    // If we have a gid, try it as a fallback  handles tabs that have been
    // renamed or have spaces/underscores that don't match exactly.
    if (opts.gid) {
      try { data = await attempt({ gid: String(opts.gid) }); }
      catch { throw new Error(describeFetchFailure(e1)); }
    } else {
      throw new Error(describeFetchFailure(e1));
    }
  }

  if (data.status !== "ok") {
    const msg = (data.errors?.[0]?.detailed_message || data.errors?.[0]?.message || "unknown sheet error").replace(/<[^>]+>/g, "");
    throw new Error(`Sheet "${tabName}": ${msg}`);
  }

  const cols = data.table.cols.map(c => (c.label || c.id || "").trim());
  const rows = (data.table.rows || []).map(r => {
    const o = {};
    (r.c || []).forEach((cell, i) => {
      const key = cols[i] || `col_${i}`;
      o[key] = cellToString(cell);
    });
    return o;
  });
  return rows.filter(r => Object.values(r).some(v => v !== ""));
}

/* One-shot health check. Returns {ok:true} or {ok:false, reason, hint}.
 * Never throws  safe to call from a UI button.
 */
export async function sheetHealthCheck() {
  if (location.protocol === "file:") {
    return { ok:false, reason:"file:// protocol", hint:"Run the site through a local web server  browsers refuse cross-origin fetches from file URLs. Options: `npx serve`, Python's `python -m http.server`, VS Code Live Server, or deploy to GitHub Pages." };
  }
  if (!SHEET_ID) return { ok:false, reason:"No SHEET_ID", hint:"firebase-config.js is missing SHEET_ID." };

  // Cheap probe: ask for the first cell only.
  const url = `${GVIZ_BASE(SHEET_ID)}&range=A1:A1&headers=0&_=${Date.now()}`;
  try {
    const res = await fetch(url, { credentials: "omit", cache: "no-store" });
    if (!res.ok) return { ok:false, reason:`HTTP ${res.status}`, hint:"Share the sheet as Anyone-with-link Viewer." };
    const text = await res.text();
    // Private sheets return an HTML sign-in page wrapped in gviz error JSON
    if (text.includes('"status":"error"')) {
      return { ok:false, reason:"Access denied by Google", hint:"Sheet is likely private. Share  General access  Anyone with the link  Viewer." };
    }
    return { ok:true };
  } catch (e) {
    return { ok:false, reason:e.message || String(e), hint:describeFetchFailure(e) };
  }
}

/*  Domain readers  */

// Known gids from the user's sheet (extracted from tab URLs).
// These are used as a fallback when the tab name doesn't match exactly
// (e.g. the user renamed "Invoice_Asset_Intake" to "Invoice Asset Intake").
const TAB_GIDS = {
  [SHEET_TABS.INTAKE]: 851690280,
};

/* Asset rows from the Google Sheet.
 *
 * Rows with a non-empty Asset_ID (column Q) are allocated assets and carry
 * that canonical ID. Rows with a blank Asset_ID are pending allocation  they
 * keep `id=""` and `pending=true`; the UI renders them without inventing a
 * fake ID. The `sheet_row` index lets the allocator queue the ID write-back
 * to the correct row.
 */
export async function fetchAssets() {
  const raw = await fetchSheet(SHEET_TABS.INTAKE, { headers: 1, range: "A2:V", gid: TAB_GIDS[SHEET_TABS.INTAKE] });
  return raw.map((r, i) => {
    const invoice  = pick(r, ["Invoice_No", "Invoice No", "Invoice No.", "Invoice Number", "Invoice_Number", "Bill_No", "Bill No", "Bill Number"]);
    const invDate  = pick(r, ["Invoice_Date", "Invoice Date", "Invoice Dt", "Bill_Date", "Bill Date"]);
    const vendor   = pick(r, ["Vendor_Name", "Vendor Name", "Vendor", "Supplier_Name", "Supplier Name", "Supplier"]);
    const desc     = pick(r, ["Asset_Description", "Asset Description", "Description", "Asset_Name", "Asset Name", "Item Description", "Item"]);
    const qty      = pick(r, ["Quantity", "Qty"]);
    const dept     = pick(r, ["Department", "Dept", "Department_Area", "Department / Area"]);
    const location = pick(r, ["Location", "Area", "Floor", "Block"]);
    const value    = pick(r, ["Purchase_Value", "Purchase Value", "Value", "Amount", "Cost", "Gross Value"]);
    const itu      = pick(r, ["Put_to_Use_Date", "Put to Use Date", "In Service", "In Service Date", "Use Date"]);
    const life     = pick(r, ["Useful_Life_Years", "Useful Life Years", "Useful Life", "Life"]);
    const depRate  = pick(r, ["Dep_Rate_Percent", "Dep Rate Percent", "Dep Rate %", "Depreciation Rate"]);
    const depMeth  = pick(r, ["Dep_Method", "Dep Method", "Depreciation Method"]);
    const cat      = pick(r, ["Asset_Category", "Asset Category", "Category", "Class"]);
    const serial   = pick(r, ["Serial_No", "Serial No", "Serial No.", "Serial Number", "Serial"]);
    const model    = pick(r, ["Model_No", "Model No", "Model No.", "Model Number", "Model"]);
    const custodian = pick(r, ["Custodian_Department", "Custodian Department", "Custodian", "Custody", "Responsible Department"]);
    const remarks  = pick(r, ["Remarks", "Remark", "Notes", "Comment"]);
    const assetId  = pick(r, ["Asset_ID", "Asset ID", "Asset Id", "asset_id"]);
    const qrUrl    = pick(r, ["QR_URL", "QR URL", "QR Link"]);
    const qrStatus = pick(r, ["QR_Status", "QR Status"]);
    const qrOn     = pick(r, ["QR_Generated_On", "QR Generated On"]);
    const qrBy     = pick(r, ["QR_Generated_By", "QR Generated By"]);
    const reprints = pick(r, ["Reprint_Count", "Reprint Count"]);
    const assetState = pick(r, ["Asset_State", "Asset State", "State"]);
    const updated  = pick(r, ["Last_Updated", "Last Updated", "Updated"]);
    const condition = pick(r, ["Condition", "Asset Condition"]);
    const source   = pick(r, ["Source", "Asset Source"]);
    const voucherRef = pick(r, ["Voucher_Ref", "Voucher Ref", "Voucher"]);
    const verifiedOn = pick(r, ["Last_Verified_On", "Last Verified On", "Verified On"]);

    const hasIntakeData = [
      invoice, invDate, vendor, desc, qty, dept, location, value, itu, life,
      depRate, depMeth, cat, serial, model, custodian, remarks, assetId,
    ].some(v => String(v || "").trim() !== "");
    if (!hasIntakeData) return null;

    const id = assetId.trim();
    const pending = !id;
    const qrStatusValue = (qrStatus.trim().toLowerCase() || "pending");
    return {
      id,                                           // "" if pending
      pending,
      invoice,
      invDate,
      vendor,
      desc,
      qty,
      dept,
      location,
      value,
      itu,
      life,
      depRate,
      depMeth:  depMeth || "WDV",
      cat,
      serial,
      model,
      remarks,
      qrUrl,
      qr:       pending ? "pending" : qrStatusValue,
      qrOn,
      qrBy,
      reprints: +reprints || 0,
      state:    pending ? "pending_allocation" : normalizeState(assetState),
      updated,

      // Phase 1 fields  blank until the custodian departments fill them
      custodian,
      condition:  condition.trim().toLowerCase().replace(/[^a-z_]/g, "_") || "unknown",
      source:     source.trim().toLowerCase() || (id ? "purchase_intake" : "legacy_discovery"),
      voucherRef,
      verifiedOn,

      sheet_row: i + 3,
    };
  }).filter(Boolean);
}

export async function fetchSettings() {
  const rows = await fetchSheet(SHEET_TABS.SETTINGS, { headers: 1, range: "A2:D" });
  // Settings tab is a KEY/VALUE/NOTES table  collapse to a plain object
  const out = {};
  rows.forEach(r => {
    const k = r.KEY || r.key;
    const v = r.VALUE ?? r.value ?? "";
    if (k) out[k] = v;
  });
  return out;
}

export async function fetchDisposalRegister() {
  try { return await fetchSheet(SHEET_TABS.DISPOSAL, { headers: 1, range: "A2:M" }); }
  catch { return []; }
}

export async function fetchReprintLog() {
  try { return await fetchSheet(SHEET_TABS.REPRINTS, { headers: 1, range: "A2:M" }); }
  catch { return []; }
}

export async function fetchAuditLog() {
  try { return await fetchSheet(SHEET_TABS.AUDIT, { headers: 1, range: "A2:L" }); }
  catch { return []; }
}

/*  Sheet write transport (Apps Script Web App)  */

/* POST a job to the Apps Script Web App. The browser cannot call the Sheets
 * write API directly without OAuth, so we hand the job off to a Web App that
 * runs as the sheet owner.
 *
 * Job shape (matches what the Apps Script doPost handler expects):
 *   { tab, op: "append_row", values: [...] }
 *   { tab, op: "cell_update", cell: "Q42", value: "NEH-U1-BM-000001" }
 *
 * Uses Content-Type: text/plain to dodge the CORS preflight (Apps Script does
 * not reply to OPTIONS); Apps Script still receives the JSON body via
 * e.postData.contents and parses it.
 *
 * Never throws  on failure logs and returns { ok:false, error }. Callers are
 * responsible for deciding whether a sheet-mirror miss is fatal (none are
 * today; the canonical record is in Firestore).
 */
export async function postSheetJob(job) {
  if (!APPS_SCRIPT_URL) {
    console.warn("[postSheetJob] APPS_SCRIPT_URL not set in firebase-config.js  skipping sheet write");
    return { ok: false, error: "APPS_SCRIPT_URL not configured" };
  }
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(job),
      redirect: "follow",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[postSheetJob] HTTP", res.status, text.slice(0, 240));
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json().catch(() => ({ ok: false, error: "non-JSON response" }));
    if (!data.ok) console.warn("[postSheetJob] script reported error:", data.error);
    return data;
  } catch (e) {
    console.warn("[postSheetJob] fetch failed:", e);
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/* Append-row helper. Signature kept compatible with the previous
 * Firestore-queue version  the (db, addDoc, collection) parameters are now
 * unused but accepting them keeps every existing caller working unchanged.
 *
 *   tab:     sheet tab name from SHEET_TABS
 *   values:  ordered array matching that tab's column order
 */
export async function queueSheetWrite(_db, _addDoc, _collection, tab, values, meta = {}) {
  return postSheetJob({ tab, op: "append_row", values, meta });
}
