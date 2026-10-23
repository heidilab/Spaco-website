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
