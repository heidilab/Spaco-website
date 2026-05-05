'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Sparkles, ArrowUpRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { venues } from '@/lib/venues';
import { FilterState } from '@/types';
import { generateFallbackSuggestions } from '@/lib/venues';

interface ZeroResultsFallbackProps {
  filters: FilterState;
}

export default function ZeroResultsFallback({ filters }: ZeroResultsFallbackProps) {
  const t = useTranslations('fallback');
  const locale = useLocale() as 'zh' | 'en';
  const suggestions = generateFallbackSuggestions(filters);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="text-center py-8">
        <Sparkles className="mx-auto mb-4 text-accent" size={32} />
        <h3 className="text-xl font-bold mb-2">{t('noResults')}</h3>
      </div>

      {suggestions.map((suggestion, i) => {
        const suggestedVenues = venues.filter((v) =>
          suggestion.venueIds.includes(v.id)
        );

        return (
          <div
            key={i}
            className={`rounded-3xl p-8 ${
              suggestion.type === 'upsell'
                ? 'bg-charcoal text-cream'
                : 'bg-white border border-charcoal/5'
            }`}
          >
            <p className={`text-sm leading-relaxed mb-6 ${
              suggestion.type === 'upsell' ? 'text-cream/80' : 'text-charcoal/60'
            }`}>
              {suggestion.message[locale]}
            </p>

            <div className="flex flex-wrap gap-3">
              {suggestedVenues.map((venue) => (
                <Link
                  key={venue.id}
                  href={`/branches/${venue.slug}`}
                  className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    suggestion.type === 'upsell'
                      ? 'bg-accent text-white hover:bg-accent/90'
                      : 'bg-charcoal text-cream hover:bg-charcoal/90'
                  }`}
                >
                  {venue.name[locale]}
                  <ArrowUpRight size={14} />
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </motion.div>
  );
}
