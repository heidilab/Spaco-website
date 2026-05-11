'use client';

// Per-branch amenities rendered as a grid of icon cards. Each amenity
// is matched against a registry (by structured id or free-form CMS
// string) to pick an icon + gradient. Switch + Board-game amenities
// get an expandable disclosure that reveals the full game list.

import { useState } from 'react';
import {
  Flame, ChefHat, Beer, Gamepad2, Dice5, Mic2, Sparkles,
  CookingPot, Spade, Volume2, Users as UsersIcon,
  Tv, ChevronDown, ChevronUp, type LucideIcon,
} from 'lucide-react';

export interface AmenityEntry {
  /** Original label as it came in (id like 'mahjong' or free-form text). */
  raw: string;
  /** Bilingual display label. */
  label: { zh: string; en: string };
  /** Lucide icon class. */
  icon: LucideIcon;
  /** Tailwind gradient classes for the icon badge. */
  gradient: string;
  /** Optional special-amenity key when this is Switch or board games. */
  kind?: 'switch' | 'board';
}

/** Catalog: maps an amenity string (id or label, case-insensitive) to
 *  display + icon. Matching is best-effort — unknown amenities fall
 *  through to a generic Sparkles icon so the grid stays uniform. */
const REGISTRY: Array<{
  match: RegExp;
  label: { zh: string; en: string };
  icon: LucideIcon;
  gradient: string;
  kind?: 'switch' | 'board';
}> = [
  // 燒烤 / BBQ
  { match: /\b(bbq|barbe?cue|燒烤)\b|戶外\s*BBQ/i,
    label: { zh: '戶外 BBQ', en: 'Outdoor BBQ' },
    icon: Flame,
    gradient: 'from-orange-500 to-rose-500' },
  // 火鍋 / Hotpot
  { match: /\b(hotpot|hot\s*pot|打邊爐|火鍋)\b/i,
    label: { zh: '火鍋', en: 'Hotpot' },
    icon: ChefHat,
    gradient: 'from-rose-500 to-red-500' },
  // 麻將 / Mahjong
  { match: /\bmahjong\b|麻將/i,
    label: { zh: '麻將', en: 'Mahjong' },
    icon: Dice5,
    gradient: 'from-emerald-500 to-teal-500' },
  // Poker / Poker 枱
  { match: /\bpoker\b|poker\s*枱|啤牌/i,
    label: { zh: 'Poker 枱', en: 'Poker Table' },
    icon: Spade,
    gradient: 'from-slate-700 to-slate-900' },
  // Switch
  { match: /^switch$|nintendo|switch\s*遊戲/i,
    label: { zh: 'Switch', en: 'Switch' },
    icon: Gamepad2,
    gradient: 'from-rose-500 to-orange-500',
    kind: 'switch' },
  // 桌遊 / Board Games
  { match: /board\s*game|boardgame|桌遊/i,
    label: { zh: '桌遊', en: 'Board Games' },
    icon: Dice5,
    gradient: 'from-violet-500 to-pink-500',
    kind: 'board' },
  // 桌球 / Pool Table
  { match: /pool\s*table|billiard|桌球/i,
    label: { zh: '桌球', en: 'Pool Table' },
    icon: Sparkles,
    gradient: 'from-emerald-600 to-emerald-800' },
  // 獨立廚房 / Private Kitchen
  { match: /private\s*kitchen|獨立廚房/i,
    label: { zh: '獨立廚房', en: 'Private Kitchen' },
    icon: CookingPot,
    gradient: 'from-amber-500 to-orange-500' },
  // 音響 / Sound system / 無線咪 / Mic
  { match: /音響|sound|無線咪|mic|microphone/i,
    label: { zh: '音響＋無線咪', en: 'Sound System + Mic' },
    icon: Mic2,
    gradient: 'from-sky-500 to-indigo-500' },
  // 投影 / Projector / AV
  { match: /projector|投影|av\s*equipment/i,
    label: { zh: '投影設備', en: 'Projector / AV' },
    icon: Tv,
    gradient: 'from-blue-500 to-indigo-600' },
  // 飲品 / Drinks
  { match: /drinks?|飲品|無酒精/i,
    label: { zh: '飲品', en: 'Drinks' },
    icon: Beer,
    gradient: 'from-amber-500 to-yellow-500' },
  // 卡拉OK
  { match: /karaoke|卡拉/i,
    label: { zh: '卡拉 OK', en: 'Karaoke' },
    icon: Volume2,
    gradient: 'from-pink-500 to-fuchsia-500' },
];

/** Resolve a single amenity string to a card entry. Returns undefined
 *  when the string doesn't match anything in the registry — caller
 *  renders a generic fallback in that case. */
function resolveAmenity(raw: string, locale: 'zh' | 'en'): AmenityEntry {
  const trimmed = raw.trim();
  for (const r of REGISTRY) {
    if (r.match.test(trimmed)) {
      return { raw: trimmed, label: r.label, icon: r.icon, gradient: r.gradient, kind: r.kind };
    }
  }
  // Fallback — render the raw text with a generic icon.
  return {
    raw: trimmed,
    label: { zh: trimmed, en: trimmed },
    icon: UsersIcon,
    gradient: 'from-charcoal/40 to-charcoal/60',
    kind: undefined,
  };
}

interface AmenityGridProps {
  /** Raw amenity strings — venue.amenities ids or CMS free-form text
   *  already split. Order is preserved. Deduped by label internally. */
  amenities: string[];
  switchGames: string[];
  boardGames: string[];
  locale: 'zh' | 'en';
}

export default function AmenityGrid({ amenities, switchGames, boardGames, locale }: AmenityGridProps) {
  const [expanded, setExpanded] = useState<'switch' | 'board' | null>(null);

  // Resolve + dedupe by display label
  const seen = new Set<string>();
  let entries: AmenityEntry[] = amenities
    .map((a) => resolveAmenity(a, locale))
    .filter((e) => {
      const key = e.label[locale];
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  // Auto-add Switch / Board cards when games exist but the amenities
  // list doesn't already include them (admin may have left amenities
  // alone and only entered the games list).
  if (switchGames.length > 0 && !entries.some((e) => e.kind === 'switch')) {
    entries.push(resolveAmenity('Switch', locale));
  }
  if (boardGames.length > 0 && !entries.some((e) => e.kind === 'board')) {
    entries.push(resolveAmenity('桌遊', locale));
  }

  // Reorder: gameables (Switch / Board) go last so the user reads
  // physical amenities first then drills into the games.
  entries = [
    ...entries.filter((e) => !e.kind),
    ...entries.filter((e) => e.kind === 'switch'),
    ...entries.filter((e) => e.kind === 'board'),
  ];

  if (entries.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {entries.map((e, i) => {
          const isExpandable = (e.kind === 'switch' && switchGames.length > 0)
            || (e.kind === 'board' && boardGames.length > 0);
          const isExpanded = expanded === e.kind;
          const count = e.kind === 'switch' ? switchGames.length
            : e.kind === 'board' ? boardGames.length : 0;

          return (
            <button
              key={`${e.raw}-${i}`}
              type="button"
              onClick={() => isExpandable && setExpanded(isExpanded ? null : e.kind!)}
              disabled={!isExpandable}
              className={`group relative flex flex-col items-center text-center p-4 rounded-2xl bg-white/60 border border-charcoal/5 transition-all ${
                isExpandable ? 'cursor-pointer hover:bg-white hover:border-pink/30 hover:-translate-y-0.5' : 'cursor-default'
              } ${isExpanded ? 'ring-2 ring-pink/40 bg-white' : ''}`}
            >
              <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${e.gradient} flex items-center justify-center text-white shadow-glow mb-2.5`}>
                <e.icon size={20} />
              </div>
              <p className="font-semibold text-sm text-ink">{e.label[locale]}</p>
              {isExpandable && (
                <p className="text-[11px] text-ink-soft mt-0.5 flex items-center gap-1">
                  {locale === 'zh' ? `${count} 款` : `${count} titles`}
                  {isExpanded
                    ? <ChevronUp size={11} className="text-pink" />
                    : <ChevronDown size={11} className="text-pink" />}
                </p>
              )}
            </button>
          );
        })}
      </div>

      {/* Expanded panel — game list for whichever card is open */}
      {expanded === 'switch' && switchGames.length > 0 && (
        <ExpandedGamePanel
          title={locale === 'zh' ? 'Switch 遊戲' : 'Switch Games'}
          icon={<Gamepad2 size={18} />}
          games={switchGames}
          chipClass="bg-rose-50 text-rose-700 border-rose-200"
          gradient="from-rose-500 to-orange-500"
        />
      )}
      {expanded === 'board' && boardGames.length > 0 && (
        <ExpandedGamePanel
          title={locale === 'zh' ? '桌遊' : 'Board Games'}
          icon={<Dice5 size={18} />}
          games={boardGames}
          chipClass="bg-violet-50 text-violet-700 border-violet-200"
          gradient="from-violet-500 to-pink-500"
        />
      )}
    </div>
  );
}

function ExpandedGamePanel({
  title, icon, games, chipClass, gradient,
}: {
  title: string;
  icon: React.ReactNode;
  games: string[];
  chipClass: string;
  gradient: string;
}) {
  return (
    <div className="glass-card p-5 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white shadow-glow`}>
          {icon}
        </div>
        <h4 className="font-bold font-display">{title}</h4>
      </div>
      <div className="flex flex-wrap gap-2">
        {games.map((g, i) => (
          <span key={i} className={`inline-flex items-center px-3 py-1.5 rounded-pill text-sm border ${chipClass}`}>
            {g}
          </span>
        ))}
      </div>
    </div>
  );
}
