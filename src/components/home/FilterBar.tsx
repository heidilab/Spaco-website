'use client';

import { useTranslations } from 'next-intl';
import { useState, useCallback } from 'react';
import { ChevronDown, X, RotateCcw } from 'lucide-react';
import { FilterState } from '@/types';

interface FilterBarProps {
  onFilterChange: (filters: FilterState) => void;
}

export default function FilterBar({ onFilterChange }: FilterBarProps) {
  const t = useTranslations('filter');
  const [filters, setFilters] = useState<FilterState>({
    capacity: null,
    vibe: null,
    amenities: [],
  });
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const capacityOptions = ['6-10', '10-35', '36-70', '71-100'];
  const vibeOptions = ['family', 'corporate', 'chill', 'poker'];
  const amenityOptions = ['bbq', 'pool-table', 'hotpot', 'mahjong', 'private-kitchen'];

  const updateFilters = useCallback(
    (newFilters: FilterState) => {
      setFilters(newFilters);
      onFilterChange(newFilters);
    },
    [onFilterChange]
  );

  const setCapacity = (val: string | null) => {
    const newFilters = { ...filters, capacity: filters.capacity === val ? null : val };
    updateFilters(newFilters);
    setOpenDropdown(null);
  };

  const setVibe = (val: string | null) => {
    const newFilters = { ...filters, vibe: filters.vibe === val ? null : val };
    updateFilters(newFilters);
    setOpenDropdown(null);
  };

  const toggleAmenity = (val: string) => {
    const newAmenities = filters.amenities.includes(val)
      ? filters.amenities.filter((a) => a !== val)
      : [...filters.amenities, val];
    updateFilters({ ...filters, amenities: newAmenities });
  };

  const resetFilters = () => {
    updateFilters({ capacity: null, vibe: null, amenities: [] });
    setOpenDropdown(null);
  };

  const hasActiveFilters = filters.capacity || filters.vibe || filters.amenities.length > 0;

  return (
    <div className="glass-card p-6 md:p-7">
      <div className="flex flex-col gap-5">
        {/* Title row */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold font-display">{t('title')}</h3>
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-1.5 text-sm text-ink-soft hover:text-pink transition-colors"
            >
              <RotateCcw size={14} />
              {t('reset')}
            </button>
          )}
        </div>

        {/* Filter Controls */}
        <div className="flex flex-col md:flex-row gap-3">
          {/* Capacity Dropdown */}
          <div className="relative flex-1">
            <button
              onClick={() => setOpenDropdown(openDropdown === 'capacity' ? null : 'capacity')}
              className={`w-full flex items-center justify-between px-5 py-3.5 rounded-pill border-2 transition-all text-sm backdrop-blur-md ${
                filters.capacity
                  ? 'border-pink bg-pink/15 text-ink shadow-glow font-semibold'
                  : 'border-charcoal/15 bg-white/85 text-ink hover:bg-white hover:border-pink/60 hover:shadow-sm'
              }`}
            >
              <span className="font-medium">
                {filters.capacity
                  ? t(`capacityOptions.${filters.capacity}`)
                  : t('capacity')}
              </span>
              <ChevronDown size={16} className={`transition-transform ${openDropdown === 'capacity' ? 'rotate-180' : ''}`} />
            </button>
            {openDropdown === 'capacity' && (
              <div className="absolute top-full left-0 right-0 mt-2 glass-strong rounded-3xl z-20 overflow-hidden p-1.5">
                {capacityOptions.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setCapacity(opt)}
                    className={`w-full px-4 py-3 text-left text-sm rounded-2xl transition-colors ${
                      filters.capacity === opt
                        ? 'bg-gradient-pink text-white font-semibold'
                        : 'hover:bg-white/60 text-ink'
                    }`}
                  >
                    {t(`capacityOptions.${opt}`)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Vibe Dropdown */}
          <div className="relative flex-1">
            <button
              onClick={() => setOpenDropdown(openDropdown === 'vibe' ? null : 'vibe')}
              className={`w-full flex items-center justify-between px-5 py-3.5 rounded-pill border-2 transition-all text-sm backdrop-blur-md ${
                filters.vibe
                  ? 'border-lavender bg-lavender/15 text-ink shadow-glow-purple font-semibold'
                  : 'border-charcoal/15 bg-white/85 text-ink hover:bg-white hover:border-lavender/60 hover:shadow-sm'
              }`}
            >
              <span className="font-medium">
                {filters.vibe
                  ? t(`vibeOptions.${filters.vibe}`)
                  : t('vibe')}
              </span>
              <ChevronDown size={16} className={`transition-transform ${openDropdown === 'vibe' ? 'rotate-180' : ''}`} />
            </button>
            {openDropdown === 'vibe' && (
              <div className="absolute top-full left-0 right-0 mt-2 glass-strong rounded-3xl z-20 overflow-hidden p-1.5">
                {vibeOptions.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setVibe(opt)}
                    className={`w-full px-4 py-3 text-left text-sm rounded-2xl transition-colors ${
                      filters.vibe === opt
                        ? 'bg-gradient-cool text-white font-semibold'
                        : 'hover:bg-white/60 text-ink'
                    }`}
                  >
                    {t(`vibeOptions.${opt}`)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Amenity Pills */}
        <div>
          <p className="text-xs text-ink mb-3 font-bold uppercase tracking-wider">{t('amenities')}</p>
          <div className="flex flex-wrap gap-2">
            {amenityOptions.map((opt) => (
              <button
                key={opt}
                onClick={() => toggleAmenity(opt)}
                className={`px-4 py-2 rounded-pill text-sm font-semibold transition-all border-2 ${
                  filters.amenities.includes(opt)
                    ? 'bg-gradient-pink text-white border-transparent shadow-glow'
                    : 'bg-white/85 text-ink border-charcoal/15 hover:bg-white hover:border-pink/60 hover:shadow-sm backdrop-blur-md'
                }`}
              >
                {t(`amenityOptions.${opt}`)}
                {filters.amenities.includes(opt) && (
                  <X size={14} className="inline ml-1.5 -mt-0.5" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
