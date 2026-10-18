# FPS amount ignored points — fix and data correction (2026-10-18)

## Cause

`pricing.deposit` is stored before points; points only reduce the upfront charge. KPay charged `deposit − pointsDiscount`, but the FPS page, the my-bookings WhatsApp message, the offline-pending email and the admin receipt approval used raw `pricing.deposit`. Approval then triggered `/api/email/payment-confirmed`, which deducts the points unconditionally. FPS customers therefore paid in full and also lost their points. The FPS amount line dates from 2026-06-07 (5f718a8) and the pre-handover confirm page already stored a pre-points deposit, so this predates the 2026-10-09 handover.

## Code (commit c751504, preview dpl_2NEKhzjVUYeVJ32TdcbkoQMVX5hT, not yet production)

`initialAmountDue()` in `src/lib/bookingMoney.ts` (deposit − pointsDiscount, regression tests) is now used by the FPS page, my-bookings WhatsApp text, offline-pending email and receipt approval (paid amount and the 應付 label, which also notes the points). The admin booking detail shows the points row below 小計.

## Data correction (applied 2026-10-18, Heidi approved after dry run)

Rule from Heidi: if the full amount was collected, the points were not used; the deposit refund stays at the contractual deposit.

A read-only scan of every booking with `pointsUsed > 0` found two offline-paid bookings where the full deposit was received while points were deducted; all others were paid by KPay and were correct. For both, one Admin SDK transaction per booking (scratchpad script, preconditions on the inspected state) set `pointsUsed`/`pointsDiscount` to 0, removed `pointsRedeemedAt`/`pointsActuallyDeducted`, added a `pointsRestored` audit field, returned the points to the customer and wrote a `_loyalty_adjustments` row (`fps-points-correction-2026-10-18`).

- Unsettled booking: refundable credit now equals the deposit (previously deposit plus the points value); settlement will credit points on the full consumption.
- Settled September booking: recalculated refund now matches the refund actually paid (the admin mismatch warning disappears); the settlement points credit was topped up to the no-redemption basis at Heidi's request.

Readback confirmed both bookings and both customers' balances. No email, notification, refund or payment was triggered. Customer amounts are recorded in the session, not here.

## Production release

Heidi approved. main fast-forwarded to 7b03bab (fix c751504). Production deployment dpl_6dmFjEHJLhmPMre9AsfdcHHapFfS READY and aliased to https://spacohk.com; deployment id recorded in the Notion changelog. No rules change.
