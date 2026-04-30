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

`NEH-U1-ICU-001`

Meaning:

- `NEH` = New Era Hospital group, always.
- `U1`, `U2`, etc. = hospital unit.
- `ICU`, `OT`, `RAD`, etc. = location/department code.
- `001` = sequence number for that unit and location.

Examples:

- `NEH-U1-ICU-001`
- `NEH-U1-OT-001`
- `NEH-U2-RAD-001`

Current allocator:

- File: `asset_id.js`
- Function: `allocateAssetId(...)`
- Counter path example: `entities/NEH-U1/counters/seq_LOC_ICU`
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
  "value": "NEH-U1-ICU-001"
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

`far:guideSeen:v2`

Why this matters:

- The guide auto-shows once for users who have not seen this version.
- If guide content changes materially, bump the version key to `v3`, `v4`, etc.
- Users can reopen it anytime from the top-bar `Guide` button.

Current guidebook covers:

- Syncing Google Sheet rows
- Allocating Asset IDs like `NEH-U1-ICU-001`
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
