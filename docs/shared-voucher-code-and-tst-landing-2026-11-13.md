# One voucher code used N times; 尖沙咀 ad landing page — 2026-11-13

Two requests from Heidi.

## 1. 活動現金券: one code, good N times

Her 「VERTEXFC 足球隊 sponsor」 campaign (HK$500, min $3,800, until
2027-11-30) was meant as ONE code the team shares, usable 50 times in total
and dead after the 50th use. The generator (優惠碼管理 → 活動現金券) could only
make 50 different single-use codes, with no choice.

- The generator now asks 「優惠碼點樣用？」:
  - **一個 code，可用多次** — she types the code (e.g. `VERTEXFC`) and the
    total number of uses. Optional 「每個帳戶最多用幾次」; blank = no
    per-account limit, only the total counts (her rule: "用夠 50 次就會失效").
  - **多個 code，每個用一次** — unchanged.
- An existing batch can be folded into one code: open the campaign →
  「改為一個共用 code（可用 N 次）」. The new code gets every use the unused
  codes still had and the same value / min spend / dates / restrictions; the
  unused old codes are deleted (redeemed ones stay as the record). The new
  code is created before the old ones are deleted.
- A shared code shows 「可用 · 已用 x/N」 and has 停用 / 重新啟用. Once it has
  been redeemed it cannot be deleted, only stopped.
- Campaign header 「已用 x/y」 now counts uses, so both shapes read the same.

No change to validation or counting: a shared code is a normal `promo_codes`
doc with `totalUsageLimit: N`; `/api/promo/validate`, booking creation,
checkout and settlement already enforce `totalUsageCount < totalUsageLimit`.
Code: `lib/promoCodes.ts` (`createVoucherCampaign` mode `shared`,
`convertCampaignToSharedCode`, `sharedCodeError`, `campaignUsage`),
`components/admin/VoucherCampaigns.tsx`. Tests: `voucherSharedCode.test.ts`.

Her existing VERTEXFC campaign is NOT converted by this release — she does it
with the button (it deletes codes, so it is her click).

## 2. 尖沙咀 landing page for Google Ads

`/zh/tsim-sha-tsui-party-room` (and `/en/…`). Not in the site menu. Lists
the 尖沙咀 branches — today 尖沙咀店 and 尖沙咀 HART — each with main photo,
name, address, size, capacity and a short intro; the card opens the branch's
own page (`/branches/tsim-sha-tsui`, `/branches/tsthart`).

- Content comes from 分店管理 (`lib/districtLanding.ts`, pure, tested):
  - which branches: name or address contains 尖沙咀 / Tsim Sha Tsui / TST;
  - main photo: the venue's first photo. Multi-room: of the BIGGEST space
    that has photos — HART's A+B has none, so Room B's first photo is used
    (Heidi asked for exactly that one, not Room A's);
  - address: street number only, no building / floor / unit
    (「尖沙咀寶勒巷22-24號」) — her request; `streetOnly()`;
  - size: as typed in 分店管理 (multi-room: the whole-floor option);
  - capacity: smallest minimum – largest maximum of the branch's spaces;
  - intro: the venue's 簡介. HART has none filled in (2026-11-13), so the page
    uses the same sentence as the HART branch page (「同一層樓 3 種佈局…」) and
    lists the three room options. Filling in 簡介 in 分店管理 replaces it.
- Rendered on the server per request (`force-dynamic`); if the server cannot
  read the registry the browser loads it again.
- Title / description: SEO 管理 → 「尖沙咀廣告頁」 (`landing-tst`). The page is
  in the sitemap and indexable.
- `groupBranches` moved to `lib/branchGrouping.ts` (pure) so server code can
  use it; `lib/branchDirectory` re-exports it.

Another district is one entry in `DISTRICTS` plus a page folder.
