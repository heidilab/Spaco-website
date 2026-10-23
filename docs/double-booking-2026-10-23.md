# CWB 2026-10-31 shown as available while booked (2026-10-23)

## Cause

Two confirmed, paid FPS bookings had no `blocked_slots`: CWB 2026-10-31 21:00–02:00 (created 2026-10-09 22:15 HKT, paid 23:41) and SW full floor 2026-10-29 20:00–01:00 (created 2026-10-14 10:06, verified 11:28). Both were paid AFTER the 30-minute hold: the expiry cron flipped them to `payment_not_completed` and deleted their slots; CS then approved the receipt / recorded the payment, which set the booking back to `confirmed` but nothing re-created the slots. Site availability and the server conflict check both read only `blocked_slots`, so the time stayed sellable and CWB 2026-10-31 was sold twice (the second customer was moved to another branch). The KPay path already restored slots in `finalizeConfirmedBooking`; the FPS paths did not.

## Data repair (production, 2026-10-23)

Read-only scan of all upcoming active bookings found exactly these two without slots and none with test-stamped slots. Slots were rebuilt (booking + cleaning buffer, overnight split) by a one-off Admin SDK transaction; readback shows no upcoming booking without slots. spacohk.com now offers CWB 2026-10-31 starts only up to 15:00. No booking fields were changed.

## Code (commits 5c9bc1e, this release)

- `/api/email/payment-confirmed` (called after receipt approval) and `/api/admin/booking-record-offline-payment` (when a booking returns to confirmed) now call `restoreBlockedSlotsIfMissing`.
- `/api/bookings/create` and `/api/admin/booking-direct` also check the venue group's bookings themselves (`src/lib/bookingOverlap.ts`, pure, tested) and refuse `SLOT_CONFLICT` when a paid booking overlaps, even if its slots are missing. Test bookings are ignored on production only.
- The daily hygiene cron rebuilds missing slots and clears `isTest` stamps on slots of real upcoming bookings; the admin 🧪 toggle now updates the booking's slots too.
- Catering menu updated to the supplier's October list (121/126/141/158/161/163/165/171 changed, 166/167/183 added, A6 → fruit platter HK$398). One upcoming booking on 2026-10-23 (sw-ab) ordered the OLD 141 and 158×2 — the supplier must deliver the dishes as originally ordered; the admin page now shows the new names for those codes.

## Verification

294 unit tests, TypeScript and focused lint pass. Preview dpl_CwFHVetNBdvf7ALaSpyVUSmJzwAu (guards + menu) ready; the FPS restore fix is in the next preview.

## Production release

Heidi approved. main fast-forwarded to 52cee1a; production dpl_DGy1tgdXWxPUKJjCG3dP2De3Kb2j READY and aliased to https://spacohk.com. Home, CWB and SW booking pages return 200; booking create and the hygiene cron return 401 without credentials; CWB 2026-10-31 offers start times only up to 15:00 (evening booked). Final preview before release: dpl_7bZPXmdSumBey72APc3KNXYKwEX1. No rules change.

## Venue photo uploads (same day)

分店管理 uploads to `venue-images/`, a path no storage rules version ever allowed, so uploads failed with storage/unauthorized. Commit f6c3c6a adds admin-only image writes (10 MB cap) with public read, covered by emulator tests (21 pass). Heidi approved; live rules were backed up to `docs/rollback-2026-10-23/storage.rules` (ruleset ce9bdb4d, verified identical to the 2026-10-15 release) and the new ruleset 64ba7201 was released through the Firebase Rules API at 14:12:53Z, read back identical to `storage.rules`. Firestore release 6c70fa3d untouched.
