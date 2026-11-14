# Site review 2026-11-13 — phases 1 and 2 as shipped

Follow-up to `docs/site-review-2026-11-13.md`. Numbers refer to its §5.

## Phase 1 — defects fixed

| # | Change |
|---|---|
| 1 | Staff direct orders (`createdVia: 'admin-direct'`) with no payment are never swept by `expire-pending-bookings`. |
| 2 | `booking-direct` uses `venuesSharingSpaceServer` + `venue.spaceGroup` for the lock key, like `/create`; calendar clashes are named from `blocked_slot_details`. |
| 3 | `/api/google/auth` needs the `gcal` permission and sets an HttpOnly `gcal_oauth_state` cookie; `/api/google/callback` refuses a mismatched state. |
| 4, 5 | `restoreBlockedSlotsIfMissing` checks the shared rooms' slots first; a clash flags `paymentReviewRequired` (`slot_taken_on_restore`) instead of stacking. New `/api/admin/booking-confirmed` (restore + rewards) is called from the status dropdown, the bookings-list approve and receipt approval; `payment_not_completed` releases slots. |
| 6 | `lib/bookingRewards.consumeBookingRewards` — one transaction, idempotent on `pointsRedeemedAt` / `promoRedeemedAt`; called from payment-confirmed (before the no-email early return), record-offline-payment, edit-followup, settle-balance and booking-confirmed. |
| 7 | `paidBase` ignores refund entries (`isRefund`, `kind: 'refund'`, negative amount); recording a refund leaves `balanceDue` unchanged. |
| 9 | Sync writes event title / description to `blocked_slot_details/{slotId}` (no public rule) and only a text hash on `blocked_slots`; legacy rows are rewritten once; the admin calendar gets the text from `/api/admin/calendar-bookings` (`gcalDetails`). |
| 11 | `requireBookingAccess` (owner or staff) on push-booking, booking-cancelled (also requires status cancelled), offline-pending, notify-receipt-pending; welcome reads the signed-in profile; translate requires `content`. Callers use `adminApiFetch`. |
| 14 | Rebuilt slots keep `isTest` (modify route, `updateBookingDateTime`, restore). |
| 19 | 會員管理 adjusts points through `/api/admin/loyalty-adjust`. |
| 20, 27 | Deleted: booking-cleanup-fix, cleanup-phantom-slots, backfill-loyalty-points, relabel-kpay-payments, scan-pricing-repair, scan-status-repair, sync-promo-freedrinks-cost, force-lock-passcode, sweep-lock-passcodes, test-ttlock-passcode, sw-slots-diag, scan-lock-config, and the stray `test-booking-hygiene/route 2.ts`. |
| 24 | All cron routes use `requireCronSecret` (no fail-open). |
| lock #1 | A failed TTLock delete keeps `lockPasscode` on the booking with `revokeFailedAt` / `revokeError` and rethrows. |

#10 (customers setting `receiptUrl` to leave `confirmed`): `firestore.rules` tightened (`ownReceiptUrl`, unpaid bookings only) and published by Heidi in the Firebase console on 2026-11-14 (rules deploy is separate from the app). Still open from the review: #8 (finalization retries), #12/#13 (cancel refunds rewards; server-side cancel), #15–18, #21–26.

## Phase 2 — one source for branches

- `venueRegistryServer.resolveVenueServer(id)` (registry first, built-in list as fallback) replaces the static `getVenueById` in: finalizeBooking, lockPasscode (3 sites; lock map now read through the server registry), lock-passcode route, notify-booking, notify-receipt-pending, booking-cancelled, offline-pending, payment-confirmed, post-event and settlement-debt crons. Emails for a 分店管理 branch now carry its name and address.
- Google Calendar event titles use the registry venue + `roomLabel` (`venueStaffLabel`); built-in Sheung Wan rooms keep their tags.
- Customer pages use `findVenueNow` / `useVenueRegistryReady`: book/success, my-bookings (list, detail, modify), account, book/claim, SettlementDebtNotice. A customer at a 分店管理 branch can modify a booking again.
- Admin: bookings list (venue filter + names from the registry), receipts, documents (場地 name, drinks rule), booking detail (TTLock status from the venue doc too), lock SOP page (every live venue; venue doc or legacy slot), calendar-sync page (the calendars actually synced, from 分店管理), 內容管理 promo links (every branch page).
- Pricing side paths: `venueDrinksIncluded(venue)` and `earlySetupPricePerHour(venue)` replace `freeDrinksVenues` / `earlySetupPriceByVenue` in create / modify / confirm routes, `updateBookingDateTime`, admin booking edit, new booking, confirm page, documents; finance's early-setup revenue uses the stamped unit price.
- Venue doc fields `lockGuideUrl` and `lockConfirmKey` (分店管理 per room); the passcode email reads them first, legacy `lockguide_*` / Wan Chai rule as fallback. Clearing a lock field in 分店管理 now deletes it.
- SEO: `branchSeoPages` adds registry branches to SEO 管理; sitemap lists every live branch page (venues via public REST); Organization JSON-LD lists branches from the registry with a live count; llms.txt is built from the registry; "四間分店" copy no longer states a number.
- Finance key: `salesBranchKey` maps branchKey `sheung-wan` to `sw`; 分店管理 refuses the reserved keys `sw / cwb / wanchai / tst / sheung-wan` for a new branch.

Still static (later phases): packages (`lib/packages.ts`), home filters' id lists, 內容管理 hero / card image slots for the original branches, `ZeroResultsFallback` suggestions, peak-day 全場優先 (Sheung Wan only), `branchInfo.ts` for LocalBusiness of the original four.

## Phase 3 — 門鎖設定 (2026-11-14)

- New admin page `/admin/locks` (系統管理 → 門鎖設定, `staff`), backed by
  `/api/admin/ttlock/status`: environment names present, the token held,
  「測試連線」 (fresh login + lock list), every venue from 分店管理 with a
  lock picker (from the account), confirm key and door-guide image saved
  on the venue doc, 「測試此門鎖」 (add + delete a 10-minute code, digits
  never shown), a one-click copy of legacy 系統設定 `ttlock_*` /
  `lockguide_*` values into venue docs, the last sweep
  (`system/ttlock_status`, written by every sweep) and the next 3 days'
  bookings with generate / retry-email / resend / revoke.
- Engine (`lib/lockPasscode.ts`): `passcodeWindow` opens at the start of a
  paid early set-up window; `emailPasscode` marks `emailSentAt` only when
  the email went out (else `emailSkipped`), and the daily sweep retries
  pending emails (`action: 'emailed'`); `refreshPasscodeAfterTimeChange`
  re-issues a TTLock code after the customer modify route or an admin
  follow-up changes the times.
- `lib/ttlock.ts`: `listLocks` returns battery / gateway; `testTTLockConnection`,
  `testLockRoundTrip`, `ttlockEnvStatus`, `cachedTokenInfo`.
- Removed: `scan-ttlock-locks`, `scan-lock-eligibility`, `ttlock/locks`,
  the unprotected `ttlock/oauth-callback` (login is by username + password
  or a refresh token saved on Vercel).
