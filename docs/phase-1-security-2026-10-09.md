# Phase 1 security implementation — 2026-10-09

Status: local working changes on kpay-integration. Not committed, pushed or deployed. Production rules have not been fetched/verified. Preview and production share Firebase; deploying rules is a production-affecting release requiring Heidi approval.

## Changes

- Customer booking creation and confirmation use authenticated server APIs. Package prices, add-ons, duration, capacity, discounts and points are validated server-side; customer-supplied prices and identities are ignored. Staff draft terms are read from the stored quote and claimed transactionally.
- KPay verifies booking ownership and derives the amount from the booking. A transactional checkout record reuses an existing link and blocks competing payment methods/amounts. A price mismatch requires the customer to review the new amount.
- Firestore rules deny customer financial edits, points writes, arbitrary booking creation and staff-draft reads. Receipt storage restricts access to the booking owner and authorised staff, with MIME/10MB restrictions. Existing download-token URLs are not revoked by these rules.
- Staff calendar API redacts financial/contact data for cleaner and marketing. Financial collections are restricted; venue management UI is admin-only. Missing staff roles no longer default to administrator.
- CS point adjustments use an authenticated, audited server transaction. Customer confirmation retains permitted refund details and offline receipt uploads.
- Corrected conditional hook ordering in the new-booking admin page.

## Validation

- 130 unit tests passed (13 files), including forged package prices, identities, CS quote tampering, expired quotes and unauthorised KPay checkout.
- 9 Firestore/Storage emulator tests passed using demo-spaco-security; no live customer bookings or payments created.
- TypeScript passed. Focused lint on new security/server modules passed. Full-project lint has existing unrelated failures from the initial audit.
- Next build exited 0. Remote CMS fetches may fall back under the local network restrictions; this is not production smoke testing.

## Release work and limitations

- Local implementation is ready for review, not a declaration that production is secured. Verify actual deployed rules, preview UI and migration compatibility before release.
- Deploy application/API changes before restrictive rules, then verify role-specific workflows. Preserve rollback copies of deployed rules.
- Review pending legacy bookings and already-issued KPay links: historical client-written prices are not automatically repaired; old links are not tracked by the new checkout records.
- A gateway timeout leaves a checkout in creating state to avoid a second unknown charge. Reconcile the external order before manually recovering this state; do not simply delete the lock.
- Webhook atomicity/idempotency, cancelled-booking callbacks and concurrent points/promo reservation remain phase 2 work. Do not claim complete payment-race protection.
- Existing receipt download-token links remain usable by anyone holding the URL. Old flat-path receipts are staff-only through SDK rules.

## Preview deployment

Vercel preview deployed successfully on 2026-10-09: https://spaco-website-p4wvpau3b-heidilabs-projects.vercel.app/zh
Deployment ID: dpl_9gkrQDtE9ruqYmJFSsZ1LZgPDHe4 (READY). CLI deployed the uncommitted kpay-integration working tree over base ab7855892dfee86744635c549ae862c5aea22941; no git push. Cloud build, TypeScript and 130 tests passed. Browser homepage loaded. Production app and shared Firebase rules unchanged. Preview is connected to existing Firebase and is not an isolated payment sandbox.
