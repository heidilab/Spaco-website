# Admin edits did not reprice bookings on 分店管理-only venues — 2026-11-06

Reported bookings: `#x5O1406V` (time changed 6h → 5h, 場租 stayed at the 6-hour
figure) and `#l1qt8Wzv` (到會 added, 小計 / 總額 unchanged, so no balance link
could be sent).

## Cause (from code; live data was not inspected)

`updateBookingDateTime` in `src/lib/firestore.ts` — the function behind the
儲存 button on `/admin/bookings/[id]` — resolved the venue for its pricing
recompute with the static `getVenueById` from `src/lib/venues.ts`. Spaces
created in 分店管理 (the HART rooms `hart-a` / `hart-b` / `hart-ab`) exist only
in the Firestore `venues` collection, so the lookup returned `undefined` and the
whole pricing block was skipped **without any error**. The date, time,
add-ons and hours were still written, but `pricing.baseCharge`,
`pricing.addOnTotal`, `pricing.subtotal`, `pricing.deposit` and `balanceDue`
kept their old values. The admin page's live 消費小計 preview uses the registry,
so staff saw the right number in the input and the old number in the summary.

The 2026-10-24 release (commit `74b1535`) moved the customer package /
confirm / payment / pay-balance pages to the registry for the same reason;
the admin save path was missed.

Secondary gap found alongside: editing the dishes / tier / delivery of an
**existing** catering add-on left quantity at 1, so the save did not treat the
add-ons as changed. The auto-synced 消費小計 still went to the server as a
subtotal override, which folded the new catering price into 場租 while the
stored catering options (and the supplier order email) stayed stale.

## Change

- `updateBookingDateTime` resolves the venue registry-first
  (`loadAllVenues()`), static array as fallback, **before** any slot is
  rewritten. A non-package booking whose venue cannot be found now throws
  `VENUE_NOT_FOUND:<id>` and the admin page shows 「搵唔到場地…無法重新計價」
  instead of silently keeping the old price.
- `/api/admin/booking-edit-followup` names the venue registry-first in the
  customer's 「預訂已更新」 email (previously HART rooms appeared by slug).
- Admin booking page: a catering selection that differs from the stored
  options now marks add-ons dirty, so the new options are saved and priced.
  The comparison is field-by-field so untouched bookings do not read as
  changed (a false positive would email the customer).

## What to do for the two bookings after release

1. `#x5O1406V`: open the booking in admin and press 儲存 (the 消費小計 input
   already differs from the stored figure, so the button is enabled). 場租
   recomputes for 5 hours and 總額 follows. Then approve the FPS receipt as
   usual; approval credits the new 應付 amount. The customer transferred the
   6-hour amount, so the difference is refunded offline and should be noted
   on the booking.
2. `#l1qt8Wzv`: open the booking and press 儲存. The catering line joins
   附加項目, 小計 / 總額 update, and the 預訂未付尾數 card shows the pay-balance
   link to send.

## Verification

`npx tsc --noEmit --incremental false` clean; `npm test` 31 files / 354 tests
passing; focused ESLint on the three changed files. No production deployment,
Firestore write, payment, email or passcode was triggered by this work.
