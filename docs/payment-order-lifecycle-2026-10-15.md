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
