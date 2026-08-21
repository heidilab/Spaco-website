'use client';

// UTM link generator — builds spacohk.com links with utm_source /
// utm_campaign tags so channels that strip referrers (WhatsApp, IG
// bio, KOL posts) still classify correctly in the traffic report.

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { Link2, Copy, Check } from 'lucide-react';

const CHANNELS = [
  { value: 'ig',        label: { zh: 'Instagram（bio link / story）', en: 'Instagram (bio / story)' } },
  { value: 'fb',        label: { zh: 'Facebook post', en: 'Facebook post' } },
  { value: 'wa',        label: { zh: 'WhatsApp broadcast / 對話', en: 'WhatsApp broadcast / chat' } },
  { value: 'threads',   label: { zh: 'Threads', en: 'Threads' } },
  { value: 'xhs',       label: { zh: '小紅書', en: 'Xiaohongshu' } },
  { value: 'kol',       label: { zh: 'KOL 合作（campaign 填 KOL 名）', en: 'KOL collab (put KOL name in campaign)' } },
  { value: 'email',     label: { zh: 'Email', en: 'Email' } },
  { value: 'other',     label: { zh: '其他', en: 'Other' } },
] as const;

const PAGES = [
  { value: 'https://spacohk.com', label: { zh: '主頁', en: 'Homepage' } },
  { value: 'https://spacohk.com/zh/book/causeway-bay', label: { zh: '銅鑼灣店', en: 'Causeway Bay' } },
  { value: 'https://spacohk.com/zh/book/wan-chai', label: { zh: '灣仔店', en: 'Wan Chai' } },
  { value: 'https://spacohk.com/zh/book/tsim-sha-tsui', label: { zh: '尖沙咀店', en: 'TST' } },
  { value: 'https://spacohk.com/zh/book/sheung-wan-a', label: { zh: '上環 Room A', en: 'SW Room A' } },
  { value: 'https://spacohk.com/zh/book/sheung-wan-b', label: { zh: '上環 Room B', en: 'SW Room B' } },
  { value: 'https://spacohk.com/zh/book/sheung-wan-ab', label: { zh: '上環全場', en: 'SW Full Floor' } },
  { value: 'custom', label: { zh: '自訂網址…', en: 'Custom URL…' } },
] as const;

export default function UtmLinkGeneratorPage() {
  const locale = useLocale() as 'zh' | 'en';
  const { hasPermission } = useAuth();
  const [channel, setChannel] = useState<string>('ig');
  const [page, setPage] = useState<string>(PAGES[0].value);
  const [customUrl, setCustomUrl] = useState('');
  const [campaign, setCampaign] = useState('');
  const [copied, setCopied] = useState(false);

  if (!hasPermission('members')) {
    return <div className="p-8 text-ink-soft">{locale === 'zh' ? '冇權限' : 'No permission'}</div>;
  }

  const baseUrl = page === 'custom' ? customUrl.trim() : page;
  let finalLink = '';
  if (baseUrl) {
    try {
      const u = new URL(baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`);
      u.searchParams.set('utm_source', channel);
      // Campaign slug: spaces → dashes so the URL stays clean.
      const slug = campaign.trim().replace(/\s+/g, '-');
      if (slug) u.searchParams.set('utm_campaign', slug);
      finalLink = u.toString();
    } catch { finalLink = ''; }
  }

  const copy = async () => {
    if (!finalLink) return;
    await navigator.clipboard.writeText(finalLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="p-6 md:p-8 max-w-2xl">
      <h1 className="text-2xl font-bold flex items-center gap-2 mb-2">
        <Link2 className="text-accent" size={24} />
        {locale === 'zh' ? '追蹤 Link 產生器' : 'UTM Link Generator'}
      </h1>
      <p className="text-sm text-ink-soft mb-6 leading-relaxed">
        {locale === 'zh'
          ? '出 post / send broadcast / 俾 KOL 用嘅 link 喺度整——條 link 帶住渠道標記，客人撳入嚟就會準確計入「流量報表」對應嘅來源。Google 廣告同 FB/IG 廣告會自動帶標記，唔使喺度整。'
          : 'Build links for posts / broadcasts / KOLs — the tag makes the traffic report classify the source precisely. Google Ads and Meta ads auto-tag; no need to build those here.'}
      </p>

      <div className="glass-card p-6 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-ink-soft mb-1.5">
            {locale === 'zh' ? '1. 渠道（條 link 會擺喺邊）' : '1. Channel'}
          </label>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-charcoal/15 bg-white text-sm"
          >
            {CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>{c.label[locale]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-ink-soft mb-1.5">
            {locale === 'zh' ? '2. 目標頁面' : '2. Destination page'}
          </label>
          <select
            value={page}
            onChange={(e) => setPage(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-charcoal/15 bg-white text-sm"
          >
            {PAGES.map((p) => (
              <option key={p.value} value={p.value}>{p.label[locale]}</option>
            ))}
          </select>
          {page === 'custom' && (
            <input
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="https://spacohk.com/zh/..."
              className="mt-2 w-full px-3 py-2.5 rounded-xl border border-charcoal/15 bg-white text-sm font-mono"
            />
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-ink-soft mb-1.5">
            {locale === 'zh' ? '3. 活動名（選填，例如「中秋優惠」「KOL-阿明」）' : '3. Campaign name (optional)'}
          </label>
          <input
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
            placeholder={locale === 'zh' ? '中秋優惠' : 'mid-autumn-promo'}
            className="w-full px-3 py-2.5 rounded-xl border border-charcoal/15 bg-white text-sm"
          />
        </div>

        {finalLink && (
          <div className="pt-2 border-t border-charcoal/10">
            <label className="block text-xs font-semibold text-ink-soft mb-1.5">
              {locale === 'zh' ? '✅ 完成——copy 呢條 link 去用' : '✅ Done — copy this link'}
            </label>
            <div className="flex gap-2">
              <input
                readOnly
                value={finalLink}
                onFocus={(e) => e.target.select()}
                className="flex-1 px-3 py-2.5 rounded-xl border border-emerald-300 bg-emerald-50 text-xs font-mono text-emerald-900"
              />
              <button
                type="button"
                onClick={copy}
                className="px-4 py-2.5 rounded-xl bg-gradient-pink text-white text-sm font-bold flex items-center gap-1.5 shrink-0"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? (locale === 'zh' ? '已 copy' : 'Copied') : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
