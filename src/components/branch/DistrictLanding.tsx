'use client';

// District landing page body (尖沙咀, for Google Ads — Heidi 2026-11-13).
// One large card per branch: main photo, name, size, capacity, a short
// intro; the whole card opens the branch's own page. Not linked from the
// site menu. Data comes from lib/districtLanding (venue registry).
//
// The server page renders the cards so the ad lands on real content; if
// the server could not read the registry (cards without photos / missing
// branches) the browser loads it once more.

import { useEffect, useState } from 'react';
import { Link } from '@/i18n/routing';
import { ArrowRight, MapPin, Maximize, Users } from 'lucide-react';
import { districtBranchCards, DISTRICTS, type DistrictBranchCard } from '@/lib/districtLanding';

const GRADIENTS = ['bg-gradient-pink', 'bg-gradient-cool', 'bg-gradient-sunset', 'bg-gradient-warm'];

export default function DistrictLanding({
  district, initial, locale,
}: {
  district: keyof typeof DISTRICTS;
  initial: DistrictBranchCard[];
  locale: 'zh' | 'en';
}) {
  const def = DISTRICTS[district];
  const [cards, setCards] = useState<DistrictBranchCard[]>(initial);
  const zh = locale === 'zh';

  useEffect(() => {
    if (initial.length > 0 && initial.every((c) => !!c.image)) return;
    let active = true;
    import('@/lib/venueRegistry')
      .then(({ loadActiveVenues }) => loadActiveVenues())
      .then((list) => {
        const fresh = districtBranchCards(list, def);
        if (active && fresh.length > 0) setCards(fresh);
      })
      .catch(() => { /* keep what the server rendered */ });
    return () => { active = false; };
  }, [initial, def]);

  const people = (c: { min: number; max: number }) =>
    (zh ? `${c.min}–${c.max} 人` : `${c.min}–${c.max} guests`);
  const districtName = def.name[locale];

  return (
    <div className="pt-28 relative overflow-hidden">
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '-60px', opacity: 0.35 }} />
      <div className="orb orb-lavender animate-float-medium" style={{ width: 200, height: 200, top: '45%', left: '-60px', opacity: 0.3 }} />

      <section className="px-6 md:px-12 lg:px-20 pt-6 pb-8 relative z-10">
        <div className="max-content mx-auto">
          <span className="chip mb-4">
            <MapPin size={12} className="text-pink" />
            {zh ? `${districtName} · ${cards.length} 間分店` : `${districtName} · ${cards.length} ${cards.length === 1 ? 'location' : 'locations'}`}
          </span>
          <h1 className="text-heading font-display mb-3">
            {districtName} <span className="text-gradient-warm">Party Room</span>
          </h1>
          <p className="text-lg text-ink-soft max-w-2xl">
            {zh
              ? `SPACO 喺${districtName}有 ${cards.length} 間全自助 Party Room。睇吓邊間啱你嘅人數同場合，再撳入去睇詳細介紹、設施同價錢。`
              : `SPACO has ${cards.length} self-service party ${cards.length === 1 ? 'room' : 'rooms'} in ${districtName}. Pick the one that fits your group, then open it for full details, facilities and prices.`}
          </p>
        </div>
      </section>

      <section className="px-6 md:px-12 lg:px-20 pb-20 relative z-10">
        <div className={`max-content mx-auto grid grid-cols-1 ${cards.length > 1 ? 'lg:grid-cols-2' : ''} gap-6 lg:gap-8`}>
          {cards.map((c, i) => {
            const name = c.name[locale] || c.name.zh;
            const address = c.address[locale] || c.address.zh;
            const singles = c.rooms.filter((r) => !r.combined).length;
            const intro = c.intro[locale] || c.intro.zh
              || (c.rooms.length > 1
                ? (zh
                  ? `同一層樓 ${c.rooms.length} 種佈局：可以單獨租用 ${singles} 個獨立空間，或者包場做大型聚會。`
                  : `One floor, ${c.rooms.length} layouts: book any of the ${singles} individual spaces, or take the whole floor for a large gathering.`)
                : '');
            return (
              <Link
                key={c.key}
                href={`/branches/${c.slug}`}
                className="group flex flex-col glass-card overflow-hidden hover:-translate-y-1 transition-all duration-500 shadow-glass-lg"
              >
                {/* Main photo */}
                <div className="relative aspect-[16/10] overflow-hidden">
                  {c.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.image}
                      alt={zh ? `${name} Party Room` : `${name} party room`}
                      loading={i === 0 ? 'eager' : 'lazy'}
                      decoding="async"
                      className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                    />
                  ) : (
                    <div className={`absolute inset-0 ${GRADIENTS[i % GRADIENTS.length]}`} />
                  )}
                </div>

                <div className="flex flex-col flex-1 p-6 md:p-8">
                  <h2 className="text-2xl md:text-3xl font-bold font-display text-ink leading-tight">{name}</h2>
                  {address && (
                    <p className="mt-2 flex items-start gap-1.5 text-sm text-ink-soft">
                      <MapPin size={14} className="text-pink mt-0.5 shrink-0" />
                      <span>{address}</span>
                    </p>
                  )}

                  {/* Size + capacity */}
                  <dl className="mt-5 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-white/60 border border-white/70 p-4">
                      <dt className="flex items-center gap-1.5 text-xs text-ink-soft uppercase tracking-wider font-semibold">
                        <Maximize size={13} className="text-lavender-deep" />
                        {zh ? '尺寸' : 'Size'}
                      </dt>
                      <dd className="mt-1.5 text-sm md:text-base font-bold text-ink leading-snug">{c.size || '—'}</dd>
                    </div>
                    <div className="rounded-2xl bg-white/60 border border-white/70 p-4">
                      <dt className="flex items-center gap-1.5 text-xs text-ink-soft uppercase tracking-wider font-semibold">
                        <Users size={13} className="text-pink" />
                        {zh ? '容納人數' : 'Capacity'}
                      </dt>
                      <dd className="mt-1.5 text-sm md:text-base font-bold text-ink leading-snug">{people(c.capacity)}</dd>
                    </div>
                  </dl>

                  {intro && <p className="mt-5 text-ink-soft leading-relaxed line-clamp-4">{intro}</p>}

                  {c.rooms.length > 1 && (
                    <ul className="mt-4 flex flex-wrap gap-2">
                      {c.rooms.map((r) => (
                        <li key={r.label.zh} className="chip">
                          {r.label[locale] || r.label.zh} · {people(r.capacity)}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-auto pt-6">
                    <span className="btn-primary">
                      {zh ? '睇詳細介紹' : 'View details'}
                      <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
