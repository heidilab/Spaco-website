# Manual discount on booking links; balance payment failure — 2026-10-31

## 1. Balance payment refused after admin edit (TST, 31 Oct, +9 guests)

### Confirmed causes (from code; live data was not inspected)

1. **The 30-minute slot hold was never cleared by FPS / offline payments.**
   `/api/bookings/create` stamps `pendingExpiresAt = now + 30 min` on every new
   booking. Only the KPay webhook (`settleKpayPayment`) deleted it. Receipt
   approval (`/admin/receipts`), `booking-record-offline-payment`,
   `booking-edit-followup` and `booking-settle-balance` all credited the
   payment but left the stamp in place. `checkoutAmount()` then rejected every
   later KPay checkout on that booking with `BOOKING_EXPIRED` — the customer saw
   「預訂暫留已過期，請重新選擇時段或聯絡我們」 both from the staff-sent
   pay-balance link and from 會員中心, because both open the same page and call
   the same `/api/kpay/checkout`. Any booking whose first payment was FPS and
   which later needs a KPay balance payment (admin added guests / add-ons,
   settlement overflow) hit this.
2. **A prior KPay order with different terms blocked the new one.** When a
   balance order already existed (customer opened the link once, or picked the
   other payment rail) and the bill then changed, checkout answered
   `PAYMENT_ALREADY_STARTED` on every retry until KPay expired the old order.
   Switching 電子錢包 ↔ 信用卡 hit the same wall.
3. **A failed gateway call left the reservation locked forever.** If
   `order/add` returned an error or timed out, the `_checkout_orders` lock stayed
   at `creating` and every retry answered `PAYMENT_PROCESSING`.
4. The pay-balance page sent the stored `balanceDue` while the server verified
   `amountOwed()`; any drift between the two produced `PRICE_CHANGED`.

### Change

- `checkoutAmount`: the hold only guards the first payment. Once `payments[]`
  carries credit the booking is held by that payment (same rule the webhook's
  `settlementDecision` already used).
- Every offline-credit path now deletes `pendingExpiresAt`.
- `/api/kpay/checkout`: when the amount or method group differs from the prior
  order and KPay confirms that order is still awaiting payment with no attempt
  that could have moved money, a new order is created and the old mapping is
  marked `supersededBy`. A pending attempt on an open transaction still blocks.
  A `creating` reservation older than 3 minutes is replaced; a gateway failure
  releases the reservation immediately.
- Pay-balance page charges `amountOwed(booking)`, the same figure the server
  checks.

### What to do for the 31 Oct customer

Nothing to repair in Firestore. After this release, re-send the same
pay-balance link (or let the customer use 會員中心 → 找尾數). If it still
fails, read the Vercel log line `[kpay/checkout] prior order` for that booking
id; it names the gateway state and the decision taken.

## 2. 折扣優惠 on the booking-link generator

`/admin/bookings/new` has a new card below the promo code: 冇折扣 / 現金扣減
HK$ / 場租折扣 % / 全單折扣 %, plus an optional note. It maps onto the existing
`adminDiscount` shape (`cash·all`, `percent·rent`, `percent·all`) that the
booking detail page already supports, so receipts, emails, finance and
month-close pick it up unchanged.

- Stored on the draft (`BookingDraft.adminDiscount`) and copied to the booking
  on claim by `/api/bookings/create`, which deducts it before computing the
  upfront deposit. Also accepted by `/api/admin/booking-direct`.
- Shown as its own line on the claim page, confirm page, payment page, 會員中心
  and the admin price summary. The security deposit is never discounted; the
  deposit tier still keys off the pre-discount subtotal, like the promo.
- `/api/bookings/[id]/confirm` keeps the discount when the customer adds
  loyalty points (previously that recompute would have restored the
  undiscounted deposit).
- Input is validated server-side (`sanitizeAdminDiscount`): percent ≤ 100,
  value > 0, note ≤ 200 chars; a customer self-booking body cannot carry one.

## Verification

See the commit message and the test run recorded there. No production
deployment, Firestore write, payment, email or passcode was triggered by this
work.
