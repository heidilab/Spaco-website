# SPACO operations

## Payment review

`paymentReviewRequired` marks a received KPay payment which could not automatically confirm the booking. The admin booking detail shows a warning. Check cash received, slot availability, cancelled/expired status and points/promo entitlement before arranging confirmation or a refund. Do not ask for duplicate payment. A later callback intentionally does not clear this flag.

- `_kpay_webhook_events`: transaction deduplication records. Never delete casually to force a retry: that risks duplicate credit.
- `_kpay_orders`: immutable checkout-to-booking and amount mapping.
- `_checkout_orders`: current checkout link/creation lock. A gateway timeout needs provider reconciliation before unlocking.
- `_payment_reconciliation`: unmatched payment notifications; investigate with the provider and booking records.
- `_payment_finalizations`: durable post-payment work. Pending jobs are retried every five minutes, with a two-minute lease; check attempts/lease/status if notifications are delayed. External messages can repeat after an interrupted send, even though money is not credited twice.

Points/promos are finally checked and consumed at settlement, not reserved before the customer pays. Competing already-open links can both charge; the ineligible one needs manual reconciliation. Offline/FPS workflows remain separately managed.

## Scheduled work

`vercel.json` is the source of truth. Vercel schedules are UTC; below is Hong Kong time:

| Work | Hong Kong schedule |
| --- | --- |
| Lock passcodes | 09:00 daily |
| Expire unpaid bookings | Every 15 minutes |
| Post-event emails | 11:00 daily |
| Google Calendar sync | Every 15 minutes |
| Bonus check | 09:00, 15:00, 21:00 daily |
| Test booking hygiene | 10:30 daily |
| Payment finalizations | Every 5 minutes |

Production must have `CRON_SECRET`; do not print it or manually run authenticated jobs as smoke tests. A deployed schedule is not proof every run succeeded: inspect Vercel execution logs and pending job records when diagnosing failures.

## Rollback

Keep the previous Vercel production deployment ID. Redeploy the approved prior commit using production environment variables if rollback is needed. Review data/schema compatibility before reversing a release; application rollback does not undo recorded payments or external actions.

Firebase rules rollback is separate. Remote rules captured before the first security release are in `docs/rollback-2026-10-09/` for audit/recovery reference. They contain the old broad permissions, so do not restore them automatically. Prefer a narrowly scoped forward fix and confirm emulator tests. Never modify customer records just to make a rollback test pass.

## Content maintenance

Home title, description and social images can be managed in admin SEO. Titles already containing SPACO use an absolute title to avoid a second brand suffix. Promotional image alternative text should describe the offer; do not enter storage keys or filenames. Footer follows Instagram rather than collecting email addresses through an unconnected form. Phone/email links open the device's dialler/mail application.

Venue-specific claims in articles must be checked against current venue settings and the business owner. The audit found an all-branches BBQ statement; do not silently rewrite live CMS articles as part of a code preview. Review that article with the current venue information before publishing a correction.
