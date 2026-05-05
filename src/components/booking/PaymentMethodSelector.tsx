'use client';

import { useLocale } from 'next-intl';
import { CreditCard, Smartphone, Check } from 'lucide-react';

interface PaymentMethodSelectorProps {
  selected: 'stripe' | 'fps' | null;
  onSelect: (method: 'stripe' | 'fps') => void;
}

export default function PaymentMethodSelector({ selected, onSelect }: PaymentMethodSelectorProps) {
  const locale = useLocale() as 'zh' | 'en';

  const methods = [
    {
      id: 'stripe' as const,
      icon: CreditCard,
      title: { zh: '線上信用卡付款', en: 'Pay by Card' },
      desc: { zh: '即時確認，支援 Visa / Mastercard', en: 'Instant confirmation, Visa / Mastercard' },
      tag: { zh: '推薦', en: 'Recommended' },
    },
    {
      id: 'fps' as const,
      icon: Smartphone,
      title: { zh: 'FPS 轉數快 / 銀行轉帳', en: 'FPS / Bank Transfer' },
      desc: { zh: '需上傳入數紙，24 小時內確認', en: 'Upload receipt, confirmed within 24 hours' },
      tag: null,
    },
  ];

  return (
    <div className="space-y-3">
      {methods.map((method) => {
        const isSelected = selected === method.id;
        const Icon = method.icon;
        return (
          <button
            key={method.id}
            onClick={() => onSelect(method.id)}
            className={`w-full flex items-center gap-4 p-5 rounded-2xl border-2 transition-all text-left ${
              isSelected
                ? 'border-accent bg-accent/5'
                : 'border-charcoal/5 hover:border-charcoal/20'
            }`}
          >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              isSelected ? 'bg-accent text-white' : 'bg-cream text-charcoal/40'
            }`}>
              <Icon size={22} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold">{method.title[locale]}</p>
                {method.tag && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent/10 text-accent">
                    {method.tag[locale]}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted mt-0.5">{method.desc[locale]}</p>
            </div>
            <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
              isSelected ? 'border-accent bg-accent' : 'border-charcoal/20'
            }`}>
              {isSelected && <Check size={14} className="text-white" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}
