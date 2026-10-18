# Settlement debt block, reminders and month-close timing (2026-10-18)

## Rules (Heidi)

1. When deposit settlement deductions exceed the customer's credit, the shortfall is a debt from the moment of settlement.
2. While any debt is unpaid the customer sees a warning on sign-in and cannot place new bookings. No permanent ban.
3. Paying online, or staff recording the payment in the admin, lifts the block immediately.
4. Reminder emails on day 14 and day 30 after settlement, then no more.
5. Month close counts only money received by the end of the event month. A later payment is income of the month it is received, recorded against the original booking.

## Implementation (commit 7e1765f)

- `src/lib/settlementDebt.ts` (pure, tested): `settlementDebt`, `outstandingDebts`, `debtReminderStage`, `settlementCashTiming`. The debt is derived live from `depositRefund` + `amountOwed`; there is no stored flag. Test bookings count only on the preview site.
- Block: `assertNoSettlementDebt` in `/api/bookings/create` (self-booking and CS links) and `/api/bookings/[id]/confirm`; error `SETTLEMENT_DEBT_OUTSTANDING` with customer wording in `paymentErrors.ts`.
- Warning: `SettlementDebtNotice` in the locale layout. Once per browser session after sign-in, and again on booking pages; lists each debt with a 立即補款 link to the existing pay-balance page.
- Payment fix: `booking-record-offline-payment` reduces the actual debt for settled bookings. Previously any partial amount cleared it to zero.
- Reminders: `/api/cron/settlement-debt-reminders`, daily 10:00 HKT (`vercel.json`), automation key `settlement_debt_reminder` with admin toggle and preview; idempotent `settlementDebtReminder14SentAt` / `30SentAt`. No-account bookings get the email only when a customer email exists.
- Month close: event-month revenue excludes the unpaid or later-paid debt (from 加時/罰款 first, then rent); later payments are added to that month's Total Sales as 補收舊單欠款 with a per-booking list; both lists show under the summary and the new row is in the Excel proportion table.

## Verification

287 unit tests (17 new for the helpers, one create-route block/unblock test, new error code), TypeScript and focused lint pass. Preview dpl_EYhJb9JsWKsmcrHgqMmtz75xp2SF READY: home and booking pages 200 with no console errors, cron without secret 401, create without token 401. A read-only scan on 2026-10-18 found no customer currently owing a settlement debt, so release blocks nobody and sends no email immediately; past top-ups were all received in the event month, so no past month close changes.

## Known gap (not changed)

Month-close Total Sales is the sum of booking subtotals; 加時/罰款 (deposit deductions) appear only in the proportion table, not in Total Sales or profit. Late settlement payments are added to Total Sales as instructed, which is asymmetric with promptly paid deductions. Including deductions in Total Sales would change past months and needs Heidi's decision.

## Production release

Heidi approved. main fast-forwarded to 263e0b5 (feature 7e1765f); production dpl_2cy7H7M9MrP8vwBKbQcWTdh3rs12 READY and aliased to https://spacohk.com. /zh, the booking page and my-bookings return 200; the reminder cron and booking create return 401 without credentials; Vercel lists `/api/cron/settlement-debt-reminders` among the project crons. No rules change. The first cron run is expected at 10:00 HKT; with no current debtors it should send nothing.
