# 優惠碼適用限制 — 2026-10-12

Status: preview preparation on kpay-integration. No production deployment or live voucher/booking writes.

## Behaviour

- Single-code creation/editing and batch campaign generation share one restriction editor.
- Choose all branches (including future additions), or specific venue/room IDs loaded from the venue registry. Selecting specific venues retains at least one selection; explicitly choose all to clear the allowlist.
- Exclude one or multiple inclusive event-date ranges. Same start/end means a single day. An event spanning an excluded calendar date is ineligible. These are event dates, separate from the existing redemption validity window.
- Packages: all, selected only, all except selected, or none. Standard hourly bookings have a separate eligibility checkbox. Invalid dates, empty include selection, and disabling all booking types are rejected.
- Legacy codes without new fields retain unrestricted scope. No existing codes were migrated.
- Package checkout now supports eligible codes against the server-calculated flat package price. Included drinks do not trigger a per-head reprice or another free-drinks reduction. CS-issued prices remain immutable at customer confirmation.
- Client quote, authoritative booking create/confirm, and CS draft claim pass/check venue, dates and package context. Admin changing date/venue with an incompatible code is rejected before slot writes; reapply/remove the code first. Existing reward rescaling keeps prior validity-window behaviour.
- A KPay payment received with a newly ineligible, unredeemed code is recorded for manual review rather than auto-confirmed. Previously redeemed codes are not retroactively rejected.
- Changing admin booking date/venue/package/amount clears the previously applied preview discount so it must be checked again.

## Validation

- 170 unit tests passed, including authoritative package pricing, excluded dates, legacy defaults, multiple/overnight ranges, package include/exclude, voucher persistence and payment review.
- TypeScript and local build passed. New restriction editor/helper and validation route/tests lint passed.
- Isolated browser fixture with mocked venues: branch/package selection, standard booking checkbox, add/remove date ranges, invalid-state messages and resets passed; 390px layout has no horizontal overflow. No live login, voucher creation, booking or payment performed.
- Preview and production share Firebase. Do not generate real vouchers just to test the form.
