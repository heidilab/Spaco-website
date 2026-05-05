'use client';

import { useTranslations, useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ShieldAlert, HelpCircle, Sparkles } from 'lucide-react';
import SplitHeading from '@/components/ui/SplitHeading';
import { loadFaqContent } from '@/lib/faqStorage';
import { DEFAULT_FAQ, FaqContent } from '@/lib/faqDefaults';

function AccordionItem({ question, answer, isOpen, onClick }: {
  question: string;
  answer: string;
  isOpen: boolean;
  onClick: () => void;
}) {
  return (
    <div className="border-b border-white/40 last:border-0">
      <button
        onClick={onClick}
        className="w-full flex items-center justify-between py-5 text-left group"
      >
        <span className={`text-base font-semibold pr-4 transition-colors ${isOpen ? 'text-pink' : 'text-ink group-hover:text-pink'}`}>
          {question}
        </span>
        <span
          className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all ${
            isOpen
              ? 'bg-gradient-pink text-white shadow-glow'
              : 'bg-white/60 text-ink-soft group-hover:bg-white'
          }`}
        >
          <ChevronDown
            size={16}
            className={`transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
          />
        </span>
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <p className="pb-5 text-ink-soft text-sm leading-relaxed">{answer}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function FAQPage() {
  const t = useTranslations('faq');
  const locale = useLocale() as 'zh' | 'en';
  const [openGuest, setOpenGuest] = useState<number | null>(0);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  // Load CMS-edited FAQ from Firestore. Defaults render immediately so
  // the page never shows blank during the async load.
  const [content, setContent] = useState<FaqContent>(DEFAULT_FAQ);
  useEffect(() => {
    loadFaqContent().then(setContent).catch(() => {/* keep defaults */});
  }, []);

  const guestRules = content.guestRules.map((e) => ({ q: e[locale].q, a: e[locale].a }));
  const faqItems = content.faqItems.map((e) => ({ q: e[locale].q, a: e[locale].a }));

  return (
    <div className="pt-28">
      <section className="section-padding relative overflow-hidden noise">
        {/* Decorative orbs */}
        <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '-60px', opacity: 0.5 }} />
        <div className="orb orb-lavender animate-float-medium" style={{ width: 200, height: 200, bottom: '15%', left: '-40px', opacity: 0.45 }} />
        <div className="orb orb-coral animate-float-fast" style={{ width: 130, height: 130, top: '30%', left: '15%', opacity: 0.45 }} />

        <div className="max-content mx-auto max-w-3xl relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-14"
          >
            <span className="chip mb-4 mx-auto">
              <Sparkles size={12} className="text-pink" />
              FAQ
            </span>
            <h1 className="text-heading font-display mb-3">
              <SplitHeading text={t('title')} accentClassName="text-gradient-pink" />
            </h1>
            <p className="text-lg text-ink-soft">{t('subtitle')}</p>
          </motion.div>

          {/* Guest Guidelines */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-12"
          >
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-2xl bg-gradient-warm flex items-center justify-center text-white shadow-glow">
                <ShieldAlert size={20} />
              </div>
              <h2 className="text-xl font-bold font-display">{t('guestInfo')}</h2>
            </div>
            <div className="glass-card px-7">
              {guestRules.map((item, i) => (
                <AccordionItem
                  key={i}
                  question={item.q}
                  answer={item.a}
                  isOpen={openGuest === i}
                  onClick={() => setOpenGuest(openGuest === i ? null : i)}
                />
              ))}
            </div>
          </motion.div>

          {/* FAQ */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-2xl bg-gradient-cool flex items-center justify-center text-white shadow-glow-purple">
                <HelpCircle size={20} />
              </div>
              <h2 className="text-xl font-bold font-display">{t('questions')}</h2>
            </div>
            <div className="glass-card px-7">
              {faqItems.map((item, i) => (
                <AccordionItem
                  key={i}
                  question={item.q}
                  answer={item.a}
                  isOpen={openFaq === i}
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                />
              ))}
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
