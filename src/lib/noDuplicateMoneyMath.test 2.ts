/**
 * ARCHITECTURAL GUARD for the surfaces that have actually broken.
 *
 * Every money incident on this project had the same mechanism: a page
 * computed a total inline, someone fixed a different copy, and the two
 * disagreed in production. These are the surfaces where that happened.
 * They must keep importing from bookingMoney rather than re-deriving.
 *
 * This is deliberately targeted rather than a repo-wide scan: plenty of
 * files legitimately touch baseCharge/addOnTotal when they BUILD a
 * pricing block (booking form, repair scripts, invoice line items). A
 * broad scan flags those and trains people to ignore the failure.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(process.cwd(), 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/** Customer- and admin-facing surfaces that display or gate on money. */
const GUARDED = [
  {
    file: 'app/[locale]/my-bookings/page.tsx',
    incident: 'total/paid looked swapped on a points-redeemed booking',
    mustImport: ['displayBillTotal', 'paidGateway'],
  },
  {
    file: 'app/[locale]/my-bookings/[id]/page.tsx',
    incident: 'total/paid looked swapped; 已付 showed pricing.deposit',
    mustImport: ['displayBillTotal', 'paidGateway'],
  },
  {
    file: 'app/[locale]/admin/bookings/[id]/page.tsx',
    incident: '#2qzYQOU4 + #LSi5Z31A — outstanding-balance card disappeared',
    mustImport: ['amountOwed'],
  },
  {
    file: 'components/booking/PaymentHistory.tsx',
    incident: 'phantom synth payment row from a drifted grand total',
    mustImport: ['computeGrandTotal'],
  },
  {
    file: 'app/api/bookings/[id]/modify/route.ts',
    incident: 'customer self-modify recomputes the bill',
    mustImport: ['computeGrandTotal', 'computeBalanceDue'],
  },
];

describe('guarded money surfaces', () => {
  for (const { file, incident, mustImport } of GUARDED) {
    it(`${file} uses the shared module (${incident})`, () => {
      const text = read(file);
      expect(text, `${file} must import from @/lib/bookingMoney`)
        .toContain("from '@/lib/bookingMoney'");
      for (const fn of mustImport) {
        expect(text, `${file} must use ${fn}() rather than its own formula`)
          .toContain(fn);
      }
    });
  }

  it('the canonical grand-total formula is not retyped on a guarded surface', () => {
    // Fingerprint of a hand-rolled copy: subtracting BOTH discounts off
    // baseCharge + addOnTotal in one expression.
    // Require the arithmetic, not just the words — an object literal that
    // merely passes these fields into computeGrandTotal is fine.
    // [\s\S] instead of the /s flag — the repo's TS target predates es2018.
    const inline = /baseCharge[^;]{0,120}\+[^;]{0,60}addOnTotal[^;]{0,120}-[^;]{0,60}promoDiscount[^;]{0,120}-[^;]{0,60}pointsDiscount/;
    const offenders = GUARDED
      .map(({ file }) => ({ file, text: read(file) }))
      .filter(({ text }) => inline.test(text))
      .map(({ file }) => file);

    expect(
      offenders,
      'Delete the inline formula and call computeGrandTotal() instead:\n'
      + offenders.map((o) => `  - ${o}`).join('\n'),
    ).toEqual([]);
  });
});
