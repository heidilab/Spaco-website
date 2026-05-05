import React from 'react';

interface SplitHeadingProps {
  /** The full heading text. */
  text: string;
  /** Tailwind class for the leading portion (defaults to text-ink). */
  baseClassName?: string;
  /** Tailwind gradient class for the highlighted portion. */
  accentClassName?: string;
  /** Strategy for splitting:
   *  - 'lastWord': split off the final whitespace-separated word (English titles)
   *  - 'all': apply the accent class to the whole string (best for short CJK)
   */
  strategy?: 'lastWord' | 'all';
  className?: string;
}

/**
 * Renders a heading with the last word (or whole string) styled in a
 * gradient accent. Hydration-safe: avoids stray whitespace text nodes
 * and empty spans that produce SSR / client mismatches.
 */
export default function SplitHeading({
  text,
  baseClassName = 'text-ink',
  accentClassName = 'text-gradient-pink',
  strategy = 'lastWord',
  className = '',
}: SplitHeadingProps) {
  const trimmed = (text ?? '').trim();

  // CJK / single-word titles — accent the whole string
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (strategy === 'all' || parts.length <= 1) {
    return (
      <span className={className}>
        <span className={accentClassName}>{trimmed}</span>
      </span>
    );
  }

  // Multi-word: accent the last word, keep the rest in base color.
  const last = parts[parts.length - 1];
  const lead = parts.slice(0, -1).join(' ');
  return (
    <span className={className}>
      <span className={baseClassName}>{lead}</span>
      <span>{'\u00A0'}</span>
      <span className={accentClassName}>{last}</span>
    </span>
  );
}
