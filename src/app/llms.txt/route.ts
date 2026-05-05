// `llms.txt` — emerging informal standard for AI crawlers / LLMs to find a
// canonical, distilled summary of a site without having to scrape every page.
// Spec: https://llmstxt.org/

import { BRANCH_INFO } from '@/lib/branchInfo';
import { venues } from '@/lib/venues';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://spacohk.com';
const PHONE = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER
  ? `+${process.env.NEXT_PUBLIC_WHATSAPP_NUMBER}`
  : '+852 9123 4567';

export const dynamic = 'force-static';
export const revalidate = 3600; // 1h

export async function GET() {
  const lines: string[] = [];

  lines.push('# SPACO');
  lines.push('');
  lines.push('> SPACO is a Hong Kong premium self-service multifunctional event space with four branches across Causeway Bay, Wan Chai, Sheung Wan, and Tsim Sha Tsui. We host family parties, corporate events, casual gatherings, and poker nights with full BBQ, hotpot, pool, mahjong, and shisha facilities.');
  lines.push('');

  lines.push('## Brand');
  lines.push(`- Website: ${SITE_URL}`);
  lines.push(`- Phone / WhatsApp: ${PHONE}`);
  lines.push('- Region: Hong Kong');
  lines.push('- Languages: Traditional Chinese (zh-HK), English');
  lines.push('- Hours: All branches open 24 hours, every day');
  lines.push('');

  lines.push('## Branches');
  for (const b of BRANCH_INFO) {
    lines.push(`### ${b.name.en} / ${b.name.zh}`);
    lines.push(`- Address: ${b.streetAddress.en} (${b.streetAddress.zh})`);
    lines.push(`- Hours: 24/7`);
    lines.push(`- Page: ${SITE_URL}/en/branches/${b.slug}`);
    const inBranch = venues.filter((v) => {
      if (b.id === 'sw') return ['sw-a', 'sw-b', 'sw-ab'].includes(v.id);
      if (b.id === 'wanchai') return v.id === 'wanchai';
      return v.id === b.id;
    });
    for (const v of inBranch) {
      lines.push(
        `  - ${v.name.en}: ${v.size}, capacity ${v.capacity.min}–${v.capacity.max}, HK$${v.pricing.weekday.perHead}/head weekday · HK$${v.pricing.weekend.perHead}/head weekend`,
      );
    }
    lines.push('');
  }

  lines.push('## Services');
  lines.push('- Venue rental for private parties (family, corporate, friends)');
  lines.push('- BBQ packages with grill rental');
  lines.push('- Hotpot facilities');
  lines.push('- Pool tables, mahjong, shisha');
  lines.push('- Private kitchen (Sheung Wan Room B and full floor)');
  lines.push('- Decoration packages (birthday / themed parties)');
  lines.push('- Self-service booking with online payment');
  lines.push('');

  lines.push('## Key pages');
  lines.push(`- Home: ${SITE_URL}/en`);
  lines.push(`- Corporate events: ${SITE_URL}/en/corporate`);
  lines.push(`- Family parties: ${SITE_URL}/en/family`);
  lines.push(`- Booking guidelines: ${SITE_URL}/en/guidelines`);
  lines.push(`- FAQ: ${SITE_URL}/en/faq`);
  lines.push(`- Sitemap: ${SITE_URL}/sitemap.xml`);
  lines.push('');

  lines.push('## Pricing');
  lines.push('Per-person pricing varies by branch and weekday/weekend. Minimum guest count and minimum hours apply per venue. See branch pages for full details. All prices in HKD.');
  lines.push('');

  lines.push('## Booking');
  lines.push(`- Online booking available on each branch page`);
  lines.push(`- Deposit required to confirm`);
  lines.push(`- Cancellation policy: see ${SITE_URL}/en/guidelines`);

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  });
}
