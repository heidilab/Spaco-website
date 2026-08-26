'use client';

// 分店管理 — admin CRUD for the dynamic venues collection. Create a
// venue, fill in details / photos / facilities / pricing, flip it 上架
// and it appears across the site + booking flow (Phase 2 wiring).
// 落架 hides it from the site while keeping all booking history.

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { Venue } from '@/types';
import { loadAllVenues, invalidateVenueCache, emptyVenue } from '@/lib/venueRegistry';
import { amenityLabels, vibeLabels } from '@/lib/venues';
import {
  Store, Plus, ArrowLeft, Loader2, Check, Eye, EyeOff, Upload, X as XIcon, AlertCircle,
} from 'lucide-react';

export default function AdminVenuesPage() {
  const locale = useLocale() as 'zh' | 'en';
  const { hasPermission } = useAuth();
  const canAccess = hasPermission('content');

  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Venue | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const reload = async () => {
    invalidateVenueCache();
    const list = await loadAllVenues();
    setVenues(list);
    setLoading(false);
  };
  useEffect(() => { if (canAccess) reload(); }, [canAccess]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!canAccess) {
    return <div className="p-8 text-ink-soft">{locale === 'zh' ? '冇權限' : 'No permission'}</div>;
  }

  const set = (patch: Partial<Venue>) => setEditing((v) => v ? { ...v, ...patch } : v);

  const handleImageUpload = async (files: FileList | null) => {
    if (!files || !editing) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        const rand = Math.random().toString(36).slice(2, 7);
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const r = storageRef(storage, `venue-images/${editing.id || 'new'}-${Date.now()}-${rand}.${ext}`);
        await uploadBytes(r, file);
        urls.push(await getDownloadURL(r));
      }
      set({ images: [...(editing.images || []), ...urls] });
    } catch (err) {
      setMsg((locale === 'zh' ? '❌ 上載失敗：' : '❌ Upload failed: ') + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setUploading(false);
    }
  };

  const validate = (): string | null => {
    if (!editing) return 'no venue';
    if (!/^[a-z0-9-]{2,24}$/.test(editing.id)) return locale === 'zh' ? '分店 ID 只可用小寫英文/數字/連字號（2-24 字）' : 'Venue ID: lowercase letters/digits/dashes only';
    if (!/^[a-z0-9-]{2,40}$/.test(editing.slug)) return locale === 'zh' ? '網址名 (slug) 只可用小寫英文/數字/連字號' : 'Slug: lowercase letters/digits/dashes only';
    if (!editing.name.zh) return locale === 'zh' ? '請填中文名' : 'Chinese name required';
    if (isNew && venues.some((v) => v.id === editing.id)) return locale === 'zh' ? '呢個分店 ID 已存在' : 'Venue ID already exists';
    if (venues.some((v) => v.id !== editing.id && v.slug === editing.slug)) return locale === 'zh' ? '呢個網址名已被其他分店使用' : 'Slug already in use';
    return null;
  };

  const handleSave = async () => {
    if (!editing) return;
    const err = validate();
    if (err) { setMsg(`❌ ${err}`); return; }
    setSaving(true);
    setMsg(null);
    try {
      const { id, ...data } = editing;
      // Strip undefined values — Firestore rejects them.
      const clean = JSON.parse(JSON.stringify(data));
      await setDoc(doc(db, 'venues', id), {
        ...clean,
        updatedAt: serverTimestamp(),
        ...(isNew ? { createdAt: serverTimestamp() } : {}),
      }, { merge: true });
      setMsg(locale === 'zh' ? '✓ 已儲存' : '✓ Saved');
      setEditing(null);
      setIsNew(false);
      await reload();
    } catch (e) {
      setMsg((locale === 'zh' ? '❌ 儲存失敗：' : '❌ Save failed: ') + (e instanceof Error ? e.message : 'unknown'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (v: Venue) => {
    const goingDown = v.active !== false;
    if (goingDown && !window.confirm(locale === 'zh'
      ? `確定要落架「${v.name.zh}」？分店會即時從網站消失、唔接受新預訂。歷史訂單唔受影響，可以隨時重新上架。`
      : `Take "${v.name.en || v.name.zh}" offline? It disappears from the site immediately; history is kept.`)) return;
    await setDoc(doc(db, 'venues', v.id), { active: !goingDown ? true : false, updatedAt: serverTimestamp() }, { merge: true });
    await reload();
  };

  // ── Editor ──
  if (editing) {
    const otherVenues = venues.filter((v) => v.id !== editing.id);
    const inputCls = 'w-full px-3 py-2 rounded-xl border border-charcoal/15 bg-white text-sm';
    const labelCls = 'block text-xs font-semibold text-ink-soft mb-1';
    return (
      <div className="p-6 md:p-8 max-w-3xl">
        <button onClick={() => { setEditing(null); setIsNew(false); setMsg(null); }} className="flex items-center gap-2 text-sm text-muted hover:text-charcoal mb-5">
          <ArrowLeft size={16} /> {locale === 'zh' ? '返回分店列表' : 'Back'}
        </button>
        <h1 className="text-2xl font-bold mb-5 flex items-center gap-2">
          <Store className="text-accent" size={24} />
          {isNew ? (locale === 'zh' ? '新增分店' : 'New venue') : `${editing.name.zh || editing.id}`}
        </h1>

        <div className="space-y-5">
          {/* Identity */}
          <div className="glass-card p-5 space-y-3">
            <p className="font-bold text-sm">{locale === 'zh' ? '基本資料' : 'Basics'}</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>{locale === 'zh' ? '分店 ID（儲存後不可改）' : 'Venue ID (permanent)'}</label>
                <input value={editing.id} disabled={!isNew} onChange={(e) => set({ id: e.target.value.toLowerCase() })} placeholder="mongkok" className={`${inputCls} font-mono disabled:bg-charcoal/5`} />
              </div>
              <div>
                <label className={labelCls}>{locale === 'zh' ? '網址名 (slug)' : 'URL slug'}</label>
                <input value={editing.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase() })} placeholder="mong-kok" className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label className={labelCls}>中文名</label>
                <input value={editing.name.zh} onChange={(e) => set({ name: { ...editing.name, zh: e.target.value } })} placeholder="旺角店" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>English name</label>
                <input value={editing.name.en} onChange={(e) => set({ name: { ...editing.name, en: e.target.value } })} placeholder="Mong Kok" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{locale === 'zh' ? '短代號（日曆顯示）' : 'Short tag'}</label>
                <input value={editing.branch} onChange={(e) => set({ branch: e.target.value.toUpperCase() })} placeholder="MK" className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label className={labelCls}>{locale === 'zh' ? '面積' : 'Size'}</label>
                <input value={editing.size} onChange={(e) => set({ size: e.target.value })} placeholder="1,500 sq ft" className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>{locale === 'zh' ? '中文地址' : 'Address (zh)'}</label>
              <input value={editing.address.zh} onChange={(e) => set({ address: { ...editing.address, zh: e.target.value } })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>English address</label>
              <input value={editing.address.en} onChange={(e) => set({ address: { ...editing.address, en: e.target.value } })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{locale === 'zh' ? '中文介紹' : 'Description (zh)'}</label>
              <textarea value={editing.description.zh} onChange={(e) => set({ description: { ...editing.description, zh: e.target.value } })} rows={2} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>English description</label>
              <textarea value={editing.description.en} onChange={(e) => set({ description: { ...editing.description, en: e.target.value } })} rows={2} className={inputCls} />
            </div>
          </div>

          {/* Photos */}
          <div className="glass-card p-5 space-y-3">
            <p className="font-bold text-sm">{locale === 'zh' ? '相片（第一張係封面）' : 'Photos (first = cover)'}</p>
            <div className="flex flex-wrap gap-3">
              {(editing.images || []).map((url, i) => (
                <div key={i} className="relative w-28 h-20 rounded-xl overflow-hidden border border-charcoal/10 group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => set({ images: editing.images.filter((_, j) => j !== i) })}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100"
                  ><XIcon size={11} /></button>
                  {i > 0 && (
                    <button
                      onClick={() => {
                        const arr = [...editing.images];
                        [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
                        set({ images: arr });
                      }}
                      className="absolute bottom-1 left-1 px-1.5 rounded bg-black/60 text-white text-[10px] opacity-0 group-hover:opacity-100"
                    >←</button>
                  )}
                </div>
              ))}
              <label className="w-28 h-20 rounded-xl border-2 border-dashed border-charcoal/20 flex flex-col items-center justify-center cursor-pointer text-ink-soft hover:border-accent hover:text-accent">
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                <span className="text-[10px] mt-1">{locale === 'zh' ? '上載' : 'Upload'}</span>
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleImageUpload(e.target.files)} />
              </label>
            </div>
          </div>

          {/* Facilities + vibes */}
          <div className="glass-card p-5 space-y-3">
            <p className="font-bold text-sm">{locale === 'zh' ? '設施' : 'Facilities'}</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(amenityLabels).map(([key, lbl]) => (
                <button key={key} type="button"
                  onClick={() => set({ amenities: editing.amenities.includes(key) ? editing.amenities.filter((a) => a !== key) : [...editing.amenities, key] })}
                  className={`px-3 py-1.5 rounded-pill text-xs font-semibold border ${editing.amenities.includes(key) ? 'bg-accent text-white border-accent' : 'border-charcoal/15 text-ink-soft'}`}>
                  {lbl[locale]}
                </button>
              ))}
            </div>
            <p className="font-bold text-sm pt-2">{locale === 'zh' ? '適合場合' : 'Vibes'}</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(vibeLabels).map(([key, lbl]) => (
                <button key={key} type="button"
                  onClick={() => set({ vibes: editing.vibes.includes(key) ? editing.vibes.filter((a) => a !== key) : [...editing.vibes, key] })}
                  className={`px-3 py-1.5 rounded-pill text-xs font-semibold border ${editing.vibes.includes(key) ? 'bg-pink text-white border-pink' : 'border-charcoal/15 text-ink-soft'}`}>
                  {lbl[locale]}
                </button>
              ))}
            </div>
          </div>

          {/* Pricing + capacity */}
          <div className="glass-card p-5 space-y-3">
            <p className="font-bold text-sm">{locale === 'zh' ? '收費與人數' : 'Pricing & capacity'}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {([
                { label: locale === 'zh' ? '平日每位/小時 $' : 'Weekday $/head/hr', value: editing.pricing.weekday.perHead, on: (n: number) => set({ pricing: { ...editing.pricing, weekday: { perHead: n } } }) },
                { label: locale === 'zh' ? '週末每位/小時 $' : 'Weekend $/head/hr', value: editing.pricing.weekend.perHead, on: (n: number) => set({ pricing: { ...editing.pricing, weekend: { perHead: n } } }) },
                { label: locale === 'zh' ? '平日最少鐘數' : 'Weekday min hrs', value: editing.minHours.weekday, on: (n: number) => set({ minHours: { ...editing.minHours, weekday: n } }) },
                { label: locale === 'zh' ? '週末最少鐘數' : 'Weekend min hrs', value: editing.minHours.weekend, on: (n: number) => set({ minHours: { ...editing.minHours, weekend: n } }) },
                { label: locale === 'zh' ? '平日最少人數' : 'Weekday min pax', value: editing.minGuests.weekday, on: (n: number) => set({ minGuests: { ...editing.minGuests, weekday: n } }) },
                { label: locale === 'zh' ? '週末最少人數' : 'Weekend min pax', value: editing.minGuests.weekend, on: (n: number) => set({ minGuests: { ...editing.minGuests, weekend: n } }) },
                { label: locale === 'zh' ? '最少容納' : 'Capacity min', value: editing.capacity.min, on: (n: number) => set({ capacity: { ...editing.capacity, min: n } }) },
                { label: locale === 'zh' ? '最多容納' : 'Capacity max', value: editing.capacity.max, on: (n: number) => set({ capacity: { ...editing.capacity, max: n } }) },
              ]).map((f, i) => (
                <div key={i}>
                  <label className={labelCls}>{f.label}</label>
                  <input type="number" value={f.value} onChange={(e) => f.on(Math.max(0, parseInt(e.target.value, 10) || 0))} className={inputCls} />
                </div>
              ))}
            </div>
          </div>

          {/* Venue-specific rules */}
          <div className="glass-card p-5 space-y-3">
            <p className="font-bold text-sm">{locale === 'zh' ? '分店專屬設定' : 'Venue rules'}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.bbqAvailable !== false} onChange={(e) => set({ bbqAvailable: e.target.checked })} className="accent-accent" />
                {locale === 'zh' ? '提供 BBQ' : 'BBQ available'}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!editing.drinksIncluded} onChange={(e) => set({ drinksIncluded: e.target.checked })} className="accent-accent" />
                {locale === 'zh' ? '已包無酒精飲品任飲' : 'Drinks included'}
              </label>
              <div>
                <label className={labelCls}>{locale === 'zh' ? '提早入場佈置 $/小時' : 'Early setup $/hr'}</label>
                <input type="number" value={editing.earlySetupPricePerHour ?? 500} onChange={(e) => set({ earlySetupPricePerHour: Math.max(0, parseInt(e.target.value, 10) || 0) })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{locale === 'zh' ? 'BBQ 標準套餐每位 $' : 'BBQ standard $/head'}</label>
                <input type="number" value={editing.bbqStandardPrice ?? 158} onChange={(e) => set({ bbqStandardPrice: Math.max(0, parseInt(e.target.value, 10) || 0) })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{locale === 'zh' ? '顯示次序（細=前）' : 'Sort order'}</label>
                <input type="number" value={editing.sortOrder ?? 99} onChange={(e) => set({ sortOrder: Math.max(0, parseInt(e.target.value, 10) || 0) })} className={inputCls} />
              </div>
            </div>
          </div>

          {/* Shared space (上環-style room group) */}
          <div className="glass-card p-5 space-y-3">
            <p className="font-bold text-sm">{locale === 'zh' ? '同一實體空間（房間組合）' : 'Shared physical space'}</p>
            <p className="text-xs text-ink-soft -mt-1">
              {locale === 'zh'
                ? '上環模式：一層樓拆做 Room A / Room B / 全層三個「分店」。填相同嘅空間組名，再剔選「邊啲分店訂咗會霸住本店」，系統就會互相封時段。獨立分店留空即可。'
                : 'SW model: one floor split into rooms. Same group key + tick which venues block this one. Leave empty for standalone venues.'}
            </p>
            <div>
              <label className={labelCls}>{locale === 'zh' ? '空間組名（例如 sw-physical）' : 'Space group key'}</label>
              <input value={editing.spaceGroup || ''} onChange={(e) => set({ spaceGroup: e.target.value.trim() || undefined })} placeholder="sw-physical" className={`${inputCls} font-mono`} />
            </div>
            {editing.spaceGroup && (
              <div>
                <label className={labelCls}>{locale === 'zh' ? '呢啲分店訂咗會封埋本店時段：' : 'Bookings at these venues block this one:'}</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {otherVenues.map((v) => (
                    <button key={v.id} type="button"
                      onClick={() => {
                        const cur = editing.conflictsWith || [];
                        set({ conflictsWith: cur.includes(v.id) ? cur.filter((c) => c !== v.id) : [...cur, v.id] });
                      }}
                      className={`px-3 py-1.5 rounded-pill text-xs font-semibold border ${(editing.conflictsWith || []).includes(v.id) ? 'bg-amber-500 text-white border-amber-500' : 'border-charcoal/15 text-ink-soft'}`}>
                      {v.name.zh || v.id}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Integrations */}
          <div className="glass-card p-5 space-y-3">
            <p className="font-bold text-sm">{locale === 'zh' ? '連接設定（可留空，遲啲補）' : 'Integrations (optional)'}</p>
            <div>
              <label className={labelCls}>Google Calendar ID</label>
              <input value={editing.gcalCalendarId || ''} onChange={(e) => set({ gcalCalendarId: e.target.value.trim() || undefined })} placeholder="xxxx@group.calendar.google.com" className={`${inputCls} font-mono`} />
              <p className="text-[11px] text-ink-soft mt-1">{locale === 'zh' ? '留空 = 呢間分店唔同步 Google Calendar' : 'Empty = no gcal sync for this venue'}</p>
            </div>
            <div>
              <label className={labelCls}>TTLock Lock ID</label>
              <input value={editing.ttlockLockId || ''} onChange={(e) => set({ ttlockLockId: e.target.value.trim() || undefined })} placeholder="1234567" className={`${inputCls} font-mono`} />
              <p className="text-[11px] text-ink-soft mt-1">{locale === 'zh' ? '留空 = 唔自動發門鎖密碼' : 'Empty = no auto door passcodes'}</p>
            </div>
          </div>

          {msg && <p className="text-sm">{msg}</p>}
          <button
            onClick={handleSave}
            disabled={saving || uploading}
            className="w-full py-3 rounded-xl bg-gradient-pink text-white font-bold disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {locale === 'zh' ? '儲存分店' : 'Save venue'}
          </button>
          {isNew && (
            <p className="text-xs text-amber-700 flex items-start gap-1.5">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              {locale === 'zh'
                ? '新分店儲存後預設係「落架」狀態——你檢查妥當之後，返去列表撳「上架」先會喺網站出現。'
                : 'New venues save as OFFLINE — flip them online from the list when ready.'}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── List ──
  return (
    <div className="p-6 md:p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Store className="text-accent" size={24} />
          {locale === 'zh' ? '分店管理' : 'Venues'}
        </h1>
        <button
          onClick={() => { setEditing(emptyVenue()); setIsNew(true); setMsg(null); }}
          className="px-4 py-2 rounded-xl bg-gradient-pink text-white text-sm font-bold flex items-center gap-1.5"
        >
          <Plus size={14} /> {locale === 'zh' ? '新增分店' : 'New venue'}
        </button>
      </div>

      {msg && <p className="text-sm mb-4">{msg}</p>}
      {loading ? (
        <div className="animate-pulse text-muted">Loading…</div>
      ) : (
        <div className="space-y-3">
          {venues.map((v) => (
            <div key={v.id} className={`glass-card p-4 flex items-center gap-4 ${v.active === false ? 'opacity-60' : ''}`}>
              {v.images?.[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={v.images[0]} alt="" className="w-16 h-12 rounded-lg object-cover shrink-0" />
              ) : (
                <div className="w-16 h-12 rounded-lg bg-charcoal/10 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-bold truncate">
                  {v.name.zh}
                  <span className="text-xs text-ink-soft font-mono ml-2">{v.id}</span>
                  {v.spaceGroup && (
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{locale === 'zh' ? '房間組合' : 'room group'}: {v.spaceGroup}</span>
                  )}
                </p>
                <p className="text-xs text-ink-soft truncate">
                  ${v.pricing.weekday.perHead}/${v.pricing.weekend.perHead} · {v.capacity.min}–{v.capacity.max}人
                  {v.active === false && <span className="text-rose-600 font-bold ml-2">{locale === 'zh' ? '已落架' : 'OFFLINE'}</span>}
                </p>
              </div>
              <button
                onClick={() => toggleActive(v)}
                className={`px-3 py-1.5 rounded-pill text-xs font-bold flex items-center gap-1 ${v.active === false ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}
              >
                {v.active === false ? <><Eye size={12} /> {locale === 'zh' ? '上架' : 'Go live'}</> : <><EyeOff size={12} /> {locale === 'zh' ? '落架' : 'Take offline'}</>}
              </button>
              <button
                onClick={() => { setEditing({ ...emptyVenue(), ...v }); setIsNew(false); setMsg(null); }}
                className="px-3 py-1.5 rounded-pill text-xs font-bold bg-pink/10 text-pink hover:bg-pink/20"
              >
                {locale === 'zh' ? '編輯' : 'Edit'}
              </button>
            </div>
          ))}
          {venues.length === 0 && (
            <p className="text-ink-soft text-sm">{locale === 'zh' ? '未有分店數據（未 seed）' : 'No venues yet'}</p>
          )}
        </div>
      )}
      <p className="text-xs text-ink-soft mt-5 leading-relaxed">
        {locale === 'zh'
          ? '※ 「落架」唔會刪除任何歷史訂單／收據，只係由網站消失同停收新預訂；可隨時重新上架。新增分店後記得補返 Google Calendar ID 同門鎖 ID，先有埋自動同步／門鎖密碼功能。'
          : '※ Taking a venue offline keeps all booking history. Fill gcal / lock IDs for sync + auto passcodes.'}
      </p>
    </div>
  );
}
