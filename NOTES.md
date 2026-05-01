# New Era Hospital FAR - Current Guide

Last updated: 2026-04-30

This file is the operating guide for the Fixed Asset Register website. Keep it updated whenever Google Sheet structure, Asset ID format, Firebase rules, QR scan display, or deployment steps change.

## 1. What This App Does

The system has four main pages:

| File | Used by | Purpose |
|---|---|---|
| `index.html` | Staff/admin | Login page |
| `admin.html` | Global admin | Companies/units, users, roles |
| `dashboard.html` | Admin/sub-admin staff | FAR operations, asset list, QR generation, reprints, disposal, maintenance, reports |
| `scan.html` | Public/staff scanner | Public QR scan page for one asset |

Main data flow:

1. Finance/management enters asset rows in Google Sheet.
2. Website reads those rows from Google Sheet.
3. Admin allocates Asset IDs in the dashboard.
4. Firestore stores the canonical asset records.
5. The Asset ID is written back to Google Sheet column `Q`.
6. QR codes publish selected scan details to the public `scan.html` page.

Firestore is the operational system. Google Sheet is the finance/management working file and mirror.

## 2. Current Folder Upload List

Upload these files to GitHub:

- `admin.html`
- `asset_id.js`
- `audit.js`
- `dashboard.html`
- `firebase-config.js`
- `firestore.rules`
- `index.html`
- `NewERA logo.png`
- `NOTES.md`
- `scan.html`
- `setup_sheet.gs`
- `sheets.js`

Do not upload:

- `.claude/`
- `.env`
- `node_modules`
- local backup zip files

## 3. Google Sheet Layout

Main intake tab:

`Invoice_Asset_Intake`

The website now reads this range:

`A2:V`

Meaning:

- Row 1 is banner/title.
- Row 2 is the real header row.
- Row 3 onward is data.

Important columns:

| Column | Header | Owner |
|---|---|---|
| A | `Invoice_No` | Finance/manual |
| B | `Invoice_Date` | Finance/manual |
| C | `Vendor_Name` | Finance/manual |
| D | `Asset_Description` | Finance/manual |
| E | `Quantity` | Finance/manual |
| F | `Department` | Finance/manual |
| G | `Location` | Finance/manual |
| H | `Purchase_Value` | Finance/manual |
| I | `Put_to_Use_Date` | Finance/manual |
| J | `Useful_Life_Years` | Finance/manual |
| K | `Dep_Rate_Percent` | Finance/manual |
| L | `Dep_Method` | Finance/manual |
| M | `Asset_Category` | Finance/manual |
| N | `Serial_No` | Finance/manual |
| O | `Custodian_Department` | Finance/manual |
| P | `Remarks` | Finance/manual |
| Q | `Asset_ID` | Website writes here |
| R | `QR_URL` | Website/system |
| S | `QR_Status` | Website/system |
| T | `Asset_State` | Website/system |
| U | `Public_Scan_State` | Website/system |
| V | `Last_Updated` | Website/system |

Do not move column `Q`. `asset_id.js` writes generated IDs to column `Q`.

## 4. Asset ID Format

Current Asset ID format:

`NEH-U1-ICU-BME-0001`

Meaning:

- `NEH` = New Era Hospital group, always.
- `U1`, `U2`, etc. = hospital unit.
- `ICU`, `OT`, `RAD`, etc. = location/department code.
- `BME`, `IT`, `MA` = custodian initials for BioMedical, IT, or Maintenance.
- `0001` = sequence number for that unit, location, and custodian series.

Examples:

- `NEH-U1-ICU-BME-0001`
- `NEH-U1-OT-BME-0001`
- `NEH-U2-RAD-IT-0001`

Current allocator:

- File: `asset_id.js`
- Function: `allocateAssetId(...)`
- Counter path example: `entities/NEH-U1/counters/seq_LOC_ICU_CUST_BME`
- Row lock path example: `entities/NEH-U1/asset_allocations/sheet_row_42`

Why row locks exist:

- If user clicks allocate twice, the same row reuses the same Asset ID.
- This prevents duplicate Asset IDs and duplicate sequence burning.

## 5. Google Sheet Read and Write

Read direction:

- Browser reads the public Google Sheet using Google's `gviz/tq` endpoint.
- File: `sheets.js`
- Function: `fetchAssets()`
- Sheet must be shared as `Anyone with the link - Viewer`.

Write direction:

- Browser cannot write directly to Google Sheet.
- Website sends write jobs to Apps Script Web App.
- File: `setup_sheet.gs`
- Function: `doPost(e)`
- Website URL config: `firebase-config.js` -> `APPS_SCRIPT_URL`

Write job examples:

```json
{
  "tab": "Invoice_Asset_Intake",
  "op": "cell_update",
  "cell": "Q42",
  "value": "NEH-U1-ICU-BME-0001"
}
```

Bulk write example used for fast ID allocation:

```json
{
  "tab": "Invoice_Asset_Intake",
  "op": "batch_cell_update",
  "updates": [
    { "cell": "Q42", "value": "NEH-U1-ICU-BME-0001" },
    { "cell": "Q43", "value": "NEH-U1-ICU-IT-0001" }
  ]
}
```

```json
{
  "tab": "Audit_Log",
  "op": "append_row",
  "values": ["AUD-001", "2026-04-30T10:00:00", "admin@example.com"]
}
```

## 6. Asset List Table

Current Asset List columns in `dashboard.html`:

- Asset ID
- Description
- Dept
- Location
- Custodian
- Category
- Vendor
- Serial No.
- Invoice
- Invoice Date
- Put to Use Date
- Value
- Remarks
- State
- QR Status
- Actions

The table is intentionally wide and horizontally scrollable.

Search now includes:

- Asset ID
- Description
- Invoice
- Invoice Date
- Serial No.
- Model
- Vendor
- Remarks
- Department
- Location
- Custodian

## 7. Public Scan Page

File:

`scan.html`

Public scan data comes from Firestore collection:

`scan_data/{assetId}`

The page listens in real time using Firestore `onSnapshot`, so changes to `scan_data` reflect without requiring a page rebuild.

Public scan visibility is controlled from:

- Dashboard global scan settings
- Asset profile scan visibility box

Visible fields supported:

- Description
- Department
- Location
- Category
- Put to Use Date
- Invoice number
- Custodian
- Remarks

Current public FAR note shown on scan page:

> Details shown are based on the asset list finalised by management for inclusion in the Fixed Asset Register as at 31-Mar-2026. Reconciliation with the books of account may be required.

## 8. In-App Guidebook

The dashboard has an in-app guidebook opened by the `Guide` button in the top bar.

File:

`dashboard.html`

Current guide version key:

`far:guideSeen:v3`

Why this matters:

- The guide auto-shows once for users who have not seen this version.
- If guide content changes materially, bump the version key to `v3`, `v4`, etc.
- Users can reopen it anytime from the top-bar `Guide` button.

Current guidebook covers:

- Syncing Google Sheet rows
- Allocating Asset IDs like `NEH-U1-ICU-BME-0001`
- Generating QR codes
- Printing label formats and sizes
- Public scan visibility controls
- Reprints, disposal, and maintenance
- Reports and audit trail
- Keyboard shortcuts and search tips

## 9. QR / Barcode Data Reset

Use this only when you want to remove old QR data.

### Reset QR only, keep existing Asset IDs

In Google Sheet:

1. Keep column `Q` Asset_ID.
2. Clear columns `R:V` from row 3 downward.
3. Clear rows 3 downward in:
   - `QR_Control_Register`
   - `Reprint_Requests`
   - `Audit_Log` only if you want history removed

In Firebase Firestore delete:

- `scan_data`
- `scan_logs`
- `scan_concerns` if public reports should be removed
- `entities/NEH-U1/qr_codes`
- `entities/NEH-U1/reprint_requests`
- `entities/NEH-U1/print_jobs`

Optional:

- Update assets if old assets still show QR issued.

### Full reset, generate all Asset IDs again

In Google Sheet:

1. Clear columns `Q:V` from row 3 downward in `Invoice_Asset_Intake`.

In Firebase Firestore delete:

- `scan_data`
- `scan_logs`
- `scan_concerns`
- `entities/NEH-U1/assets`
- `entities/NEH-U1/asset_allocations`
- `entities/NEH-U1/counters`
- `entities/NEH-U1/qr_codes`
- `entities/NEH-U1/reprint_requests`
- `entities/NEH-U1/print_jobs`

Do not delete:

- `users`
- `user_invites`
- `entities/NEH-U1`
- `entities/NEH-U1/settings`

After reset:

1. Open dashboard.
2. Click `Sync Now`.
3. Allocate pending Asset IDs again.
4. Generate QR again.

## 10. Firestore Rules

Reference file:

`firestore.rules`

If rules change:

1. Open Firebase Console.
2. Go to Firestore Database.
3. Open Rules.
4. Paste the full contents of `firestore.rules`.
5. Publish.

Current important collections:

- `users`
- `user_invites`
- `entities/{entityId}`
- `entities/{entityId}/assets`
- `entities/{entityId}/asset_allocations`
- `entities/{entityId}/counters`
- `entities/{entityId}/qr_codes`
- `entities/{entityId}/reprint_requests`
- `entities/{entityId}/disposal_records`
- `entities/{entityId}/maintenance_tickets`
- `entities/{entityId}/print_jobs`
- `entities/{entityId}/audit_log`
- `entities/{entityId}/settings`
- `scan_data`
- `scan_logs`
- `scan_concerns`

## 11. Apps Script Deployment

When `setup_sheet.gs` changes:

1. Open the Google Sheet.
2. Go to Extensions -> Apps Script.
3. Paste latest `setup_sheet.gs`.
4. Deploy -> Manage deployments.
5. Click edit/pencil on active Web App.
6. Choose `New version`.
7. Deploy.

Deployment settings:

- Execute as: `Me`
- Who has access: `Anyone`

Do not change `Content-Type` in `sheets.js` from `text/plain`. Apps Script Web Apps do not handle CORS preflight correctly for `application/json`.

## 12. Common Problems

| Problem | Cause | Fix |
|---|---|---|
| Invoice blank in website | Sheet banner row got merged into header | Fixed by reading `A2:V` with row 2 headers |
| Sheet data not updating | Google cache or tab hidden | Website now cache-busts and auto-refreshes |
| Asset ID duplicates | Multiple clicks | Row lock and transaction prevent this |
| QR scan page not reflecting visibility change | Old `scan_data` not updated | Save Scan Settings again or save asset profile visibility |
| Google Sheet write does not happen | Apps Script Web App URL wrong or not deployed | Check `APPS_SCRIPT_URL` and redeploy script |
| Website works locally but not on GitHub | Missing file upload or wrong filename case | Upload all files except `.claude/` |

## 13. Do Not Break These Rules

- Do not move Asset_ID column away from column `Q`.
- Do not delete `users` or the global admin user doc.
- Do not delete `entities/NEH-U1/settings` unless you want to reset scan visibility settings.
- Do not reintroduce Firebase Cloud Functions unless required later.
- Do not use Google auto-login without the 15-minute/session logic.
- Do not make the public scan page show fields that admin has hidden.
- Do not edit `firestore.rules` without publishing the same rules in Firebase Console.

---

## 14. Hardening additions (2026-04-28)

This pass added a set of small safety, reporting, and UX improvements. None
required Firestore rule changes — all were code-only or documentation.

### Code changes shipped
| Item | Where | What |
|---|---|---|
| **A1** Asset ID sequence format | `asset_id.js` | IDs now include location and custodian code with 4-digit sequence, e.g. `NEH-U1-ICU-BME-0001`. Old IDs coexist; new counters are per location+custodian. |
| **A2** Re-push Asset IDs to Sheet | `dashboard.html` (Sync section) | New "Re-push Asset IDs" button walks Firestore-known assets and re-fires `cell_update` jobs for column Q. Idempotent. Throttled at 250ms/job to stay under Apps Script quota. |
| **B1** Email link cross-device | `index.html` | Sign-in link now embeds `?e=<email>` so opening the link on a different device skips the email-confirmation prompt. |
| **B2 + B3** Invite expiry + resend | `admin.html` | New invites carry `expiresAt` (+30 days). Users tab shows "Pending — expires in Xd" / "Expired Yd ago". A **Resend Invite** action refreshes the expiry. Audited as `Invite Resent`. |
| **B4** Audit quick filters | `dashboard.html` | Audit section now has Range (24h / 7d / 30d / 90d) and per-User dropdowns alongside the existing search + action filters. |
| **B6** CSV numeric exports | `dashboard.html` (`exportReport`) | Full Register and Additions CSV exports now write `Purchase Value` and `Useful Life` as plain numbers so Excel auto-totals work. |
| **B7** Last-sync pill | `dashboard.html` topbar | Shows "Synced 2 min ago" with green pulse when fresh, amber when >30 min stale. Updates every 30s. |
| **C1** Print preview page-breaks | `dashboard.html` Print Center | Preview now inserts "End of page N / Page N+1 of M" dividers every (24/12/6) labels for Small/Medium/Large sizes, so operators see how many A4 sheets they're about to print. |
| **C2** Print history per asset | `dashboard.html` asset profile | New "Print & Label History" card on the asset profile, derived from the audit log (filtered to QR/Reprint events). |
| **D1** Fiscal year filter | `dashboard.html` Reports | Reports section gains a year selector (auto-populated from data; April-start FY). Filters Additions and Disposals tables. Default = All time. |
| **D2** Additions report | `dashboard.html` Reports | New table: assets added in selected FY with put-to-use date and value totals. CSV export. |
| **D3** Ageing report | `dashboard.html` Reports | New table: pending allocations bucketed by age (fresh / 7d / 14d / 30d / stale). Helps nag finance/custodians. CSV export. |
| **D4** Printable summary | `dashboard.html` Reports | "Print Summary" button opens a print-ready A4 page with KPIs, FY activity, dept breakdown, and a sign-off block. |
| **E3** Past-useful-life report | `dashboard.html` Reports | Computes expiry as `put_to_use + useful_life_years` and lists assets past that date. CSV export. |
| **F1** Idle session expiry | already present | `startInactivityWatch()` runs every 30s and force-signs-out at 15 min idle. Verified, no change. |
| **F2** Apps Script shared secret | `firebase-config.js` + `sheets.js` + `setup_sheet.gs` | `postSheetJob()` now injects `secret` from `APPS_SCRIPT_SECRET` into every payload. The Apps Script `doPost(e)` rejects requests whose `secret` doesn't match the in-script `SHARED_SECRET` constant. **You must redeploy the Apps Script** for this to take effect (see below). |
| **F3** Batch Sheet writes | `setup_sheet.gs` + `dashboard.html` | Bulk Asset ID allocation uses `batch_cell_update`; bulk QR generation uses `batch_append_rows`. This avoids one Apps Script web call per row. **Redeploy Apps Script** after uploading this code. |
| **G1** Build version | all 4 HTML files + dashboard avatar dropdown | `<meta name="far-build">` per page; dashboard shows the value at the bottom of the user dropdown. Useful when triaging "what version was this?" |
| **A4** App Check SDK stub | `firebase-config.js` | Conditional App Check init: if `RECAPTCHA_SITE_KEY` is set, lazy-loads the App Check SDK and registers reCAPTCHA v3. Empty by default = no-op. See "External setup needed" below. |

### B5 (concurrent edit detection) — deferred

Detecting that two operators edited the same asset simultaneously needs an
`updated_at` round-trip on every update site. Deferred because:
- Touches every place we write to `assets`, `qr_codes`, `reprint_requests`,
  `disposal_records`, `maintenance_tickets`, `scan_data`, `settings`.
- Risk of breaking a working flow > value at current 1–5 operator count.
- Proper fix needs server-side `updated_at` enforcement via Firestore rules
  (compare `request.resource.data.updated_at` to `resource.data.updated_at`),
  which means another rules change.
- Revisit when ≥5 simultaneous operators are working in the system.

### A3 (sheet row drift) — operating policy, not a code fix

Asset allocation uses `row.sheet_row` (the gviz row index) as the join key
between Firestore and the sheet. If finance inserts/deletes rows in the sheet
while an operator is mid-allocation, the cell_update will land on the wrong
row.

**Operating policy** (must be communicated to finance, not enforceable in
code):
1. Finance only **appends** to `Invoice_Asset_Intake`. Never insert rows in
   the middle. Never delete rows.
2. If a row was entered in error, blank out columns A–P and add `IGNORED` to
   Remarks. Do not delete the row.
3. Operators should `Sync Now` immediately before allocating a batch of IDs to
   pull the freshest sheet rows.
4. Allocations are protected by per-row locks (`asset_allocations/sheet_row_N`)
   so re-clicking the same row never burns a new ID.

A real fix (UUID per row, or just-in-time identity verification) is possible
but would need a sheet schema change. Don't do it unless drift incidents
actually start happening.

### F3 (admin lockout) — recovery procedure

If the **only Global Admin** sets themselves to `active: false` or assigns
themselves a non-admin role, no one in the system can re-elevate them. To
recover:

1. Sign in to **Firebase Console** with the project owner's Google account.
2. Firestore Database → `users/{uid}` → edit the doc directly.
3. Set `role` back to `"global_admin"` and `active` back to `true`.
4. Sign back into the FAR site.

Avoid this by never deactivating the last admin from the UI. (We don't enforce
this in rules because the validation logic is brittle — too easy to lock
people out via edge cases.)

---

## 15. External setup steps for this pass

Three items in the pass require something you do **outside the code**:

### 1. Redeploy the Apps Script (mandatory — sheet writes will fail otherwise)

Reason: `setup_sheet.gs` now requires the shared secret. The browser sends it
on every POST. If you deploy the website without re-deploying the Apps Script,
all sheet writes silently fail with `{ ok: false, error: "forbidden" }`.

Steps:
1. Open the Google Sheet.
2. Extensions → Apps Script.
3. Paste the latest `setup_sheet.gs` (the `SHARED_SECRET` constant near the
   top must match `APPS_SCRIPT_SECRET` in `firebase-config.js`).
4. Save (Ctrl+S).
5. Deploy → Manage deployments → pencil icon → Version: **New version** →
   Deploy.
6. The `/exec` URL stays the same — no `firebase-config.js` change needed.
7. Test: visit the `/exec` URL in a browser; should still return
   `{"ok":true,"service":"NEH FAR Sheet Writer", ...}`.

If you ever rotate `SHARED_SECRET`, change BOTH files together and redeploy.

### 2. (Optional) Enable App Check for spam protection

Reason: A4 added the SDK stub, but it's a no-op until you provide a reCAPTCHA
v3 site key.

Steps:
1. Firebase Console → Project Settings → App Check → Apps → Register the web
   app.
2. Choose "reCAPTCHA v3" provider. Use Google's free test key during dev or
   create a real reCAPTCHA v3 site at https://www.google.com/recaptcha/admin.
3. Copy the **site key**.
4. Set `RECAPTCHA_SITE_KEY` in `firebase-config.js` to that value.
5. Push the change. Reload the FAR site once to register the App Check token.
6. Back in Firebase Console → App Check → choose Firestore → click **Enforce**.
7. From this point, scan_logs / scan_concerns posts from anywhere without a
   valid token (i.e. bots) will be denied.

If anything breaks, simply set `RECAPTCHA_SITE_KEY = ""` again — App Check init
becomes a no-op.

### 3. (Recommended) Sentry for error monitoring

Not done in code yet. To add later:
1. Sign up at https://sentry.io (free tier covers 5k events/month).
2. Create a "Browser JavaScript" project; copy the DSN URL.
3. Add a `<script>` tag at the top of each HTML file's `<body>`:
   ```html
   <script src="https://browser.sentry-cdn.com/8.0.0/bundle.tracing.min.js" crossorigin="anonymous"></script>
   <script>Sentry.init({ dsn: "YOUR_DSN_HERE", tracesSampleRate: 0.1 });</script>
   ```
4. Errors thrown in the browser will show up in the Sentry dashboard with
   stack traces and the user's email if you call `Sentry.setUser({ email })`
   after sign-in.

### 4. (Recommended) Firebase Analytics for usage tracking

Skipped for now. To add: Firebase Console → Analytics → enable. Then add
`getAnalytics(app)` to `firebase-config.js`. Free, no key rotation, gives you
per-feature usage breakdowns.

---

## 16. CSV / Excel notes

- All CSV exports prefix the file with a UTF-8 BOM (`﻿`) so Excel reads
  Unicode (₹, é, etc.) correctly without an Import Wizard step.
- Numeric columns (Purchase Value, Useful Life) are now exported as plain
  numbers — Excel will auto-detect and allow `=SUM()` directly. Anything
  containing thousand-separators or currency symbols is parsed via
  `parseValue()` before export.
- Date columns are exported as the human-readable string from the sheet
  (`12-Apr-2025` style). Excel will treat these as text — that's intentional
  to avoid timezone shenanigans.

---

## 17. Build / version visibility

Every page now ships a `<meta name="far-build" content="YYYY-MM-DD"/>` tag.
The dashboard shows this at the bottom of the avatar dropdown.

When making any meaningful change, update the `content` value in all 4 HTML
files: `index.html`, `dashboard.html`, `admin.html`, `scan.html`. (No
auto-build step yet; manual.)
