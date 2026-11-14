import { netConsumption } from '@/lib/bookingMoney';
import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/adminAuth';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { sendEmail, buildBonusProgressEmail, buildBonusAchievedEmail } from '@/lib/email';
import { getStaffNotificationRecipients } from '@/lib/emailAutomations';
import { countsForFinance } from '@/lib/finance';
import { loadAllVenuesServer } from '@/lib/venueRegistryServer';
import { salesBranchKey, salesBranches } from '@/lib/bonusBranches';
import { evaluateBonus, sortedTiers } from '@/lib/bonusMath';
import type { BookingRecord, BonusConfig } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * CS sales-bonus watcher (獎金) — runs daily. For each branch with
 * configured tiers (system/bonus_config):
 *   • month-to-date sales = Σ pricing.subtotal over countsForFinance
 *     bookings in the current HKT calendar month (same basis as 月結,
 *     so the numbers CS chase are the numbers finance settles on)
 *   • ≥80% toward the next unachieved tier → one nudge email per tier
 *   • tier target reached → one congratulation email per tier
 * Dedupe state lives in bonus_alerts/{branch}_{month} (server-only), so
 * the sweep is idempotent and the month resets itself on the 1st.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const cfgSnap = await adminDb.collection('system').doc('bonus_config').get();
  if (!cfgSnap.exists) return NextResponse.json({ ok: true, skipped: 'no config' });
  const cfg = cfgSnap.data() as BonusConfig;
  const branchEntries = Object.entries(cfg.branches || {})
    .filter(([, b]) => (b.tiers || []).some((t) => t.target > 0));
  if (branchEntries.length === 0) return NextResponse.json({ ok: true, skipped: 'no tiers' });

  // Current month in HKT — sales reset on the 1st.
  const hkt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const month = `${hkt.getUTCFullYear()}-${String(hkt.getUTCMonth() + 1).padStart(2, '0')}`;

  const snap = await adminDb.collection('bookings')
    .where('date', '>=', `${month}-01`)
    .where('date', '<=', `${month}-31`)
    .get();
  // Branch roll-up + names come from the venue registry (lib/bonusBranches),
  // the same source as the CS 獎金 page — a branch added in 分店管理 (e.g.
  // 尖沙咀 HART, three rooms → one branch) is covered without a code change.
  const venues = await loadAllVenuesServer();
  const salesByBranch: Record<string, number> = {};
  for (const d of snap.docs) {
    const b = { id: d.id, ...d.data() } as BookingRecord;
    if (!countsForFinance(b)) continue;   // prod basis: test bookings excluded
    const key = salesBranchKey(b.venueId, venues);
    // Net of promo / points / staff discount — the figure 月結 reports (review #25).
    salesByBranch[key] = (salesByBranch[key] || 0) + netConsumption(b);
  }

  const BRANCH_NAMES: Record<string, string> = Object.fromEntries(
    salesBranches(venues, branchEntries.map(([bk]) => bk)).map((b) => [b.key, b.name.zh]),
  );
  // Recipients come from the live staff roster (admin + cs accounts in
  // 員工管理) — nothing to configure on the bonus page (Heidi 2026-09-07).
  const recipients = await getStaffNotificationRecipients();
  if (recipients.length === 0) return NextResponse.json({ ok: true, skipped: 'no recipients' });
  const sent: string[] = [];

  for (const [bk, branchCfg] of branchEntries) {
    const tiers = sortedTiers(branchCfg.tiers).filter((t) => t.target > 0);
    const sales = salesByBranch[bk] || 0;
    const evalr = evaluateBonus(sales, tiers);
    const branchName = BRANCH_NAMES[bk] || bk;

    const alertRef = adminDb.collection('bonus_alerts').doc(`${bk}_${month}`);
    const alertSnap = await alertRef.get();
    const state = (alertSnap.data() || {}) as { sent80?: number[]; sentAchieved?: number[] };
    const sent80 = new Set(state.sent80 || []);
    const sentAchieved = new Set(state.sentAchieved || []);
    let dirty = false;

    // Tier-achieved congratulations (one per tier, ever).
    for (const i of evalr.achievedTierIndexes) {
      if (sentAchieved.has(i)) continue;
      const email = buildBonusAchievedEmail({
        branchName,
        month,
        sales,
        target: tiers[i].target,
        bonus: tiers[i].bonus,
        totalBonus: evalr.totalBonus,
        nextTarget: evalr.nextTierIndex !== null ? tiers[evalr.nextTierIndex].target : undefined,
      });
      try {
        await sendEmail({ to: recipients, subject: email.subject, html: email.html });
        sentAchieved.add(i); dirty = true;
        sent.push(`${bk}:achieved:${i}`);
      } catch (e) {
        console.error('[bonus-check] achieved email failed', bk, i, e);
      }
    }

    // 80% nudge toward the next unachieved tier (one per tier, ever).
    if (
      evalr.nextTierIndex !== null
      && (evalr.nextTierProgressPct ?? 0) >= 80
      && !sent80.has(evalr.nextTierIndex)
    ) {
      const t = tiers[evalr.nextTierIndex];
      const email = buildBonusProgressEmail({
        branchName,
        month,
        sales,
        target: t.target,
        bonus: t.bonus,
        progressPct: evalr.nextTierProgressPct ?? 0,
      });
      try {
        await sendEmail({ to: recipients, subject: email.subject, html: email.html });
        sent80.add(evalr.nextTierIndex); dirty = true;
        sent.push(`${bk}:progress:${evalr.nextTierIndex}`);
      } catch (e) {
        console.error('[bonus-check] progress email failed', bk, e);
      }
    }

    if (dirty) {
      await alertRef.set({
        branchKey: bk,
        month,
        sent80: Array.from(sent80),
        sentAchieved: Array.from(sentAchieved),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }

  return NextResponse.json({ ok: true, month, sales: salesByBranch, sent });
}
