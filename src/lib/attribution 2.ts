// Traffic-source attribution — classifies where a visitor came from
// (Google Ads / Google SEO / IG / FB / WhatsApp / direct / other) and
// maintains a persistent anonymous visitor id so repeat visits by the
// same browser are linked into one journey.
//
// Used by <VisitTracker /> (fires one event per session) and the
// booking flow (stamps visitorId + first-touch source on the booking).

export interface VisitAttribution {
  /** Canonical source bucket. */
  source: TrafficSource;
  /** Raw referrer hostname (for the "other" bucket + debugging). */
  referrerHost: string | null;
  /** utm_source / utm_medium / utm_campaign if present. */
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

export type TrafficSource =
  | 'google_ads'      // gclid present, or utm_medium=cpc from google
  | 'google_organic'  // google referrer without ad markers (SEO)
  | 'instagram'
  | 'facebook'
  | 'whatsapp'
  | 'threads'
  | 'xiaohongshu'
  | 'direct'          // no referrer, no utm (typed URL / bookmark / most apps)
  | 'other';          // some other site linked to us

const SOURCE_LABELS: Record<TrafficSource, { zh: string; en: string }> = {
  google_ads:     { zh: 'Google 廣告', en: 'Google Ads' },
  google_organic: { zh: 'Google 搜尋 (SEO)', en: 'Google Search (SEO)' },
  instagram:      { zh: 'Instagram', en: 'Instagram' },
  facebook:       { zh: 'Facebook', en: 'Facebook' },
  whatsapp:       { zh: 'WhatsApp', en: 'WhatsApp' },
  threads:        { zh: 'Threads', en: 'Threads' },
  xiaohongshu:    { zh: '小紅書', en: 'Xiaohongshu' },
  direct:         { zh: '直接進入', en: 'Direct' },
  other:          { zh: '其他網站', en: 'Other sites' },
};

export function trafficSourceLabel(source: string, locale: 'zh' | 'en' = 'zh'): string {
  return SOURCE_LABELS[source as TrafficSource]?.[locale] || source;
}

export const ALL_TRAFFIC_SOURCES = Object.keys(SOURCE_LABELS) as TrafficSource[];

/** Classify the current page load. Call client-side on landing. */
export function classifyVisit(href: string, referrer: string): VisitAttribution {
  let params: URLSearchParams;
  try {
    params = new URL(href).searchParams;
  } catch {
    params = new URLSearchParams();
  }
  const utmSource = params.get('utm_source')?.toLowerCase() || null;
  const utmMedium = params.get('utm_medium')?.toLowerCase() || null;
  const utmCampaign = params.get('utm_campaign') || null;
  const gclid = params.get('gclid');
  const fbclid = params.get('fbclid');

  let referrerHost: string | null = null;
  try {
    referrerHost = referrer ? new URL(referrer).hostname.toLowerCase() : null;
  } catch { /* malformed referrer */ }

  const base = { referrerHost, utmSource, utmMedium, utmCampaign };

  // 1. Explicit ad-click markers beat everything.
  if (gclid) return { source: 'google_ads', ...base };

  // 2. UTM tags (our own posts / ads carry these).
  if (utmSource) {
    if (utmSource.includes('google')) {
      return { source: utmMedium === 'cpc' || utmMedium === 'paid' ? 'google_ads' : 'google_organic', ...base };
    }
    if (utmSource.includes('instagram') || utmSource === 'ig') return { source: 'instagram', ...base };
    if (utmSource.includes('facebook') || utmSource === 'fb') return { source: 'facebook', ...base };
    if (utmSource.includes('whatsapp') || utmSource === 'wa') return { source: 'whatsapp', ...base };
    if (utmSource.includes('threads')) return { source: 'threads', ...base };
    if (utmSource.includes('xiaohongshu') || utmSource === 'xhs' || utmSource.includes('red')) return { source: 'xiaohongshu', ...base };
    return { source: 'other', ...base };
  }

  // 3. fbclid without utm — Meta family. IG in-app browser sets the
  //    referrer; use it to split IG vs FB, defaulting to FB.
  if (fbclid) {
    if (referrerHost?.includes('instagram')) return { source: 'instagram', ...base };
    return { source: 'facebook', ...base };
  }

  // 4. Referrer-based classification.
  if (referrerHost) {
    if (referrerHost.includes('instagram')) return { source: 'instagram', ...base };
    if (referrerHost.includes('facebook') || referrerHost.includes('fb.com')) return { source: 'facebook', ...base };
    if (referrerHost.includes('whatsapp')) return { source: 'whatsapp', ...base };
    if (referrerHost.includes('threads')) return { source: 'threads', ...base };
    if (referrerHost.includes('xiaohongshu') || referrerHost.includes('xhslink')) return { source: 'xiaohongshu', ...base };
    if (referrerHost.includes('google')) return { source: 'google_organic', ...base };
    if (referrerHost.includes('spacohk.com') || referrerHost === 'localhost') {
      // Internal navigation — not a new visit source; treated as direct
      // (VisitTracker's session guard means this rarely fires anyway).
      return { source: 'direct', ...base };
    }
    return { source: 'other', ...base };
  }

  // 5. Nothing — typed URL, bookmark, or an app that strips referrers
  //    (WhatsApp iOS often lands here).
  return { source: 'direct', ...base };
}

// ───── Visitor identity ─────

const VISITOR_KEY = 'spaco_visitor_id';
const SESSION_KEY = 'spaco_session_logged';
const FIRST_TOUCH_KEY = 'spaco_first_touch';

/** Stable anonymous id for this browser. Created on first visit. */
export function getVisitorId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem(VISITOR_KEY);
  if (!id) {
    id = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
}

/** True once per browser session (tab lifetime) — used so we log ONE
 *  visit per session, not one per page navigation. */
export function shouldLogVisit(): boolean {
  if (typeof window === 'undefined') return false;
  if (sessionStorage.getItem(SESSION_KEY)) return false;
  sessionStorage.setItem(SESSION_KEY, '1');
  return true;
}

/** First-touch source — locked in on the visitor's very first visit,
 *  never overwritten. Used to attribute an eventual booking. */
export function recordFirstTouch(source: TrafficSource): void {
  if (typeof window === 'undefined') return;
  if (!localStorage.getItem(FIRST_TOUCH_KEY)) {
    localStorage.setItem(FIRST_TOUCH_KEY, source);
  }
}

export function getFirstTouchSource(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(FIRST_TOUCH_KEY);
}
