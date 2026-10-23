# New branch invisible on the public site (2026-10-24)

## Cause

HART (尖沙咀, branchKey `tsthart`, three active spaces) was added in 分店管理. The branch page already worked at `/branches/tsthart` (generic MultiRoomBranch) and the home collection already read the registry, but the header Spaces dropdown, the 分店導覽 grid and the hero "4 分店" counter were hard-coded to the original four branches, and the count strings were literal.

## Change (commit 344c0dd)

`src/lib/branchDirectory.ts`: `groupBranches(venues)` groups active registry venues by `branchKey` (single space → its own slug; multi-space → `/branches/<branchKey>`; inactive spaces and branches drop out), with the static four as first paint and `useBranchDirectory()` for components. Header, BranchGrid and HeroSection now read it; `hero.locations` and `branches.subtitle` take `{count}`. BranchGrid keeps the 內容管理 hero-image slots for the legacy four and uses the venue's first photo for new branches; grid columns adapt to the count.

## Verification

298 unit tests (4 new), TypeScript and lint pass. Preview dpl (spaco-website-qwinmm71x): header links to all five branches including `/branches/tsthart`, chip shows 5 locations, hero shows 5 分店, HART card present, no console errors. Production page `/branches/tsthart` already renders the three HART rooms with photos, prices and booking buttons.

## Not changed

Static SEO text still mentions four branches in the default meta description (editable in admin SEO). `src/lib/branchInfo.ts` and `jsonLd.venuesForBranch` remain static for legacy pages; the branch layout already falls back to the registry for dynamic slugs.

## Production release

Heidi approved. main fast-forwarded to 02d509e (feature 344c0dd); production dpl_4zztztpxtWWCAB5XoFZcJh6AxpFf READY and aliased to https://spacohk.com. /zh, /en, /zh/branches/tsthart and /zh/book/hart-a return 200; the live home page lists five branch links including tsthart, shows 「香港 · 5 間分店」 and "5 locations · Hong Kong", renders the HART card, and has no console errors. No rules change.

## 2026-10-24 (later) — amenities merge + TST HART birthday package (preview only, commit 74b1535)

- **Amenities**: 分店管理 has two inputs per space — the checkbox set (`amenities` ids) and 設施文字列表 (`amenitiesText`). The three branch pages used the text list *instead of* the ticked boxes whenever it was non-empty, so Hart Room A (麻將 + 火鍋 ticked, "Poker / 音響" typed) lost 麻將 and 火鍋. `src/lib/venueAmenities.ts` → `venueAmenityItems()` now merges both (ticked first, case-insensitive dedupe, en falls back to the zh text). Used by `MultiRoomBranch`, `branches/[slug]` and `branches/sheung-wan`.
- **birthday-hart** (`src/lib/packages.ts`): same $6,800 / $2,000 deposit / 3 h / 08:00–17:00 / ≥5 days notice as `birthday-cwb`, sold on `hart-ab` (Hart Room A+B 全場). Hours and notice period were copied from CWB — confirm with Heidi. `getPackagesByCategory('birthday')` drives the 揀分店 chips on `/book/package/*` and the per-branch buttons on `/family`; `branchLabel` on each package is the chip text. Admin 推廣連結 list gained `/book/package/birthday-hart` and `/branches/tsthart`.
- **Package card on multi-space pages**: the 「此分店獨家套餐」 section moved to `src/components/branches/BranchPackages.tsx` and is rendered by both the single-space page and `MultiRoomBranch` (packages of any space in the branch).
- **Registry-first venue lookup on customer pages**: `src/lib/useRegistryVenue.ts` (`useRegistryVenue`, `useVenueRegistryReady`, `findVenueNow`) replaces the static `getVenueById` on the package, confirm, payment and pay-balance pages — HART rooms only exist in the registry, so those pages showed the slug as the venue name and skipped the drinks repricing. `SettlementDebtNotice` still uses the static list (name only).
- Server: `pricePackage` unchanged — `birthday-hart` is accepted only with `venueId === 'hart-ab'` (`src/lib/packages.test.ts`).
- Verified on preview `spaco-website-i6jc0kyuf`: `/zh/branches/tsthart` shows 麻將／火鍋 plus the typed items and the package card; `/zh/book/package/birthday-hart` shows the switcher and 「尖沙咀 HART 店 Room A+B（全場）」 at $6,800 + $2,000; `/zh/family` offers 預訂 銅鑼灣店 / 預訂 尖沙咀 HART. Not released to production.

## 2026-10-24 (night) — amenity icons + Google Calendar id normalisation (live, 63e7f28 / 2409344, dpl_9gHzxm9LhSo6Q8CbF2cg8LJ9vY44)

- `AmenityGrid` registry: `\b` never matches next to CJK, so 「火鍋」/「燒烤」 fell through to the generic icon. Added 街機 (Joystick), 波波池 (Volleyball), 彈跳床 (ChevronsUp), 兒童玩具 (ToyBrick); 桌球 → CircleDot. `resolveAmenity` is exported and covered by `AmenityGrid.test.ts`.
- HART's three venue docs had the Google **embed URL** in `gcalCalendarId`; the 15-minute sync logged `cal4:hart-a: Not Found` in `system/calendar_sync.errors` (other calendars unaffected — errors are per calendar). `normalizeGcalCalendarId()` (`src/lib/gcalCalendarId.ts`) now reduces embed / `cid=` / ical URLs to the bare id on save (admin venues form) and on read (`getCalendarIdForVenue`, `getCalendarGroups`), so no data fix was needed. First post-deploy sync 2026-10-23T18:00:39Z: scanned 25, errors []. Read-only probe with the connected account: HART calendar reachable, 0 upcoming events; HART has 0 bookings so nothing has been pushed yet.
- How to check sync health: read `system/calendar_sync` (lastSyncedAt should be < 15 min old; `errors` lists failing calendars). The cron hits the deployment named in the Vercel project's `crons.definitions[].host`.
