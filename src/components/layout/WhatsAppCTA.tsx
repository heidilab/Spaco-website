'use client';

import { MessageCircle } from 'lucide-react';
import { useLocale } from 'next-intl';

const WHATSAPP_NUMBER = '85292823060';

const DEFAULT_MESSAGES = {
  zh: '你好，我想查詢 SPACO 場地預訂',
  en: 'Hi, I would like to ask about SPACO venue booking',
} as const;

interface Props {
  className?: string;
  /** Optional pre-filled message. Falls back to a generic enquiry line. */
  message?: string;
  /** Override the default label (rare). */
  label?: string;
  /** Identifier used for the gtag event 'event_label' so different
   *  CTAs can be measured separately (e.g. "navbar", "hero", "footer"). */
  source?: string;
  /** Show ArrowRight icon variant when used as a navbar CTA. */
  variant?: 'pill' | 'inline';
}

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export default function WhatsAppCTA({
  className,
  message,
  label,
  source = 'whatsapp_cta',
  variant = 'pill',
}: Props) {
  const locale = useLocale() as 'zh' | 'en';
  const text = encodeURIComponent(message || DEFAULT_MESSAGES[locale]);
  const href = `https://wa.me/${WHATSAPP_NUMBER}?text=${text}`;

  function handleClick() {
    // Fire Google Ads conversion (only when gtag + conversion id are configured).
    // The conversion event is on click — Vercel adds the gtag script in the
    // root layout when NEXT_PUBLIC_GOOGLE_ADS_ID is set.
    if (typeof window === 'undefined' || !window.gtag) return;
    const sendTo = process.env.NEXT_PUBLIC_GOOGLE_ADS_WHATSAPP_CONVERSION;
    if (sendTo) {
      window.gtag('event', 'conversion', {
        send_to: sendTo,
        event_callback: undefined,
      });
    }
    // Always log a generic event so the click is countable in GA even
    // without a Google Ads conversion configured.
    window.gtag('event', 'whatsapp_click', {
      event_category: 'engagement',
      event_label: source,
    });
  }

  const text_ = label || (locale === 'zh' ? 'WhatsApp 查詢' : 'WhatsApp');

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      className={
        className ||
        (variant === 'pill'
          ? 'inline-flex items-center gap-2 px-5 py-2.5 rounded-pill bg-[#25D366] text-white font-semibold text-sm hover:opacity-90 transition-opacity shadow-md'
          : 'inline-flex items-center gap-1.5 text-[#25D366] hover:underline')
      }
    >
      <MessageCircle size={16} />
      {text_}
    </a>
  );
}
