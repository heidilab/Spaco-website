# Phase 2 — KPay settlement and concurrency

Scope: KPay sales/refund callbacks, reward consumption at KPay settlement, expiry races and durable post-payment work. Preview only; production release requires Heidi approval.

## Behavior

- Booking payment, transaction marker, points deduction and promo redemption now commit in one Firestore transaction. Duplicate callbacks do not credit again. Separate payments recalculate the balance from fresh booking data.
- New checkout orders retain an immutable full-booking mapping and expected amount/surcharge. Legacy prefix lookup rejects ambiguous matches. Unmatched payments persist in `_payment_reconciliation` for investigation.
- Cancelled/expired bookings are never resurrected. Payments with exhausted points/promo limits or mismatched amounts are recorded but require CS review, without lock/slot/email finalization. Admin booking detail shows a review banner.
- Reward availability is checked before generating a new checkout link, then atomically rechecked/consumed at settlement. This is NOT a pre-payment reservation: two already-open links can both charge, but only eligible settlement automatically confirms. The other requires CS refund/reconciliation; it does not silently grant unavailable discounts.
- Refund callbacks atomically upsert by transaction number, allowing pending-to-success progression while preventing a late failure from downgrading success.
- Expiry cron rereads the booking and removes slots in one transaction, so a stale candidate cannot expire a concurrently recorded payment.
- Side effects are durably queued in `_payment_finalizations`, executed after the ACK with Vercel waitUntil and protected by a two-minute lease. A fail-closed authenticated cron retries pending work every five minutes after production release. Money is never credited by the worker.
- External notifications remain at-least-once: a process crash after a successful external send may cause a duplicate notification. Helpers that internally suppress failures cannot guarantee delivery. No exactly-once external delivery claim.
- Invalid signatures are rejected before database debug writes; merchant, currency, amount type and transaction ID are validated. No raw signature/payload logging.

## Validation

143 unit tests passed; 18 emulator tests passed, including concurrent duplicate callbacks, two bookings competing for points/global/per-user promo limits, concurrent distinct payments, cancelled payments, mismatched amounts, transaction failure atomicity and side-effect retry. TypeScript, focused lint and local build passed. Local build CMS fetches may fall back under DNS restrictions. No real booking, payment, email or lock used for testing.

## Operations

Review `paymentReviewRequired` bookings in admin; reconcile funds, availability and entitlement before manual confirmation/refund. The flag is intentionally not automatically cleared by a later callback. Inspect unmatched transactions in server-only `_payment_reconciliation`. Existing offline/FPS reward workflows are outside this KPay settlement change. Previous callback markers remain respected. No Firebase rules change is required because new collections are server-only under default deny.
