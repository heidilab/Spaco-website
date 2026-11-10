# Admin pages listed only the original four branches — 2026-11-10

A branch added in 分店管理 (尖沙咀 HART — branchKey `tsthart`, rooms `hart-a`,
`hart-b`, `hart-ab`) was missing from 控制中心, 財務總覽, 支出管理, 月結 and
特別日子. Found by grep; not reproduced in the UI (no staff login in the
session that made this change, and live data was not inspected).

## Cause

- `branchKey(venueId)` in `src/lib/finance.ts` only knew the `sw-` prefix, so
  each HART room was its own "branch" (`hart-a`, …) instead of rolling up to
  `tsthart`.
- Each page then listed a hard-coded `['cwb', 'sw', 'tst', 'wanchai']` (特別日子:
  the six original venue ids), so HART sales had no dashboard card, no
  branch filter, no expense ledger and no month close, and its rooms could
  not get a peak-day surcharge / minimum.

## Change

- `branchKey(venueId, registry)` now takes the venue registry and applies the
  same rule as the CS 獎金 page (`src/lib/bonusBranches.ts`, reused unchanged):
  the original four keep their keys, every other venue rolls up to its 分店管理
  `branchKey`. `branchGroupName` and `aggregateBookings` take the registry too,
  and `financeBranches(registry, extraKeys)` gives the list a page shows.
- 控制中心, 財務總覽 (filter, per-booking export, expenses in the Excel export),
  支出管理 and 月結 load the registry with `loadAllVenues()` and list
  `financeBranches(...)`. Short labels of the original four are unchanged.
- 特別日子 lists `peakRuleScopes(registry, savedKeys)` from
  `src/lib/peakDayRules.ts`: the original six, then every other 上架 venue,
  keyed by venue id (what `resolvePeakRule` already looks up first). Re-saving
  a date now keeps rules for venues the page does not list.

If the registry cannot be read, `loadAllVenues()` falls back to the static
venues and every page shows the original four, as before.

## Decision recorded

Answer given for the owner (Heidi) in the session, 2026-11-10: HART is closed and expensed
as **one branch**. New records use `tsthart`: `month_closes/tsthart_<month>`,
`expenses` / `expense_templates` with `branchKey: 'tsthart'`, and
`system/finance_config.profitSplits.tsthart`. Existing records of the original
four are untouched.

## Not done / to check

- **Old per-room month-close docs.** Before this change, applying a KPay
  statement in 月結 saved the fee of a HART booking under the room id
  (`month_closes/hart-a_<month>` …). Nothing reads those docs now. Whether any
  exist was not checked. If HART took KPay payments in a month whose statement
  was already applied, upload that statement again so the fee lands on
  `tsthart_<month>`; until then that month shows the estimated fee.
- HART has no default profit split or recurring expense items yet — set them
  on the 尖沙咀 HART tab of 月結 and 支出管理.
- The pages were not opened in a browser. First check after deploy: the HART
  card on 控制中心 and the 尖沙咀 HART tab on 支出管理 / 月結 (opening a tab reads
  only; nothing is saved until an item is added or a split is edited).
