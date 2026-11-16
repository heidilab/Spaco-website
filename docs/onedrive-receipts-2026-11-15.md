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
5. The same row is written into her Financial Master workbook for that
   branch (Graph workbook API), **month-sheet mode** (2026-11-16): the
   expense month picks the sheet (2026-11 → `NOV-2026`; case/spacing
   tolerant), the 「Vendor | Amount」 header pair is re-detected on that
   sheet, `item` goes under Vendor and `amount` under Amount on the first
   line that is empty in every column above 「Total Expenses:」; the
   receipt date goes in the sheet's 「Date」 column (A, as a real date
   `d/m/yyyy`) and the note / Claude summary in 「Remarks」 (U) — both
   auto-detected per sheet, overridable or blanked in the config
   (2026-11-16, Heidi: expense dates go in column A). A line a
   payment group above still spans (`=SUM(O15:O16)` on the line above —
   where her merged Kpay-fee cells sit) is skipped. When the block is
   full, two cells are inserted above its last line so the SUM keeps
   covering it. The SPACO expense id is written in an unused column
   (default V, header 「SPACO ID」 added once) so edits/deletes find the
   same line; delete clears the three cells, never shifts anything.
   Missing month sheet → the row stays `excel.synced:false` and every run
   retries up to 10 such rows (`resyncPendingExcel`), so creating the
   sheet later is enough. Legacy `mode:'sheet'` (fixed sheet + column
   letters, table `rows/add`) is still supported by the sync code.
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
  branch → per branch pick its Financial Master workbook (no sheet to
  choose; Vendor/Amount columns auto-detected, ID column default V) →
  立即同步 to test.

## Data

| Where | What |
|---|---|
| `secrets/onedrive_oauth` | refresh token (rotated on every refresh — personal accounts issue a new one), connected email |
| `system/onedrive_receipts` | branchFolders (one per branch), excelByBranch (one workbook per branch: mode month + vendor/amount/id columns; legacy sheet mode and `excel` as fallback), deltaLinks per folder, lastScanAt/Error |
| `receipt_files/{driveItemId}` | per-file status: queued / done / error (≤3 attempts) / skipped / no_branch |
| `expenses` (`source: 'receipt'`) | the row; `receipt.*`, `reviewed`, `excel.{synced,error,sheet,row}` |

All new collections are server-only (Admin SDK); no Firestore rules change.

## Limits / known gaps
- Choosing a folder starts from **now** (`delta?token=latest`); files
  already there are not imported (they are already in her Excel).
- A file whose parent chain does not reach a chosen branch folder is
  marked `no_branch` (cannot normally happen now that delta runs per
  branch folder).
- Month mode writes item, amount, date (A) and note (U); the receipt
  link, category and reviewed tick live in 支出管理 only. Vendor cell =
  支出管理 項目 text. Caveat she accepted implicitly: the TST and TST Hart
  workbooks compute Cleaning fee as `=COUNT(A6:A32)*300`, so a receipt
  date in A on a line ≤32 adds 300 there (CWB / SW / WC have no such
  formula).
- Graph exposes no merged-cell info; the reserved-line guard relies on
  her payment-group SUM formulas. A merge without such a formula directly
  under the last booking could still be hit once the free band is used
  up from the top (verified against the real CWB workbook: NOV → line 17,
  OCT → 20, BLANK → 6).
- A deleted OneDrive file only flags the row (`receipt.fileDeleted`); the
  expense stays.
- Delta tokens older than Graph keeps (HTTP 410) restart from `latest`;
  anything uploaded in the gap must be re-uploaded or added by hand.
