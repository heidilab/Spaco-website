# Commission base, sales pay, fixed-expense cleanup, campaign delete — 2026-11-13

Four requests from Heidi on the finance pages (支出管理 / 月結 / CS 獎金) and
one on 活動現金券.

## 1. Commission counts 加時/罰款; manual amount with a 儲存 button

- `bookingMoney.commissionBase(booking, base)`: the percentage is taken of
  the whole bill the customer ends up paying — the deposit deductions kept
  at settlement (加時, 罰款 …, `depositDeductionsKept`) are added to both
  bases. 行家 stays rent-only for F&B (rent − discounts + 加時/罰款); platforms
  take consumption − discounts + 加時/罰款. The refundable deposit and the
  card surcharge never count. Takes effect for every month shown, including
  closed ones (it is derived live), unless a booking carries a saved amount.
- 支出管理 → 佣金: each row shows the base (「10% × 全單 $5,880（含加時/罰款
  $1,000）= $588」), an amount box, a **儲存** button (Enter works too) and,
  once saved, **還原自動**. The saved amount is `booking.commissionOverride`
  (unchanged field) — 月結 and the Master export read the same function, so
  they follow it. Saving no longer happens on blur.

## 2. Sales pay (底薪 + 獎金) on the month close

- CS 獎金 → 目標設定: a 底薪 (monthly base pay) per branch, saved in
  `system/bonus_config.branches[branch].baseSalary`.
- 月結: `salary = baseSalary + bonus of the tier reached` (lib/salesSalary,
  same sales basis as the CS 獎金 page — Σ `pricing.subtotal` of the month's
  countsForFinance bookings of that branch). Counted in 總支出 and in the
  Master table; the monthly tab gets an expense row
  「Sales Salary（底薪 $1,500 + 獎金 $800）」 in the Vendor / Amount columns.
  Each branch computes its own. A branch with no 底薪 and no tier reached
  has no row.
- Not on 支出管理's own totals (that page is the ledger of stored rows +
  derived commissions / KPay); the P&L figure is 月結's.

## 3. Fixed expenses (固定開支)

- Deleting a template now also deletes its rows in the month being viewed
  and every later month (confirm text says so); earlier months keep theirs.
- Seeding skips a template whose item name is already on the month's
  recurring rows (a template deleted and re-added used to seed 「寬頻」
  twice). `templatesToSeed`, `rowsRemovedWithTemplate`, `sameExpenseItem`
  are pure and tested.
- Rows of a deleted template show 「固定項目已刪除」; a repeated name shows
  「重複」 — both still deletable with the bin icon. Existing duplicates are
  not removed automatically (which of the two to keep is her call).

## 4. 活動現金券: delete a whole campaign

Open the campaign → 「刪除整個 campaign」 deletes all its codes after a
confirm that states how many redemptions it had. Bookings that redeemed a
code keep their discount and the code text; only the admin record goes.
