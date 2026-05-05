'use client';

import { useEffect, useState } from 'react';
import { getSiteContent } from './content';
import { SiteContentSection } from '@/types';

/** Map venue ids to their CMS field key prefix in the `branches` page. */
export const VENUE_TO_CMS_PREFIX: Record<string, string> = {
  cwb:    'cwb',
  wanchai: 'wc',
  'sw-a':  'swa',
  'sw-b':  'swb',
  'sw-ab': 'swab',
  tst:    'tst',
};

export interface BranchOverride {
  name?: { zh: string; en: string };
  size?: { zh: string; en: string };
  description?: { zh: string; en: string };
  amenities?: { zh: string; en: string };
}

/**
 * Loads admin-edited branch overrides from Firestore (`site_content/branches`).
 * Returns a lookup function `get(venueId, locale)` that returns the saved
 * override (or undefined if no override exists for that field).
 *
 * Components should fall back to the hardcoded `venue.*` data when an
 * override is undefined.
 */
export function useBranchOverrides() {
  const [content, setContent] = useState<SiteContentSection | null>(null);

  useEffect(() => {
    getSiteContent('branches')
      .then((c) => setContent(c))
      .catch(() => setContent(null));
  }, []);

  /** Get an override for a single field on a venue. Returns '' if not set. */
  const get = (venueId: string, field: 'name' | 'size' | 'description' | 'amenities', locale: 'zh' | 'en'): string => {
    if (!content) return '';
    const prefix = VENUE_TO_CMS_PREFIX[venueId];
    if (!prefix) return '';
    const key = `${prefix}_${field}`;
    return content[key]?.[locale] || '';
  };

  return { get, ready: content !== null };
}
