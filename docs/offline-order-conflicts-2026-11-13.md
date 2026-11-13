# Offline orders refused by Google Calendar entries — 2026-11-13

Reported by Heidi: a part-timer marks a broker / Airbnb booking straight
into Google Calendar. When staff then record it properly (新增預訂 → 直接落單)
the website refuses it as a time conflict — with the calendar entry that
stands for that same booking. Deleting the calendar entry did not help: two
hours later it still "conflicted".

## Cause

1. `/api/admin/booking-direct` treated every `blocked_slots` row alike. Rows
   with `reason: 'gcal'` are mirrors of Google Calendar events, so the
   part-timer's entry blocked the order it described.
2. The Google → website sync (`syncCalendars`) deleted stale mirror rows in
   ONE Firestore batch. A batch takes at most 500 writes; a larger backlog
   threw, which aborted the run before anything was removed, and the same
   backlog failed every later run — additions kept working (they are written
   before that step), removals never did. This fits "deleted the event, still
   blocked" but is **not confirmed against production data** (no Firestore
   access in the session that made this change).
   A second fault in the same step: when a calendar could not be read, all of
   its mirror rows were treated as gone and deleted.

## Change

- `lib/directBookingClashes.ts` (pure, tested): what an offline order
  overlaps, and what may stop it.
  - A Google Calendar entry never stops it. The order is created and the
    success screen lists what it overlapped, with a reminder to delete the
    calendar entry if it is the same booking (the system creates its own
    event for the order).
  - Another booking, its cleaning / set-up buffer, or a block staff set on
    the site (人手封鎖) stops it once: the form lists the clash and offers to
    add the order anyway (`allowOverlap`). Not an unconditional pass — a
    real double booking should be a decision (CWB 2026-10-31).
- Customer bookings, CS payment links and edits of existing bookings keep
  the full conflict check.
- `syncCalendars`: stale rows are deleted in batches of 400; rows of a
  calendar that failed to load are kept. The cron route allows 60 s.
- Staff label of `bbq-premium` is `BBQ Seafood Package` / `BBQ 豪華海鮮套餐`
  (was `BBQ Premium Package`) — Google Calendar, the admin calendar and the
  supplier order email. "Premium" did not tell the cleaner there is seafood.
  Existing calendar events keep the old text until the booking is pushed
  again (the sync button on the booking page, or saving a remark).

## To check after release

- 系統設定 → Google Calendar → 立即同步 once, and read the result: `removed`
  should show the backlog being cleared; an error there is the real cause if
  slots still stick.
