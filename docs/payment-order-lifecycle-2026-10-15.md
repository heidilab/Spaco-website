# Balance checkout lifecycle follow-up — 2026-10-15

## Incident and limits

Refreshing a cashier signature does not reopen an expired/closed KPay managed order. The previous hotfix was incomplete for that case. The customer reported the gateway's order-ended screen. Firestore still showed an outstanding balance; this alone is not proof the gateway did not collect payment.

The preview and production KPay credential entries are separate. The temporary preview query returned code 30002, so it cannot establish production payment status. A full production environment export was rejected by approval review; a narrower request could not decrypt the sensitive KPay values. A proposed temporary production-runtime diagnostic was also rejected and was not executed. The customer explicitly wants only balance payment, so the diagnostic component/API were removed from source and both diagnostic preview deployments were removed. No production data has been changed.

## Narrow proposed change (not production)

Balance checkout queries the previous managed order by both identifiers. Only an identity-, amount- and currency-matching terminal expired/closed order with no successful, refunded, pending or unfamiliar payment attempts can be replaced. The replacement reservation is atomic; the old mapping remains available for late callbacks. Paid, unknown and unavailable gateway status blocks a new charge. Pending payable orders retain fresh-signature reuse. Initial checkout behaviour is unchanged.

Numeric lifecycle values follow the gateway integration reference at https://github.com/himwai/KPay/blob/main/src/api/v1/kpay/types/typeKpayApi.ts and its query result schema. Confirmation against the production gateway remains outstanding; do not treat mocked tests as end-to-end verification.

No new staff-facing feature is included. Local sync conflict copies remain on disk and are excluded from deployment. The existing payment-history test fixture now includes required payment fields.

## Verification / release

193 tests pass, including terminal states, contradictory payment attempts, identity/amount mismatch, gateway failure, and concurrent replacement prevention. Preview dpl_K2mAUuYJ9FKivit7YuvkTF1nggBD READY; cloud 193 tests, TypeScript and build passed (implementation c85e82b). No main merge or production deployment. Retired diagnostic preview domains were removed and other domains preserved. Notion status synced. The user was asked to verify the old balance order's payment status in KPay before any manual lock repair. No real payment, refund, booking, email or lock was created.

## 2026-10-15 follow-up: gateway-driven reuse for every prior order

Production (dpl_FQFdgsnASzqyvmjMFMw2vyLik8dH, release 2c23054) still re-signs the stored managed order unconditionally, so the customer's balance link reopened an order KPay had already closed (「該訂單已完結」). The replacement logic in c85e82b never reached production.

Local KPay documentation (`.claude/kpay-docs/全託管訂單.md`, `status_code.md`) confirms the query schema used by `canReplaceKpayOrder`: `managedOrderState` 1 待支付 / 2 已支付 / 3 已過期 / 4 已退貨 / 5 已關閉, `paymentOrderList[].result` and `.orderState`, and application code 30004 訂單已過期. The managed-order add API has no expiry parameter; the cashier runs its own countdown, so no stored order may be assumed payable later.

Change: `decideKpayOrderReuse` returns reuse (state 1), replace (verified terminal unpaid order, or gateway code 30004) or blocked (paid, refunded, unknown, mismatched, 30002, or query failure). The checkout route now applies it to deposit and balance locks alike, derives the expected gateway charge for legacy locks without `chargeTotal`, allows a method switch once the old order is dead, and logs the decision (booking id, kind, state/code only). The old `_kpay_orders` mapping is kept for late callbacks, as before.

Verification: 216 unit tests pass (new lifecycle, 30004, 30002, legacy lock, deposit reuse/replace/paid cases). TypeScript passes for tracked files; a pre-existing test fixture cast in `PaymentHistory.test.ts` was tightened to `as unknown as BookingRecord`. Untracked ` 2.ts` sync copies still fail tsc locally and remain excluded from deployment. Not yet verified against the production gateway; mocked tests are not proof of customer payment.

## Production release (2026-10-15)

Heidi explicitly approved immediate production release. main fast-forwarded to ef64e00 and pushed. Production deployment dpl_FMTvSAzaf3bFC8P3vJgddtXmzCSK is READY and aliased to https://spacohk.com (previous production: dpl_FQFdgsnASzqyvmjMFMw2vyLik8dH, keep for rollback). Post-deploy checks: /zh HTTP 200, unauthenticated /api/kpay/checkout 401, balance page route 200. The customer's retry against the production gateway is the only end-to-end verification; the `[kpay/checkout] prior order` log line records the reuse/replace/blocked decision for it. Preview hostname was not added to Firebase Auth (no permission from this session). No payment, refund, booking, email or lock was created.
