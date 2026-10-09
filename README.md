# SPACO website

Next.js 14 App Router / React / TypeScript website for SPACO Hong Kong. Chinese and English customer pages, booking and payment flows, and role-based staff administration. Hosted on Vercel; Firebase Auth, Firestore and Storage provide identity/data. Payments use KPay and manual FPS verification; Stripe checkout/webhook are retired.

## Local development

```sh
npm ci
npm run dev
```

Copy environment configuration through the authorised Vercel project or a project owner. Never commit `.env*.local`, service-account keys, tokens or customer exports. Preview and production currently share Firebase: local/preview code is not a payment or door-lock sandbox. Use mocks and emulators for writes and payment tests.

```sh
npm test
npx tsc --noEmit --incremental false
npm run build
# Java is required for the emulators (on this Mac: /opt/homebrew/opt/openjdk/bin).
npm run test:rules
```

`build` runs unit tests before Next.js. Rules/concurrency tests use only the `demo-spaco-security` project on local emulator ports 8180 and 9299. The existing project-wide lint backlog is not enforced by Next build; run focused ESLint for changed code. Network-restricted local builds may use CMS/SEO fallbacks, so inspect the cloud preview too.

## Release workflow

1. Make changes on `kpay-integration`; run relevant checks and commit/push.
2. Deploy a Vercel preview and record the exact URL/commit in the Notion changelog.
3. Verify public pages and unauthorised endpoint responses. Do not create real test bookings, payments, messages or passcodes.
4. Wait for Heidi's explicit production approval, then fast-forward/merge to `main`, push and deploy production with production environment variables.
5. Verify the production alias and routes. Firebase rules are a separate deployment affecting the shared live database: back up remote rules first, deploy compatible app changes first, and verify rules read back correctly.
6. Update Notion with status, commit, deployment, checks and known limitations. Changes outside this chat are not automatically captured by a webhook.

Notion hub: https://app.notion.com/p/c451dc1e991583cf830f0142835fab3e
Changelog: https://app.notion.com/p/3ea1dc1e9915817d850aff50ac6b5f3a

## Important code

- `src/lib/bookingMoney.ts`: canonical booking money calculations.
- `src/lib/bookingSecurity.ts`: trusted booking and checkout input validation.
- `src/lib/settleKpayPayment.ts`: atomic KPay payment and reward consumption.
- `src/lib/paymentFinalization.ts`: leased, retryable post-payment work.
- `src/lib/lockPasscode.ts`: TTLock access eligibility and automation.
- `src/lib/seo.ts`: per-page CMS metadata and defaults.
- `firestore.rules`, `storage.rules`: customer/staff data boundaries.

## Operations and recovery

See [operations](docs/operations.md), [initial audit](docs/audit-2026-10-09.md) and phase reports in `docs/`. Historical reports describe the state on that date; their original findings are not a statement that a later fix remains outstanding.
