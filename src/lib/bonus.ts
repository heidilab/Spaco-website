// CS monthly sales-bonus config accessors (獎金) — client side.
// Config doc: system/bonus_config (staff read / admin write per rules).
// Bonus math itself lives in the pure bonusMath module; monthly alert
// state is server-only (bonus_alerts, written by the cron via Admin SDK).

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import type { BonusConfig } from '@/types';

export const EMPTY_BONUS_CONFIG: BonusConfig = {
  branches: {},
};

export async function getBonusConfig(): Promise<BonusConfig> {
  try {
    const snap = await getDoc(doc(db, 'system', 'bonus_config'));
    if (!snap.exists()) return EMPTY_BONUS_CONFIG;
    const d = snap.data() as Partial<BonusConfig>;
    return { branches: d.branches || {} };
  } catch {
    return EMPTY_BONUS_CONFIG;
  }
}

export async function saveBonusConfig(cfg: BonusConfig): Promise<void> {
  await setDoc(doc(db, 'system', 'bonus_config'), {
    ...cfg,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}
