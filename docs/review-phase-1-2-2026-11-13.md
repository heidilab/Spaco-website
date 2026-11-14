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

## Phase 4 — 項目變數據 (2026-11-14)

Everything a booking can carry is now data staff edit, read through one
accessor each, with the coded lists kept only as seed / fallback.

| # | What | Where staff edit it | Stored |
|---|---|---|---|
| 4a | Custom add-ons (name, per person / item / flat, price per branch, month-close column, supplier order) | 附加服務管理 → 新增附加服務 | `site_content/addons` (ids `x-…`, `AddOnSetting.custom`) |
| 4b | Channels: labels, offered to customers, broker / platform, own Excel column, commission | 財務 → 來源渠道／佣金 (`/admin/channels`; 內容管理 → 系統設定 removed 2026-11-14) | `site_content/channels` (derived from the legacy text until first save) |
| 4c | Packages: branch / room, price, deposit, hours, days, times, notice, inclusions, per-head add-ons, 停售, duplicate to another branch | 套餐管理 (`/admin/packages`) | `site_content/packages` |
| 4d | Deposit tiers, fixed deposit deductions, points rates, instalment rule | 預訂規則 (`/admin/rules`) | `site_content/booking_rules` |
| 4e | Home filters on each venue's capacity / vibes / amenities; 全場優先 for any branch whose rooms combine (room relationships from 分店管理) | 分店管理 / 特別日子 | — |

Readers: `pricing.allAddOns / findAddOn / customAddOnEntryCost`,
`marketingChannels.getChannelRegistry / channelIdLabel`,
`packages.getPackageBySlug / activePackages` (+ `packageRegistryClient` /
`packageRegistryServer`), `bookingRules.securityDepositFor /
pointsEarnedFor / fillRuleTokens` (+ `bookingRulesClient` /
`bookingRulesServer`), `homeFilters.filterVenueList /
fallbackSuggestions`, `peakDayRules.fullFloorSplitBlocked`. 條款 §5 and
預訂須知 print the deposit tiers, deductions and instalment sentence from
the rules document (tokens `{{DEPOSIT_TIERS}}` / `{{DEDUCTIONS}}` /
`{{INSTALLMENT}}` / `{{POINTS}}` also work in 內容管理 text).

Not changed: package add-on prices are still the package's own (not
附加服務管理's); the home filter vocabulary (capacity buckets, vibes,
amenity ids) stays in the i18n files; FAQ text is edited in 常見問題管理.

## Phase 5 — 流程中央化 (2026-11-14)

- `lib/bookingLifecycle` (Admin SDK): `cancelBookingServer` — status +
  audit, blocked_slots, points / promo refunded (#12) in ONE transaction,
  then Calendar removal, passcode revoke, customer email, each recorded in
  `cancelEffects`; `setBookingStatusServer` — status in a transaction,
  slots rebuilt (conflict-checked) or released with it (#4), rewards
  consumed, and on a manual confirm `finalizeConfirmedBooking` (passcode,
  staff + supplier notices, Calendar; customer email only when the caller
  asks, i.e. receipt approval), results in `statusEffects`;
  `settleDepositServer` — refund, deductions, owed, status and points in
  one transaction (#21: a double click cannot credit twice; the overflow's
  points wait in `pointsPendingOverflow` until `creditPendingOverflowPoints`
  runs from settle-balance / record-offline-payment). Routes:
  `/api/admin/booking-cancel`, `booking-status`, `booking-settle-deposit`.
- Browser: `lib/cancelBooking.cancelBooking / setBookingStatus` are thin
  calls; the booking detail (status dropdown, settle / amend / recover
  points), the bookings list and the receipts page use them; a failed
  external step is shown as 「未完成…再做一次會重試」 (#13).
- `finalizeConfirmedBooking` returns per-step results and skips steps
  already done; `runPaymentFinalization` records `steps` on the job, so a
  retry never re-sends an email, and after 6 attempts marks the job
  `failed`, stamps `booking.finalizationFailed` and emails staff once (#8).
- The customer modify route updates the Google Calendar event after a
  time / guests / add-ons change.
- Still client-side: the staff booking edit (`updateBookingDateTime` +
  `booking-edit-followup`) — it already conflict-checks and migrates
  slots, but a closed tab between the two calls leaves the Calendar /
  email behind; next candidate for the same treatment.

## Remaining items (2026-11-14, after phase 5)

| # | Done |
|---|---|
| 15 | create / direct-order / modify / staff-edit windows include the booking's own 60-minute cleaning buffer (blocked_slots and booking-level checks). |
| 16 | Customer modify validates HH:mm, ignores test slots on production, and checks the bookings themselves (`overlappingBookings`). |
| 17 | `lib/gcalSegments`: a Google event crossing midnight blocks both days; an all-day event every day (one row per day, keyed by `googleEventPart`). |
| 18 | `pushBookingToCalendar` never pushes a cancelled / dead / test booking; the staff edit keeps no slots for a dead booking. |
| 22 | Promo windows use Hong Kong dates (`lib/hkTime`). |
| 23 | 財務總覽 revenue nets the staff discount; the 行家 rent base nets a rent-scoped staff discount. |
| 24 | Done in phase 1 (`requireCronSecret`; lock route behind `requireAdmin`). |
| 25 | Post-event sweep covers 3–10 days back, skips test bookings on production, leaves no mark when the automation is off; CS bonus sales = net bill. |
| 26 | KPay refund capped at what is left of the payment; a successful refund is a `payments[]` refund entry (route + webhook, idempotent). |
| 27 | 11 secret-gated diagnostic routes deleted; the four repair routes the admin UI uses stay behind `requireAdmin`. |
| lock 4 | The 09:00 sweep emails staff when a passcode could not be issued. |
| lock 9 | Automation schedule texts say 09:00 / 11:00 HKT (the crons are UTC). |
| 404 | `[locale]/not-found.tsx` + `[locale]/[...rest]` + root `not-found.tsx`: a wrong address shows a page, not a blank. |
| staff edit | `lib/bookingEditServer.updateBookingServer` + `/api/admin/booking-update`: the staff edit (save and recalc) runs in one server transaction — conflict check, slots, repricing, promo rescale, sticky deposit, balance, settled-booking points — then `followUpAfterEdit` (passcode, update email with diff, Calendar), shared with `booking-edit-followup`. `lib/firestore.updateBookingDateTime` is no longer called by the admin. |

See `docs/change-process.md` for how changes are made and deployed from here on.
