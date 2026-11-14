'use client';

// 來源渠道／佣金 — under 財務 (Heidi 2026-11-14: the channel list and the
// commission rules are finance data, not site content). The editor
// itself is components/admin/MarketingChannelEditor.

import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import MarketingChannelEditor from '@/components/admin/MarketingChannelEditor';
import { Megaphone } from 'lucide-react';

export default function ChannelsAdminPage() {
  const locale = useLocale() as 'zh' | 'en';
  const zh = locale === 'zh';
  const { hasPermission } = useAuth();
  if (!hasPermission('staff')) return <div className="p-8 text-gray-500">{zh ? '冇權限' : 'No access'}</div>;

  return (
    <div className="p-4 md:p-8 pb-16 space-y-5 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Megaphone className="w-6 h-6 text-pink" />
          {zh ? '來源渠道／佣金' : 'Channels & commission'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {zh
            ? '客人訂場時揀嘅來源、員工開單用嘅行家／平台渠道、每個渠道嘅佣金，同月結 Excel 嘅渠道欄，全部喺呢度設定。佣金規則同「支出管理」係同一份數據。'
            : 'The sources customers pick, the broker / platform channels staff use, each channel\'s commission and the month-close Excel columns are all set here. Commission rules are the same data as 支出管理.'}
        </p>
      </div>
      <MarketingChannelEditor locale={locale} />
    </div>
  );
}
