import { describe, it, expect } from 'vitest';
import { reconcileKpayFees, kpayFeeOf, sumKpayFees, hkDateOf, type ReconcileBooking } from './kpayReconcile';
import { estimatedKpayFee } from './bookingMoney';
import type { StoredKpayStatement, KpayStatementTxn } from './kpayStatement';

const txn = (orderRef: string, date: string, amount: number, fee: number, transactionNo = ''): KpayStatementTxn =>
  ({ orderRef, date, amount, fee, ...(transactionNo ? { transactionNo } : {}) });

const stmt = (month: string, transactions: KpayStatementTxn[]): StoredKpayStatement => ({
  month, fileName: `${month}.xlsx`, rowCount: transactions.length,
  gross: transactions.reduce((s, t) => s + t.amount, 0),
  fee: transactions.reduce((s, t) => s + t.fee, 0),
  transactions,
});

/** A KPay payment as the webhook stores it (recordedAt is UTC ISO). */
const kpay = (hkDateTime: string, amount: number, cardSurcharge = 0) => ({
  method: 'kpay', amount, cardSurcharge,
  recordedAt: new Date(`${hkDateTime}+08:00`).toISOString(),
});
const fps = (hkDateTime: string, amount: number) => ({
  method: 'fps', amount, recordedAt: new Date(`${hkDateTime}+08:00`).toISOString(),
});

// ── Heidi's CWB OCT-2026 sheet (2026-11-10): the four KPay bookings and
// the rows of the AUG / SEP / OCT statements they were paid on. ──
const AUG = stmt('2026-08', [
  txn('BkpiNUudbFGVC_P1787565139', '2026-08-24', 8800, 132.0),
  txn('B4zZFwp9XWH0z_P1786585700', '2026-08-13', 8800, 132.0), // another booking, same amount
]);
const SEP = stmt('2026-09', [
  txn('BDpznzj5p22ur_P1789463502', '2026-09-15', 8960, 170.24),
  txn('BFV3Z7oIO7FiV_P1788406925', '2026-09-03', 9373.53, 263.46),
  txn('Bn3xbM6gViWb4_P1788787802', '2026-09-07', 3320, 49.8),  // another branch's booking
]);
const OCT = stmt('2026-10', [
  txn('BDpznzj5p22ur_B1791362222', '2026-10-07', 500, 9.5),
  txn('BFV3Z7oIO7FiV_B1791638328388', '2026-10-10', 7093.84, 199.63),
  txn('BKAlnfTkYJdHm_P1791872387656', '2026-10-13', 9395, 140.93),
  txn('BKAlnfTkYJdHm_B1793184525420', '2026-10-28', 10985, 164.78),
  txn('BKAlnfTkYJdHm_B1793184827896', '2026-10-28', 315, 4.73),
]);

const oct9: ReconcileBooking = { id: 'Dpznzj5p22urAAAAAAAA', payments: [kpay('2026-09-15T17:23', 8960), kpay('2026-10-07T16:37', 500)] };
// Card payments: the customer paid a surcharge on top, so KPay charged
// more than was credited to the booking.
const oct10: ReconcileBooking = { id: 'FV3Z7oIO7FiVAAAAAAAA', payments: [kpay('2026-09-03T11:42', 9235, 138.53), kpay('2026-10-10T21:19', 6989, 104.84)] };
const oct18: ReconcileBooking = { id: 'kpiNUudbFGVCAAAAAAAA', payments: [kpay('2026-08-24T17:52', 8800)] };
const oct30: ReconcileBooking = { id: 'KAlnfTkYJdHmAAAAAAAA', payments: [kpay('2026-10-13T14:20', 9395), kpay('2026-10-28T18:50', 10985), kpay('2026-10-28T18:54', 315)] };
const oct31Fps: ReconcileBooking = { id: 'fpsOnlyBookingAAAAAA', payments: [fps('2026-10-09T10:00', 5350), fps('2026-10-31T10:00', 5350)] };
const cwbOct = [oct9, oct10, oct18, oct30, oct31Fps];

describe('reconcileKpayFees — fee follows the booking, not the statement month', () => {
  const rec = reconcileKpayFees(cwbOct, [AUG, SEP, OCT], 1.5);

  it('a booking paid in full two months earlier takes its fee from that statement', () => {
    const f = kpayFeeOf(rec, oct18.id);
    expect(f.fee).toBe(132);
    expect(f.estimatedFee).toBe(0);
    expect(f.lines).toEqual([expect.objectContaining({ date: '2026-08-24', amount: 8800, fee: 132, actual: true, statementMonth: '2026-08' })]);
  });

  it('a booking paid across two months adds the fee of each payment', () => {
    expect(kpayFeeOf(rec, oct9.id).fee).toBe(179.74);   // 170.24 (SEP) + 9.50 (OCT)
    expect(kpayFeeOf(rec, oct10.id).fee).toBe(463.09);  // 263.46 (SEP) + 199.63 (OCT)
    expect(kpayFeeOf(rec, oct9.id).lines.map((l) => l.statementMonth)).toEqual(['2026-09', '2026-10']);
  });

  it('three payments in the same month all land on the booking', () => {
    expect(kpayFeeOf(rec, oct30.id).fee).toBe(310.44);
  });

  it('matches her OCT-2026 CWB sheet total, with nothing estimated', () => {
    const total = sumKpayFees(cwbOct.map((b) => kpayFeeOf(rec, b.id)));
    expect(total.fee).toBe(1085.27); // 179.74 + 463.09 + 132.00 + 310.44
    expect(total.estimatedFee).toBe(0);
    expect(total.estimatedLines).toBe(0);
    expect(total.actualLines).toBe(8);
  });

  it('FPS-only bookings carry no KPay fee', () => {
    expect(kpayFeeOf(rec, oct31Fps.id)).toEqual({ fee: 0, actualFee: 0, estimatedFee: 0, lines: [] });
  });

  it('rows of other bookings are not pulled in, and are reported unmatched', () => {
    const unmatched = rec.matches.filter((m) => !m.bookingId).map((m) => m.txn.orderRef);
    expect(unmatched).toEqual(['B4zZFwp9XWH0z_P1786585700', 'Bn3xbM6gViWb4_P1788787802']);
  });
});

describe('reconcileKpayFees — statements not uploaded yet', () => {
  it('with no statements every booking equals the old estimate', () => {
    const rec = reconcileKpayFees(cwbOct, [], 1.5);
    for (const b of cwbOct) {
      const f = kpayFeeOf(rec, b.id);
      expect(f.fee).toBe(estimatedKpayFee(b, 1.5));
      expect(f.actualFee).toBe(0);
    }
  });

  it('estimates only the payment whose statement is missing, and says which', () => {
    const rec = reconcileKpayFees(cwbOct, [OCT], 1.5); // SEP + AUG not uploaded
    const f = kpayFeeOf(rec, oct9.id);
    expect(f.actualFee).toBe(9.5);
    expect(f.estimatedFee).toBe(134.4); // 1.5% × 8,960
    expect(f.lines[0]).toEqual(expect.objectContaining({ actual: false, reason: 'statement-missing', statementMonth: '2026-09' }));
    expect(f.lines[1]).toEqual(expect.objectContaining({ actual: true, statementMonth: '2026-10' }));
  });

  it('estimates on the credited amount, not on the customer surcharge', () => {
    const rec = reconcileKpayFees([oct10], [OCT], 1.5);
    const sepLine = kpayFeeOf(rec, oct10.id).lines[0];
    expect(sepLine.amount).toBe(9373.53);   // what KPay charged
    expect(sepLine.fee).toBe(138.53);       // 1.5% × 9,235 credited
  });

  it('flags a KPay payment that an uploaded statement does not contain', () => {
    // Recorded by hand as KPay (e.g. taken on another KPay account).
    const b: ReconcileBooking = { id: 'manualKpayBookingAAA', payments: [kpay('2026-10-20T12:00', 2000)] };
    const f = kpayFeeOf(reconcileKpayFees([b], [OCT], 1.5), b.id);
    expect(f).toEqual(expect.objectContaining({ actualFee: 0, estimatedFee: 30 }));
    expect(f.lines[0].reason).toBe('not-in-statement');
  });
});

describe('reconcileKpayFees — matching edge cases', () => {
  it('falls back to same date + same amount when the order number is not ours', () => {
    const b: ReconcileBooking = { id: 'linkPaidBookingAAAAA', payments: [kpay('2026-10-05T09:25', 6500)] };
    const s = stmt('2026-10', [txn('2026100509245800001', '2026-10-05', 6500, 123.5)]);
    const rec = reconcileKpayFees([b], [s], 1.5);
    expect(kpayFeeOf(rec, b.id)).toEqual(expect.objectContaining({ fee: 123.5, estimatedFee: 0 }));
    expect(rec.matches[0]).toEqual(expect.objectContaining({ bookingId: b.id, via: 'date-amount' }));
  });

  it('never guesses when two payments fit the same date and amount', () => {
    const a: ReconcileBooking = { id: 'twinBookingAAAAAAAAA', payments: [kpay('2026-10-05T09:00', 8800)] };
    const b: ReconcileBooking = { id: 'twinBookingBBBBBBBBB', payments: [kpay('2026-10-05T15:00', 8800)] };
    const s = stmt('2026-10', [txn('2026100509245800001', '2026-10-05', 8800, 132)]);
    const rec = reconcileKpayFees([a, b], [s], 1.5);
    expect(rec.matches[0].bookingId).toBeNull();
    expect(kpayFeeOf(rec, a.id).actualFee).toBe(0);
    expect(kpayFeeOf(rec, b.id).actualFee).toBe(0);
  });

  it('does not use a date+amount fallback row for an FPS payment', () => {
    const b: ReconcileBooking = { id: 'fpsSameAmountAAAAAAA', payments: [fps('2026-10-05T09:25', 6500)] };
    const s = stmt('2026-10', [txn('2026100509245800001', '2026-10-05', 6500, 123.5)]);
    expect(kpayFeeOf(reconcileKpayFees([b], [s], 1.5), b.id).fee).toBe(0);
  });

  it('counts a statement row once even when its payment entry was edited', () => {
    // Order number names the booking; the logged amount no longer equals
    // the charge. The fee must not be counted actual AND estimated.
    const b: ReconcileBooking = { id: 'editedPaymentAAAAAAA', payments: [kpay('2026-10-07T12:00', 1300)] };
    const s = stmt('2026-10', [txn('BeditedPaymen_P1791345762', '2026-10-07', 1380, 26.22)]);
    expect(kpayFeeOf(reconcileKpayFees([b], [s], 1.5), b.id)).toEqual(
      expect.objectContaining({ fee: 26.22, actualFee: 26.22, estimatedFee: 0 }),
    );
  });

  it('keeps a missing-statement payment estimated beside an unrelated row', () => {
    // SEP deposit (statement not uploaded) + an OCT row for the booking
    // whose own payment entry is absent: two different payments.
    const b: ReconcileBooking = { id: 'Dpznzj5p22urAAAAAAAA', payments: [kpay('2026-09-15T17:23', 8960)] };
    const f = kpayFeeOf(reconcileKpayFees([b], [OCT], 1.5), b.id);
    expect(f.actualFee).toBe(9.5);
    expect(f.estimatedFee).toBe(134.4);
  });

  it('ignores a row uploaded twice in overlapping statements', () => {
    const row = txn('BkpiNUudbFGVC_P1787565139', '2026-08-24', 8800, 132, '2026082400000001');
    const rec = reconcileKpayFees([oct18], [stmt('2026-08', [row]), stmt('2026-09', [row])], 1.5);
    expect(kpayFeeOf(rec, oct18.id).fee).toBe(132);
  });

  it('pairs by KPay交易號 when the payment carries one', () => {
    const b: ReconcileBooking = {
      id: 'kpiNUudbFGVCAAAAAAAA',
      payments: [{ ...kpay('2026-08-24T17:52', 8800), kpayTransactionNo: 'T2' }, { ...kpay('2026-08-24T18:10', 8800), kpayTransactionNo: 'T1' }],
    };
    const s = stmt('2026-08', [txn('BkpiNUudbFGVC_P1787565139', '2026-08-24', 8800, 132, 'T1')]);
    const f = kpayFeeOf(reconcileKpayFees([b], [s], 1.5), b.id);
    expect(f.actualFee).toBe(132);
    expect(f.estimatedFee).toBe(132); // the other 8,800 stays an estimate
    expect(f.lines.filter((l) => !l.actual)[0].reason).toBe('not-in-statement');
  });

  it('keeps the estimate for a KPay refund entry', () => {
    const b: ReconcileBooking = {
      id: 'kpiNUudbFGVCAAAAAAAA',
      payments: [kpay('2026-08-24T17:52', 8800), kpay('2026-09-02T10:00', -1000)],
    };
    const f = kpayFeeOf(reconcileKpayFees([b], [AUG], 1.5), b.id);
    expect(f.actualFee).toBe(132);
    expect(f.estimatedFee).toBe(-15);
    expect(f.lines[1].reason).toBe('refund');
  });
});

describe('hkDateOf', () => {
  it('uses the HK calendar day, not the UTC one', () => {
    expect(hkDateOf('2026-07-25T17:11:00.000Z')).toBe('2026-07-26'); // 01:11 HKT
    expect(hkDateOf('2026-10-31T11:07:00.000Z')).toBe('2026-10-31');
  });
  it('reads Firestore timestamps and Dates, and tolerates junk', () => {
    expect(hkDateOf({ seconds: Date.parse('2026-08-24T09:52:00Z') / 1000 })).toBe('2026-08-24');
    expect(hkDateOf({ toMillis: () => Date.parse('2026-08-24T20:00:00Z') })).toBe('2026-08-25');
    expect(hkDateOf(new Date('2026-08-24T09:52:00Z'))).toBe('2026-08-24');
    expect(hkDateOf(null)).toBe('');
    expect(hkDateOf('not a date')).toBe('');
  });
});
