'use client';

// 套餐管理 (site review 2026-11-13, phase 4c) — the 包場套餐 as data.
//
// Every package the site sells is a row here: which branch (any room in
// 分店管理), price, deposit, hours, allowed days, start / end limits,
// notice period, the included list, per-head add-ons, 停售. Saved to
// site_content/packages; the customer package page, the branch pages,
// the family / corporate pages, the staff booking form and the server's
// package pricing all read that list (lib/packages). A new branch gets a
// package by 「複製到另一分店」— no code change.

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { loadAllVenues } from '@/lib/venueRegistry';
import { loadPackages, savePackages } from '@/lib/packageRegistryClient';
import {
  ALL_PACKAGES, PACKAGE_CATEGORIES, CATEGORY_LABEL, sanitizePackage, type EventPackage,
} from '@/lib/packages';
import type { Venue } from '@/types';
import { Gift, Loader2, Check, Plus, Trash2, Copy, ArrowUp, ArrowDown, ExternalLink } from 'lucide-react';

interface Pair { zh: string; en: string }
interface AddOnRow { id: string; zh: string; en: string; descZh: string; descEn: string; price: string }
interface Draft {
  slug: string;
  isNew?: boolean;
  active: boolean;
  category: EventPackage['category'];
  venueId: string;
  branchZh: string; branchEn: string;
  nameZh: string; nameEn: string;
  shortZh: string; shortEn: string;
  pitchZh: string; pitchEn: string;
  includes: Pair[];
  price: string; deposit: string; durationHours: string;
  days: number[];
  earliestStart: string; latestEnd: string; minAdvanceDays: string;
  basePax: string; extraPaxPrice: string;
  addOns: AddOnRow[];
}

const INPUT = 'w-full border rounded-lg px-2.5 py-1.5 text-sm bg-white';
const DAYS_ZH = ['日', '一', '二', '三', '四', '五', '六'];
const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function draftOf(p: EventPackage): Draft {
  const zh = p.includes.zh; const en = p.includes.en;
  return {
    slug: p.slug, active: p.active !== false, category: p.category, venueId: p.venueId,
    branchZh: p.branchLabel?.zh || '', branchEn: p.branchLabel?.en || '',
    nameZh: p.name.zh, nameEn: p.name.en, shortZh: p.shortDesc.zh, shortEn: p.shortDesc.en,
    pitchZh: p.pitch.zh, pitchEn: p.pitch.en,
    includes: zh.map((z, i) => ({ zh: z, en: en[i] ?? '' })),
    price: String(p.price), deposit: String(p.deposit), durationHours: String(p.durationHours),
    days: [...p.allowedDaysOfWeek], earliestStart: p.earliestStart, latestEnd: p.latestEnd || '',
    minAdvanceDays: p.minAdvanceDays ? String(p.minAdvanceDays) : '',
    basePax: p.basePax ? String(p.basePax) : '', extraPaxPrice: p.extraPaxPrice != null ? String(p.extraPaxPrice) : '',
    addOns: (p.addOns || []).map((a) => ({ id: a.id, zh: a.label.zh, en: a.label.en, descZh: a.description?.zh || '', descEn: a.description?.en || '', price: String(a.pricePerPerson) })),
  };
}

/** The package a draft describes — raw; sanitizePackage decides if it is valid. */
function packageOf(d: Draft, sortOrder: number): unknown {
  const includesZh = d.includes.map((p) => p.zh.trim()).filter(Boolean);
  const includesEn = d.includes.filter((p) => p.zh.trim()).map((p) => p.en.trim() || p.zh.trim());
  return {
    slug: d.slug.trim().toLowerCase(), category: d.category, venueId: d.venueId,
    branchLabel: d.branchZh.trim() ? { zh: d.branchZh.trim(), en: d.branchEn.trim() || d.branchZh.trim() } : undefined,
    name: { zh: d.nameZh.trim(), en: d.nameEn.trim() || d.nameZh.trim() },
    shortDesc: { zh: d.shortZh.trim(), en: d.shortEn.trim() || d.shortZh.trim() },
    pitch: { zh: d.pitchZh.trim(), en: d.pitchEn.trim() || d.pitchZh.trim() },
    includes: { zh: includesZh, en: includesEn },
    price: d.price, deposit: d.deposit, durationHours: d.durationHours,
    allowedDaysOfWeek: d.days, earliestStart: d.earliestStart, latestEnd: d.latestEnd || undefined,
    minAdvanceDays: d.minAdvanceDays || undefined,
    basePax: d.basePax || undefined, extraPaxPrice: d.basePax ? (d.extraPaxPrice || '0') : undefined,
    addOns: d.addOns.map((a) => ({ id: a.id.trim().toLowerCase(), label: { zh: a.zh, en: a.en || a.zh }, description: a.descZh ? { zh: a.descZh, en: a.descEn || a.descZh } : undefined, pricePerPerson: a.price })),
    active: d.active, sortOrder,
  };
}

function problemsOf(d: Draft, zh: boolean, venues: Venue[]): string[] {
  const out: string[] = [];
  const name = d.nameZh.trim() || d.slug;
  if (!d.nameZh.trim()) out.push(zh ? `${d.slug || '新套餐'}：未填中文名稱` : `${d.slug || 'new'}: Chinese name missing`);
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(d.slug.trim().toLowerCase())) out.push(zh ? `${name}：網址代號只可以用小寫英文、數字同「-」（2–40 個字）` : `${name}: slug must be 2–40 lower-case letters, digits or '-'`);
  if (!d.venueId.trim()) out.push(zh ? `${name}：請揀分店／房間` : `${name}: pick a venue`);
  if (!(Number(d.price) >= 0) || d.price.trim() === '') out.push(zh ? `${name}：未填價錢` : `${name}: price missing`);
  if (!(Number(d.deposit) >= 0) || d.deposit.trim() === '') out.push(zh ? `${name}：未填按金` : `${name}: deposit missing`);
  const h = Number(d.durationHours);
  if (!(h > 0 && h <= 24 && (h * 4) % 1 === 0)) out.push(zh ? `${name}：時數要係 0.25 嘅倍數（最多 24）` : `${name}: hours must be a multiple of 0.25 (max 24)`);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.earliestStart)) out.push(zh ? `${name}：最早開始時間格式要係 HH:mm` : `${name}: earliest start must be HH:mm`);
  if (d.latestEnd && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.latestEnd)) out.push(zh ? `${name}：最遲完結時間格式要係 HH:mm` : `${name}: latest end must be HH:mm`);
  if (d.days.length === 0) out.push(zh ? `${name}：最少揀一日` : `${name}: pick at least one day`);
  if (d.addOns.some((a) => !a.id.trim() || !a.zh.trim() || !(Number(a.price) >= 0) || a.price.trim() === '')) out.push(zh ? `${name}：加購項目要有代號、中文名同每位價錢` : `${name}: each add-on needs an id, a Chinese name and a per-person price`);
  return out;
}

export default function PackagesAdminPage() {
  const locale = useLocale() as 'zh' | 'en';
  const zh = locale === 'zh';
  const { user, hasPermission } = useAuth();
  const canAccess = hasPermission('staff');

  const [venues, setVenues] = useState<Venue[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [savedOnce, setSavedOnce] = useState(false);

  useEffect(() => {
    if (!canAccess) return;
    Promise.all([loadAllVenues(), loadPackages(true)])
      .then(([v, saved]) => {
        setVenues(v.filter((x) => x.active !== false));
        setSavedOnce(saved !== null);
        setDrafts((saved ?? ALL_PACKAGES).map(draftOf));
      })
      .finally(() => setLoading(false));
  }, [canAccess]);

  const patch = (slug: string, p: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.slug === slug ? { ...d, ...p } : d)));
  const move = (i: number, by: number) => setDrafts((prev) => {
    const j = i + by;
    if (j < 0 || j >= prev.length) return prev;
    const next = [...prev];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const taken = useMemo(() => new Set(drafts.map((d) => d.slug)), [drafts]);
  const freeSlug = (base: string) => {
    let slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'package';
    let n = 2;
    const root = slug;
    while (taken.has(slug)) slug = `${root}-${n++}`;
    return slug;
  };
  function addPackage() {
    const venue = venues[0];
    const slug = freeSlug(`birthday-${venue?.id || 'new'}`);
    setDrafts((prev) => [...prev, {
      slug, isNew: true, active: true, category: 'birthday', venueId: venue?.id || '',
      branchZh: venue?.branchName?.zh || venue?.name.zh || '', branchEn: venue?.branchName?.en || venue?.name.en || '',
      nameZh: '', nameEn: '', shortZh: '', shortEn: '', pitchZh: '', pitchEn: '',
      includes: [{ zh: '', en: '' }], price: '', deposit: '2000', durationHours: '3', days: [0, 1, 2, 3, 4, 5, 6],
      earliestStart: '08:00', latestEnd: '17:00', minAdvanceDays: '5', basePax: '', extraPaxPrice: '', addOns: [],
    }]);
    setOpenSlug(slug);
  }
  function duplicate(d: Draft) {
    const other = venues.find((v) => v.id !== d.venueId) || venues[0];
    const slug = freeSlug(`${d.category}-${other?.id || d.venueId}`);
    const copy: Draft = {
      ...d, slug, isNew: true, venueId: other?.id || d.venueId,
      branchZh: other?.branchName?.zh || other?.name.zh || '', branchEn: other?.branchName?.en || other?.name.en || '',
      includes: d.includes.map((p) => ({ ...p })), addOns: d.addOns.map((a) => ({ ...a })),
    };
    setDrafts((prev) => [...prev, copy]);
    setOpenSlug(slug);
  }
  function remove(d: Draft) {
    if (!d.isNew) return;
    setDrafts((prev) => prev.filter((x) => x.slug !== d.slug));
    if (openSlug === d.slug) setOpenSlug(null);
  }

  const problems = useMemo(() => drafts.flatMap((d) => problemsOf(d, zh, venues)), [drafts, zh, venues]);

  async function save() {
    if (problems.length > 0) { setMessage({ ok: false, text: problems.join('；') }); return; }
    setSaving(true); setMessage(null);
    try {
      const list = drafts.map((d, i) => sanitizePackage(packageOf(d, i))).filter((p): p is EventPackage => !!p);
      if (list.length !== drafts.length) throw new Error(zh ? '有套餐資料唔完整' : 'a package is incomplete');
      const saved = await savePackages(list, user?.email || 'admin');
      setDrafts(saved.map(draftOf));
      setSavedOnce(true);
      setMessage({ ok: true, text: zh ? '已儲存，客人頁面即時生效。' : 'Saved — live on the customer pages.' });
    } catch (err) {
      setMessage({ ok: false, text: (zh ? '儲存失敗：' : 'Could not save: ') + (err instanceof Error ? err.message : '') });
    } finally {
      setSaving(false);
    }
  }

  if (!canAccess) return <div className="p-8 text-gray-500">{zh ? '冇權限' : 'No access'}</div>;

  const venueName = (id: string) => {
    const v = venues.find((x) => x.id === id);
    return v ? v.name[locale] : id;
  };
  const field = (label: string, value: string, onChange: (v: string) => void, opts: { type?: string; placeholder?: string; step?: string } = {}) => (
    <label className="block">
      <span className="text-xs text-gray-500">{label}</span>
      <input type={opts.type || 'text'} step={opts.step} value={value} onChange={(e) => onChange(e.target.value)} placeholder={opts.placeholder} className={`${INPUT} mt-1`} />
    </label>
  );

  return (
    <div className="p-4 md:p-8 pb-28 space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Gift className="w-6 h-6 text-pink" />
          {zh ? '套餐管理' : 'Packages'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {zh
            ? '呢度管所有包場套餐：分店、價錢、按金、時數、適用日子、時間限制、提前日數、包含項目同加購。儲存之後套餐頁、分店頁、員工開單同伺服器計價即時跟住變。新分店要套餐，撳「複製到另一分店」再改。'
            : 'Every package: branch, price, deposit, hours, days, time limits, notice, inclusions and add-ons. Saving updates the package page, branch pages, the staff form and server pricing at once. For a new branch, duplicate a package and edit it.'}
        </p>
        {!loading && !savedOnce && (
          <p className="text-xs text-amber-700 mt-2">{zh ? '目前顯示嘅係程式內置嘅套餐；儲存一次之後就以呢度為準。' : 'Showing the built-in packages; once saved, this list is the source.'}</p>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>
      ) : (
        <>
          {drafts.map((d, i) => {
            const open = openSlug === d.slug;
            const summary = [
              d.active ? (zh ? '發售中' : 'On sale') : (zh ? '已停售' : 'Off sale'),
              venueName(d.venueId),
              d.price ? `HK$${Number(d.price).toLocaleString()}` : null,
              `${d.durationHours}${zh ? ' 小時' : 'h'}`,
              CATEGORY_LABEL[d.category][locale],
            ].filter(Boolean).join(' · ');
            return (
              <div key={d.slug} className={`bg-white rounded-xl border ${d.active ? '' : 'opacity-70'}`}>
                <div className="flex items-center gap-3 p-4">
                  <button type="button" onClick={() => setOpenSlug(open ? null : d.slug)} className="flex-1 text-left">
                    <div className="font-semibold">{d.nameZh || (zh ? '（未命名的新套餐）' : '(unnamed new package)')}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{summary} · <span className="font-mono">/book/package/{d.slug}</span></div>
                  </button>
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input type="checkbox" checked={d.active} onChange={(e) => patch(d.slug, { active: e.target.checked })} className="w-4 h-4" />
                    {zh ? '發售' : 'On sale'}
                  </label>
                  <div className="flex items-center">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-25" title={zh ? '上移' : 'Up'}><ArrowUp className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === drafts.length - 1} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-25" title={zh ? '下移' : 'Down'}><ArrowDown className="w-3.5 h-3.5" /></button>
                  </div>
                  <button type="button" onClick={() => setOpenSlug(open ? null : d.slug)} className="text-sm text-pink hover:underline">
                    {open ? (zh ? '收起' : 'Close') : (zh ? '設定' : 'Edit')}
                  </button>
                </div>

                {open && (
                  <div className="border-t p-4 space-y-6 text-sm">
                    <div className="grid md:grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-xs text-gray-500">{zh ? '分店／房間' : 'Branch / room'}</span>
                        <select value={d.venueId} onChange={(e) => patch(d.slug, { venueId: e.target.value })} className={`${INPUT} mt-1`}>
                          {!venues.some((v) => v.id === d.venueId) && <option value={d.venueId}>{d.venueId}</option>}
                          {venues.map((v) => <option key={v.id} value={v.id}>{v.name[locale]}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs text-gray-500">{zh ? '類別' : 'Category'}</span>
                        <select value={d.category} onChange={(e) => patch(d.slug, { category: e.target.value as EventPackage['category'] })} className={`${INPUT} mt-1`}>
                          {PACKAGE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c][locale]}</option>)}
                        </select>
                      </label>
                      {d.isNew
                        ? field(zh ? '網址代號（儲存後唔可以改）' : 'Slug (fixed once saved)', d.slug, (v) => { const slug = v.toLowerCase(); setDrafts((prev) => prev.map((x) => (x.slug === d.slug ? { ...x, slug } : x))); setOpenSlug(slug); }, { placeholder: 'birthday-cwb' })
                        : (
                          <label className="block">
                            <span className="text-xs text-gray-500">{zh ? '網址代號' : 'Slug'}</span>
                            <div className={`${INPUT} mt-1 bg-gray-50 font-mono flex items-center justify-between`}>
                              {d.slug}
                              <a href={`/${locale}/book/package/${d.slug}`} target="_blank" rel="noreferrer" className="text-pink inline-flex items-center gap-1 text-xs"><ExternalLink className="w-3 h-3" />{zh ? '開套餐頁' : 'Open'}</a>
                            </div>
                          </label>
                        )}
                      {field(zh ? '分店短名（中文，揀分店按鈕用）' : 'Branch short name (Chinese)', d.branchZh, (v) => patch(d.slug, { branchZh: v }), { placeholder: '銅鑼灣店' })}
                      {field(zh ? '分店短名（英文）' : 'Branch short name (English)', d.branchEn, (v) => patch(d.slug, { branchEn: v }), { placeholder: 'Causeway Bay' })}
                      {field(zh ? '套餐名稱（中文）*' : 'Name (Chinese) *', d.nameZh, (v) => patch(d.slug, { nameZh: v }))}
                      {field(zh ? '套餐名稱（英文）' : 'Name (English)', d.nameEn, (v) => patch(d.slug, { nameEn: v }))}
                      {field(zh ? '一句簡介（中文）' : 'One-line summary (Chinese)', d.shortZh, (v) => patch(d.slug, { shortZh: v }), { placeholder: '$6,800 全包．3 小時專屬包場．不限人頭' })}
                      {field(zh ? '一句簡介（英文）' : 'One-line summary (English)', d.shortEn, (v) => patch(d.slug, { shortEn: v }))}
                      {field(zh ? '宣傳句（中文，分店頁卡片用）' : 'Pitch (Chinese)', d.pitchZh, (v) => patch(d.slug, { pitchZh: v }))}
                      {field(zh ? '宣傳句（英文）' : 'Pitch (English)', d.pitchEn, (v) => patch(d.slug, { pitchEn: v }))}
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {field(zh ? '套餐價錢 HK$ *' : 'Price HK$ *', d.price, (v) => patch(d.slug, { price: v }), { type: 'number' })}
                      {field(zh ? '可退按金 HK$ *' : 'Refundable deposit HK$ *', d.deposit, (v) => patch(d.slug, { deposit: v }), { type: 'number' })}
                      {field(zh ? '固定時數 *' : 'Hours *', d.durationHours, (v) => patch(d.slug, { durationHours: v }), { type: 'number', step: '0.25' })}
                      {field(zh ? '最少提前幾日預訂' : 'Days of notice', d.minAdvanceDays, (v) => patch(d.slug, { minAdvanceDays: v }), { type: 'number', placeholder: '0' })}
                      {field(zh ? '最早開始時間 *' : 'Earliest start *', d.earliestStart, (v) => patch(d.slug, { earliestStart: v }), { placeholder: '08:00' })}
                      {field(zh ? '最遲完結時間（留空＝24 小時場）' : 'Latest end (blank = 24h venue)', d.latestEnd, (v) => patch(d.slug, { latestEnd: v }), { placeholder: '17:00' })}
                      {field(zh ? '包幾多人（留空＝不限人頭）' : 'Guests included (blank = unlimited)', d.basePax, (v) => patch(d.slug, { basePax: v }), { type: 'number' })}
                      {field(zh ? '每位額外客人 HK$' : 'Per extra guest HK$', d.extraPaxPrice, (v) => patch(d.slug, { extraPaxPrice: v }), { type: 'number' })}
                    </div>

                    <div>
                      <div className="text-xs text-gray-500 mb-1">{zh ? '適用日子' : 'Days available'}</div>
                      <div className="flex flex-wrap gap-2">
                        {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                          <label key={day} className={`px-3 py-1.5 rounded-pill border text-xs cursor-pointer ${d.days.includes(day) ? 'bg-pink text-white border-pink' : 'bg-white'}`}>
                            <input type="checkbox" className="hidden" checked={d.days.includes(day)} onChange={(e) => patch(d.slug, { days: e.target.checked ? [...d.days, day].sort() : d.days.filter((x) => x !== day) })} />
                            {zh ? `星期${DAYS_ZH[day]}` : DAYS_EN[day]}
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-gray-500 mb-1">{zh ? '包含項目（一行一項，中文｜英文）' : 'Inclusions (one per row, Chinese | English)'}</div>
                      <div className="space-y-1.5">
                        {d.includes.map((row, j) => (
                          <div key={j} className="grid grid-cols-[1fr,1fr,2rem] gap-2 items-center">
                            <input value={row.zh} onChange={(e) => patch(d.slug, { includes: d.includes.map((x, k) => (k === j ? { ...x, zh: e.target.value } : x)) })} placeholder={zh ? '中文' : 'Chinese'} className={INPUT} />
                            <input value={row.en} onChange={(e) => patch(d.slug, { includes: d.includes.map((x, k) => (k === j ? { ...x, en: e.target.value } : x)) })} placeholder={zh ? 'English（留空＝用中文）' : 'English (blank = Chinese)'} className={INPUT} />
                            <button type="button" onClick={() => patch(d.slug, { includes: d.includes.filter((_, k) => k !== j) })} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        ))}
                      </div>
                      <button type="button" onClick={() => patch(d.slug, { includes: [...d.includes, { zh: '', en: '' }] })} className="mt-2 text-sm text-pink hover:underline inline-flex items-center gap-1"><Plus className="w-4 h-4" />{zh ? '新增一項' : 'Add row'}</button>
                    </div>

                    <div>
                      <div className="text-xs text-gray-500 mb-1">{zh ? '每位加購（套餐頁剔選，按人數計）' : 'Per-head add-ons (ticked on the package page)'}</div>
                      <div className="space-y-1.5">
                        {d.addOns.map((a, j) => {
                          const set = (p: Partial<AddOnRow>) => patch(d.slug, { addOns: d.addOns.map((x, k) => (k === j ? { ...x, ...p } : x)) });
                          return (
                            <div key={j} className="grid grid-cols-2 md:grid-cols-[6rem,1fr,1fr,1fr,1fr,6rem,2rem] gap-2 items-center rounded-lg bg-gray-50 p-1.5">
                              <input value={a.id} onChange={(e) => set({ id: e.target.value })} placeholder="bbq" className={`${INPUT} font-mono`} />
                              <input value={a.zh} onChange={(e) => set({ zh: e.target.value })} placeholder={zh ? '中文名' : 'Chinese'} className={INPUT} />
                              <input value={a.en} onChange={(e) => set({ en: e.target.value })} placeholder="English" className={INPUT} />
                              <input value={a.descZh} onChange={(e) => set({ descZh: e.target.value })} placeholder={zh ? '簡介（中文）' : 'Description (zh)'} className={INPUT} />
                              <input value={a.descEn} onChange={(e) => set({ descEn: e.target.value })} placeholder={zh ? '簡介（英文）' : 'Description (en)'} className={INPUT} />
                              <input type="number" value={a.price} onChange={(e) => set({ price: e.target.value })} placeholder={zh ? '每位 $' : '$/pax'} className={INPUT} />
                              <button type="button" onClick={() => patch(d.slug, { addOns: d.addOns.filter((_, k) => k !== j) })} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                          );
                        })}
                      </div>
                      <button type="button" onClick={() => patch(d.slug, { addOns: [...d.addOns, { id: '', zh: '', en: '', descZh: '', descEn: '', price: '' }] })} className="mt-2 text-sm text-pink hover:underline inline-flex items-center gap-1"><Plus className="w-4 h-4" />{zh ? '新增加購' : 'Add add-on'}</button>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
                      <button type="button" onClick={() => duplicate(d)} className="text-sm text-pink hover:underline inline-flex items-center gap-1"><Copy className="w-4 h-4" />{zh ? '複製到另一分店' : 'Duplicate for another branch'}</button>
                      {d.isNew
                        ? <button type="button" onClick={() => remove(d)} className="text-sm text-red-600 hover:underline inline-flex items-center gap-1"><Trash2 className="w-4 h-4" />{zh ? '取消新增' : 'Discard'}</button>
                        : <span className="text-xs text-gray-500">{zh ? '已儲存嘅套餐唔會刪除（舊訂單要靠佢顯示）；唔再賣就取消「發售」。' : 'Saved packages are not deleted (old bookings need them); untick On sale instead.'}</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <button type="button" onClick={addPackage} className="w-full rounded-xl border-2 border-dashed border-pink/40 text-pink hover:bg-pink/5 p-4 text-sm font-semibold inline-flex items-center justify-center gap-2">
            <Plus className="w-4 h-4" />{zh ? '新增套餐' : 'Add a package'}
          </button>

          <div className="sticky bottom-3 bg-white/95 backdrop-blur rounded-xl border p-4 flex flex-wrap items-center gap-3 shadow">
            <button onClick={save} disabled={saving} className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {zh ? '儲存全部套餐' : 'Save all packages'}
            </button>
            {message && <span className={`text-sm ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</span>}
            {!message && problems.length > 0 && <span className="text-sm text-red-600">{problems.join('；')}</span>}
          </div>
        </>
      )}
    </div>
  );
}
