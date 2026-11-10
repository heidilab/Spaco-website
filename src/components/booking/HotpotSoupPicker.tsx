'use client';

import { HOTPOT_SOUP_BASES } from '@/lib/hotpot';

/**
 * 火鍋湯底 picker — one row of the three soup bases per pot. Each row is
 * an independent single choice, so two pots can take the SAME soup
 * (15+ guests get two pots; smaller groups get one, or two with the paid
 * extra soup base). `value[i]` is the pick for pot i ('' = not picked).
 *
 * Shared by the customer booking form, the customer modify page and the
 * admin editors so the options and wording never drift apart.
 */
export default function HotpotSoupPicker({
  slots,
  value,
  onChange,
  locale,
  size = 'md',
  disabled = false,
}: {
  /** Number of pots to pick for (see hotpotSoupSlots). */
  slots: number;
  value: readonly string[];
  onChange: (next: string[]) => void;
  locale: 'zh' | 'en';
  size?: 'md' | 'sm';
  disabled?: boolean;
}) {
  if (slots <= 0) return null;
  const pill = size === 'sm' ? 'px-3 py-1 text-xs' : 'px-4 py-2 text-sm';
  return (
    <div className="space-y-2">
      {Array.from({ length: slots }, (_, slot) => {
        const picked = value[slot] || '';
        const rowLabel = slots > 1
          ? (locale === 'zh' ? `湯底 ${slot + 1}` : `Soup base ${slot + 1}`)
          : (locale === 'zh' ? '湯底' : 'Soup base');
        return (
          <div key={slot} role="radiogroup" aria-label={rowLabel} className="flex flex-wrap items-center gap-2">
            {slots > 1 && (
              <span className={`shrink-0 font-semibold text-ink-soft ${size === 'sm' ? 'text-[11px] w-12' : 'text-xs w-14'}`}>
                {rowLabel}
              </span>
            )}
            {HOTPOT_SOUP_BASES.map((soup) => {
              const active = picked === soup.id;
              return (
                <button
                  key={soup.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={disabled}
                  onClick={() => {
                    const next = Array.from({ length: slots }, (_, i) => value[i] || '');
                    next[slot] = soup.id;
                    onChange(next);
                  }}
                  className={`${pill} rounded-full font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    active ? 'bg-charcoal text-cream' : 'bg-cream text-charcoal/70 hover:bg-charcoal/10'
                  }`}
                >
                  {soup.name[locale]}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
