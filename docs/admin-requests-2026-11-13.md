# Seven admin requests — 2026-11-13

Asked for by Heidi while testing the KPay / Financial Master work. All on
branch `claude/bold-goldberg-7zkepd`. Unit-tested and type-checked; **none of
it was exercised in the browser against live data** (no staff login in the
session that made these changes).

## 1. BBQ / hotpot package for part of the group

Staff typed a custom item ("BBQ Package For 20ppl $3,160") when a customer
wanted BBQ for 20 of 39 guests; month close then put the money in 加時/罰款.

- `AddOnOptions.pax` on the four per-person food packages (BBQ standard /
  premium, hotpot standard / seafood) — absent = whole group.
- Booking page: ticking one shows 「加幾多位」 (blank = everyone).
- `calculatePricing`, `finance.addOnRevenueForBooking`, the documents page
  and the supplier order email price on it; staff labels show `×N位`.
- Staff only: `validateAddOns` drops it from customer requests and the
  customer modify route keeps the stored value.
- Not on the 新增預訂連結 page — only on an existing booking, as asked.
- Hotpot's "15 guests = 2 soup bases" rule still counts the whole group.

## 2. Offline payment: FPS only

The Bank choice is removed from the booking page and the direct-booking
form; `booking-direct` stores a `bank` as `fps`. Old `bank` records still
read, labelled FPS in the exports. Customer pages still show the bank
account as a way to pay (they always stored `fps`).

## 3. 附加服務管理 (`/admin/addons`, admin only)

Per add-on: offered to customers on/off; built-in branch rule or a ticked
branch list; unit price for all branches and/or per branch; the BBQ / hotpot
package menus.

- Settings: `site_content/addons` → `{ items }` (public read; saved through
  `POST /api/admin/addon-config`, `staff` permission). `lib/addOnConfig`
  (pure) + `addOnConfigClient` (`useAddOnConfig`) + `addOnConfigServer`.
  Empty settings = the catalog as coded.
- `pricing.addOnUnitPrice / addOnAvailableAt / addOnMenu`; `calculatePricing`
  reads the active settings. The create / modify / confirm routes load them
  first, and create refuses an add-on staff switched off or limited to other
  branches (CS links exempt).
- **A price change applies to new bookings only.** Each priced add-on entry
  carries `options.unitPrice`, stamped when the booking is created or edited
  (`pricing.stampAddOnPrices`); `calculatePricing` and month close use it.
  Saving a changed price first stamps the OLD price on every existing
  booking that has that add-on unstamped (`lockedBookings` in the response).
- 美食到會 (second round, same day): the dish list (code, names, own price
  for 追加款式, offered / paused, add / remove per category), the five tier
  prices, the extra-dish fee and the door-to-door fee. 水煙: the flavour
  list and the four prices (1 pipe, 2 pipes, extra head, staff set-up).
  Read through `lib/cateringCatalog` and `pricing.shishaPrices /
  shishaFlavors` — the picker, the price, the supplier order email and the
  customer copy all follow. A paused or removed dish / flavour is still
  named on old bookings (falls back to the built-in name).
- These two are sold as a TOTAL for a selection: `options.soldTotal`,
  kept while the selection (tier + dishes + delivery / heads + pipes +
  set-up) is unchanged and recomputed at today's prices when staff change
  it (`pricing.keepSoldTotals`). Saving changed catering / shisha prices
  stamps the old total on existing bookings first, like unit prices.
- Every list is edited one row per item, Chinese and English side by side
  with a number / code — the first version used two free-text boxes that
  were hard to keep lined up. BBQ / hotpot menus and notes can be
  re-ordered. Rendered in a jsdom harness and screenshotted (desktop and
  phone width); not exercised against live data.
- Not editable here: tier sizes (pax range, dishes included), delivery
  zones and cutlery fees, dish tags, add-on names / descriptions, hotpot
  soup bases, the maximum of 2 pipes. Staff can still add a switched-off
  add-on to a booking by hand.
- The undefined Tailwind colour `primary-*` (active tab rendered blank on
  月結, 特別日子, 獎金 and here) is replaced with the theme's `pink`.

## 3b. Supplier order email: BBQ 豪華套餐

`bbq-premium` now triggers the supplier-order notification and has its own
section (portions — the whole group or the package head count — unit price
sold at, total, time slot). The standard BBQ package alone does not.
- The per-branch prices in 分店管理 (BBQ standard, early set-up) still work;
  a price set in 附加服務管理 wins over them.

## 4. 商業租場使用 on 新增預訂連結

Staff pick venue / date / time, type the rent and the 按金, optionally a head
count; add-ons as usual. Works for both 產生付款連結 and 直接落單.

- `isCommercial` on drafts and bookings; `calculatePricing(..., fixedRent)`;
  every re-pricing of an existing booking passes `pricing.fixedRentOf(booking)`
  so an edit keeps the agreed rent. To change the rent later, edit 消費小計 on
  the booking page.
- Head count 0 = not given (commercial drafts only); shown blank in emails,
  Google Calendar, the claim / confirm / payment pages and the month-close
  sheet. Per-person add-ons need a head count (or a package head count, #1).
- The upfront amount still follows the normal rule (full if the total is
  ≤ $10k or the event is within 2 days, else 50%).

## 5. Staff remark, synced to Google Calendar

`BookingRecord.staffRemark`, edited from the admin calendar's booking pop-up
or the booking page (CS / admin), shown on the day list.
`POST /api/admin/booking-remark` saves it and rewrites the Google Calendar
event (top of the description). An unpaid booking is not on the calendar yet;
the remark goes out with it when it is confirmed. Cleaners (calendar-only
role) see it on the website calendar too.

## 6. Members shown as 「訪客」

`users/{uid}.displayName` was written only when the profile doc was first
created, so a doc created before the name was known stayed nameless.

- Sign-in now fills a missing name / photo from the account (`lib/auth`).
- The name CS types on a booking link is kept on the booking.
- The booking page falls back to the email prefix, like the list.
- 會員管理: a button fills nameless members from their sign-in accounts
  (`POST /api/admin/backfill-member-names`). Members who registered by email
  without a name have none to fill.

## 7. Staff can change a booking's source

`BookingSourceEditor` on the booking page. Commission was already derived
live from `marketingChannel` (rules in `system/finance_config`: Reubird 10%
of the whole bill by default), so the new source shows in 支出管理 and the
month-close sheet with no further step. A manual commission amount can be
cleared with the change. `marketingChannelSetByStaff` stops the customer's
confirm step overwriting it.
