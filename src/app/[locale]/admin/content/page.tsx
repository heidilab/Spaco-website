'use client';

import { useEffect, useState, useRef } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import {
  getSiteImages, uploadSiteImage, uploadSiteImagesBulk, deleteSiteImage,
  getSiteContent, updateSiteContent,
  compareSiteImages, reorderSiteImages, setSiteImageLinkUrl,
} from '@/lib/content';
import { translateZhToEn } from '@/lib/translate';
import { CONTENT_DEFAULTS } from '@/lib/contentDefaults';
import { SiteImage, SiteContentSection } from '@/types';
import MarketingChannelEditor from '@/components/admin/MarketingChannelEditor';
import {
  Upload, Trash2, Save, Image, FileText, Check, Languages, Loader2, GripVertical, Star, Link2,
} from 'lucide-react';

type Tab = 'images' | 'text';
type ImageSubTab = 'homepage' | 'branches' | 'guidelines';
type TextSubTab = 'homepage' | 'corporate' | 'family' | 'guidelines' | 'branches' | 'settings';

// ===== IMAGE SECTIONS =====
// `recommendedSize` shows guidance to admins. All sizes in pixels.
// Aspect ratios chosen to match the actual rendered slot in the homepage layout.
//
// Marquee and Amenities sections render gradient + icons only (no images),
// so they're intentionally absent here.

interface SingleSlotSection {
  key: string;
  label: { zh: string; en: string };
  slots: string[]; // Each slot = exactly ONE image, named by `key`
  recommendedSize: string;
  notes: { zh: string; en: string };
  slotLabels?: string[]; // Optional human label per slot (e.g. "銅鑼灣")
}

const homepageImageSections: SingleSlotSection[] = [
  {
    key: 'hero',
    label: { zh: '首頁 — Hero 主圖', en: 'Homepage — Hero Image' },
    slots: ['hero-main'],
    recommendedSize: '1200 × 1500 px (4:5 直向)',
    notes: {
      zh: '展示喺右邊大玻璃框內。JPEG / PNG，建議 < 800 KB，色彩豐富。',
      en: 'Shown in the right-hand glass frame. JPEG / PNG, < 800 KB, vibrant.',
    },
  },
  {
    key: 'branches-grid',
    label: { zh: '首頁 — 分店導覽 4 張卡片', en: 'Homepage — Branch Grid (4 cards)' },
    slots: ['branch-hero-cwb', 'branch-hero-wc', 'branch-hero-sw', 'branch-hero-tst'],
    slotLabels: ['銅鑼灣', '灣仔', '上環', '尖沙咀'],
    recommendedSize: '900 × 1200 px (3:4 直向)',
    notes: {
      zh: '依序為：銅鑼灣、灣仔、上環、尖沙咀。直向卡片，重要主體放上半部（避免被卡片底部嘅標題遮住）。如果留空，會 fallback 到漸變色背景。',
      en: 'Order: Causeway Bay, Wan Chai, Sheung Wan, TST. Portrait cards — keep key subject in the upper half (so the title overlay does not obscure it). Empty slot falls back to gradient background.',
    },
  },
  {
    key: 'filter-cards',
    label: { zh: '首頁 — Filter / 派對空間卡片', en: 'Homepage — Filter / Spaces Cards' },
    slots: ['card-cwb', 'card-wc', 'card-sw', 'card-tst'],
    slotLabels: ['銅鑼灣', '灣仔', '上環', '尖沙咀'],
    recommendedSize: '1600 × 1200 px (4:3) 或 1200 × 1600 px',
    notes: {
      zh: '篩選器下方嘅 4 張派對空間卡。如果留空，會 fallback 用該分店嘅第 1 張相片。',
      en: 'The 4 venue cards beneath the filter bar. Falls back to the first photo of each branch when empty.',
    },
  },
  {
    key: 'family-hero',
    label: { zh: '親子派對 — Hero 主圖', en: 'Family Page — Hero Image' },
    slots: ['family-hero'],
    recommendedSize: '1200 × 1500 px (4:5 直向)',
    notes: {
      zh: '展示喺親子派對頁左邊嘅大玻璃框內。如果留空，會 fallback 用 SPACO logo + 漸變色背景。',
      en: 'Shown in the glass frame on the left of the Family page hero. Falls back to SPACO logo gradient when empty.',
    },
  },
  {
    key: 'family-decor',
    label: { zh: '親子派對 — 基本佈置款式', en: 'Family Page — Decoration Styles' },
    slots: ['decor-blue', 'decor-pink', 'decor-khaki'],
    slotLabels: ['藍色', '粉紅色', '卡其色'],
    recommendedSize: '1200 × 1200 px (1:1 正方形)',
    notes: {
      zh: '生日包場 $6,800 套餐免費包含嘅 3 款佈置款式。客人預訂時會喺呢 3 款入面揀一款。',
      en: 'The 3 free decoration styles included in the $6,800 birthday package. Customers pick one during booking.',
    },
  },
  {
    key: 'corporate-hero',
    label: { zh: '商務活動 — Hero 主圖', en: 'Corporate Page — Hero Image' },
    slots: ['corporate-hero'],
    recommendedSize: '1200 × 1500 px (4:5 直向)',
    notes: {
      zh: '展示喺商務活動頁左邊嘅大玻璃框內。如果留空，會 fallback 用 SPACO logo + 漸變色背景。',
      en: 'Shown in the glass frame on the left of the Corporate page hero. Falls back to SPACO logo gradient when empty.',
    },
  },
];

interface BranchPhotoSection {
  key: string;          // section identifier in Firestore (`branch-cwb`)
  keyPrefix: string;    // prefix for new image keys (e.g. `cwb`)
  label: { zh: string; en: string };
}

// ===== Homepage Promo Section =====
// Single bulk-upload section that powers the "特別優惠 Package" block on the
// homepage. Each promo image carries an optional `linkUrl` so admins can
// choose where every card navigates to.
const PROMO_SECTION = {
  key: 'homepage-promos',
  keyPrefix: 'promo',
  label: { zh: '首頁 — 特別優惠 Package 圖片', en: 'Homepage — Special Offer Promo Images' },
  recommendedSize: '1080 × 1350 px (4:5 直向)',
  notes: {
    zh: '每張卡片連結至指定頁面（如套餐、分店或自訂網址）。可一次上傳多張，拖拉排序。',
    en: 'Each card links to a chosen destination (package, branch, or custom URL). Upload multiple, drag to reorder.',
  },
};

// Predefined link destinations for the promo cards. Admins pick from this
// list (or "Custom URL" for anything else) when deciding where each promo
// should navigate. Add new internal pages here as they ship.
const PROMO_LINK_OPTIONS: { value: string; label: { zh: string; en: string } }[] = [
  { value: '/corporate-package',          label: { zh: '企業包場（尖沙咀）', en: 'Corporate Package (TST)' } },
  { value: '/family',                     label: { zh: '親子派對',           en: 'Family Parties' } },
  { value: '/corporate',                  label: { zh: '商務活動',           en: 'Corporate Events' } },
  { value: '/book/package/birthday-cwb',  label: { zh: '生日包場（銅鑼灣）', en: 'Birthday Package (CWB)' } },
  { value: '/book/package/mahjong-wanchai', label: { zh: '麻雀包場（灣仔）',  en: 'Mahjong Package (Wan Chai)' } },
  { value: '/book/package/corporate-tst', label: { zh: '企業套餐（尖沙咀）',  en: 'Corporate Package Booking (TST)' } },
  { value: '/branches/causeway-bay',      label: { zh: '銅鑼灣分店',         en: 'Causeway Bay Branch' } },
  { value: '/branches/wan-chai',          label: { zh: '灣仔分店',           en: 'Wan Chai Branch' } },
  { value: '/branches/sheung-wan',        label: { zh: '上環分店',           en: 'Sheung Wan Branch' } },
  { value: '/branches/tsim-sha-tsui',     label: { zh: '尖沙咀分店',         en: 'TST Branch' } },
];

// Note: 上環全層 A+B (sw-ab) is NOT listed here — it's the same physical
// floor as Room A + Room B combined, so its branch page reuses A's & B's
// photos rather than maintaining a third gallery.
const branchPhotoSections: BranchPhotoSection[] = [
  { key: 'branch-cwb',   keyPrefix: 'cwb',   label: { zh: '銅鑼灣店',       en: 'Causeway Bay' } },
  { key: 'branch-wc',    keyPrefix: 'wc',    label: { zh: '灣仔店',         en: 'Wan Chai' } },
  { key: 'branch-sw-a',  keyPrefix: 'sw-a',  label: { zh: '上環 Room A',    en: 'Sheung Wan A' } },
  { key: 'branch-sw-b',  keyPrefix: 'sw-b',  label: { zh: '上環 Room B',    en: 'Sheung Wan B' } },
  { key: 'branch-tst',   keyPrefix: 'tst',   label: { zh: '尖沙咀店',       en: 'TST' } },
];

// ===== TEXT SECTIONS =====
const textPages: { id: TextSubTab; label: { zh: string; en: string }; fields: { key: string; label: { zh: string; en: string }; multiline?: boolean }[] }[] = [
  {
    id: 'homepage',
    label: { zh: '首頁', en: 'Homepage' },
    fields: [
      { key: 'hero_title', label: { zh: 'Hero — 大標題', en: 'Hero — Main Title' } },
      { key: 'hero_subtitle', label: { zh: 'Hero — 副標題', en: 'Hero — Subtitle' } },
      { key: 'hero_cta', label: { zh: 'Hero — 按鈕文字', en: 'Hero — CTA Button' } },
      { key: 'marquee_text', label: { zh: '跑馬燈文字', en: 'Marquee Text' } },
      { key: 'collection_title', label: { zh: '空間展示 — 標題', en: 'Collection — Title' } },
      { key: 'collection_subtitle', label: { zh: '空間展示 — 副標題', en: 'Collection — Subtitle' } },
      { key: 'amenities_title', label: { zh: '設施 — 標題', en: 'Amenities — Title' } },
      { key: 'amenities_subtitle', label: { zh: '設施 — 副標題', en: 'Amenities — Subtitle' } },
      { key: 'branches_title', label: { zh: '分店 — 標題', en: 'Branches — Title' } },
      { key: 'branches_subtitle', label: { zh: '分店 — 副標題', en: 'Branches — Subtitle' } },
    ],
  },
  {
    id: 'corporate',
    label: { zh: '商務活動', en: 'Corporate' },
    fields: [
      { key: 'title', label: { zh: '頁面標題', en: 'Page Title' } },
      { key: 'subtitle', label: { zh: '副標題', en: 'Subtitle' } },
      { key: 'hero_text', label: { zh: 'Hero 內文', en: 'Hero Text' }, multiline: true },
      { key: 'cta', label: { zh: 'CTA 按鈕文字', en: 'CTA Button' } },
    ],
  },
  {
    id: 'family',
    label: { zh: '親子派對', en: 'Family' },
    fields: [
      { key: 'title', label: { zh: '頁面標題', en: 'Page Title' } },
      { key: 'subtitle', label: { zh: '副標題', en: 'Subtitle' } },
      { key: 'hero_text', label: { zh: 'Hero 內文', en: 'Hero Text' }, multiline: true },
      { key: 'cta', label: { zh: 'CTA 按鈕文字', en: 'CTA Button' } },
    ],
  },
  {
    id: 'guidelines',
    label: { zh: '預訂須知', en: 'Guidelines' },
    fields: [
      { key: 'booking_flow_title', label: { zh: '預約流程 — 標題', en: 'Booking Flow — Title' } },
      { key: 'booking_flow_content', label: { zh: '預約流程 — 內容', en: 'Booking Flow — Content' }, multiline: true },
      { key: 'booking_rules_title', label: { zh: '預約須知 — 標題', en: 'Booking Rules — Title' } },
      { key: 'booking_rules_content', label: { zh: '預約須知 — 內容', en: 'Booking Rules — Content' }, multiline: true },
      { key: 'deposit_title', label: { zh: '按金安排 — 標題', en: 'Deposit — Title' } },
      { key: 'deposit_content', label: { zh: '按金安排 — 內容', en: 'Deposit — Content' }, multiline: true },
      { key: 'cancellation_title', label: { zh: '取消更改 — 標題', en: 'Cancellation — Title' } },
      { key: 'cancellation_content', label: { zh: '取消更改 — 內容', en: 'Cancellation — Content' }, multiline: true },
      { key: 'ballpit_title', label: { zh: '波波池 — 標題', en: 'Ball Pit — Title' } },
      { key: 'ballpit_content', label: { zh: '波波池 — 內容', en: 'Ball Pit — Content' }, multiline: true },
      { key: 'weather_title', label: { zh: '惡劣天氣 — 標題', en: 'Weather — Title' } },
      { key: 'weather_content', label: { zh: '惡劣天氣 — 內容', en: 'Weather — Content' }, multiline: true },
      { key: 'bbq_title', label: { zh: 'BBQ — 標題', en: 'BBQ — Title' } },
      { key: 'bbq_content', label: { zh: 'BBQ — 內容', en: 'BBQ — Content' }, multiline: true },
      { key: 'decoration_title', label: { zh: '佈置 — 標題', en: 'Decoration — Title' } },
      { key: 'decoration_content', label: { zh: '佈置 — 內容', en: 'Decoration — Content' }, multiline: true },
    ],
  },
  {
    id: 'branches',
    label: { zh: '分店資料', en: 'Branch Info' },
    fields: [
      // ─── 銅鑼灣店 ───
      { key: 'cwb_name', label: { zh: '銅鑼灣 — 名稱', en: 'CWB — Name' } },
      { key: 'cwb_size', label: { zh: '銅鑼灣 — 場地面積', en: 'CWB — Area' } },
      { key: 'cwb_description', label: { zh: '銅鑼灣 — 描述', en: 'CWB — Description' }, multiline: true },
      { key: 'cwb_amenities', label: { zh: '銅鑼灣 — 設施列表', en: 'CWB — Amenities' }, multiline: true },
      { key: 'cwb_switch_games', label: { zh: '銅鑼灣 — Switch 遊戲（每行一個）', en: 'CWB — Switch Games (one per line)' }, multiline: true },
      { key: 'cwb_board_games', label: { zh: '銅鑼灣 — 桌遊（每行一個）', en: 'CWB — Board Games (one per line)' }, multiline: true },
      // ─── 灣仔店 ───
      { key: 'wc_name', label: { zh: '灣仔 — 名稱', en: 'WC — Name' } },
      { key: 'wc_size', label: { zh: '灣仔 — 場地面積', en: 'WC — Area' } },
      { key: 'wc_description', label: { zh: '灣仔 — 描述', en: 'WC — Description' }, multiline: true },
      { key: 'wc_amenities', label: { zh: '灣仔 — 設施列表', en: 'WC — Amenities' }, multiline: true },
      { key: 'wc_switch_games', label: { zh: '灣仔 — Switch 遊戲（每行一個）', en: 'WC — Switch Games (one per line)' }, multiline: true },
      { key: 'wc_board_games', label: { zh: '灣仔 — 桌遊（每行一個）', en: 'WC — Board Games (one per line)' }, multiline: true },
      // ─── 上環海景旗艦店 - Room A ───
      { key: 'swa_name', label: { zh: '上環A — 名稱', en: 'SW-A — Name' } },
      { key: 'swa_size', label: { zh: '上環A — 場地面積', en: 'SW-A — Area' } },
      { key: 'swa_description', label: { zh: '上環A — 描述', en: 'SW-A — Description' }, multiline: true },
      { key: 'swa_amenities', label: { zh: '上環A — 設施列表', en: 'SW-A — Amenities' }, multiline: true },
      { key: 'swa_switch_games', label: { zh: '上環A — Switch 遊戲（每行一個）', en: 'SW-A — Switch Games (one per line)' }, multiline: true },
      { key: 'swa_board_games', label: { zh: '上環A — 桌遊（每行一個）', en: 'SW-A — Board Games (one per line)' }, multiline: true },
      // ─── 上環海景旗艦店 - Room B ───
      { key: 'swb_name', label: { zh: '上環B — 名稱', en: 'SW-B — Name' } },
      { key: 'swb_size', label: { zh: '上環B — 場地面積', en: 'SW-B — Area' } },
      { key: 'swb_description', label: { zh: '上環B — 描述', en: 'SW-B — Description' }, multiline: true },
      { key: 'swb_amenities', label: { zh: '上環B — 設施列表', en: 'SW-B — Amenities' }, multiline: true },
      { key: 'swb_switch_games', label: { zh: '上環B — Switch 遊戲（每行一個）', en: 'SW-B — Switch Games (one per line)' }, multiline: true },
      { key: 'swb_board_games', label: { zh: '上環B — 桌遊（每行一個）', en: 'SW-B — Board Games (one per line)' }, multiline: true },
      // ─── 尖沙咀店 ───
      { key: 'tst_name', label: { zh: '尖沙咀 — 名稱', en: 'TST — Name' } },
      { key: 'tst_size', label: { zh: '尖沙咀 — 場地面積', en: 'TST — Area' } },
      { key: 'tst_description', label: { zh: '尖沙咀 — 描述', en: 'TST — Description' }, multiline: true },
      { key: 'tst_amenities', label: { zh: '尖沙咀 — 設施列表', en: 'TST — Amenities' }, multiline: true },
      { key: 'tst_switch_games', label: { zh: '尖沙咀 — Switch 遊戲（每行一個）', en: 'TST — Switch Games (one per line)' }, multiline: true },
      { key: 'tst_board_games', label: { zh: '尖沙咀 — 桌遊（每行一個）', en: 'TST — Board Games (one per line)' }, multiline: true },
      // ─── 上環海景旗艦店 - 全層 A+B ───
      { key: 'swab_name', label: { zh: '上環全層 — 名稱', en: 'SW-AB — Name' } },
      { key: 'swab_size', label: { zh: '上環全層 — 場地面積', en: 'SW-AB — Area' } },
      { key: 'swab_description', label: { zh: '上環全層 — 描述', en: 'SW-AB — Description' }, multiline: true },
      { key: 'swab_amenities', label: { zh: '上環全層 — 設施列表', en: 'SW-AB — Amenities' }, multiline: true },
      { key: 'swab_switch_games', label: { zh: '上環全層 — Switch 遊戲（每行一個）', en: 'SW-AB — Switch Games (one per line)' }, multiline: true },
      { key: 'swab_board_games', label: { zh: '上環全層 — 桌遊（每行一個）', en: 'SW-AB — Board Games (one per line)' }, multiline: true },
    ],
  },
  {
    id: 'settings',
    label: { zh: '系統設定', en: 'Settings' },
    fields: [
      // TTLock smart-lock IDs per venue. Read by lockPasscode.ts → getVenueLockMap().
      // Keys MUST be `ttlock_<venueId>`; the value can be entered into either zh/en.
      // Find each lockId by opening the TTLock admin app or calling listLocks().
      { key: 'ttlock_cwb',      label: { zh: 'TTLock — 銅鑼灣 (lockId)',       en: 'TTLock — Causeway Bay (lockId)' } },
      { key: 'ttlock_wanchai',  label: { zh: 'TTLock — 灣仔 (lockId)',         en: 'TTLock — Wan Chai (lockId)' } },
      { key: 'ttlock_sw-a',     label: { zh: 'TTLock — 上環 Room A (lockId)',  en: 'TTLock — Sheung Wan A (lockId)' } },
      { key: 'ttlock_sw-b',     label: { zh: 'TTLock — 上環 Room B (lockId)',  en: 'TTLock — Sheung Wan B (lockId)' } },
      { key: 'ttlock_sw-ab',    label: { zh: 'TTLock — 上環全層 (lockId)',     en: 'TTLock — Sheung Wan A+B (lockId)' } },
      { key: 'ttlock_tst',      label: { zh: 'TTLock — 尖沙咀 (lockId)',       en: 'TTLock — TST (lockId)' } },
      // Per-branch door usage guide images (Cloudinary URL). Embedded in
      // the lock-passcode email. `sw-ab` automatically falls back to
      // `sw-b` when unset (whole-floor bookings enter via Room B).
      { key: 'lockguide_cwb',     label: { zh: '門鎖指南圖 — 銅鑼灣 (URL)',        en: 'Lock guide image — Causeway Bay (URL)' } },
      { key: 'lockguide_wanchai', label: { zh: '門鎖指南圖 — 灣仔 (URL)',          en: 'Lock guide image — Wan Chai (URL)' } },
      { key: 'lockguide_sw-a',    label: { zh: '門鎖指南圖 — 上環 Room A (URL)',   en: 'Lock guide image — Sheung Wan A (URL)' } },
      { key: 'lockguide_sw-b',    label: { zh: '門鎖指南圖 — 上環 Room B / 全層 (URL)', en: 'Lock guide image — SW Room B / A+B (URL)' } },
      { key: 'lockguide_tst',     label: { zh: '門鎖指南圖 — 尖沙咀 (URL)',        en: 'Lock guide image — TST (URL)' } },
    ],
  },
];

export default function AdminContentPage() {
  const locale = useLocale() as 'zh' | 'en';
  const { user, hasPermission } = useAuth();
  const [tab, setTab] = useState<Tab>('images');
  const [imageSubTab, setImageSubTab] = useState<ImageSubTab>('homepage');
  const [textSubTab, setTextSubTab] = useState<TextSubTab>('homepage');
  const [images, setImages] = useState<SiteImage[]>([]);
  const [textContent, setTextContent] = useState<Record<string, SiteContentSection>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null); // slot key OR section key
  const [savedField, setSavedField] = useState<string | null>(null);
  const [translating, setTranslating] = useState<string | null>(null);

  useEffect(() => {
    if (hasPermission('content')) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = async () => {
    const [imgs, ...contentData] = await Promise.all([
      getSiteImages(),
      ...textPages.map((p) => getSiteContent(p.id)),
    ]);
    setImages(imgs);

    // For each text page: start with the default (i18n / hardcoded) values,
    // then overlay anything saved in Firestore. Result: the editor shows the
    // current LIVE content; admin can edit and save deltas.
    const content: Record<string, SiteContentSection> = {};
    textPages.forEach((p, i) => {
      const cmsData = (contentData[i] as SiteContentSection | null) || {};
      const defaults = CONTENT_DEFAULTS[p.id] || {};
      const merged: SiteContentSection = {};
      // First lay down all defaults (so admin sees live text)
      for (const fieldKey of Object.keys(defaults)) {
        merged[fieldKey] = { ...defaults[fieldKey] };
      }
      // Then overlay CMS overrides per-language so admin's saved edits win
      for (const fieldKey of Object.keys(cmsData)) {
        const fieldVal = cmsData[fieldKey] || { zh: '', en: '' };
        merged[fieldKey] = {
          zh: fieldVal.zh || merged[fieldKey]?.zh || '',
          en: fieldVal.en || merged[fieldKey]?.en || '',
        };
      }
      content[p.id] = merged;
    });
    setTextContent(content);
    setLoading(false);
  };

  // Single-slot upload (hero, branch hero cards, filter cards). The first
  // file is taken; existing image at this key is deleted first.
  const uploadToSlot = async (file: File, key: string, section: string) => {
    setUploading(key);
    try {
      const existing = images.find((img) => img.key === key);
      if (existing) await deleteSiteImage(existing.id, existing.url);
      await uploadSiteImage(file, key, section, key);
      await loadData();
    } catch (err) {
      console.error('[upload] failed for', key, err);
      alert(
        (locale === 'zh' ? '上傳失敗：' : 'Upload failed: ') +
        (err instanceof Error ? err.message : String(err))
      );
    } finally {
      setUploading(null);
    }
  };

  const handleDeleteImage = async (img: SiteImage) => {
    await deleteSiteImage(img.id, img.url);
    await loadData();
  };

  // Promo bulk upload — same pattern as branch photos, but for the
  // homepage-promos section. Appends `files` to the end.
  const uploadPromoPhotos = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(PROMO_SECTION.key);
    try {
      const existing = images
        .filter((i) => i.section === PROMO_SECTION.key)
        .sort(compareSiteImages);
      const startingOrder = existing.length;
      await uploadSiteImagesBulk(files, PROMO_SECTION.key, PROMO_SECTION.keyPrefix, startingOrder);
      await loadData();
    } catch (err) {
      console.error('[promo-upload] failed', err);
      alert(
        (locale === 'zh' ? '上傳失敗：' : 'Upload failed: ') +
        (err instanceof Error ? err.message : String(err))
      );
    } finally {
      setUploading(null);
    }
  };

  // Update a single promo image's click-through URL. Optimistic local
  // update first so the dropdown feels instant, then persist.
  const updatePromoLink = async (id: string, linkUrl: string) => {
    setImages((prev) =>
      prev.map((img) => (img.id === id ? { ...img, linkUrl } : img)),
    );
    try {
      await setSiteImageLinkUrl(id, linkUrl || null);
    } catch (err) {
      console.error('[promo-link] failed', err);
      await loadData(); // restore real state
    }
  };

  // Branch photo bulk upload — appends `files` to the end of the section.
  const uploadBranchPhotos = async (files: File[], section: BranchPhotoSection) => {
    if (files.length === 0) return;
    setUploading(section.key);
    try {
      const existing = images
        .filter((i) => i.section === section.key)
        .sort(compareSiteImages);
      const startingOrder = existing.length;
      await uploadSiteImagesBulk(files, section.key, section.keyPrefix, startingOrder);
      await loadData();
    } catch (err) {
      console.error('[bulk-upload] failed for', section.key, err);
      alert(
        (locale === 'zh' ? '上傳失敗：' : 'Upload failed: ') +
        (err instanceof Error ? err.message : String(err))
      );
    } finally {
      setUploading(null);
    }
  };

  // Branch photo reorder — `orderedIds` is the new sequence of doc IDs.
  const persistOrder = async (orderedIds: string[]) => {
    // Optimistic local update first so UI doesn't snap back
    setImages((prev) =>
      prev.map((img) => {
        const idx = orderedIds.indexOf(img.id);
        return idx >= 0 ? { ...img, order: idx } : img;
      })
    );
    try {
      await reorderSiteImages(orderedIds);
    } catch (err) {
      console.error('[reorder] failed', err);
      // Re-fetch to restore real state
      await loadData();
    }
  };

  const handleTextChange = (pageId: string, fieldKey: string, lang: 'zh' | 'en', value: string) => {
    setTextContent((prev) => ({
      ...prev,
      [pageId]: {
        ...prev[pageId],
        [fieldKey]: {
          ...(prev[pageId]?.[fieldKey] || { zh: '', en: '' }),
          [lang]: value,
        },
      },
    }));
  };

  const handleAutoTranslate = async (pageId: string, fieldKey: string) => {
    const zhText = textContent[pageId]?.[fieldKey]?.zh;
    if (!zhText) return;
    setTranslating(`${pageId}-${fieldKey}`);
    try {
      const enText = await translateZhToEn(zhText);
      handleTextChange(pageId, fieldKey, 'en', enText);
    } catch (err) {
      alert(
        (locale === 'zh' ? '翻譯失敗：' : 'Translation failed: ') +
        (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setTranslating(null);
    }
  };

  const handleAutoTranslateAll = async (pageId: string) => {
    const page = textPages.find((p) => p.id === pageId);
    if (!page) return;
    setTranslating(pageId);
    let firstError: string | null = null;
    for (const field of page.fields) {
      const zhText = textContent[pageId]?.[field.key]?.zh;
      if (!zhText) continue;
      try {
        const enText = await translateZhToEn(zhText);
        handleTextChange(pageId, field.key, 'en', enText);
      } catch (err) {
        // Continue with the rest of the fields; surface the first error at the end.
        if (!firstError) firstError = err instanceof Error ? err.message : String(err);
      }
    }
    setTranslating(null);
    if (firstError) {
      alert(
        (locale === 'zh' ? '部分欄位翻譯失敗：' : 'Some fields failed to translate: ') + firstError,
      );
    }
  };

  const handleSaveText = async (pageId: string) => {
    if (!user) return;
    await updateSiteContent(pageId, textContent[pageId], user.uid);
    setSavedField(pageId);
    setTimeout(() => setSavedField(null), 2000);
  };

  if (!hasPermission('content')) {
    return <div className="text-center py-20 text-muted">{locale === 'zh' ? '無權限存取' : 'Access Denied'}</div>;
  }

  const currentTextPage = textPages.find((p) => p.id === textSubTab);

  return (
    <div>
      <h1 className="text-heading mb-8">{locale === 'zh' ? '內容管理' : 'Content Management'}</h1>

      {/* Main Tab */}
      <div className="flex gap-2 mb-6">
        <button onClick={() => setTab('images')} className={`flex items-center gap-2 px-5 py-2.5 rounded-pill text-sm font-medium transition-all border ${tab === 'images' ? 'bg-gradient-pink text-white border-transparent shadow-glow' : 'bg-white/50 text-ink-soft border-white/70 hover:bg-white/80 backdrop-blur-md'}`}>
          <Image size={16} /> {locale === 'zh' ? '圖片管理' : 'Images'}
        </button>
        <button onClick={() => setTab('text')} className={`flex items-center gap-2 px-5 py-2.5 rounded-pill text-sm font-medium transition-all border ${tab === 'text' ? 'bg-gradient-pink text-white border-transparent shadow-glow' : 'bg-white/50 text-ink-soft border-white/70 hover:bg-white/80 backdrop-blur-md'}`}>
          <FileText size={16} /> {locale === 'zh' ? '文字內容' : 'Text Content'}
        </button>
      </div>

      {loading ? (
        <div className="animate-pulse text-muted">Loading...</div>
      ) : tab === 'images' ? (
        <>
          {/* Image Sub-Tabs */}
          <div className="flex gap-2 mb-6">
            {[
              { id: 'homepage' as ImageSubTab, label: { zh: '頁面圖片（首頁・親子・商務）', en: 'Page Images (Home / Family / Corporate)' } },
            ].map((st) => (
              <button key={st.id} onClick={() => setImageSubTab(st.id)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${imageSubTab === st.id ? 'bg-accent text-white' : 'bg-cream text-charcoal/60 hover:bg-charcoal/5'}`}>
                {st.label[locale]}
              </button>
            ))}
          </div>

          <p className="text-xs text-ink-soft -mt-3 mb-5">
            {locale === 'zh'
              ? '📌 分店相片已搬去「分店管理」— 每間分店嘅相片喺嗰度上載／排序／刪除。'
              : '📌 Branch photos moved to Venues (分店管理) — manage each venue\'s photos there.'}
          </p>
          {imageSubTab === 'homepage' ? (
            <div className="space-y-8">
              {homepageImageSections.map((section) => (
                <SingleSlotPanel
                  key={section.key}
                  section={section}
                  images={images}
                  uploading={uploading}
                  locale={locale}
                  onUpload={uploadToSlot}
                  onDelete={handleDeleteImage}
                />
              ))}
              {/* Special-offer promo cards on the homepage */}
              <PromoSectionPanel
                allImages={images}
                uploading={uploading === PROMO_SECTION.key}
                locale={locale}
                onBulkUpload={uploadPromoPhotos}
                onDelete={handleDeleteImage}
                onReorder={persistOrder}
                onLinkChange={updatePromoLink}
              />
            </div>
          ) : (
            <div className="space-y-8">
              {branchPhotoSections.map((section) => (
                <BranchPhotoPanel
                  key={section.key}
                  section={section}
                  allImages={images}
                  uploading={uploading === section.key}
                  locale={locale}
                  onBulkUpload={(files) => uploadBranchPhotos(files, section)}
                  onDelete={handleDeleteImage}
                  onReorder={persistOrder}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-ink-soft mb-3">
            {locale === 'zh'
              ? '📌 分店名稱／面積／描述／設施／遊戲列表已搬去「分店管理」，喺嗰度編輯。'
              : '📌 Branch info moved to Venues (分店管理).'}
          </p>
          {/* Text Sub-Tabs */}
          <div className="flex flex-wrap gap-2 mb-6">
            {/* 分店資料 moved to 分店管理 (venue docs) 2026-08 */}
            {textPages.filter((page) => page.id !== 'branches').map((page) => (
              <button key={page.id} onClick={() => setTextSubTab(page.id)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${textSubTab === page.id ? 'bg-accent text-white' : 'bg-cream text-charcoal/60 hover:bg-charcoal/5'}`}>
                {page.label[locale]}
              </button>
            ))}
          </div>

          {currentTextPage && (
            <div className="glass-card p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold">{currentTextPage.label[locale]}</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAutoTranslateAll(currentTextPage.id)}
                    disabled={translating === currentTextPage.id}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-50 transition-colors"
                  >
                    {translating === currentTextPage.id ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
                    {locale === 'zh' ? '全部自動翻譯' : 'Auto-translate All'}
                  </button>
                  <button
                    onClick={() => handleSaveText(currentTextPage.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                      savedField === currentTextPage.id ? 'bg-green-100 text-green-700' : 'bg-accent text-white hover:bg-accent/90'
                    }`}
                  >
                    {savedField === currentTextPage.id ? <Check size={14} /> : <Save size={14} />}
                    {savedField === currentTextPage.id ? (locale === 'zh' ? '已儲存' : 'Saved') : (locale === 'zh' ? '儲存' : 'Save')}
                  </button>
                </div>
              </div>

              {/* 來源渠道選項 — structured row editor (shows the options
                * currently in effect, add/edit/remove per item). Replaces
                * the raw `id | zh | en` textarea, which Heidi found
                * unusable. Writes the same settings key underneath. */}
              {currentTextPage.id === 'settings' && (
                <MarketingChannelEditor locale={locale} />
              )}

              <div className="space-y-6">
                {currentTextPage.fields.map((field) => (
                  <div key={field.key} className="border-b border-charcoal/5 pb-6 last:border-0 last:pb-0">
                    <label className="text-sm font-semibold text-charcoal/70 mb-3 block">
                      {field.label[locale]}
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <span className="text-[10px] text-muted uppercase tracking-wider font-medium">中文</span>
                        {field.multiline ? (
                          <textarea
                            value={textContent[currentTextPage.id]?.[field.key]?.zh || ''}
                            onChange={(e) => handleTextChange(currentTextPage.id, field.key, 'zh', e.target.value)}
                            rows={5}
                            className="w-full mt-1 px-3 py-2 rounded-xl border border-charcoal/10 text-sm focus:outline-none focus:border-accent resize-none"
                          />
                        ) : (
                          <input
                            type="text"
                            value={textContent[currentTextPage.id]?.[field.key]?.zh || ''}
                            onChange={(e) => handleTextChange(currentTextPage.id, field.key, 'zh', e.target.value)}
                            className="w-full mt-1 px-3 py-2 rounded-xl border border-charcoal/10 text-sm focus:outline-none focus:border-accent"
                          />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted uppercase tracking-wider font-medium">EN</span>
                          <button
                            onClick={() => handleAutoTranslate(currentTextPage.id, field.key)}
                            disabled={translating === `${currentTextPage.id}-${field.key}`}
                            className="text-[10px] text-blue-500 hover:text-blue-700 flex items-center gap-1 disabled:opacity-50"
                          >
                            {translating === `${currentTextPage.id}-${field.key}` ? <Loader2 size={10} className="animate-spin" /> : <Languages size={10} />}
                            {locale === 'zh' ? '自動翻譯' : 'Translate'}
                          </button>
                        </div>
                        {field.multiline ? (
                          <textarea
                            value={textContent[currentTextPage.id]?.[field.key]?.en || ''}
                            onChange={(e) => handleTextChange(currentTextPage.id, field.key, 'en', e.target.value)}
                            rows={5}
                            className="w-full mt-1 px-3 py-2 rounded-xl border border-charcoal/10 text-sm focus:outline-none focus:border-accent resize-none"
                          />
                        ) : (
                          <input
                            type="text"
                            value={textContent[currentTextPage.id]?.[field.key]?.en || ''}
                            onChange={(e) => handleTextChange(currentTextPage.id, field.key, 'en', e.target.value)}
                            className="w-full mt-1 px-3 py-2 rounded-xl border border-charcoal/10 text-sm focus:outline-none focus:border-accent"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────

interface SingleSlotPanelProps {
  section: SingleSlotSection;
  images: SiteImage[];
  uploading: string | null;
  locale: 'zh' | 'en';
  onUpload: (file: File, key: string, section: string) => Promise<void>;
  onDelete: (img: SiteImage) => Promise<void>;
}

function SingleSlotPanel({
  section, images, uploading, locale, onUpload, onDelete,
}: SingleSlotPanelProps) {
  return (
    <div className="glass-card p-6">
      <h3 className="text-lg font-bold font-display text-ink mb-1">{section.label[locale]}</h3>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-4">
        <span className="text-xs text-ink-soft">
          {locale === 'zh' ? `${section.slots.length} 個圖片位置` : `${section.slots.length} image slots`}
        </span>
        <span className="text-ink-soft/40">·</span>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-pink">
          <Image size={11} />
          {locale === 'zh' ? '建議尺寸：' : 'Recommended: '}{section.recommendedSize}
        </span>
        <span className="text-ink-soft/40">·</span>
        <span className="text-xs text-ink-soft italic">{section.notes[locale]}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {section.slots.map((slotKey, i) => {
          const img = images.find((im) => im.key === slotKey);
          const isUploading = uploading === slotKey;
          const slotLabel = section.slotLabels?.[i] ?? slotKey;
          return (
            <SingleSlot
              key={slotKey}
              slotKey={slotKey}
              slotLabel={slotLabel}
              sectionKey={section.key}
              img={img}
              isUploading={isUploading}
              locale={locale}
              onUpload={onUpload}
              onDelete={onDelete}
            />
          );
        })}
      </div>
    </div>
  );
}

interface SingleSlotProps {
  slotKey: string;
  slotLabel: string;
  sectionKey: string;
  img?: SiteImage;
  isUploading: boolean;
  locale: 'zh' | 'en';
  onUpload: (file: File, key: string, section: string) => Promise<void>;
  onDelete: (img: SiteImage) => Promise<void>;
}

function SingleSlot({
  slotKey, slotLabel, sectionKey, img, isUploading, locale, onUpload, onDelete,
}: SingleSlotProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => inputRef.current?.click();
  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await onUpload(file, slotKey, sectionKey);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="relative">
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleChange} />
      <div className="aspect-[4/3] rounded-xl overflow-hidden bg-cream border-2 border-dashed border-charcoal/10">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img.url} alt={img.alt || slotKey} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-charcoal/30">
            <Image size={20} />
            <span className="text-[10px] mt-1 font-medium">{slotLabel}</span>
          </div>
        )}
        {isUploading && (
          <div className="absolute inset-0 bg-charcoal/50 flex items-center justify-center rounded-xl">
            <Loader2 size={20} className="animate-spin text-cream" />
          </div>
        )}
      </div>
      <div className="mt-1.5 flex gap-1">
        <button
          onClick={handleClick}
          disabled={isUploading}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-lg bg-accent/10 text-accent text-[10px] font-medium hover:bg-accent/20 disabled:opacity-50 transition-colors"
        >
          <Upload size={10} /> {img ? (locale === 'zh' ? '更換' : 'Replace') : (locale === 'zh' ? '上載' : 'Upload')}
        </button>
        {img && (
          <button
            onClick={() => onDelete(img)}
            className="px-2 py-1 rounded-lg bg-red-50 text-red-500 text-[10px] hover:bg-red-100 transition-colors"
          >
            <Trash2 size={10} />
          </button>
        )}
      </div>
    </div>
  );
}

interface BranchPhotoPanelProps {
  section: BranchPhotoSection;
  allImages: SiteImage[];
  uploading: boolean;
  locale: 'zh' | 'en';
  onBulkUpload: (files: File[]) => Promise<void>;
  onDelete: (img: SiteImage) => Promise<void>;
  onReorder: (orderedIds: string[]) => Promise<void>;
}

function BranchPhotoPanel({
  section, allImages, uploading, locale, onBulkUpload, onDelete, onReorder,
}: BranchPhotoPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  // Local copy used during drag-reorder so the UI doesn't flicker. Synced on
  // every prop refresh.
  const sectionPhotos = allImages
    .filter((i) => i.section === section.key)
    .sort(compareSiteImages);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const pickFiles = () => inputRef.current?.click();

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    await onBulkUpload(arr);
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) await handleFiles(e.dataTransfer.files);
  };

  const handleReorder = async (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const ids = sectionPhotos.map((p) => p.id);
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...ids];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, fromId);
    await onReorder(next);
  };

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-bold font-display text-ink">{section.label[locale]}</h3>
        <span className="text-xs text-ink-soft">
          {sectionPhotos.length} {locale === 'zh' ? '張相片' : 'photos'}
        </span>
      </div>
      <p className="text-xs text-ink-soft italic mb-4">
        {locale === 'zh'
          ? '第 1 張會用作主圖（亦可用喺首頁 Filter 卡片），其餘為相簿縮圖。可以直接拖入多張相片，亦可拖拉排序。'
          : 'The first photo is the cover (also used as filter card fallback). Drop multiple photos at once, drag tiles to reorder.'}
      </p>

      {/* Drop zone */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div
        onClick={pickFiles}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`mb-4 rounded-2xl border-2 border-dashed cursor-pointer transition-colors p-6 text-center ${
          dragOver ? 'border-pink bg-pink/5' : 'border-charcoal/15 hover:border-charcoal/30 hover:bg-white/40'
        }`}
      >
        {uploading ? (
          <div className="flex items-center justify-center gap-2 text-ink-soft">
            <Loader2 size={16} className="animate-spin" />
            {locale === 'zh' ? '上傳中…' : 'Uploading…'}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-1 text-ink-soft">
            <Upload size={20} />
            <p className="text-sm font-medium">
              {locale === 'zh'
                ? '撳呢度揀相，或者拖多張相片入嚟'
                : 'Click to pick photos, or drop multiple files here'}
            </p>
            <p className="text-[11px] text-ink-soft/70">
              {locale === 'zh' ? '可以一次過選多張相，按住 Cmd / Shift 多選' : 'Cmd/Shift-click to multi-select'}
            </p>
          </div>
        )}
      </div>

      {/* Sortable grid */}
      {sectionPhotos.length === 0 ? (
        <p className="text-center text-sm text-ink-soft py-6">
          {locale === 'zh' ? '仲未有相片' : 'No photos yet'}
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {sectionPhotos.map((img, i) => {
            const isCover = i === 0;
            const isDragging = draggingId === img.id;
            const isHover = hoverId === img.id && draggingId && draggingId !== img.id;
            return (
              <div
                key={img.id}
                draggable
                onDragStart={(e) => {
                  setDraggingId(img.id);
                  e.dataTransfer.effectAllowed = 'move';
                  // Some browsers need data set or drag won't fire
                  e.dataTransfer.setData('text/plain', img.id);
                }}
                onDragEnd={() => { setDraggingId(null); setHoverId(null); }}
                onDragOver={(e) => {
                  if (!draggingId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setHoverId(img.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggingId) handleReorder(draggingId, img.id);
                  setDraggingId(null);
                  setHoverId(null);
                }}
                className={`relative group transition-all ${
                  isDragging ? 'opacity-40' : ''
                } ${isHover ? 'scale-105 ring-2 ring-pink' : ''}`}
              >
                <div className="aspect-[4/3] rounded-xl overflow-hidden bg-cream relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={img.alt || img.key} className="w-full h-full object-cover pointer-events-none" />
                  {isCover && (
                    <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 bg-gradient-pink text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-glow">
                      <Star size={10} fill="white" />
                      {locale === 'zh' ? '主圖' : 'Cover'}
                    </span>
                  )}
                  <span className="absolute top-1.5 right-1.5 bg-white/80 backdrop-blur-md rounded-md p-1 cursor-grab active:cursor-grabbing">
                    <GripVertical size={12} className="text-charcoal/60" />
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-ink-soft">{i + 1}</span>
                  <button
                    onClick={() => onDelete(img)}
                    className="px-2 py-1 rounded-lg bg-red-50 text-red-500 text-[10px] hover:bg-red-100 transition-colors"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// PromoSectionPanel — homepage "特別優惠 Package" management
// ──────────────────────────────────────────────────────────

interface PromoSectionPanelProps {
  allImages: SiteImage[];
  uploading: boolean;
  locale: 'zh' | 'en';
  onBulkUpload: (files: File[]) => Promise<void>;
  onDelete: (img: SiteImage) => Promise<void>;
  onReorder: (orderedIds: string[]) => Promise<void>;
  onLinkChange: (id: string, linkUrl: string) => Promise<void>;
}

function PromoSectionPanel({
  allImages, uploading, locale, onBulkUpload, onDelete, onReorder, onLinkChange,
}: PromoSectionPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const promos = allImages
    .filter((i) => i.section === PROMO_SECTION.key)
    .sort(compareSiteImages);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const pickFiles = () => inputRef.current?.click();

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    await onBulkUpload(arr);
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) await handleFiles(e.dataTransfer.files);
  };

  const handleReorder = async (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const ids = promos.map((p) => p.id);
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...ids];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, fromId);
    await onReorder(next);
  };

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-lg font-bold font-display text-ink">{PROMO_SECTION.label[locale]}</h3>
        <span className="text-xs text-ink-soft">
          {promos.length} {locale === 'zh' ? '張卡片' : 'cards'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-4">
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-pink">
          <Image size={11} />
          {locale === 'zh' ? '建議尺寸：' : 'Recommended: '}{PROMO_SECTION.recommendedSize}
        </span>
        <span className="text-ink-soft/40">·</span>
        <span className="text-xs text-ink-soft italic">{PROMO_SECTION.notes[locale]}</span>
      </div>

      {/* Drop zone */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div
        onClick={pickFiles}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`mb-4 rounded-2xl border-2 border-dashed cursor-pointer transition-colors p-6 text-center ${
          dragOver ? 'border-pink bg-pink/5' : 'border-charcoal/15 hover:border-charcoal/30 hover:bg-white/40'
        }`}
      >
        {uploading ? (
          <div className="flex items-center justify-center gap-2 text-ink-soft">
            <Loader2 size={16} className="animate-spin" />
            {locale === 'zh' ? '上傳中…' : 'Uploading…'}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-1 text-ink-soft">
            <Upload size={20} />
            <p className="text-sm font-medium">
              {locale === 'zh'
                ? '撳呢度揀相，或者拖多張相片入嚟'
                : 'Click to pick images, or drop multiple files here'}
            </p>
            <p className="text-[11px] text-ink-soft/70">
              {locale === 'zh' ? '上傳後可逐張設定點擊跳轉嘅頁面' : 'Set the click-through destination per image after upload'}
            </p>
          </div>
        )}
      </div>

      {/* Sortable cards with link editor */}
      {promos.length === 0 ? (
        <p className="text-center text-sm text-ink-soft py-6">
          {locale === 'zh' ? '仲未有 Promo 圖片' : 'No promo images yet'}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {promos.map((img, i) => {
            const isDragging = draggingId === img.id;
            const isHover = hoverId === img.id && draggingId && draggingId !== img.id;
            return (
              <div
                key={img.id}
                draggable
                onDragStart={(e) => {
                  setDraggingId(img.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', img.id);
                }}
                onDragEnd={() => { setDraggingId(null); setHoverId(null); }}
                onDragOver={(e) => {
                  if (!draggingId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setHoverId(img.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggingId) handleReorder(draggingId, img.id);
                  setDraggingId(null);
                  setHoverId(null);
                }}
                className={`relative bg-white/60 backdrop-blur-md border border-white/80 rounded-2xl p-3 transition-all ${
                  isDragging ? 'opacity-40' : ''
                } ${isHover ? 'scale-105 ring-2 ring-pink' : ''}`}
              >
                {/* Thumbnail (4:5 portrait) */}
                <div className="aspect-[4/5] rounded-xl overflow-hidden bg-cream relative mb-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.alt || img.key}
                    className="w-full h-full object-cover pointer-events-none"
                  />
                  <span className="absolute top-1.5 left-1.5 bg-white/85 backdrop-blur-md rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft">
                    #{i + 1}
                  </span>
                  <span className="absolute top-1.5 right-1.5 bg-white/85 backdrop-blur-md rounded-md p-1 cursor-grab active:cursor-grabbing">
                    <GripVertical size={12} className="text-charcoal/60" />
                  </span>
                </div>

                {/* Link editor */}
                <PromoLinkEditor
                  img={img}
                  locale={locale}
                  onChange={onLinkChange}
                />

                {/* Delete */}
                <button
                  onClick={() => onDelete(img)}
                  className="mt-2 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-red-50 text-red-500 text-xs hover:bg-red-100 transition-colors"
                >
                  <Trash2 size={12} />
                  {locale === 'zh' ? '刪除' : 'Delete'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface PromoLinkEditorProps {
  img: SiteImage;
  locale: 'zh' | 'en';
  onChange: (id: string, linkUrl: string) => Promise<void>;
}

function PromoLinkEditor({ img, locale, onChange }: PromoLinkEditorProps) {
  const current = img.linkUrl?.trim() || '';
  const isPredefined = PROMO_LINK_OPTIONS.some((o) => o.value === current);
  // "custom" mode kicks in either when the saved URL is unrecognised, OR
  // when the admin explicitly picks the Custom option from the dropdown.
  const [mode, setMode] = useState<'predefined' | 'custom' | 'none'>(
    current === '' ? 'none' : isPredefined ? 'predefined' : 'custom',
  );
  const [customUrl, setCustomUrl] = useState(isPredefined ? '' : current);

  const handleSelect = async (value: string) => {
    if (value === '__custom__') {
      setMode('custom');
      // Don't clear saved value — keep what's there until user types
      return;
    }
    if (value === '') {
      setMode('none');
      await onChange(img.id, '');
      return;
    }
    setMode('predefined');
    await onChange(img.id, value);
  };

  const handleCustomBlur = async () => {
    await onChange(img.id, customUrl.trim());
  };

  return (
    <div className="space-y-2">
      <label className="text-[10px] uppercase tracking-wider font-semibold text-ink-soft flex items-center gap-1">
        <Link2 size={10} />
        {locale === 'zh' ? '點擊跳轉' : 'Click destination'}
      </label>
      <select
        value={mode === 'custom' ? '__custom__' : current}
        onChange={(e) => handleSelect(e.target.value)}
        className="w-full px-2.5 py-2 rounded-lg border border-charcoal/15 text-xs bg-white focus:outline-none focus:border-pink"
      >
        <option value="">{locale === 'zh' ? '— 未設定 —' : '— Not set —'}</option>
        {PROMO_LINK_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label[locale]}
          </option>
        ))}
        <option value="__custom__">
          {locale === 'zh' ? '自訂網址…' : 'Custom URL…'}
        </option>
      </select>
      {mode === 'custom' && (
        <input
          type="url"
          value={customUrl}
          onChange={(e) => setCustomUrl(e.target.value)}
          onBlur={handleCustomBlur}
          placeholder={locale === 'zh' ? 'https://… 或 /頁面路徑' : 'https://… or /page-path'}
          className="w-full px-2.5 py-2 rounded-lg border border-charcoal/15 text-xs focus:outline-none focus:border-pink"
        />
      )}
      {current && (
        <p className="text-[10px] text-emerald-600 truncate" title={current}>
          ✓ {current}
        </p>
      )}
    </div>
  );
}
