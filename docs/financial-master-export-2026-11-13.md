# 月結 export shaped like her Financial Master workbook — 2026-11-13

Reported by Heidi while testing the KPay change: 「匯出 Master」 gave one rollup
sheet; she wanted the workbook she keeps by hand
(`CWB2026-2027 Financial Master.xlsx`): a `Master` tab plus one tab per month
(`OCT-2026`, `SEP-2026`, …) in her monthly layout.

## What was wrong

1. **No monthly tabs.** The export wrote the `Master` rollup only.
2. **Total Sales was short.** Her OCT-2026 (CWB) tab reads $66,142.37; 月結
   showed $62,999. The $3,143.37 gap is 加時/罰款 $2,900 (deposit deductions
   kept) + 信用卡手續費 $243.37 (card surcharge the customer paid). 月結 listed
   加時/罰款 beside the total but summed `pricing.subtotal` only, and had no
   信用卡手續費 at all. Her `Total` is `=SUM(D:K)` over every Sales column.

   The second half mattered more after the KPay change of 2026-11-10: the
   actual KPay fee on a card payment is the gateway's FULL fee, part of which
   the customer already paid as the surcharge. Expensing the fee without
   booking the surcharge as income understated profit.

## Change

- `finance.monthCloseSales(booking, excluded)` — one booking's Sales columns in
  her terms, always adding up to Total:
  `Total = bill (pricing.subtotal) + deposit deductions kept
  + card surcharge received − points redeemed`.
  Columns: Rent, BBQ/Hotpot, Shisha, 到會, Drinks, 會員積分優惠 (negative),
  信用卡手續費, 加時/罰款. Anything on the bill outside the five product columns
  (custom items, early set-up) rides in 加時/罰款 so a row never fails to add up.
  Settlement debt not received by month end still comes off 加時/罰款 first,
  then rent.
- 月結 uses it for Total Sales, the channel sales and the Sales Income
  Proportion rows (which now add up to Total Sales, with 會員積分優惠 and
  信用卡手續費 rows as in her Master).
- KPay fee ESTIMATE (payments whose statement is not uploaded) is now
  `% × credited amount + card surcharge`, so booking the surcharge as income
  does not flatter an estimated month. Actual fees are unchanged.
- 「匯出 Master」 now writes the `Master` tab, then one tab per financial-year
  month that has bookings or expenses, newest first.
  `lib/financialMasterSheet.ts` lays a tab out (pure, tested against her
  OCT-2026 tab: $66,142.37 / $58,654.91 / $7,487.46);
  `lib/financialMasterXlsx.ts` styles it. Her 21 columns, booking blocks with
  merged cells, real date cells, and her formulas (`=SUM(D6:K6)`, column sums,
  Total Expenses, Total Sales Amount, Profit, split rows) with cached values.
- `lib/salesRecord.ts` — the transaction rows, shared with the 財務總覽 Sales
  Record export. A tab's Transaction amounts include the card surcharge (the
  figure on the KPay statement).

## Effect on existing numbers

月結 Total Sales, Profit and split amounts change for any month with deposit
deductions, card-surcharge payments or points redeemed — closed months
included, since all of this is derived live. Compare against her own sheets on
the test site before release.

## Not done

- `Charts` tab: xlsx-js-style cannot write charts.
- Her Master's manual blocks (previous years' profit, 「Kenneth Return Period」
  COST, 「Account Profit」 opening balance) are her own carried figures; the
  export keeps the Profit Split and Commission tables instead.
- Per-booking vendor costs she types beside a booking (Brilliant Balloon,
  日之苑 …) are stored expenses in the system with no booking link, so they
  list with the month's expenses at the bottom of the tab, not beside the
  booking. Totals are the same.
- Promo-code discounts: 月結 sales stay gross of promo codes, as before. Her
  sheet has no column for them. Open question for her.
- 財務總覽 → Sales Record export keeps its 19-column layout and totals.
- Not exercised in the browser against live data in this session.
