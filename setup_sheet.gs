/**
 * New Era Hospital FAR - Sheet Builder + Web App writer
 *
 * Two responsibilities live in this file:
 *
 * 1) Workbook builder (run from inside the sheet)
 *    - Open the sheet, Extensions > Apps Script, paste this file, run
 *      rebuildFARWorkbook() to (re)create FAR tabs/headers/dropdowns.
 *
 * 2) Sheet write Web App (called from the FAR website)
 *    - The browser cannot write to Google Sheets directly. The website POSTs
 *      jobs to this script (function doPost) which writes to the sheet.
 *    - Deploy: Deploy > New deployment > type "Web app" > Execute as: Me,
 *      Who has access: Anyone > Deploy. Copy the /exec URL and paste it into
 *      firebase-config.js as APPS_SCRIPT_URL.
 *    - Re-deploy whenever you change doPost (Deploy > Manage deployments >
 *      pencil icon > New version > Deploy). The /exec URL stays the same.
 *
 * Layout rule:
 * - Invoice_Asset_Intake columns A:P are finance / department entry columns.
 * - Column Q is Asset_ID. Do not move it; asset_id.js writes generated IDs to Q.
 * - Columns Q:V are system-controlled by the website/backend.
 * - Dropdown values come from the Masters tab.
 */

/* ----------  Web App writer (called by the FAR website) ---------- */

/**
 * Shared secret. Must match APPS_SCRIPT_SECRET in firebase-config.js. Posts that
 * don't carry this string in their JSON body are rejected. Rotate this value
 * whenever you rotate the matching constant in firebase-config.js  any old
 * deployment of the website will then be unable to write to the sheet.
 */
const SHARED_SECRET = "neh-far-2026-rotate-me-q9s7v3kl";

/**
 * HTTP entry point. The browser POSTs JSON jobs of two shapes:
 *
 *   Append a row:
 *     { "tab": "Audit_Log", "op": "append_row", "values": [...], "meta": {...} }
 *
 *   Update one cell:
 *     { "tab": "Invoice_Asset_Intake", "op": "cell_update",
 *       "cell": "Q42", "value": "NEH-U1-ICU-001", "meta": {...} }
 *
 * The website POSTs with Content-Type: text/plain to avoid CORS preflight
 * (Apps Script Web Apps don't reply to OPTIONS). The body is still JSON; we
 * parse it from e.postData.contents.
 *
 * Always returns JSON: { ok: true, ... } on success, { ok: false, error } on
 * failure. Failures are logged to Stackdriver (View > Logs in the editor).
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut_({ ok: false, error: "empty request body" });
    }
    const job = JSON.parse(e.postData.contents);

    // Reject anything that doesn't carry the right shared secret. Public Web
    // Apps deployed as "Anyone" are world-reachable; this check is what keeps
    // random callers from spamming our sheet.
    if (!job || job.secret !== SHARED_SECRET) {
      return jsonOut_({ ok: false, error: "forbidden" });
    }

    const tab = String(job.tab || "").trim();
    if (!tab) return jsonOut_({ ok: false, error: "missing 'tab'" });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(tab);
    if (!sh) return jsonOut_({ ok: false, error: "tab not found: " + tab });

    const op = String(job.op || (job.cell ? "cell_update" : "append_row")).trim();

    if (op === "cell_update") {
      if (!job.cell) return jsonOut_({ ok: false, error: "cell_update requires 'cell'" });
      const value = (job.value === null || job.value === undefined) ? "" : job.value;
      sh.getRange(String(job.cell)).setValue(value);
      SpreadsheetApp.flush();
      return jsonOut_({ ok: true, op: op, tab: tab, cell: job.cell });
    }

    if (op === "append_row") {
      const values = Array.isArray(job.values) ? job.values.map(coerceCell_) : [];
      if (!values.length) return jsonOut_({ ok: false, error: "append_row requires non-empty 'values'" });
      sh.appendRow(values);
      SpreadsheetApp.flush();
      return jsonOut_({ ok: true, op: op, tab: tab, count: values.length });
    }

    return jsonOut_({ ok: false, error: "unsupported op: " + op });
  } catch (err) {
    return jsonOut_({ ok: false, error: (err && err.message) ? err.message : String(err) });
  }
}

/**
 * GET handler: lets you sanity-check the deployment by visiting the /exec URL
 * in a browser. Returns a small JSON ping.
 */
function doGet() {
  return jsonOut_({ ok: true, service: "NEH FAR Sheet Writer", time: new Date().toISOString() });
}

function coerceCell_(v) {
  if (v === null || v === undefined) return "";
  // Sheets accepts strings/numbers/booleans/Dates as-is. Stringify objects so
  // the row doesn't break if a caller accidentally passes nested data.
  if (typeof v === "object" && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ----------  Workbook builder ---------- */

const FAR = {
  maxRows: 1500,
  tabs: {
    settings: "Settings",
    masters: "Masters",
    intake: "Invoice_Asset_Intake",
    qr: "QR_Control_Register",
    reprints: "Reprint_Requests",
    disposal: "Disposal_Register",
    audit: "Audit_Log",
  },
};

function rebuildFARWorkbook() {
  const ui = SpreadsheetApp.getUi();
  const confirm = ui.alert(
    "Rebuild FAR workbook?",
    "This will clear and rebuild FAR tabs, headers, dropdowns, formulas, and formatting. Existing rows inside FAR tabs will be removed. Continue?",
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  buildSettings_(ss);
  buildMasters_(ss);
  buildIntake_(ss);
  removeSheetIfExists_(ss, "Depreciation_Working");
  buildQRRegister_(ss);
  buildReprints_(ss);
  buildDisposal_(ss);
  buildAudit_(ss);

  ss.toast("FAR workbook rebuilt.", "Done", 5);
}

function addDropdownsOnly() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const masters = ss.getSheetByName(FAR.tabs.masters);
  const intake = ss.getSheetByName(FAR.tabs.intake);

  if (!masters || !intake) {
    ui.alert("Missing required tabs", "Masters or Invoice_Asset_Intake tab not found. Run rebuildFARWorkbook first.", ui.ButtonSet.OK);
    return;
  }

  const start = 3;
  const end = Math.max(FAR.maxRows, intake.getMaxRows());
  const linked = applyMasterDropdowns_(ss, intake, start, end);
  styleIntakeZones_(intake);

  ss.toast(linked.length ? "Dropdowns refreshed from Masters." : "No dropdown columns found.", "Done", 3);
}

function buildSettings_(ss) {
  const sh = resetSheet_(ss, FAR.tabs.settings);
  banner_(sh, "SETTINGS | NEW ERA HOSPITAL FAR", 4);
  setHeader_(sh, 2, ["KEY", "VALUE", "NOTES", "LOCKED"]);
  const rows = [
    ["ENTITY_ID", "NEH-U1", "Must match Firebase entity/company ID", "YES"],
    ["ENTITY_CODE", "NEH-U1", "Prefix used in generated Asset IDs", "YES"],
    ["ENTITY_NAME", "New Era Hospital - Unit 1", "Display name", "NO"],
    ["CITY", "Nagpur", "Unit city/location", "NO"],
    ["FISCAL_YEAR_START_MONTH", "4", "April = 4", "NO"],
    ["SCAN_BASE_URL", "", "Optional. Website derives this automatically if blank.", "NO"],
  ];
  sh.getRange(3, 1, rows.length, rows[0].length).setValues(rows);
  finish_(sh, 4);
}

function buildMasters_(ss) {
  const sh = resetSheet_(ss, FAR.tabs.masters);
  banner_(sh, "MASTERS | Edit all dropdown values here", 14);
  const masters = [
    ["Departments", ["ICU", "OPD", "Emergency", "Operation Theatre", "Radiology", "Pathology", "Pharmacy", "Ward - General", "Ward - Private", "Administration", "Reception", "Housekeeping", "Kitchen", "IT", "BioMedical", "Maintenance", "Other"]],
    ["Locations", ["Admin Block", "ICU Block", "OT Block", "Radiology Block", "Pathology Lab", "Pharmacy", "Ward", "Store", "Other"]],
    ["Asset_Categories", ["IT Equipment", "Medical Equipment", "Furniture & Fixtures", "Office Equipment", "HVAC & Electrical", "Vehicles", "Laboratory Equipment", "Other"]],
    ["Custodian_Departments", ["IT", "BioMedical", "Maintenance"]],
    ["Dep_Methods", ["WDV", "SLM"]],
    ["QR_Status", ["pending", "issued", "printed"]],
    ["Asset_States", ["active_untagged", "active_tagged", "under_maintenance", "disposed", "written_off", "destroyed", "transferred_out", "blocked"]],
    ["Public_Scan_States", ["show_active", "show_restricted", "show_disposed", "show_written_off", "show_destroyed", "disabled"]],
    ["Reprint_Reasons", ["Label Damaged / Torn", "Label Faded / Unreadable", "Label Lost / Missing", "Asset Transferred", "First Print Failed", "Other"]],
    ["Disposal_Types", ["Disposed", "Written Off", "Destroyed", "Transferred Out", "Blocked"]],
  ];

  masters.forEach((m, idx) => {
    const col = idx + 1;
    sh.getRange(2, col).setValue(m[0]).setFontWeight("bold").setFontColor("#ffffff").setBackground("#166534").setHorizontalAlignment("center");
    sh.getRange(3, col, m[1].length, 1).setValues(m[1].map(v => [v]));
    sh.setColumnWidth(col, 190);
  });
  sh.setFrozenRows(2);
}

function buildIntake_(ss) {
  const sh = resetSheet_(ss, FAR.tabs.intake);
  banner_(sh, "INVOICE ASSET INTAKE | Entry A:P | System Q:V", 22);

  const headers = [
    "Invoice_No", "Invoice_Date", "Vendor_Name", "Asset_Description",
    "Quantity", "Department", "Location", "Purchase_Value",
    "Put_to_Use_Date", "Useful_Life_Years", "Dep_Rate_Percent", "Dep_Method",
    "Asset_Category", "Serial_No", "Custodian_Department", "Remarks",
    "Asset_ID", "QR_URL", "QR_Status", "Asset_State", "Public_Scan_State",
    "Last_Updated"
  ];
  setHeader_(sh, 2, headers);
  sh.setFrozenRows(2);
  sh.setFrozenColumns(1);
  resizeColumnsExact_(sh, headers.length);

  const widths = [135,115,180,300,80,160,160,120,125,110,110,100,170,150,170,240,175,260,110,150,160,150];
  widths.forEach((w, i) => sh.setColumnWidth(i + 1, w));

  const start = 3;
  const end = FAR.maxRows;
  applyMasterDropdowns_(ss, sh, start, end);
  shadeRows_(sh, start, end, headers.length);

  const systemStartCol = col_(headers, "Asset_ID");
  const systemEndCol = col_(headers, "Last_Updated");
  const systemRange = sh.getRange(start, systemStartCol, end - start + 1, systemEndCol - systemStartCol + 1);
  systemRange.setBackground("#f0fdf4");
  sh.getRange(2, systemStartCol, 1, systemEndCol - systemStartCol + 1)
    .setNote("System-controlled by website/backend. Do not edit manually.");
  protectWithWarning_(sh, systemRange, "System columns - website/backend controlled");
  styleIntakeZones_(sh);
}

function buildQRRegister_(ss) {
  const sh = resetSheet_(ss, FAR.tabs.qr);
  banner_(sh, "QR CONTROL REGISTER | System mirror", 13);
  setHeader_(sh, 2, [
    "Asset_ID", "QR_URL", "First_Generated_On", "First_Generated_By",
    "QR_Status", "Reprint_Count", "Last_Printed_On", "Last_Printed_By",
    "Approved_By", "Label_Copies", "Permanent_QR_Hash", "Public_Scan_State", "Audit_Ref"
  ]);
  finish_(sh, 13);
}

function buildReprints_(ss) {
  const sh = resetSheet_(ss, FAR.tabs.reprints);
  banner_(sh, "REPRINT REQUESTS | System mirror", 13);
  setHeader_(sh, 2, [
    "Request_ID", "Asset_ID", "Requested_On", "Requested_By", "Reason",
    "Copies", "Status", "Approved_By", "Approved_On", "Printed_By",
    "Printed_On", "Notes", "Audit_Ref"
  ]);
  finish_(sh, 13);
  linkDropdown_(ss, sh, "Reason", "Reprint_Reasons", 3, FAR.maxRows);
}

function buildDisposal_(ss) {
  const sh = resetSheet_(ss, FAR.tabs.disposal);
  banner_(sh, "DISPOSAL REGISTER | System mirror", 13);
  setHeader_(sh, 2, [
    "Record_ID", "Asset_ID", "Asset_Name", "Disposal_Type", "Effective_Date",
    "Reason", "Approved_By", "Supporting_Ref", "Public_Scan_State",
    "Public_Message", "Logged_By", "Logged_On", "Audit_Ref"
  ]);
  finish_(sh, 13);
  linkDropdown_(ss, sh, "Disposal_Type", "Disposal_Types", 3, FAR.maxRows);
  linkDropdown_(ss, sh, "Public_Scan_State", "Public_Scan_States", 3, FAR.maxRows);
}

function buildAudit_(ss) {
  const sh = resetSheet_(ss, FAR.tabs.audit);
  banner_(sh, "AUDIT LOG | Append only", 12);
  setHeader_(sh, 2, [
    "Audit_ID", "Timestamp", "User_Email", "User_Role", "Action",
    "Asset_ID", "Old_Value", "New_Value", "Notes", "Source",
    "Request_ID", "Entity_ID"
  ]);
  finish_(sh, 12);
  protectWithWarning_(sh, sh.getRange(3, 1, FAR.maxRows - 2, 12), "Audit log - append only");
}

function resetSheet_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p => p.remove());
  sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => p.remove());
  sh.clear({ contentsOnly: false });
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
  sh.setHiddenGridlines(false);
  return sh;
}

function resizeColumnsExact_(sh, requiredCols) {
  const currentCols = sh.getMaxColumns();
  if (currentCols < requiredCols) {
    sh.insertColumnsAfter(currentCols, requiredCols - currentCols);
  } else if (currentCols > requiredCols) {
    sh.deleteColumns(requiredCols + 1, currentCols - requiredCols);
  }
}

function removeSheetIfExists_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (sh && ss.getSheets().length > 1) ss.deleteSheet(sh);
}

function banner_(sh, text, cols) {
  const r = sh.getRange(1, 1, 1, cols);
  r.breakApart();
  r.clearContent().setBackground("#0a2410").setFontColor("#ffffff").setFontWeight("bold").setFontSize(11).setHorizontalAlignment("center").setVerticalAlignment("middle");
  sh.getRange(1, 1).setValue(text);
  sh.setRowHeight(1, 36);
}

function setHeader_(sh, row, headers) {
  sh.getRange(row, 1, 1, headers.length).setValues([headers])
    .setBackground("#166534")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setFontSize(10)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true);
  sh.setRowHeight(row, 34);
}

function linkDropdown_(ss, targetSheet, targetHeader, masterHeader, startRow, endRow) {
  const targetCol = findHeaderCol_(targetSheet, targetHeader);
  const masterSheet = ss.getSheetByName(FAR.tabs.masters);
  const masterCol = masterSheet ? findHeaderCol_(masterSheet, masterHeader) : null;
  if (!targetCol || !masterCol) return false;
  const source = masterSheet.getRange(3, masterCol, FAR.maxRows - 2, 1);
  const rule = SpreadsheetApp.newDataValidation().requireValueInRange(source, true).setAllowInvalid(true).build();
  targetSheet.getRange(startRow, targetCol, endRow - startRow + 1, 1).setDataValidation(rule);
  return true;
}

function applyMasterDropdowns_(ss, intakeSheet, startRow, endRow) {
  const pairs = [
    ["Department", "Departments"],
    ["Location", "Locations"],
    ["Asset_Category", "Asset_Categories"],
    ["Custodian_Department", "Custodian_Departments"],
    ["Dep_Method", "Dep_Methods"],
    ["QR_Status", "QR_Status"],
    ["Asset_State", "Asset_States"],
    ["Public_Scan_State", "Public_Scan_States"],
  ];
  const linked = [];
  pairs.forEach(([target, master]) => {
    if (linkDropdown_(ss, intakeSheet, target, master, startRow, endRow)) {
      linked.push(target + " -> Masters." + master);
    }
  });
  return linked;
}

function styleIntakeZones_(sh) {
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const assetIdCol = findHeaderCol_(sh, "Asset_ID");
  const lastUpdatedCol = findHeaderCol_(sh, "Last_Updated");

  if (lastCol >= 16) sh.getRange(2, 1, 1, 16).setBackground("#166534");
  if (assetIdCol && lastUpdatedCol) {
    sh.getRange(2, assetIdCol, 1, lastUpdatedCol - assetIdCol + 1)
      .setBackground("#0f766e")
      .setNote("System-controlled by website/backend. Do not edit manually.");
    sh.getRange(3, assetIdCol, Math.max(sh.getMaxRows() - 2, 1), lastUpdatedCol - assetIdCol + 1)
      .setBackground("#f0fdf4");
  }
}

function findHeaderCol_(sh, header) {
  const row = sh.getName() === FAR.tabs.masters ? 2 : 2;
  const headers = sh.getRange(row, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  const idx = headers.indexOf(header);
  return idx >= 0 ? idx + 1 : null;
}

function col_(headers, name) {
  const idx = headers.indexOf(name);
  if (idx < 0) throw new Error("Missing header: " + name);
  return idx + 1;
}

function protectWithWarning_(sh, range, description) {
  const protection = range.protect().setDescription(description);
  protection.setWarningOnly(true);
}

function shadeRows_(sh, startRow, endRow, cols) {
  const rows = endRow - startRow + 1;
  const backgrounds = [];
  for (let i = 0; i < rows; i++) {
    backgrounds.push(new Array(cols).fill((startRow + i) % 2 === 0 ? "#f8fafc" : "#ffffff"));
  }
  sh.getRange(startRow, 1, rows, cols).setBackgrounds(backgrounds);
}

function finish_(sh, cols) {
  sh.setFrozenRows(2);
  for (let c = 1; c <= cols; c++) sh.autoResizeColumn(c);
  shadeRows_(sh, 3, FAR.maxRows, cols);
}
