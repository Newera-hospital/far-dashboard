/* asset_id.js  production Asset ID allocator.
 *
 * One responsibility: turn a pending sheet row into a canonical Asset ID that
 * is unique within its unit+location+custodian series, monotonic, immutable,
 * and mirrored back to the Google Sheet via the write-queue.
 *
 * Format:  NEH-{UNIT_CODE}-{LOCATION_CODE}-{CUSTODIAN_CODE}-{4-digit sequence}
 * Example: NEH-U1-ICU-BME-0001
 *
 * Sequence is 4 digits (max 9999 per location+custodian series). If you ever
 * cross 9999 in a single series, bump SEQ_DIGITS; the format will widen but
 * uniqueness is preserved. Old IDs from earlier deployments coexist fine.
 *
 * Each location+custodian pair has its own independent counter:
 *   entities/{eid}/counters/seq_LOC_ICU_CUST_BME
 *   entities/{eid}/counters/seq_LOC_OT_CUST_BME
 *   entities/{eid}/counters/seq_LOC_ADMIN_BLOCK_CUST_MA
 *
 * Rules enforced here:
 *   1. Uniqueness: atomic transaction on the per-location+custodian counter doc
 *      guarantees no two concurrent callers get the same sequence.
 *   2. Immutability: once the asset doc is written, Firestore rules forbid
 *      changing the asset_id field.
 *   3. One-time generation: the allocator refuses to overwrite an existing
 *      asset doc at the same ID.
 *   4. Sheet sync: POSTs a cell_update job to the Apps Script Web App
 *      which writes the new ID into column Q of the matching row.
 *
 * Concurrency notes:
 *   - runTransaction retries on contention automatically.
 *   - Each location+custodian counter is an independent hotspot; ICU-BME
 *     allocations do not contend with OT-BME or ICU-IT allocations.
 */

import { runTransaction, doc, serverTimestamp } from
  "https://www.gstatic.com/firebasejs/10.12.1/firebase-firestore.js";
import { db, auth } from "./firebase-config.js";
import { postSheetJob } from "./sheets.js";

const SEQ_DIGITS = 4;
const pad = (n) => String(n).padStart(SEQ_DIGITS, "0");
const MAX_COLLISION_SCAN = 200;

const LOCATION_CODE_OVERRIDES = Object.freeze({
  "operation theatre": "OT",
  "ot": "OT",
  "icu": "ICU",
  "emergency": "ER",
  "radiology": "RAD",
  "pathology": "PATH",
  "pharmacy": "PHARM",
  "administration": "ADMIN",
  "admin": "ADMIN",
  "it": "IT",
  "biomedical": "BM",
  "maintenance": "MT",
  "ward general": "WARD",
  "ward private": "WARDP",
  "opd": "OPD",
});

const CUSTODIAN_CODE_OVERRIDES = Object.freeze({
  "it": "IT",
  "information technology": "IT",
  "informationtechnology": "IT",
  "bio medical": "BME",
  "biomedical": "BME",
  "bio-medical": "BME",
  "biomed": "BME",
  "bme": "BME",
  "bm": "BME",
  "maintenance": "MA",
  "maint": "MA",
  "ma": "MA",
  "mt": "MA",
});

function cleanToken(value) {
  return String(value || "")
    .trim()
    .replace(/&/g, " and ")
    .replace(/\s*[-_/]\s*/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeEntityCode(entityCode, entityId) {
  const raw = cleanToken(entityCode || entityId).toUpperCase().replace(/\s+/g, "-");
  if (!raw) throw new Error("allocateAssetId: entityCode/entityId required");
  if (raw.startsWith("NEH-U")) return raw;
  if (/^U\d+$/i.test(raw)) return `NEH-${raw}`;
  return raw.startsWith("NEH-") ? raw : `NEH-${raw}`;
}

function resolveLocationCode(location) {
  const cleaned = cleanToken(location);
  if (!cleaned) throw new Error("allocateAssetId: location/department is required for the Asset ID");

  const key = cleaned.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  if (LOCATION_CODE_OVERRIDES[key]) return LOCATION_CODE_OVERRIDES[key];

  const words = key.split(/\s+/).filter(Boolean);
  if (!words.length) throw new Error(`allocateAssetId: invalid location "${location}"`);
  if (words.length === 1 && words[0].length <= 8) return words[0].toUpperCase();

  const initials = words.map(w => w[0]).join("").toUpperCase();
  return (initials || key.replace(/[^a-z0-9]/g, "").slice(0, 8).toUpperCase()).slice(0, 8);
}

function resolveCustodianCode(custodian) {
  const cleaned = cleanToken(custodian);
  if (!cleaned) throw new Error("allocateAssetId: custodian department is required for the Asset ID");

  const key = cleaned.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  const compact = key.replace(/\s+/g, "");
  if (CUSTODIAN_CODE_OVERRIDES[key]) return CUSTODIAN_CODE_OVERRIDES[key];
  if (CUSTODIAN_CODE_OVERRIDES[compact]) return CUSTODIAN_CODE_OVERRIDES[compact];

  const words = key.split(/\s+/).filter(Boolean);
  const initials = words.length > 1 ? words.map(w => w[0]).join("") : compact.slice(0, 3);
  const code = initials.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  if (!code) throw new Error(`allocateAssetId: invalid custodian "${custodian}"`);
  return code;
}

/**
 * Allocate the next Asset ID for the entity+location+custodian pair and persist the asset doc.
 *
 * @param {Object} params
 * @param {string} params.entityId    Firestore entity doc id (e.g. "NEH-U1")
 * @param {string} params.entityCode  unit code used as ID prefix (usually == entityId)
 * @param {string} params.location    asset location/department used in the ID
 * @param {string} params.custodian   custodian department used in the ID
 * @param {Object} params.row         the sheet row object from sheets.js fetchAssets()
 * @param {boolean} [params.mirrorSheet=true]  write Asset_ID back to Sheet column Q
 * @returns {Promise<string>} the newly-allocated Asset ID (e.g. "NEH-U1-ICU-BME-0001")
 */
export async function allocateAssetId({ entityId, entityCode, location, custodian, row, mirrorSheet = true }) {
  if (!entityId) throw new Error("allocateAssetId: entityId required");
  if (!row || !row.sheet_row)   throw new Error("allocateAssetId: row.sheet_row required");
  if (row.id)                    throw new Error(`Row already has Asset ID ${row.id}`);

  const prefix = normalizeEntityCode(entityCode, entityId);
  const locationCode = resolveLocationCode(location || row.dept || row.location);
  const effectiveCustodian = custodian || row.custodian || "";
  const custodianCode = resolveCustodianCode(effectiveCustodian);

  const userEmail = auth.currentUser?.email || "system";

  // Per-location+custodian counter: seq_LOC_ICU_CUST_BME, etc.
  const counterRef = doc(db, "entities", entityId, "counters", `seq_LOC_${locationCode}_CUST_${custodianCode}`);
  const rowLockRef = doc(db, "entities", entityId, "asset_allocations", `sheet_row_${row.sheet_row}`);

  let reusedExistingAllocation = false;
  const assetId = await runTransaction(db, async (tx) => {
    const lockSnap = await tx.get(rowLockRef);
    if (lockSnap.exists() && lockSnap.data().asset_id) {
      reusedExistingAllocation = true;
      return lockSnap.data().asset_id;
    }
    reusedExistingAllocation = false;

    const snap = await tx.get(counterRef);
    let nextSeq = (snap.exists() ? (snap.data().value || 0) : 0) + 1;
    let aid = "";
    let assetRef = null;

    for (let attempt = 0; attempt < MAX_COLLISION_SCAN; attempt++) {
      aid = `${prefix}-${locationCode}-${custodianCode}-${pad(nextSeq)}`;
      assetRef = doc(db, "entities", entityId, "assets", aid);
      const existing = await tx.get(assetRef);
      if (!existing.exists()) break;
      nextSeq++;
      aid = "";
      assetRef = null;
    }

    if (!aid || !assetRef) {
      throw new Error(`Could not allocate next ID for ${prefix}-${locationCode}-${custodianCode}; too many existing collisions. Contact admin.`);
    }

    tx.set(counterRef, {
      value:      nextSeq,
      prefix,
      location_code: locationCode,
      custodian_code: custodianCode,
      location_source: location || row.dept || row.location || "",
      custodian_source: effectiveCustodian,
      updated_at: serverTimestamp(),
      updated_by: userEmail,
    });

    tx.set(assetRef, {
      asset_id:          aid,
      entity_id:         entityId,
      description:       row.desc     || "",
      department:        row.dept     || "",
      location:          row.location || "",
      category:          row.cat      || "",
      invoice_no:        row.invoice  || "",
      invoice_date:      row.invDate  || "",
      vendor:            row.vendor   || "",
      serial_no:         row.serial   || "",
      model_no:          row.model    || "",
      purchase_value:    row.value    || "",
      put_to_use_date:   row.itu      || "",
      useful_life_years: row.life     || "",
      dep_method:        row.depMeth  || "WDV",
      remarks:           row.remarks  || "",
      state:             "active_untagged",
      qr_status:         "pending",

      location_code:         locationCode,
      custodian_code:        custodianCode,
      custodian_department:  effectiveCustodian,
      condition:            row.condition  || "unknown",
      source:               row.source     || "legacy_discovery",
      voucher_ref:          row.voucherRef || "",
      last_verified_on:     null,
      last_verified_by:     null,

      sheet_row:    row.sheet_row,
      allocated_on: serverTimestamp(),
      allocated_by: userEmail,
      created_at:   serverTimestamp(),
    });

    tx.set(rowLockRef, {
      asset_id:   aid,
      sheet_row:  row.sheet_row,
      location:   location || row.dept || row.location || "",
      location_code: locationCode,
      custodian:  effectiveCustodian,
      custodian_code: custodianCode,
      created_at: serverTimestamp(),
      created_by: userEmail,
    });

    return aid;
  });

  // Mirror the allocation back to column Q in the sheet. Non-fatal if it fails
  // (Firestore is the canonical store; the sheet is a mirror for finance).
  if (!reusedExistingAllocation && mirrorSheet) {
    await postSheetJob({
      tab:   "Invoice_Asset_Intake",
      op:    "cell_update",
      cell:  `Q${row.sheet_row}`,
      value: assetId,
      meta:  { kind: "Asset ID Allocation", aid: assetId, sheet_row: row.sheet_row, location_code: locationCode, custodian_code: custodianCode, custodian: effectiveCustodian, entity_id: entityId },
    });
  }

  return assetId;
}
