# KPay fee follows the booking, not the statement month — 2026-11-10

Reported by Heidi: after uploading the KPay monthly statement on 月結, the fee
did not match her own month-end sheet.

## Cause

月結 books a booking in the month of its **event**. A KPay statement lists what
was **paid** in a month. The upload put the fee of every row of the statement
onto the month selected on screen (split by branch), so:

- an October booking paid in full in August had its fee counted in August;
- an October booking paid in September (deposit) and October (balance) had
  its fee split across two months;
- September's 月結 carried the fees of bookings held in October, November, …

Her sheet does the opposite: the fee of a booking is the fee of each of its
own payments, each read off the statement of the month it was paid in, added
up, and booked with the booking.

## Change

- `src/lib/kpayReconcile.ts` (new, pure, tested) — `reconcileKpayFees(bookings,
  statements, estimatePct)` gives every booking its fee lines:
  1. a statement row finds its booking by 外部訂單號 (`B<bookingId12>_P<epoch>`,
     written by our checkout);
  2. inside the booking, rows are paired with its KPay payments (KPay交易號,
     else same amount with the same date first);
  3. a row whose order number is not ours falls back to "same date, same
     amount" against KPay payments still unmatched, and only when exactly one
     payment fits.

  A KPay payment with no statement row keeps the estimate (% of the credited
  amount, as before) with the reason: `statement-missing` (that month's
  statement is not uploaded) or `not-in-statement` (uploaded, no such row).
  With no statements uploaded every booking equals the old estimate.
- Statements are stored once per statement month, for all branches, with
  their per-transaction rows: `month_closes/kpay-statement_<YYYY-MM>`
  (`monthClose.listKpayStatements / saveKpayStatement / deleteKpayStatement`).
  The existing `month_closes` rule (admin only) covers them — **no Firestore
  rules deployment is needed**.
- `kpayStatement.ts` — each parsed row now carries its date (完成時間), KPay交易號
  and 支付方式.
- 月結 → KPay 對帳: shows the month's fee as actual + estimated, the
  per-booking breakdown (payment date, amount, fee, which statement it came
  from), which statement months are still missing, and the list of uploaded
  statements with rows that matched no booking or sit on a booking left out of
  finance. Several statement files can be uploaded at once.
- Sales Record export (財務總覽) and 支出管理 use the same per-booking fee. The
  export's vendor reads `Kpay（含估算）` while any payment is still estimated.
  Its transaction dates are now the HK calendar day (they were sliced from the
  UTC timestamp, so a payment at 01:00 HKT showed the day before).

## After deploying

- Upload the statements again, once, on 月結 → KPay 對帳 (any branch tab; JUL,
  AUG, SEP and OCT 2026 can be picked together).
- The old per-month `kpayActualFee` / `kpayStatement` values on `month_closes`
  docs are no longer read (left in place, not deleted). Months that used them —
  closed months included — show the per-booking figure instead: estimates until
  the statements are uploaded, then actuals.

## Checked

- The four real statements (JUL–OCT 2026) parse through the page's own
  xlsx path: row count, gross and fee equal each file's summary block, every
  row has a date and an order number of ours.
- The four KPay bookings on her CWB OCT-2026 sheet reconcile to her figures:
  $179.74, $463.09, $132.00, $310.44 (`kpayReconcile.test.ts`).
- `npm test`, `tsc --noEmit`. Not exercised in the browser against live data —
  no staff login in the session that made this change.

## Not covered

- Refunds. None of the four statements has a refund row, so how KPay reports
  the fee on a refund is unknown. KPay refund entries keep the estimate, as
  before, and are labelled 估算 · 退款.
- Bookings left out of finance (cancelled, test) still carry no fee in any
  month; their statement rows are listed under the statement so the amount is
  visible.
