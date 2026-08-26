'use client';

import { useTranslations } from 'next-intl';
import { useState, useCallback, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import FilterBar from './FilterBar';
import SplitHeading from '@/components/ui/SplitHeading';
import VenueCard from './VenueCard';
import ZeroResultsFallback from './ZeroResultsFallback';
import { filterVenues, venues as allVenues } from '@/lib/venues';
import { loadActiveVenues } from '@/lib/venueRegistry';
import { FilterState, Venue } from '@/types';

// All Sheung Wan variants (A / B / Full Floor) belong to one branch and
// should appear as a single card on the Spaces grid. We pick the variant
// that best matches the filter — narrower (sw-a) by default, escalating
// to sw-ab when filters target a larger capacity.
const SW_VARIANT_PREFERENCE = ['sw-a', 'sw-b', 'sw-ab'] as const;

function dedupeSheungWan(list: Venue[]): Venue[] {
  const swMatches = list.filter((v) => SW_VARIANT_PREFERENCE.includes(v.id as (typeof SW_VARIANT_PREFERENCE)[number]));
  if (swMatches.length <= 1) return list;
  // Keep the first match by preference order
  const winner = SW_VARIANT_PREFERENCE.map((id) => swMatches.find((v) => v.id === id)).find(Boolean);
  if (!winner) return list;
  return list.filter((v) => v.id === winner.id || !SW_VARIANT_PREFERENCE.includes(v.id as (typeof SW_VARIANT_PREFERENCE)[number]));
}

export default function CollectionSection() {
  const t = useTranslations('collection');
  const [filters, setFilters] = useState<FilterState>({
    capacity: null,
    vibe: null,
    amenities: [],
  });
  // Registry-backed list — admin 分店管理 additions / 落架 reach the
  // homepage without a deploy. Static array is the first paint.
  const [registryVenues, setRegistryVenues] = useState<Venue[]>(allVenues);
  useEffect(() => {
    loadActiveVenues().then(setRegistryVenues).catch(() => {});
  }, []);
  const [filteredVenues, setFilteredVenues] = useState<Venue[] | null>(null);

  // Collapse Sheung Wan A/B/AB → one card (linking to the unified branch page)
  const displayVenues = useMemo(
    () => dedupeSheungWan(filteredVenues ?? registryVenues),
    [filteredVenues, registryVenues],
  );

  const handleFilterChange = useCallback((newFilters: FilterState) => {
    setFilters(newFilters);
    // Static filter maps only know the original 6 ids; venues created
    // dynamically pass through unfiltered (shown in every filter state)
    // until Phase 3 moves the filter attributes onto the venue doc.
    const staticMatch = new Set(filterVenues(newFilters).map((v) => v.id));
    const hasFilter = !!(newFilters.capacity || newFilters.vibe || newFilters.amenities.length);
    setFilteredVenues(!hasFilter ? null : registryVenues.filter((v) => {
      const isStaticVenue = allVenues.some((sv) => sv.id === v.id);
      if (!isStaticVenue) {
        // Dynamic venue: filter directly on its own attributes.
        if (newFilters.vibe && !v.vibes.includes(newFilters.vibe)) return false;
        for (const a of newFilters.amenities) if (!v.amenities.includes(a)) return false;
        return true;
      }
      return staticMatch.has(v.id);
    }));
  }, [registryVenues]);

  return (
    <section id="collection" className="section-padding relative overflow-hidden">
      {/* Decorative orbs */}
      <div className="orb orb-coral animate-float-medium" style={{ width: 240, height: 240, top: '8%', right: '-60px', opacity: 0.4 }} />
      <div className="orb orb-lavender animate-float-slow" style={{ width: 180, height: 180, bottom: '20%', left: '-40px', opacity: 0.35 }} />

      <div className="max-content mx-auto relative z-10">
        {/* Section Header */}
        <motion.div
          className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-4"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <div>
            <span className="chip mb-4">
              <Sparkles size={12} className="text-pink" />
              Our Spaces
            </span>
            <h2 className="text-heading font-display mb-3">
              <SplitHeading text={t('title')} accentClassName="text-gradient-warm" />
            </h2>
            <p className="text-lg text-ink-soft max-w-xl">{t('subtitle')}</p>
          </div>
        </motion.div>

        {/* Filter Bar */}
        <div className="mb-10">
          <FilterBar onFilterChange={handleFilterChange} />
        </div>

        {/* Venue Grid or Fallback */}
        {displayVenues.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {displayVenues.map((venue, i) => (
              <VenueCard key={venue.id} venue={venue} index={i} />
            ))}
          </div>
        ) : (
          <ZeroResultsFallback filters={filters} />
        )}
      </div>
    </section>
  );
}
