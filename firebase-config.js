import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-app.js";
import { getAuth }       from "https://www.gstatic.com/firebasejs/10.12.1/firebase-auth.js";
import { getFirestore }  from "https://www.gstatic.com/firebasejs/10.12.1/firebase-firestore.js";

export const firebaseConfig = {
  apiKey:            "AIzaSyDFqMpDNqV4Pmw1btUXgl6ZMkypAaFIMFw",
  authDomain:        "new-era-hospital-far.firebaseapp.com",
  projectId:         "new-era-hospital-far",
  storageBucket:     "new-era-hospital-far.firebasestorage.app",
  messagingSenderId: "524636575552",
  appId:             "1:524636575552:web:488c6a931e38c55586cca5"
};

// Unit-1 Google Sheet (finance-owned intake register).
// Sheet must be shared as "Anyone with the link  Viewer" for the web app to read it
// via the gviz/tq endpoint. Writes (audit/reprint/disposal mirror, Asset_ID write-back)
// go through an Apps Script Web App  see APPS_SCRIPT_URL below.
export const SHEET_ID  = "1B18RLVjPpIaWWPRXCQI6yQDMBrvckJ5to23Fw9EAOGU";
export const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;

// Apps Script Web App URL for sheet writes. Paste the deployed exec URL here.
// To get this: open the sheet  Extensions > Apps Script  paste setup_sheet.gs
// (already includes doPost handler)  Deploy > New deployment > type "Web app"
//  Execute as: Me, Who has access: Anyone  Deploy  copy the /exec URL.
// Leave empty to disable sheet write-back (the rest of the app still works).
export const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyKyHrPntHRosB-_DGBeP2QE4YtX2l8IoiVoYJRsZw8DNHiVcPiKUBsWkTHnml4smhn/exec";

// Shared secret sent on every POST so the Apps Script can ignore unauthenticated
// callers. Must match the SHARED_SECRET constant in setup_sheet.gs.
// IMPORTANT: keep your GitHub repo private if this string is committed; rotate
// the secret if the repo ever goes public. Anyone with this value can write to
// your sheet via the Web App.
export const APPS_SCRIPT_SECRET = "neh-far-2026-rotate-me-q9s7v3kl";
export const SCAN_BASE = location.origin.includes("github.io")
  ? `${location.origin}${location.pathname.replace(/[^/]*$/, "")}scan.html?id=`
  : `${location.origin}${location.pathname.replace(/[^/]*$/, "")}scan.html?id=`;

// Sheet tab names  must match the Google Sheet tabs exactly.
export const SHEET_TABS = {
  SETTINGS:    "Settings",
  MASTERS:     "Masters",
  INTAKE:      "Invoice_Asset_Intake",
  QR_REGISTER: "QR_Control_Register",
  REPRINTS:    "Reprint_Requests",
  DISPOSAL:    "Disposal_Register",
  AUDIT:       "Audit_Log",
};

// Canonical role values  referenced from every page and from Firestore rules.
// Do not introduce new roles without also updating the rules.
export const ROLES = Object.freeze({
  GLOBAL_ADMIN: "global_admin",
  SUB_ADMIN:    "sub_admin",
});

export const STATES = Object.freeze({
  ACTIVE_UNTAGGED:   "active_untagged",
  ACTIVE_TAGGED:     "active_tagged",
  UNDER_MAINTENANCE: "under_maintenance",
  DISPOSED:          "disposed",
  WRITTEN_OFF:       "written_off",
  DESTROYED:         "destroyed",
  TRANSFERRED_OUT:   "transferred_out",
});

export const QR_STATUS = Object.freeze({
  PENDING: "pending",
  ISSUED:  "issued",
});

// Custodian department = the department responsible for the asset's upkeep,
// distinct from the user department where it's physically deployed.
// e.g. a ventilator in ICU is custodian-BioMedical, location-ICU.
export const CUSTODIAN = Object.freeze({
  IT:          "IT",
  BIOMEDICAL:  "BioMedical",
  MAINTENANCE: "Maintenance",
});

// Legacy custody code map, kept for reports/imports that may still refer to
// short custody codes. New Asset IDs no longer use this value; asset_id.js now
// uses hospital + unit + location + sequence, e.g. NEH-U1-ICU-001.
export const CUSTODIAN_CODE = Object.freeze({
  IT:          "IT",
  BioMedical:  "BM",
  Maintenance: "MT",
});

export const CONDITION = Object.freeze({
  WORKING:      "working",
  NEEDS_REPAIR: "needs_repair",
  NOT_WORKING:  "not_working",
  NOT_FOUND:    "not_found",
  UNKNOWN:      "unknown",
});

// Source marks how the row entered the register  legacy discovery (Phase 1,
// physical walk-through) vs purchase intake (Phase 2, finance-populated).
// Reports separate the two so auditors can tell baseline rows from fresh ones.
export const SOURCE = Object.freeze({
  LEGACY_DISCOVERY: "legacy_discovery",
  PURCHASE_INTAKE:  "purchase_intake",
});

// Default entity the operator is working inside. Real deployments derive this
// from the user's entityIds[] or the ?eid= URL param. Hardcoded during P1.
export const DEFAULT_ENTITY_ID   = "NEH-U1";
export const DEFAULT_ENTITY_CODE = "NEH-U1";

const app = initializeApp(firebaseConfig);

// ---- App Check (anti-abuse for the public scan surface) ------------------
//
// App Check protects scan_logs / scan_concerns from being spammed by anyone
// who finds the QR URL. It's optional  the app works fine without it  but
// recommended once you have a public deployment.
//
// To enable:
//   1. Firebase Console > Project settings > App Check > Register the web app.
//   2. Choose reCAPTCHA v3 (free tier) and copy the site key.
//   3. Set RECAPTCHA_SITE_KEY below to that value.
//   4. (Optional) Enforce App Check on Firestore once you've verified things work.
//
// Leave RECAPTCHA_SITE_KEY empty to skip activation. No-op if the SDK fails.
const RECAPTCHA_SITE_KEY = "";
if (RECAPTCHA_SITE_KEY) {
  // Lazy-load to avoid blocking the rest of init when not configured.
  import("https://www.gstatic.com/firebasejs/10.12.1/firebase-app-check.js")
    .then(({ initializeAppCheck, ReCaptchaV3Provider }) => {
      try {
        initializeAppCheck(app, {
          provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
          isTokenAutoRefreshEnabled: true,
        });
      } catch (e) { console.warn("[AppCheck] init failed:", e); }
    })
    .catch(e => console.warn("[AppCheck] SDK load failed:", e));
}

export const auth = getAuth(app);
export const db   = getFirestore(app);
