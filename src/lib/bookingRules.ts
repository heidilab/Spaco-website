// 預訂規則 — ONE settings document for the money rules that used to be
// written in four places (site review 2026-11-13, phase 4d): the deposit
// tiers, the fixed deposit deductions, the loyalty-point rates and the
// instalment rule. Code, 預訂須知 and 條款 all read from here, so they
// can no longer disagree (the guidelines said $8,000 above $20,000; the
// code never charged more than $4,000).
//
// PURE module — no firebase. Stored in `site_content/booking_rules`
// (public read, admin write) and activated by bookingRulesClient (browser)
// / bookingRulesServer (API routes) with setBookingRules(). Empty or
// unreadable settings = the rules as coded below, exactly as before.

export interface DepositTier {
  /** Applies while the bill (rent + add-ons) is at most this; null = no cap (the last tier). */
  upTo: number | null;
  deposit: number;
}

export interface DeductionItem {
  id: string;
  zh: string;
  en: string;
  amount: number;
}

export interface BookingRules {
  depositTiers: DepositTier[];
  deductionItems: DeductionItem[];
  /** Points redeemed per HK$1 (100 points = HK$1). */
  pointsPerHkd: number;
  /** Points earned per HK$1 of net spend (1 = 1 point per dollar). */
  pointsEarnPerHkd: number;
  /** Above this grand total the customer may pay a deposit first. */
  installmentThreshold: number;
  /** The upfront share, in percent. */
  installmentPct: number;
  /** The balance is due this many days before the event; inside that
   *  window the whole amount is paid upfront. */
  balanceDueDaysBefore: number;
}

export const DEFAULT_BOOKING_RULES: BookingRules = {
  depositTiers: [
    { upTo: 4000, deposit: 1000 },
    { upTo: 10000, deposit: 2000 },
    { upTo: null, deposit: 4000 },
  ],
  deductionItems: [
    { id: 'oven', zh: '沒有關閉焗爐', en: 'Oven not turned off', amount: 2000 },
    { id: 'ac', zh: '沒有關閉冷氣', en: 'AC not turned off', amount: 800 },
    { id: 'lights', zh: '沒有關閉電燈', en: 'Lights not turned off', amount: 500 },
    { id: 'cookware', zh: '沒有清洗爐具', en: 'Cookware not cleaned', amount: 500 },
    { id: 'mess', zh: '嘔吐物/場地髒亂', en: 'Vomit/venue mess', amount: 800 },
    { id: 'ballpit', zh: '波波池飲食違規', en: 'Ball pit food violation', amount: 1500 },
  ],
  pointsPerHkd: 100,
  pointsEarnPerHkd: 1,
  installmentThreshold: 10000,
  installmentPct: 50,
  balanceDueDaysBefore: 2,
};

const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const text = (v: unknown, max = 120): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Well-formed rules from raw data; every missing or bad part falls back
 *  to the coded default, so a half-written doc can never break pricing. */
export function sanitizeBookingRules(raw: unknown): BookingRules {
  const d = DEFAULT_BOOKING_RULES;
  if (!raw || typeof raw !== 'object') return { ...d, depositTiers: [...d.depositTiers], deductionItems: [...d.deductionItems] };
  const r = raw as Record<string, unknown>;

  let depositTiers: DepositTier[] = [];
  if (Array.isArray(r.depositTiers)) {
    const tiers: DepositTier[] = [];
    for (const t of r.depositTiers as Array<Record<string, unknown>>) {
      if (!t || typeof t !== 'object' || tiers.length >= 10) continue;
      const deposit = num(t.deposit);
      const upTo = t.upTo === null || t.upTo === undefined || t.upTo === '' ? null : num(t.upTo);
      if (deposit === null || deposit < 0 || (upTo !== null && upTo <= 0)) continue;
      tiers.push({ upTo, deposit: Math.round(deposit) });
    }
    // Capped tiers ascending, then the open-ended one; exactly one open tier.
    const capped = tiers.filter((t) => t.upTo !== null).sort((a, b) => (a.upTo as number) - (b.upTo as number));
    const open = tiers.filter((t) => t.upTo === null);
    if (capped.length + open.length > 0) depositTiers = [...capped, open.length > 0 ? open[open.length - 1] : { upTo: null, deposit: (capped[capped.length - 1] || d.depositTiers[d.depositTiers.length - 1]).deposit }];
  }
  if (depositTiers.length === 0) depositTiers = [...d.depositTiers];

  let deductionItems: DeductionItem[] = [];
  if (Array.isArray(r.deductionItems)) {
    const seen = new Set<string>();
    for (const it of r.deductionItems as Array<Record<string, unknown>>) {
      if (!it || typeof it !== 'object' || deductionItems.length >= 40) continue;
      const id = text(it.id, 40).toLowerCase();
      const zh = text(it.zh); const en = text(it.en);
      const amount = num(it.amount);
      if (!ID.test(id) || seen.has(id) || (!zh && !en) || amount === null || amount < 0) continue;
      seen.add(id);
      deductionItems.push({ id, zh: zh || en, en: en || zh, amount: Math.round(amount) });
    }
  }
  // An explicitly empty list is allowed (no fixed items); absent = defaults.
  if (!Array.isArray(r.deductionItems)) deductionItems = [...d.deductionItems];

  const pointsPerHkd = num(r.pointsPerHkd);
  const pointsEarnPerHkd = num(r.pointsEarnPerHkd);
  const installmentThreshold = num(r.installmentThreshold);
  const installmentPct = num(r.installmentPct);
  const balanceDueDaysBefore = num(r.balanceDueDaysBefore);
  return {
    depositTiers,
    deductionItems,
    pointsPerHkd: pointsPerHkd !== null && pointsPerHkd >= 1 && pointsPerHkd <= 100000 ? Math.round(pointsPerHkd) : d.pointsPerHkd,
    pointsEarnPerHkd: pointsEarnPerHkd !== null && pointsEarnPerHkd >= 0 && pointsEarnPerHkd <= 1000 ? Math.round(pointsEarnPerHkd * 100) / 100 : d.pointsEarnPerHkd,
    installmentThreshold: installmentThreshold !== null && installmentThreshold >= 0 ? Math.round(installmentThreshold) : d.installmentThreshold,
    installmentPct: installmentPct !== null && installmentPct >= 1 && installmentPct <= 100 ? Math.round(installmentPct) : d.installmentPct,
    balanceDueDaysBefore: balanceDueDaysBefore !== null && balanceDueDaysBefore >= 0 && balanceDueDaysBefore <= 60 ? Math.round(balanceDueDaysBefore) : d.balanceDueDaysBefore,
  };
}

// ── active rules (module state, set by the loaders) ──

let active: BookingRules = DEFAULT_BOOKING_RULES;
let version = 0;

export function setBookingRules(rules: BookingRules | null): void {
  active = rules ?? DEFAULT_BOOKING_RULES;
  version++;
}
export function getBookingRules(): BookingRules { return active; }
/** Bumps on every setBookingRules — for React memos. */
export function bookingRulesVersion(): number { return version; }

// ── the rules applied ──

/** The refundable security deposit for a bill (rent + add-ons). */
export function securityDepositFor(subtotal: number, rules: BookingRules = active): number {
  for (const t of rules.depositTiers) {
    if (t.upTo === null || subtotal <= t.upTo) return t.deposit;
  }
  return rules.depositTiers[rules.depositTiers.length - 1]?.deposit ?? 0;
}

/** Loyalty points earned on HK$ of net spend. */
export function pointsEarnedFor(netSpendHkd: number, rules: BookingRules = active): number {
  return Math.max(0, Math.floor(Math.max(0, netSpendHkd) * rules.pointsEarnPerHkd));
}

const hk = (n: number) => `HK$${n.toLocaleString()}`;

/** The deposit tiers as sentences, for 預訂須知 / 條款 / FAQ. */
export function depositTierLines(locale: 'zh' | 'en', rules: BookingRules = active): string[] {
  return rules.depositTiers.map((t, i) => {
    const prev = i > 0 ? rules.depositTiers[i - 1].upTo : null;
    if (t.upTo === null) {
      return prev === null
        ? (locale === 'zh' ? `按金 ${hk(t.deposit)}` : `Deposit ${hk(t.deposit)}`)
        : (locale === 'zh' ? `消費 ${hk(prev)} 以上：按金 ${hk(t.deposit)}` : `Over ${hk(prev)}: ${hk(t.deposit)} deposit`);
    }
    return prev === null
      ? (locale === 'zh' ? `消費 ${hk(t.upTo)} 或以下：按金 ${hk(t.deposit)}` : `Up to ${hk(t.upTo)}: ${hk(t.deposit)} deposit`)
      : (locale === 'zh' ? `消費 ${hk(prev)} 以上至 ${hk(t.upTo)}：按金 ${hk(t.deposit)}` : `${hk(prev)}–${hk(t.upTo)}: ${hk(t.deposit)} deposit`);
  });
}

/** One sentence for the tiers, e.g. the 條款 paragraph. */
export function depositTierSentence(locale: 'zh' | 'en', rules: BookingRules = active): string {
  const lines = depositTierLines(locale, rules);
  return locale === 'zh'
    ? `所有預訂均收取可退還按金，金額按場地消費總額（場租加附加服務）分級：${lines.join('、')}。`
    : `A refundable security deposit is charged on every booking, tiered by the bill (rent plus add-ons): ${lines.join('; ')}.`;
}

/** The fixed deductions as lines, e.g. 「沒有關閉焗爐：HK$2,000」. */
export function deductionLines(locale: 'zh' | 'en', rules: BookingRules = active, sign = ''): string[] {
  return rules.deductionItems.map((d) => `${locale === 'zh' ? d.zh : d.en}：${sign}${hk(d.amount)}`);
}

/** The instalment rule as a sentence. */
export function installmentSentence(locale: 'zh' | 'en', rules: BookingRules = active): string {
  if (!(rules.installmentThreshold > 0) || rules.installmentPct >= 100) {
    return locale === 'zh' ? '所有預訂須於確認時付清全數。' : 'Every booking is paid in full to confirm.';
  }
  return locale === 'zh'
    ? `訂單總額（連按金）超過 ${hk(rules.installmentThreshold)} 可選擇先付 ${rules.installmentPct}% 確認預訂，餘額於活動前 ${rules.balanceDueDaysBefore} 天付清。`
    : `Orders over ${hk(rules.installmentThreshold)} (deposit included) may pay ${rules.installmentPct}% to confirm, with the balance due ${rules.balanceDueDaysBefore} days before the event.`;
}

/** The points rule as a sentence. */
export function pointsSentence(locale: 'zh' | 'en', rules: BookingRules = active): string {
  const earn = rules.pointsEarnPerHkd;
  return locale === 'zh'
    ? `每消費 HK$1 可賺取 ${earn} 積分；${rules.pointsPerHkd.toLocaleString()} 積分可當 HK$1 使用。`
    : `Every HK$1 spent earns ${earn} point${earn === 1 ? '' : 's'}; ${rules.pointsPerHkd.toLocaleString()} points are worth HK$1.`;
}

/**
 * Replace the rule tokens in a text with the current rules:
 *   {{DEPOSIT_TIERS}}  one tier per line (bulleted)
 *   {{DEDUCTIONS}}     one fixed deduction per line (bulleted, negative)
 *   {{INSTALLMENT}}    the instalment sentence
 *   {{POINTS}}         the points sentence
 * Texts staff write in 內容管理 may use the same tokens.
 */
export function fillRuleTokens(textIn: string, locale: 'zh' | 'en', rules: BookingRules = active): string {
  return textIn
    .replace(/\{\{DEPOSIT_TIERS\}\}/g, depositTierLines(locale, rules).map((l) => `• ${l}`).join('\n'))
    .replace(/\{\{DEDUCTIONS\}\}/g, deductionLines(locale, rules, '-').map((l) => `• ${l}`).join('\n'))
    .replace(/\{\{INSTALLMENT\}\}/g, installmentSentence(locale, rules))
    .replace(/\{\{POINTS\}\}/g, pointsSentence(locale, rules));
}
