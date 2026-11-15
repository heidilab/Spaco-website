# OneDrive 單據自動入帳 (2026-11-15)

Heidi uploads every branch expense receipt to a folder in her **personal**
OneDrive. Until now she entered each one twice: 支出管理 on the site and her
own Financial Master Excel (also in OneDrive). This feature reads each new
file once and writes both.

## Flow

1. Heidi drops a photo / PDF into the branch's receipts folder (each
   branch has its own folder somewhere in her OneDrive; year/month
   sub-folders inside are fine — delta is recursive).
2. `/api/cron/onedrive-receipts` (every 15 min, also 「立即同步」 in 後台)
   calls Graph `delta` on each branch folder (own delta link each) and queues every new file in
   `receipt_files/{driveItemId}` (status `queued`). The deltaLink is
   advanced immediately so a slow read never loses a page.
3. Up to 4 queued files per run are downloaded (HEIC and photos over
   4.5 MB go through OneDrive's JPEG thumbnail renderer) and sent to Claude
   (`RECEIPT_MODEL`, default `claude-opus-5-5`) with a JSON-only prompt:
   date, vendor, total, currency, summary, category, confidence.
4. The reply becomes an `expenses` row with `source: 'receipt'`,
   `reviewed: false`, `receipt: {…}` (file link, vendor, confidence, flags).
   The branch comes from the sub-folder mapping; the month from the receipt
   date (upload day in HKT when unreadable, flagged). An unreadable amount
   still creates a 0 row flagged `no_amount` — Heidi asked for everything
   to appear.
5. The same row is appended to her Excel (Graph workbook API — table
   `rows/add` when she mapped a formatted table, else the first empty row
   below the used range). The SPACO expense id is written to the mapped
   ID column so later edits/deletes find the row again.
6. Staff get a push: 「N 張新單據已自動入帳 … 請核數」 (no amounts — CS
   devices receive pushes too).

支出管理 shows a 「單據支出」 section with an 已核數 tick per row. Editing
date / item / amount or deleting goes through `/api/onedrive/expense`,
which updates Firestore **and** the Excel row. 月結 sums `listExpenses`
regardless of source, so receipt rows flow into Total Expenses and the
Master export without further changes.

## Setup (one time)

### Azure app registration (free)
1. portal.azure.com → Microsoft Entra ID → App registrations → New.
2. Name `SPACO Receipts`. Supported account types: **Personal Microsoft
   accounts only** (or any org + personal).
3. Redirect URI (Web): `https://spaco-test.vercel.app/api/onedrive/callback`.
   Add `https://spacohk.com/api/onedrive/callback` and
   `https://www.spacohk.com/api/onedrive/callback` before go-live.
4. Overview → Application (client) ID → Vercel env `MS_OAUTH_CLIENT_ID`.
5. Certificates & secrets → New client secret → copy the **Value** →
   Vercel env `MS_OAUTH_CLIENT_SECRET`. Note the expiry; rotate before it.
6. Scopes requested at sign-in: `offline_access User.Read Files.ReadWrite`
   (delegated; no admin consent needed on a personal account).

### Site
- Vercel env (Preview + Production): `MS_OAUTH_CLIENT_ID`,
  `MS_OAUTH_CLIENT_SECRET`, optional `RECEIPT_MODEL`. `ANTHROPIC_API_KEY`
  and `CRON_SECRET` already exist.
- 後台 → 財務總覽 → OneDrive 單據連結: sign in → pick one folder per
  branch → per branch pick its workbook, sheet (table) and
  columns (ID column required) → 立即同步 to test.

## Data

| Where | What |
|---|---|
| `secrets/onedrive_oauth` | refresh token (rotated on every refresh — personal accounts issue a new one), connected email |
| `system/onedrive_receipts` | branchFolders (one per branch), excelByBranch (one workbook/sheet/columns per branch; legacy `excel` as fallback), deltaLinks per folder, lastScanAt/Error |
| `receipt_files/{driveItemId}` | per-file status: queued / done / error (≤3 attempts) / skipped / no_branch |
| `expenses` (`source: 'receipt'`) | the row; `receipt.*`, `reviewed`, `excel.{synced,error}` |

All new collections are server-only (Admin SDK); no Firestore rules change.

## Limits / known gaps
- Choosing a folder starts from **now** (`delta?token=latest`); files
  already there are not imported (they are already in her Excel).
- A file whose parent chain does not reach a chosen branch folder is
  marked `no_branch` (cannot normally happen now that delta runs per
  branch folder).
- Excel sync needs the ID column. Appending below a formatted table via
  plain range writes does not extend the table — map the table instead.
- A deleted OneDrive file only flags the row (`receipt.fileDeleted`); the
  expense stays.
- Delta tokens older than Graph keeps (HTTP 410) restart from `latest`;
  anything uploaded in the gap must be re-uploaded or added by hand.
