# Payment link and receipt display hotfix — 2026-10-14

## Confirmed causes

The authenticated checkout retry path returned a persisted cashier URL verbatim. That URL contains a signed timestamp and nonce. Reopening a previously created order hours later therefore reused an expired signature and KPay rejected it with error 40009. This regression was introduced by the October 9 checkout idempotency change.

PaymentHistory displayed payment principal only and omitted the separately stored cardSurcharge. Live read-only inspection confirmed the reported fee had been stored correctly. No payment or booking data repair is required for this display issue.

## Change

- Reuse the same managed order, but generate a new cashier signature for every checkout response. Never create another order merely because a signature expired. New checkout locks no longer store signed URLs; old locks remain compatible through managedOrderNo.
- Display stored card fees and gross receipts separately from booking principal. No recalculation of historical fees, booking balance, or refundable deposit.
- Explain balance-page load errors, offer retry/account switching, ignore stale async results, and correct the bookings navigation destination.
- Customer balance links copied by staff use the production domain even when staff are browsing a preview. This is preventative; the reported failure was on the production domain.

## Verification and status

175 unit/component tests pass, including repeat balance checkout using the same managed order with fresh signatures and no gateway order creation, unresolved checkout protection, fee rendering, fee-less legacy payments, and refunds in receipt totals.

Full Next.js build (including TypeScript validation) passed. Preview dpl_E6MMV6tdoHYdGgYb8TY1BLpBTssk is READY at https://spaco-website-6ims2epyy-heidilabs-projects.vercel.app (HTTP 200). Cloud build and 175 tests passed. Exact preview domain added to Firebase Auth with all previous domains preserved. Code commit 3b6787f pushed to kpay-integration; production approval requested. Notion changelog, workflow and architecture synced. Local CMS fetch used fallback due to sandbox DNS; cloud build completed. No production deployment yet. No real test bookings, payments, refunds, emails, or locks triggered. No customer financial records included here.

## Production release

Heidi explicitly approved immediate production release. Release 2c23054 (implementation 3b6787f) merged and pushed to main. Deployment dpl_CcwRT5PA2c2u4ceBX2nzj5wqpi2X is READY and aliased to https://spacohk.com; cloud 175 tests, TypeScript and build passed. Isolated browser confirmed the original balance URL returns HTTP 200 and shows the correct sign-in prompt. No payment submitted; customer completion is not yet verified. Notion changelog, workflow and architecture updated.
