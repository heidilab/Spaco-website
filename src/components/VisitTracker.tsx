'use client';

// Logs ONE visit event per browser session with the classified traffic
// source. Mounted once in the root layout. Fire-and-forget — must never
// affect page behaviour.

import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  classifyVisit, getVisitorId, shouldLogVisit, recordFirstTouch,
} from '@/lib/attribution';

export default function VisitTracker() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;             // wait so userId can be attached
    if (!shouldLogVisit()) return;   // one event per session

    try {
      const attribution = classifyVisit(window.location.href, document.referrer);
      recordFirstTouch(attribution.source);
      fetch('/api/track-visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorId: getVisitorId(),
          userId: user?.uid || null,
          source: attribution.source,
          referrerHost: attribution.referrerHost,
          utmSource: attribution.utmSource,
          utmMedium: attribution.utmMedium,
          utmCampaign: attribution.utmCampaign,
          landingPath: window.location.pathname,
        }),
        keepalive: true,
      }).catch(() => { /* tracking must never break the site */ });
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  return null;
}
