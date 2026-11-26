# 不使用電子門鎖 + 提早入場佈置 hold rule — 2026-11-26

Branch `fix/no-lock-early-setup` (from `origin/main` d70ed51), commits
e4e7daa + f539244. Previewed on `spaco-test.vercel.app`; Heidi approved the
release on 2026-11-26 and `main` was fast-forwarded to f539244. Production
deployment `dpl_2WMFu76p3hHzbv5XonWZ2CeqHBVP` is READY on spacohk.com
(657 tests passed in the Vercel build). The `noElectronicLock` flag was not
set on any venue at release time; Heidi ticks it per venue in 分店管理.

## 1. 分店管理 →「不使用電子門鎖」

Some branches have no TTLock / keypad door. Until now the passcode sweep
treated them like every other venue: it tried to issue a code, got
`no-lockid`, and the 09:00 sweep emailed staff「⚠️ 門鎖密碼未能發出」for
each such booking.

- New venue flag `noElectronicLock` (checkbox in 分店管理 per space; the
  TTLock ID / confirm key / guide URL fields hide while it is ticked).
- `processBookingForLockAccess`: the venue is resolved first; a no-lock
  venue returns `skipped / no-electronic-lock` — no TTLock call, not an
  error, so the sweep's failure email and the `ttlock_status.problems`
  list never include it.
- Balance reminders still go out (the money is still owed) but without
  the「找清先會發密碼」promise; subject becomes「請於活動前 2 日找清」.
- Booking confirmation emails on such venues drop the「門鎖密碼會喺活動前
  1–2 日自動 email 畀你」line.
- 門鎖設定 page: the space shows「不使用電子門鎖」instead of lock inputs;
  upcoming bookings there show state「不使用電子門鎖」.
- Booking detail → 門鎖密碼 panel: explains the venue has no lock; no
  generate / manual-passcode form. An existing passcode is still shown.

Not changed: a venue with a lock ID but the box unticked behaves exactly as
before; manual passcodes (no lock ID, box unticked) are unchanged.

## 2. 提早入場佈置 holds the room from the set-up start

Rule (Heidi): a booking 15:00–20:00 with 1 set-up hour holds 14:00–20:00,
and the note says「14:00-15:00 提早入場佈置」. Customers may buy up to 3
hours; the hold moves accordingly.

Already true before this change on the customer create path, admin edits,
customer modify and the Google Calendar event (start = set-up start, 🎈
line in the description, passcode valid from the set-up start). #rJr2PlOw
(sw21-main, 2026-12-06 15:00–20:00, 1 h) has its `setup` blocked_slot
14:00–15:00 and a calendar event.

Gaps closed now, all through the new pure helper `src/lib/earlySetup.ts`:

- `/api/admin/booking-direct` (線下訂單) ignored an `early-setup` add-on:
  no `earlySetupHours`, no setup slot, calendar event at the booking
  start. It now conflict-checks and holds the set-up window, stores
  `earlySetupHours`, and the pushed event starts at the set-up start.
- `restoreBlockedSlotsIfMissing` (slots deleted by the expiry cron and
  rebuilt on payment) rebuilt only booking + cleaning slots; it rebuilds
  the `setup` slot too.
- `bookingWindows` (second line of defence when blocked_slots are missing)
  now counts an existing booking's set-up hours, so a new booking cannot
  land on them.
- `/api/admin/package-addons` (package bookings) rewrote the setup slot but
  left the Google Calendar event and the passcode window where they were;
  it now updates both.
- 後台 calendar day list: the booking row starts at the set-up start
  (「14:00–20:00 … 🎈14:00-15:00 提早入場佈置」) instead of 15:00.

## Verification

- `npm test` (vitest): new `earlySetup.test.ts`, `venueLock.test.ts`,
  `lockPasscodeNoLock.test.ts`, extra `bookingOverlap` case.
- `tsc --noEmit`.
- Not exercised against TTLock, Google Calendar or Resend; previews share
  the live Firestore, so no test booking was created.

## Limitations

- An existing no-lock venue's past alert emails are history; the flag only
  affects sweeps after it is ticked.
- `bookingWindows` only reads `earlySetupHours`; a legacy booking whose
  hours live only in `addOns` (never stored on the field) is covered by its
  `setup` blocked_slot, as before.
