// Server-side peak-day reader (Admin SDK) — for API routes that must
// recompute pricing authoritatively (/api/bookings/create, modify,
// admin booking paths). Same doc shape as lib/peakDays.ts.

import { adminDb } from './firebaseAdmin';
import type { PeakDayConfig } from '@/types';

export async function getPeakDayAdmin(date: string): Promise<PeakDayConfig | null> {
  try {
    const snap = await adminDb.collection('peak_days').doc(date).get();
    return snap.exists ? ({ ...(snap.data() as PeakDayConfig), date }) : null;
  } catch {
    return null;
  }
}
