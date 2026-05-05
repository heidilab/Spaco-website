'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight, Briefcase, Building2, Clock, Users, MapPin,
  Check, Flame, MessageCircle, FileText, Wallet, Gamepad2,
  ShieldCheck, Sparkles, X, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { CORPORATE_TST_PACKAGE } from '@/lib/packages';
import { getSiteImages, compareSiteImages } from '@/lib/content';
import { SiteImage } from '@/types';

const pkg = CORPORATE_TST_PACKAGE;

// Why-corporate-clients-pick-us bullet copy. Bilingual marketing block —
// kept inline (rather than next-intl) since it's specific to this single
// page and the wording is product-marketing, not UI strings.
const WHY_REASONS = [
  {
    icon: MapPin,
    grad: 'bg-gradient-pink',
    title: { zh: '地理優勢', en: 'Prime Kowloon Location' },
    body: {
      zh: '九龍核心商業區，鄰近辦公室大廈，員工出行方便，無需長途跋涉。',
      en: 'In the heart of Kowloon\'s business district — minutes from major office towers. No long commutes for your team.',
    },
  },
  {
    icon: ShieldCheck,
    grad: 'bg-gradient-cool',
    title: { zh: '省時省力', en: 'Effortless for HR' },
    body: {
      zh: '自助式免人手服務，HR 唔使安排外賣、協調場地人員，一切簡單搞掂。',
      en: 'Self-service venue — no need to coordinate caterers or venue staff. HR books once, done.',
    },
  },
  {
    icon: Wallet,
    grad: 'bg-gradient-warm',
    title: { zh: '報價透明', en: 'Transparent Quotes' },
    body: {
      zh: '提供正式企業報價單，方便直接轉發上司審批，支持信用卡及轉數快付款。',
      en: 'Formal corporate quotes ready to forward up the chain. Pay by credit card or FPS.',
    },
  },
  {
    icon: Gamepad2,
    grad: 'bg-gradient-sunset',
    title: { zh: '設施豐富', en: 'Full Amenities' },
    body: {
      zh: '娛樂設施齊全，由室內到露台，任何活動形式皆宜。',
      en: 'Mahjong, pool, arcade, Switch, board games, sound system — indoor and on the private terrace.',
    },
  },
  {
    icon: Briefcase,
    grad: 'bg-gradient-pink',
    title: { zh: '私密包場', en: 'Private Exclusive' },
    body: {
      zh: '純私家包場，唔使同陌生人共用場地，讓同事自在交流。',
      en: 'Fully exclusive booking — no strangers sharing the space. Your team relaxes and connects.',
    },
  },
];

const WHATSAPP_NUMBER = '+852 9282 3060';
const WHATSAPP_LINK   = 'https://wa.me/85292823060';
const IG_HANDLE       = '@spacohk';
const IG_LINK         = 'https://www.instagram.com/spacohk';

export default function CorporatePackagePage() {
  const locale = useLocale() as 'zh' | 'en';

  const bbq = pkg.addOns?.find((a) => a.id === 'bbq');

  // Pull TST venue gallery from the same Firestore section the branch page
  // uses (`branch-tst`). Sorted by `order` field, newest admin uploads
  // automatically appear here too.
  const [venueImages, setVenueImages] = useState<SiteImage[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    getSiteImages('branch-tst').then((imgs) => {
      setVenueImages([...imgs].sort(compareSiteImages));
    }).catch(() => { /* gracefully hide section */ });
  }, []);

  return (
    <div className="pt-28 relative overflow-hidden">
      {/* Decorative orbs */}
      <div className="orb orb-lavender animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '5%', opacity: 0.7 }} />
      <div className="orb orb-sky animate-float-medium" style={{ width: 180, height: 180, bottom: '15%', left: '-40px', opacity: 0.55 }} />
      <div className="orb orb-coral animate-float-fast" style={{ width: 130, height: 130, top: '20%', right: '40%', opacity: 0.55 }} />
      <div className="absolute inset-0 bg-grid opacity-50 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)] pointer-events-none" />

      {/* ===== Hero ===== */}
      <section className="section-padding relative z-10">
        <div className="max-content mx-auto px-6 md:px-12 lg:px-20">
          <motion.div
            className="max-w-4xl"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="chip mb-5">
              <Building2 size={12} className="text-lavender" />
              {locale === 'zh' ? '企業包場 · 尖沙咀' : 'Corporate Booking · TST'}
            </span>
            <h1 className="text-display font-display mb-5 leading-tight">
              {locale === 'zh' ? (
                <>
                  <span className="text-gradient-warm whitespace-nowrap">九龍核心</span>
                  {' '}
                  <span className="text-gradient-warm whitespace-nowrap">專有包場</span>
                  <br />
                  <span className="text-ink whitespace-nowrap">讓團隊真正放鬆</span>
                </>
              ) : (
                <>
                  <span className="text-gradient-warm whitespace-nowrap">Prime Kowloon</span>
                  <br />
                  <span className="text-ink">a private space your team will love</span>
                </>
              )}
            </h1>
            <p className="text-lg md:text-xl text-ink-soft leading-relaxed max-w-3xl">
              {locale === 'zh'
                ? '尖沙咀係九龍商業心臟地帶，步行即達各大辦公室大廈。無論係部門聚會、Farewell Party 定係新人歡迎會，SPACO 尖沙咀為企業提供一個零雜擾、高品質嘅私家場地，讓 HR 一鍵搞掂、同事真心期待。'
                : 'TST sits at the heart of Kowloon\'s business district — walking distance from every major office tower. Whether it\'s a department gathering, farewell party or new-hire welcome, SPACO TST gives corporate teams a zero-hassle, premium private venue. HR books in one click; the team actually looks forward to it.'}
            </p>
          </motion.div>
        </div>
      </section>

      {/* ===== Package Card ===== */}
      <section className="px-6 md:px-12 lg:px-20 pb-12 relative z-10">
        <div className="max-content mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="relative overflow-hidden rounded-[36px] bg-gradient-cool p-1 shadow-glow-soft"
          >
            <div className="rounded-[32px] bg-white/15 backdrop-blur-md p-8 md:p-10 lg:p-12 relative overflow-hidden">
              <div className="orb orb-lavender animate-float-fast" style={{ width: 200, height: 200, top: '-40px', right: '-40px', opacity: 0.55 }} />
              <div className="orb orb-sky animate-float-medium" style={{ width: 150, height: 150, bottom: '-30px', left: '15%', opacity: 0.45 }} />

              <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                <div className="lg:col-span-7 text-white">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-pill bg-white/25 backdrop-blur-md text-xs font-bold uppercase tracking-wider mb-4">
                    <Briefcase size={12} />
                    {locale === 'zh' ? '企業 Corporate Chill Package' : 'Corporate Chill Package'}
                  </div>
                  <h2 className="text-3xl md:text-4xl font-bold font-display mb-4 leading-tight">
                    {locale === 'zh' ? '尖沙咀店企業包場' : 'TST Corporate Package'}
                    <span className="block text-2xl md:text-3xl font-display font-normal mt-1 opacity-90">
                      HK${pkg.price.toLocaleString()}
                      <span className="text-base font-normal ml-2 opacity-75">
                        {locale === 'zh' ? '包場（含飲品任飲）' : 'all-in (drinks included)'}
                      </span>
                    </span>
                  </h2>

                  {/* Key facts grid */}
                  <div className="grid grid-cols-2 gap-3 mb-6">
                    <div className="bg-white/15 backdrop-blur-md rounded-2xl p-4 border border-white/20">
                      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-white/75 mb-1.5">
                        <Clock size={12} />
                        {locale === 'zh' ? '適用時段' : 'When'}
                      </div>
                      <p className="font-semibold text-white text-sm leading-snug">
                        {locale === 'zh'
                          ? '平日（一至四）9am – 5pm，任選 5 小時'
                          : 'Mon–Thu 9am–5pm · 5-hour slot'}
                      </p>
                    </div>
                    <div className="bg-white/15 backdrop-blur-md rounded-2xl p-4 border border-white/20">
                      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-white/75 mb-1.5">
                        <Users size={12} />
                        {locale === 'zh' ? '人數' : 'Guests'}
                      </div>
                      <p className="font-semibold text-white text-sm leading-snug">
                        {locale === 'zh'
                          ? '不計人數，適合 12 至 50 人'
                          : 'No per-head charge · 12–50 guests'}
                      </p>
                    </div>
                    <div className="bg-white/15 backdrop-blur-md rounded-2xl p-4 border border-white/20">
                      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-white/75 mb-1.5">
                        <Wallet size={12} />
                        {locale === 'zh' ? '定價' : 'Price'}
                      </div>
                      <p className="font-semibold text-white text-sm leading-snug">
                        HK${pkg.price.toLocaleString()}
                        {locale === 'zh' ? ' 包場價' : ' flat'}
                      </p>
                    </div>
                    <div className="bg-white/15 backdrop-blur-md rounded-2xl p-4 border border-white/20">
                      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-white/75 mb-1.5">
                        <MapPin size={12} />
                        {locale === 'zh' ? '地點' : 'Location'}
                      </div>
                      <p className="font-semibold text-white text-sm leading-snug">
                        {locale === 'zh' ? '尖沙咀，九龍核心商業區' : 'TST · core Kowloon CBD'}
                      </p>
                    </div>
                  </div>

                  {/* CTA buttons */}
                  <div className="flex flex-wrap items-center gap-3">
                    <Link
                      href={`/book/package/${pkg.slug}`}
                      className="inline-flex items-center gap-2 px-7 py-3.5 rounded-pill bg-white text-lavender font-bold hover:-translate-y-0.5 transition-transform shadow-lg"
                    >
                      {locale === 'zh' ? '立即預訂' : 'Book Package'}
                      <ArrowRight size={16} />
                    </Link>
                    <a
                      href={WHATSAPP_LINK}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-7 py-3.5 rounded-pill bg-white/20 backdrop-blur-md border border-white/40 text-white font-bold hover:bg-white/30 transition-colors"
                    >
                      <MessageCircle size={16} />
                      {locale === 'zh' ? '索取報價單' : 'Request Quote'}
                    </a>
                  </div>
                </div>

                {/* Inclusions list */}
                <div className="lg:col-span-5">
                  <div className="glass-strong rounded-[28px] p-6 text-ink">
                    <p className="text-xs text-ink-soft uppercase tracking-wider font-semibold mb-3">
                      {locale === 'zh' ? 'Package 包含' : 'What\'s Included'}
                    </p>
                    <ul className="space-y-2">
                      {pkg.includes[locale].map((item) => (
                        <li key={item} className="flex items-start gap-2 text-sm text-ink-soft">
                          <Check size={14} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>

                    {bbq && (
                      <div className="mt-5 pt-5 border-t border-white/60">
                        <p className="text-xs text-ink-soft uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5">
                          <Flame size={12} className="text-coral" />
                          {locale === 'zh' ? '可選 Add-on' : 'Optional Add-on'}
                        </p>
                        <div className="flex items-start gap-2 text-sm">
                          <Flame size={14} className="text-coral flex-shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <p className="font-semibold text-ink">
                              {bbq.label[locale]} +HK${bbq.pricePerPerson}/{locale === 'zh' ? '位' : 'person'}
                            </p>
                            <p className="text-xs text-ink-soft">
                              {bbq.description?.[locale]}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ===== Venue Gallery — synced from /branches/tsim-sha-tsui ===== */}
      {venueImages.length > 0 && (
        <section className="px-6 md:px-12 lg:px-20 pb-12 relative z-10">
          <div className="max-content mx-auto">
            <motion.div
              className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-3"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <div>
                <span className="chip mb-3">
                  <MapPin size={12} className="text-coral" />
                  {locale === 'zh' ? '尖沙咀店' : 'TST Branch'}
                </span>
                <h2 className="text-heading font-display text-ink">
                  {locale === 'zh' ? '場地實景' : 'Venue Gallery'}
                </h2>
                <p className="text-ink-soft mt-2 max-w-xl">
                  {locale === 'zh'
                    ? '800呎室內複式 + 400呎私家露台，娛樂設施齊全。'
                    : '800 sqft duplex + 400 sqft private terrace · full amenities.'}
                </p>
              </div>
              <Link
                href="/branches/tsim-sha-tsui"
                className="hidden md:inline-flex items-center gap-2 text-sm font-semibold text-pink hover:text-pink/80 transition-colors"
              >
                {locale === 'zh' ? '查看分店詳情' : 'View branch details'}
                <ArrowRight size={14} />
              </Link>
            </motion.div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {venueImages.slice(0, 8).map((img, i) => (
                <motion.button
                  key={img.id}
                  type="button"
                  onClick={() => setLightboxIndex(i)}
                  initial={{ opacity: 0, scale: 0.95 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.04 }}
                  className="relative aspect-square rounded-2xl overflow-hidden ring-1 ring-white/60 hover:ring-pink/60 transition-all hover:-translate-y-0.5 group"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.alt || `TST venue photo ${i + 1}`}
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  {i === 7 && venueImages.length > 8 && (
                    <div className="absolute inset-0 bg-ink/60 backdrop-blur-sm flex items-center justify-center text-cream font-bold text-lg">
                      +{venueImages.length - 8}
                    </div>
                  )}
                </motion.button>
              ))}
            </div>

            {/* Mobile-only "see more" link below the grid */}
            <Link
              href="/branches/tsim-sha-tsui"
              className="md:hidden mt-6 inline-flex items-center gap-2 text-sm font-semibold text-pink"
            >
              {locale === 'zh' ? '查看分店詳情' : 'View branch details'}
              <ArrowRight size={14} />
            </Link>
          </div>
        </section>
      )}

      {/* Lightbox — click any thumbnail to open */}
      <AnimatePresence>
        {lightboxIndex !== null && venueImages.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-ink/95 backdrop-blur-md z-50 flex items-center justify-center"
            onClick={() => setLightboxIndex(null)}
          >
            <button
              className="absolute top-6 right-6 w-11 h-11 rounded-full glass-dark text-cream hover:bg-pink/30 transition-colors flex items-center justify-center"
              onClick={() => setLightboxIndex(null)}
              aria-label="Close"
            >
              <X size={22} />
            </button>
            <button
              className="absolute left-6 top-1/2 -translate-y-1/2 w-12 h-12 glass-dark rounded-full flex items-center justify-center text-cream hover:bg-pink/30 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(Math.max(0, (lightboxIndex || 0) - 1));
              }}
              aria-label="Previous"
            >
              <ChevronLeft size={24} />
            </button>
            <button
              className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 glass-dark rounded-full flex items-center justify-center text-cream hover:bg-pink/30 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(Math.min(venueImages.length - 1, (lightboxIndex || 0) + 1));
              }}
              aria-label="Next"
            >
              <ChevronRight size={24} />
            </button>
            <div className="max-w-4xl max-h-[80vh] px-16" onClick={(e) => e.stopPropagation()}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={venueImages[lightboxIndex]?.url}
                alt={venueImages[lightboxIndex]?.alt || ''}
                className="max-w-full max-h-[80vh] object-contain rounded-2xl"
              />
              <p className="text-cream/50 text-sm text-center mt-4">
                {(lightboxIndex || 0) + 1} / {venueImages.length}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== Why corporates pick SPACO TST ===== */}
      <section className="section-padding relative z-10">
        <div className="max-content mx-auto px-6 md:px-12 lg:px-20">
          <motion.div
            className="mb-12 max-w-2xl"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <span className="chip mb-4">
              <Sparkles size={12} className="text-pink" />
              {locale === 'zh' ? '為什麼企業客選 SPACO 尖沙咀？' : 'Why corporates pick SPACO TST'}
            </span>
            <h2 className="text-heading font-display">
              {locale === 'zh' ? (
                <>
                  <span className="text-ink">最 chill 嘅 </span>
                  <span className="text-gradient-pink">企業包場</span>
                </>
              ) : (
                <>
                  <span className="text-ink">The most relaxed </span>
                  <span className="text-gradient-pink">corporate venue</span>
                </>
              )}
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {WHY_REASONS.map((r, i) => {
              const Icon = r.icon;
              return (
                <motion.div
                  key={r.title.en}
                  className="glass-card p-7 group hover:-translate-y-1 transition-transform duration-500"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.06 }}
                >
                  <div className={`w-12 h-12 rounded-2xl ${r.grad} flex items-center justify-center text-white shadow-glow mb-4`}>
                    <Icon size={22} />
                  </div>
                  <h3 className="text-lg font-bold font-display mb-2 text-ink">
                    {r.title[locale]}
                  </h3>
                  <p className="text-ink-soft text-sm leading-relaxed">
                    {r.body[locale]}
                  </p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===== CTA — quote / WhatsApp ===== */}
      <section className="section-padding-sm relative z-10">
        <div className="max-content mx-auto px-6 md:px-12 lg:px-20">
          <motion.div
            className="relative overflow-hidden rounded-[32px] bg-ink text-cream p-10 md:p-14"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-80px', left: '5%', opacity: 0.55 }} />
            <div className="orb orb-lavender animate-float-medium" style={{ width: 220, height: 220, bottom: '-60px', right: '8%', opacity: 0.5 }} />

            <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
              <div>
                <h2 className="text-3xl md:text-4xl font-bold font-display mb-3">
                  {locale === 'zh' ? '立即查詢 / 索取報價單' : 'Get a quote — talk to us'}
                </h2>
                <p className="text-cream/70 text-base leading-relaxed">
                  {locale === 'zh'
                    ? 'WhatsApp 我哋傾下你嘅活動需求，2 個工作日內收到正式企業報價單。'
                    : 'WhatsApp us your event needs — formal corporate quote returned within 2 business days.'}
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <a
                  href={WHATSAPP_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 px-6 py-4 rounded-2xl bg-gradient-pink text-white font-bold hover:-translate-y-0.5 transition-transform shadow-lg"
                >
                  <span className="flex items-center gap-3">
                    <MessageCircle size={20} />
                    WhatsApp · {WHATSAPP_NUMBER}
                  </span>
                  <ArrowRight size={18} />
                </a>
                <Link
                  href={`/book/package/${pkg.slug}`}
                  className="flex items-center justify-between gap-3 px-6 py-4 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 text-cream font-semibold hover:bg-white/20 transition-colors"
                >
                  <span className="flex items-center gap-3">
                    <FileText size={20} />
                    {locale === 'zh' ? '直接預訂套餐' : 'Book the package directly'}
                  </span>
                  <ArrowRight size={18} />
                </Link>
                <a
                  href={IG_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 px-6 py-4 rounded-2xl bg-white/5 border border-white/10 text-cream/80 font-medium hover:bg-white/15 transition-colors text-sm"
                >
                  <span className="flex items-center gap-3">
                    <Sparkles size={18} />
                    Instagram · {IG_HANDLE}
                  </span>
                  <ArrowRight size={16} />
                </a>
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
