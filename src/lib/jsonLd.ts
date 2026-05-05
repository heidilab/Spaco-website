// Schema.org JSON-LD generators.
//
// AI engines (ChatGPT browse, Perplexity, Google AI Overview, Claude search)
// rely heavily on JSON-LD when indexing / citing pages. Keeping these in
// one place so consumers don't have to assemble objects ad-hoc.

import { BRANCH_INFO, BranchInfo } from './branchInfo';
import { venues, getVenueBySlug } from './venues';
import { FaqEntry } from './faqDefaults';
import { Venue } from '@/types';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://spacohk.com';
const PHONE = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER
  ? `+${process.env.NEXT_PUBLIC_WHATSAPP_NUMBER}`
  : '+85291234567'; // PLACEHOLDER

// JSON-LD nodes are loosely-typed objects; Schema.org allows arbitrary
// extension. We use `Record<string, unknown>` for flexibility.
type JsonLdNode = Record<string, unknown>;

// ────────────────────────────────────────────────────────────
// Organization (rendered on home; the canonical brand entity)
// ────────────────────────────────────────────────────────────

export function buildOrganizationLd(locale: 'zh' | 'en'): JsonLdNode {
  const name = locale === 'zh' ? 'SPACO' : 'SPACO';
  const description = locale === 'zh'
    ? '香港高級全自助多功能活動空間，銅鑼灣、灣仔、上環、尖沙咀四間分店。'
    : 'Hong Kong premium self-service multifunctional event space — four branches in Causeway Bay, Wan Chai, Sheung Wan, and Tsim Sha Tsui.';

  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name,
    url: SITE_URL,
    description,
    logo: {
      '@type': 'ImageObject',
      url: `${SITE_URL}/spaco-logo.png`,
    },
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      telephone: PHONE,
      areaServed: 'HK',
      availableLanguage: ['zh-HK', 'en'],
    },
    address: {
      '@type': 'PostalAddress',
      addressCountry: 'HK',
      addressRegion: 'Hong Kong',
    },
    location: BRANCH_INFO.map((b) => ({
      '@type': 'Place',
      name: b.name[locale],
      address: {
        '@type': 'PostalAddress',
        streetAddress: b.streetAddress[locale],
        addressLocality: b.district[locale],
        addressRegion: 'Hong Kong',
        addressCountry: 'HK',
      },
    })),
  };
}

// ────────────────────────────────────────────────────────────
// LocalBusiness (rendered on each branch detail page)
// ────────────────────────────────────────────────────────────

interface LocalBusinessInput {
  branch: BranchInfo;
  /** Venue records that live in this physical branch (for offers / amenities). */
  venuesInBranch: Venue[];
  locale: 'zh' | 'en';
  /** Canonical URL for this branch page */
  url: string;
  /** OG / hero image URL */
  image?: string;
}

export function buildLocalBusinessLd({
  branch, venuesInBranch, locale, url, image,
}: LocalBusinessInput): JsonLdNode {
  const offers = venuesInBranch.map((v) => ({
    '@type': 'Offer',
    name: v.name[locale],
    price: v.pricing.weekday.perHead,
    priceCurrency: 'HKD',
    eligibleQuantity: {
      '@type': 'QuantitativeValue',
      minValue: v.capacity.min,
      maxValue: v.capacity.max,
      unitText: 'person',
    },
    description: v.description[locale],
    priceSpecification: {
      '@type': 'UnitPriceSpecification',
      price: v.pricing.weekday.perHead,
      priceCurrency: 'HKD',
      unitText: 'per person, weekday',
    },
  }));

  // Aggregate amenities across rooms in this branch
  const amenitySet = new Set<string>();
  venuesInBranch.forEach((v) => v.amenities.forEach((a) => amenitySet.add(a)));

  return {
    '@context': 'https://schema.org',
    '@type': 'EventVenue',
    '@id': `${url}#venue`,
    name: branch.name[locale],
    description: venuesInBranch[0]?.description[locale],
    url,
    image,
    telephone: PHONE,
    address: {
      '@type': 'PostalAddress',
      streetAddress: branch.streetAddress[locale],
      addressLocality: branch.district[locale],
      addressRegion: 'Hong Kong',
      addressCountry: 'HK',
    },
    ...(branch.geo
      ? {
          geo: {
            '@type': 'GeoCoordinates',
            latitude: branch.geo.lat,
            longitude: branch.geo.lng,
          },
        }
      : {}),
    openingHoursSpecification: branch.openingHours.map((slot) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: slot.dayOfWeek,
      opens: slot.opens,
      closes: slot.closes,
    })),
    amenityFeature: Array.from(amenitySet).map((name) => ({
      '@type': 'LocationFeatureSpecification',
      name,
      value: true,
    })),
    maximumAttendeeCapacity: Math.max(...venuesInBranch.map((v) => v.capacity.max)),
    priceRange: '$$',
    makesOffer: offers,
    parentOrganization: { '@id': `${SITE_URL}/#organization` },
  };
}

/** Helper: which venues belong to a given branch slug? */
export function venuesForBranch(slug: string): Venue[] {
  if (slug.startsWith('sheung-wan')) {
    // SW page combines all 3 SW variants
    return venues.filter((v) => ['sw-a', 'sw-b', 'sw-ab'].includes(v.id));
  }
  const v = getVenueBySlug(slug);
  return v ? [v] : [];
}

// ────────────────────────────────────────────────────────────
// FAQPage
// ────────────────────────────────────────────────────────────

export function buildFaqPageLd(entries: FaqEntry[], locale: 'zh' | 'en'): JsonLdNode {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((e) => ({
      '@type': 'Question',
      name: e[locale].q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: e[locale].a,
      },
    })),
  };
}

// ────────────────────────────────────────────────────────────
// BreadcrumbList
// ────────────────────────────────────────────────────────────

interface BreadcrumbItem {
  name: string;
  url: string;
}

export function buildBreadcrumbLd(items: BreadcrumbItem[]): JsonLdNode {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
