'use client';

// 分店管理 — branch-centric CRUD over the venues collection.
//
// Model (Heidi's 2026-08 spec): a 分店 (branch) owns one or more
// 分拆場地 (bookable spaces / rooms). SW = ONE branch with Room A /
// Room B / 全層. Branch-level fields (name, address, Google Calendar
// ID) are edited once and written onto every room doc; per-room fields
// (pricing, capacity, photos, lock id, conflicts) live on each room.
// Underlying booking system is unchanged — each room is still its own
// venue doc / venueId.

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { Venue } from '@/types';
import { loadAllVenues, invalidateVenueCache, emptyVenue } from '@/lib/venueRegistry';
import { amenityLabels, vibeLabels } from '@/lib/venues';
import {
  Store, Plus, ArrowLeft, Loader2, Check, Eye, EyeOff, Upload, X as XIcon,
  AlertCircle, ChevronDown, ChevronUp, DoorOpen,
} from 'lucide-react';

interface BranchShared {
  key: string;
  branchName: { zh: string; en: string };
  address: { zh: string; en: string };
  gcalCalendarId: string;
  branchTag: string;
}

const inputCls = 'w-full px-3 py-2 rounded-xl border border-charcoal/15 bg-white text-sm';
const labelCls = 'block text-xs font-semibold text-ink-soft mb-1';

export default function AdminVenuesPage() {
  const locale = useLocale() as 'zh' | 'en';
  const { hasPermission } = useAuth();
  const canAccess = hasPermission('content');

  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [uploadingRoom, setUploadingRoom] = useState<string | null>(null);

  // Branch editor state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [isNewBranch, setIsNewBranch] = useState(false);
  const [shared, setShared] = useState<BranchShared | null>(null);
  const [rooms, setRooms] = useState<Venue[]>([]);
  const [newRoomIds, setNewRoomIds] = useState<Set<string>>(new Set());
  const [openRoom, setOpenRoom] = useState<number>(0);

  const reload = async () => {
    invalidateVenueCache();
    const list = await loadAllVenues();
    setVenues(list);
    setLoading(false);
  };
  useEffect(() => { if (canAccess) reload(); }, [canAccess]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const map = new Map<string, Venue[]>();
    for (const v of venues) {
      const k = v.branchKey || v.id;
      map.set(k, [...(map.get(k) || []), v]);
    }
    return Array.from(map.entries())
      .map(([key, rms]) => ({
        key,
        rooms: rms.sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99)),
      }))
      .sort((a, b) => (a.rooms[0].sortOrder ?? 99) - (b.rooms[0].sortOrder ?? 99));
  }, [venues]);

  if (!canAccess) {
    return <div className="p-8 text-ink-soft">{locale === 'zh' ? '冇權限' : 'No permission'}</div>;
  }

  // ── open / create ──
  const openBranch = (key: string, rms: Venue[]) => {
    const first = rms[0];
    setEditingKey(key);
    setIsNewBranch(false);
    setNewRoomIds(new Set());
    setOpenRoom(0);
    setMsg(null);
    setShared({
      key,
      branchName: first.branchName || first.name,
      address: { ...first.address },
      gcalCalendarId: first.gcalCalendarId || '',
      branchTag: first.branch || '',
    });
    setRooms(rms.map((r) => ({ ...emptyVenue(), ...r })));
  };

  const newBranch = () => {
    const room = emptyVenue();
    setEditingKey('');
    setIsNewBranch(true);
    setNewRoomIds(new Set(['__room0__']));
    setOpenRoom(0);
    setMsg(null);
    setShared({ key: '', branchName: { zh: '', en: '' }, address: { zh: '', en: '' }, gcalCalendarId: '', branchTag: '' });
    setRooms([room]);
  };

  const addRoom = () => {
    if (!shared) return;
    const room = emptyVenue();
    room.roomLabel = { zh: '', en: '' };
    // Inherit sensible defaults from the first room.
    if (rooms[0]) {
      room.pricing = JSON.parse(JSON.stringify(rooms[0].pricing));
      room.minHours = { ...rooms[0].minHours };
      room.vibes = [...rooms[0].vibes];
    }
    setRooms((prev) => [...prev, room]);
    setNewRoomIds((prev) => new Set(prev).add(`__room${rooms.length}__`));
    setOpenRoom(rooms.length);
  };

  const setRoom = (idx: number, patch: Partial<Venue>) =>
    setRooms((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const uploadRoomImages = async (idx: number, files: FileList | null) => {
    if (!files) return;
    setUploadingRoom(String(idx));
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        const rand = Math.random().toString(36).slice(2, 7);
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const r = storageRef(storage, `venue-images/${rooms[idx].id || 'new'}-${Date.now()}-${rand}.${ext}`);
        await uploadBytes(r, file);
        urls.push(await getDownloadURL(r));
      }
      setRoom(idx, { images: [...(rooms[idx].images || []), ...urls] });
    } catch (err) {
      setMsg((locale === 'zh' ? '❌ 上載失敗：' : '❌ Upload failed: ') + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setUploadingRoom(null);
    }
  };

  // ── save ──
  const validate = (): string | null => {
    if (!shared) return 'no branch';
    const key = shared.key.trim();
    if (!/^[a-z0-9-]{2,24}$/.test(key)) return locale === 'zh' ? '分店代號只可用小寫英文/數字/連字號（2-24 字）' : 'Branch key: lowercase/digits/dashes';
    if (!shared.branchName.zh) return locale === 'zh' ? '請填分店中文名' : 'Branch Chinese name required';
    if (isNewBranch && venues.some((v) => (v.branchKey || v.id) === key)) return locale === 'zh' ? '呢個分店代號已存在' : 'Branch key exists';
    for (const [i, r] of Array.from(rooms.entries())) {
      const label = rooms.length > 1 ? `場地 ${i + 1}` : '場地';
      if (!/^[a-z0-9-]{2,24}$/.test(r.id)) return locale === 'zh' ? `${label}：ID 只可用小寫英文/數字/連字號` : `Room ${i + 1}: bad id`;
      if (!/^[a-z0-9-]{2,40}$/.test(r.slug)) return locale === 'zh' ? `${label}：網址名格式錯` : `Room ${i + 1}: bad slug`;
      if (!r.name.zh) return locale === 'zh' ? `${label}：請填場地中文名` : `Room ${i + 1}: zh name required`;
      const isNewRoom = !venues.some((v) => v.id === r.id);
      if (isNewRoom && venues.some((v) => v.id === r.id)) return `${label}: id exists`;
      if (venues.some((v) => v.id !== r.id && v.slug === r.slug) || rooms.some((o, j) => j !== i && o.slug === r.slug)) {
        return locale === 'zh' ? `${label}：網址名已被使用` : `Room ${i + 1}: slug in use`;
      }
      if (rooms.some((o, j) => j !== i && o.id === r.id)) return locale === 'zh' ? `${label}：ID 重複` : `Room ${i + 1}: duplicate id`;
    }
    return null;
  };

  const handleSave = async () => {
    if (!shared) return;
    const err = validate();
    if (err) { setMsg(`❌ ${err}`); return; }
    setSaving(true);
    setMsg(null);
    try {
      const key = shared.key.trim();
      const multi = rooms.length > 1;
      for (const r of rooms) {
        const { id, ...data } = r;
        const docData: Record<string, unknown> = {
          ...JSON.parse(JSON.stringify(data)),
          // Branch-shared fields — written onto every room so all
          // consumers (emails, calendar, lock flow) see one truth.
          branchKey: key,
          branchName: shared.branchName,
          address: shared.address,
          branch: shared.branchTag || shared.branchName.en?.slice(0, 4).toUpperCase() || key.toUpperCase(),
          gcalCalendarId: shared.gcalCalendarId.trim() || null,
          // Multi-room branches automatically share one physical-space
          // group so the availability logic (上環模式) engages.
          spaceGroup: multi ? (r.spaceGroup || `${key}-physical`) : null,
          updatedAt: serverTimestamp(),
        };
        if (docData.gcalCalendarId === null) delete docData.gcalCalendarId;
        if (docData.spaceGroup === null) delete docData.spaceGroup;
        const isNewRoom = !venues.some((v) => v.id === id);
        if (isNewRoom) docData.createdAt = serverTimestamp();
        await setDoc(doc(db, 'venues', id), docData, { merge: true });
      }
      setMsg(locale === 'zh' ? '✓ 已儲存' : '✓ Saved');
      setEditingKey(null);
      setShared(null);
      await reload();
    } catch (e) {
      setMsg((locale === 'zh' ? '❌ 儲存失敗：' : '❌ Save failed: ') + (e instanceof Error ? e.message : 'unknown'));
    } finally {
      setSaving(false);
    }
  };

  const toggleBranchActive = async (rms: Venue[]) => {
    const goingDown = rms.some((r) => r.active !== false);
    const name = rms[0].branchName?.zh || rms[0].name.zh;
    if (goingDown && !window.confirm(locale === 'zh'
      ? `確定要落架「${name}」成間分店（${rms.length} 個場地）？會即時從網站消失、停收新預訂。歷史訂單不受影響，可隨時重新上架。`
      : `Take branch "${name}" (${rms.length} space(s)) offline?`)) return;
    for (const r of rms) {
      await setDoc(doc(db, 'venues', r.id), { active: !goingDown, updatedAt: serverTimestamp() }, { merge: true });
    }
    await reload();
  };

  // ═══════════ Branch editor ═══════════
  if (shared) {
    return (
      <div className="p-6 md:p-8 max-w-3xl">
        <button onClick={() => { setShared(null); setEditingKey(null); setMsg(null); }} className="flex items-center gap-2 text-sm text-muted hover:text-charcoal mb-5">
          <ArrowLeft size={16} /> {locale === 'zh' ? '返回分店列表' : 'Back'}
        </button>
        <h1 className="text-2xl font-bold mb-5 flex items-center gap-2">
          <Store className="text-accent" size={24} />
          {isNewBranch ? (locale === 'zh' ? '新增分店' : 'New branch') : (shared.branchName.zh || shared.key)}
        </h1>

        <div className="space-y-5">
          {/* ── Branch-shared fields ── */}
          <div className="glass-card p-5 space-y-3 border-2 border-accent/30">
            <p className="font-bold text-sm">{locale === 'zh' ? '分店共用資料（全部場地共用）' : 'Branch-shared info'}</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>{locale === 'zh' ? '分店代號（儲存後不可改）' : 'Branch key (permanent)'}</label>
                <input value={shared.key} disabled={!isNewBranch}
                  onChange={(e) => setShared({ ...shared, key: e.target.value.toLowerCase() })}
                  placeholder="mong-kok" className={`${inputCls} font-mono disabled:bg-charcoal/5`} />
              </div>
              <div>
                <label className={labelCls}>{locale === 'zh' ? '短代號（日曆顯示）' : 'Short tag'}</label>
                <input value={shared.branchTag} onChange={(e) => setShared({ ...shared, branchTag: e.target.value.toUpperCase() })} placeholder="MK" className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label className={labelCls}>{locale === 'zh' ? '分店中文名' : 'Branch name (zh)'}</label>
                <input value={shared.branchName.zh} onChange={(e) => setShared({ ...shared, branchName: { ...shared.branchName, zh: e.target.value } })} placeholder="旺角店" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Branch name (en)</label>
                <input value={shared.branchName.en} onChange={(e) => setShared({ ...shared, branchName: { ...shared.branchName, en: e.target.value } })} placeholder="Mong Kok" className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>{locale === 'zh' ? '中文地址' : 'Address (zh)'}</label>
              <input value={shared.address.zh} onChange={(e) => setShared({ ...shared, address: { ...shared.address, zh: e.target.value } })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>English address</label>
              <input value={shared.address.en} onChange={(e) => setShared({ ...shared, address: { ...shared.address, en: e.target.value } })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Google Calendar ID（{locale === 'zh' ? '成間分店共用一個' : 'shared by the whole branch'}）</label>
              <input value={shared.gcalCalendarId} onChange={(e) => setShared({ ...shared, gcalCalendarId: e.target.value.trim() })} placeholder="xxxx@group.calendar.google.com" className={`${inputCls} font-mono`} />
              <p className="text-[11px] text-ink-soft mt-1">
                {locale === 'zh' ? '留空 = 呢間分店唔同步 Google Calendar。所有分拆場地嘅 booking 都會入同一個 calendar。' : 'Empty = no gcal sync. All spaces sync into this one calendar.'}
              </p>
            </div>
          </div>

          {/* ── Rooms ── */}
          <div className="flex items-center justify-between">
            <p className="font-bold text-sm flex items-center gap-1.5">
              <DoorOpen size={15} className="text-accent" />
              {locale === 'zh' ? `分拆場地（${rooms.length} 個）` : `Bookable spaces (${rooms.length})`}
            </p>
            <button type="button" onClick={addRoom} className="px-3 py-1.5 rounded-pill text-xs font-bold bg-pink/10 text-pink hover:bg-pink/20 flex items-center gap-1">
              <Plus size={12} /> {locale === 'zh' ? '新增分拆場地' : 'Add space'}
            </button>
          </div>
          {rooms.length === 1 && (
            <p className="text-xs text-ink-soft -mt-2">
              {locale === 'zh' ? '單一場地分店。如果呢間分店可以拆房分開租（好似上環咁），撳「新增分拆場地」。' : 'Single-space branch. Add spaces to enable the SW-style split model.'}
            </p>
          )}

          {rooms.map((r, i) => {
            const isOpen = openRoom === i;
            const isNewRoom = !venues.some((v) => v.id === r.id);
            const siblings = rooms.filter((_, j) => j !== i);
            const roomTitle = rooms.length > 1
              ? (r.roomLabel?.zh || r.name.zh || `${locale === 'zh' ? '場地' : 'Space'} ${i + 1}`)
              : (locale === 'zh' ? '場地設定' : 'Space settings');
            return (
              <div key={i} className={`glass-card overflow-hidden ${r.active === false ? 'opacity-70' : ''}`}>
                <button type="button" onClick={() => setOpenRoom(isOpen ? -1 : i)}
                  className="w-full flex items-center justify-between px-5 py-3.5 text-left">
                  <span className="font-bold text-sm flex items-center gap-2">
                    {roomTitle}
                    {r.active === false && <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">{locale === 'zh' ? '已落架' : 'OFF'}</span>}
                    {isNewRoom && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">{locale === 'zh' ? '新' : 'NEW'}</span>}
                  </span>
                  {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
                {isOpen && (
                  <div className="px-5 pb-5 space-y-4 border-t border-charcoal/5 pt-4">
                    {/* Identity */}
                    <div className="grid grid-cols-2 gap-3">
                      {rooms.length > 1 && (
                        <>
                          <div>
                            <label className={labelCls}>{locale === 'zh' ? '場地名（例如 Room A）' : 'Room label (zh)'}</label>
                            <input value={r.roomLabel?.zh || ''} onChange={(e) => setRoom(i, { roomLabel: { ...r.roomLabel, zh: e.target.value } })} placeholder="Room A" className={inputCls} />
                          </div>
                          <div>
                            <label className={labelCls}>Room label (en)</label>
                            <input value={r.roomLabel?.en || ''} onChange={(e) => setRoom(i, { roomLabel: { ...r.roomLabel, en: e.target.value } })} placeholder="Room A" className={inputCls} />
                          </div>
                        </>
                      )}
                      <div>
                        <label className={labelCls}>{locale === 'zh' ? '場地 ID（儲存後不可改）' : 'Space ID (permanent)'}</label>
                        <input value={r.id} disabled={!isNewRoom} onChange={(e) => setRoom(i, { id: e.target.value.toLowerCase() })} placeholder="mk-a" className={`${inputCls} font-mono disabled:bg-charcoal/5`} />
                      </div>
                      <div>
                        <label className={labelCls}>{locale === 'zh' ? '網址名 (slug)' : 'URL slug'}</label>
                        <input value={r.slug} onChange={(e) => setRoom(i, { slug: e.target.value.toLowerCase() })} placeholder="mong-kok-a" className={`${inputCls} font-mono`} />
                      </div>
                      <div>
                        <label className={labelCls}>{locale === 'zh' ? '完整顯示名（中文）' : 'Full display name (zh)'}</label>
                        <input value={r.name.zh} onChange={(e) => setRoom(i, { name: { ...r.name, zh: e.target.value } })} placeholder="旺角店 - Room A" className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Full display name (en)</label>
                        <input value={r.name.en} onChange={(e) => setRoom(i, { name: { ...r.name, en: e.target.value } })} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>{locale === 'zh' ? '面積' : 'Size'}</label>
                        <input value={r.size} onChange={(e) => setRoom(i, { size: e.target.value })} placeholder="1,000 sq ft" className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>{locale === 'zh' ? '顯示次序（細=前）' : 'Sort order'}</label>
                        <input type="number" value={r.sortOrder ?? 99} onChange={(e) => setRoom(i, { sortOrder: Math.max(0, parseInt(e.target.value, 10) || 0) })} className={inputCls} />
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>{locale === 'zh' ? '中文介紹' : 'Description (zh)'}</label>
                      <textarea value={r.description.zh} rows={2} onChange={(e) => setRoom(i, { description: { ...r.description, zh: e.target.value } })} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>English description</label>
                      <textarea value={r.description.en} rows={2} onChange={(e) => setRoom(i, { description: { ...r.description, en: e.target.value } })} className={inputCls} />
                    </div>

                    {/* Photos */}
                    <div>
                      <p className={labelCls}>{locale === 'zh' ? '相片（第一張係封面）' : 'Photos (first = cover)'}</p>
                      <div className="flex flex-wrap gap-3">
                        {(r.images || []).map((url, pi) => (
                          <div key={pi} className="relative w-28 h-20 rounded-xl overflow-hidden border border-charcoal/10 group">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt="" className="w-full h-full object-cover" />
                            <button type="button"
                              onClick={() => setRoom(i, { images: r.images.filter((_, j) => j !== pi) })}
                              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100"
                            ><XIcon size={11} /></button>
                            {pi > 0 && (
                              <button type="button"
                                onClick={() => {
                                  const arr = [...r.images];
                                  [arr[pi - 1], arr[pi]] = [arr[pi], arr[pi - 1]];
                                  setRoom(i, { images: arr });
                                }}
                                className="absolute bottom-1 left-1 px-1.5 rounded bg-black/60 text-white text-[10px] opacity-0 group-hover:opacity-100"
                              >←</button>
                            )}
                          </div>
                        ))}
                        <label className="w-28 h-20 rounded-xl border-2 border-dashed border-charcoal/20 flex flex-col items-center justify-center cursor-pointer text-ink-soft hover:border-accent hover:text-accent">
                          {uploadingRoom === String(i) ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                          <span className="text-[10px] mt-1">{locale === 'zh' ? '上載' : 'Upload'}</span>
                          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => uploadRoomImages(i, e.target.files)} />
                        </label>
                      </div>
                    </div>

                    {/* Pricing & capacity */}
                    <div>
                      <p className={labelCls}>{locale === 'zh' ? '收費與人數' : 'Pricing & capacity'}</p>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {([
                          { label: locale === 'zh' ? '平日每位/小時 $' : 'Wkday $/hd/hr', value: r.pricing.weekday.perHead, on: (n: number) => setRoom(i, { pricing: { ...r.pricing, weekday: { perHead: n } } }) },
                          { label: locale === 'zh' ? '週末每位/小時 $' : 'Wkend $/hd/hr', value: r.pricing.weekend.perHead, on: (n: number) => setRoom(i, { pricing: { ...r.pricing, weekend: { perHead: n } } }) },
                          { label: locale === 'zh' ? '平日最少鐘數' : 'Wkday min hrs', value: r.minHours.weekday, on: (n: number) => setRoom(i, { minHours: { ...r.minHours, weekday: n } }) },
                          { label: locale === 'zh' ? '週末最少鐘數' : 'Wkend min hrs', value: r.minHours.weekend, on: (n: number) => setRoom(i, { minHours: { ...r.minHours, weekend: n } }) },
                          { label: locale === 'zh' ? '平日最少人數' : 'Wkday min pax', value: r.minGuests.weekday, on: (n: number) => setRoom(i, { minGuests: { ...r.minGuests, weekday: n } }) },
                          { label: locale === 'zh' ? '週末最少人數' : 'Wkend min pax', value: r.minGuests.weekend, on: (n: number) => setRoom(i, { minGuests: { ...r.minGuests, weekend: n } }) },
                          { label: locale === 'zh' ? '最少容納' : 'Cap min', value: r.capacity.min, on: (n: number) => setRoom(i, { capacity: { ...r.capacity, min: n } }) },
                          { label: locale === 'zh' ? '最多容納' : 'Cap max', value: r.capacity.max, on: (n: number) => setRoom(i, { capacity: { ...r.capacity, max: n } }) },
                        ]).map((f, fi) => (
                          <div key={fi}>
                            <label className={labelCls}>{f.label}</label>
                            <input type="number" value={f.value} onChange={(e) => f.on(Math.max(0, parseInt(e.target.value, 10) || 0))} className={inputCls} />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Facilities / vibes / games */}
                    <div>
                      <p className={labelCls}>{locale === 'zh' ? '設施' : 'Facilities'}</p>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(amenityLabels).map(([key2, lbl]) => (
                          <button key={key2} type="button"
                            onClick={() => setRoom(i, { amenities: r.amenities.includes(key2) ? r.amenities.filter((a) => a !== key2) : [...r.amenities, key2] })}
                            className={`px-3 py-1.5 rounded-pill text-xs font-semibold border ${r.amenities.includes(key2) ? 'bg-accent text-white border-accent' : 'border-charcoal/15 text-ink-soft'}`}>
                            {lbl[locale]}
                          </button>
                        ))}
                      </div>
                      <label className={`${labelCls} mt-2`}>{locale === 'zh' ? '設施文字列表（顯示用；「、」或換行分隔；留空用上面剔選）' : 'Facilities text (optional)'}</label>
                      <textarea value={r.amenitiesText?.zh || ''} rows={2} onChange={(e) => setRoom(i, { amenitiesText: { ...r.amenitiesText, zh: e.target.value } })} className={inputCls} />
                      <textarea value={r.amenitiesText?.en || ''} rows={2} placeholder="English" onChange={(e) => setRoom(i, { amenitiesText: { ...r.amenitiesText, en: e.target.value } })} className={`${inputCls} mt-2`} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>{locale === 'zh' ? 'Switch 遊戲（每行一個 zh / en）' : 'Switch games'}</label>
                        <textarea value={r.switchGames?.zh || ''} rows={3} onChange={(e) => setRoom(i, { switchGames: { ...r.switchGames, zh: e.target.value } })} className={inputCls} />
                        <textarea value={r.switchGames?.en || ''} rows={3} placeholder="English" onChange={(e) => setRoom(i, { switchGames: { ...r.switchGames, en: e.target.value } })} className={`${inputCls} mt-2`} />
                      </div>
                      <div>
                        <label className={labelCls}>{locale === 'zh' ? '桌遊（每行一個 zh / en）' : 'Board games'}</label>
                        <textarea value={r.boardGames?.zh || ''} rows={3} onChange={(e) => setRoom(i, { boardGames: { ...r.boardGames, zh: e.target.value } })} className={inputCls} />
                        <textarea value={r.boardGames?.en || ''} rows={3} placeholder="English" onChange={(e) => setRoom(i, { boardGames: { ...r.boardGames, en: e.target.value } })} className={`${inputCls} mt-2`} />
                      </div>
                    </div>
                    <div>
                      <p className={labelCls}>{locale === 'zh' ? '適合場合' : 'Vibes'}</p>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(vibeLabels).map(([key2, lbl]) => (
                          <button key={key2} type="button"
                            onClick={() => setRoom(i, { vibes: r.vibes.includes(key2) ? r.vibes.filter((a) => a !== key2) : [...r.vibes, key2] })}
                            className={`px-3 py-1.5 rounded-pill text-xs font-semibold border ${r.vibes.includes(key2) ? 'bg-pink text-white border-pink' : 'border-charcoal/15 text-ink-soft'}`}>
                            {lbl[locale]}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Per-room rules + lock */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={r.bbqAvailable !== false} onChange={(e) => setRoom(i, { bbqAvailable: e.target.checked })} className="accent-accent" />
                        {locale === 'zh' ? '提供 BBQ' : 'BBQ available'}
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={!!r.drinksIncluded} onChange={(e) => setRoom(i, { drinksIncluded: e.target.checked })} className="accent-accent" />
                        {locale === 'zh' ? '已包無酒精飲品任飲' : 'Drinks included'}
                      </label>
                      <div>
                        <label className={labelCls}>{locale === 'zh' ? '提早入場佈置 $/小時' : 'Early setup $/hr'}</label>
                        <input type="number" value={r.earlySetupPricePerHour ?? 500} onChange={(e) => setRoom(i, { earlySetupPricePerHour: Math.max(0, parseInt(e.target.value, 10) || 0) })} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>{locale === 'zh' ? 'BBQ 標準套餐每位 $' : 'BBQ std $/head'}</label>
                        <input type="number" value={r.bbqStandardPrice ?? 158} onChange={(e) => setRoom(i, { bbqStandardPrice: Math.max(0, parseInt(e.target.value, 10) || 0) })} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>TTLock {locale === 'zh' ? '門鎖 ID（呢個場地嘅門）' : 'lock ID'}</label>
                        <input value={r.ttlockLockId || ''} onChange={(e) => setRoom(i, { ttlockLockId: e.target.value.trim() || undefined })} placeholder="1234567" className={`${inputCls} font-mono`} />
                      </div>
                      <label className="flex items-center gap-2 text-sm mt-5">
                        <input type="checkbox" checked={r.active !== false} onChange={(e) => setRoom(i, { active: e.target.checked })} className="accent-accent" />
                        {locale === 'zh' ? '上架（接受預訂）' : 'Live (bookable)'}
                      </label>
                    </div>

                    {/* Conflicts within the branch */}
                    {rooms.length > 1 && (
                      <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
                        <p className="text-xs font-bold text-amber-800 mb-1.5">
                          {locale === 'zh' ? '霸位關係：訂咗以下場地，本場地就唔可以訂 ↓' : 'Booked spaces below block this one:'}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {siblings.map((sib, sj) => {
                            const sibId = sib.id || `__room${sj}__`;
                            const ticked = (r.conflictsWith || []).includes(sib.id);
                            return (
                              <button key={sibId} type="button" disabled={!sib.id}
                                onClick={() => {
                                  const cur = r.conflictsWith || [];
                                  setRoom(i, { conflictsWith: ticked ? cur.filter((c) => c !== sib.id) : [...cur, sib.id] });
                                }}
                                className={`px-3 py-1.5 rounded-pill text-xs font-semibold border disabled:opacity-40 ${ticked ? 'bg-amber-500 text-white border-amber-500' : 'border-amber-300 text-amber-800'}`}>
                                {sib.roomLabel?.zh || sib.name.zh || sib.id || `場地 ${sj + 1}`}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-[11px] text-amber-700 mt-1.5">
                          {locale === 'zh' ? '例：上環「Room A」剔「全層」；「全層」剔「Room A」同「Room B」。A 同 B 互不影響就唔剔。' : 'e.g. Room A ticks Full Floor; Full Floor ticks A + B.'}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {msg && <p className="text-sm">{msg}</p>}
          <button
            onClick={handleSave}
            disabled={saving || uploadingRoom !== null}
            className="w-full py-3 rounded-xl bg-gradient-pink text-white font-bold disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {locale === 'zh' ? '儲存分店' : 'Save branch'}
          </button>
          {isNewBranch && (
            <p className="text-xs text-amber-700 flex items-start gap-1.5">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              {locale === 'zh'
                ? '新場地記得剔「上架」先會喺網站出現。多場地分店嘅霸位關係要每個場地都設定。'
                : 'Tick "Live" on each space to publish. Set blocking on every room of a multi-space branch.'}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ═══════════ Branch list ═══════════
  return (
    <div className="p-6 md:p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Store className="text-accent" size={24} />
          {locale === 'zh' ? '分店管理' : 'Venues'}
        </h1>
        <button onClick={newBranch} className="px-4 py-2 rounded-xl bg-gradient-pink text-white text-sm font-bold flex items-center gap-1.5">
          <Plus size={14} /> {locale === 'zh' ? '新增分店' : 'New branch'}
        </button>
      </div>

      {msg && <p className="text-sm mb-4">{msg}</p>}
      {loading ? (
        <div className="animate-pulse text-muted">Loading…</div>
      ) : (
        <div className="space-y-3">
          {groups.map(({ key, rooms: rms }) => {
            const first = rms[0];
            const allOff = rms.every((r) => r.active === false);
            const name = first.branchName?.zh || first.name.zh;
            return (
              <div key={key} className={`glass-card p-4 flex items-center gap-4 ${allOff ? 'opacity-60' : ''}`}>
                {first.images?.[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={first.images[0]} alt="" className="w-16 h-12 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="w-16 h-12 rounded-lg bg-charcoal/10 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-bold truncate">
                    {name}
                    {rms.length > 1 && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-800">
                        {locale === 'zh' ? `${rms.length} 個分拆場地` : `${rms.length} spaces`}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-ink-soft truncate">
                    {rms.length > 1
                      ? rms.map((r) => `${r.roomLabel?.zh || r.name.zh}${r.active === false ? '（落架）' : ''}`).join(' · ')
                      : `$${first.pricing.weekday.perHead}/$${first.pricing.weekend.perHead} · ${first.capacity.min}–${first.capacity.max}人`}
                    {allOff && <span className="text-rose-600 font-bold ml-2">{locale === 'zh' ? '已落架' : 'OFFLINE'}</span>}
                  </p>
                </div>
                <button onClick={() => toggleBranchActive(rms)}
                  className={`px-3 py-1.5 rounded-pill text-xs font-bold flex items-center gap-1 ${allOff ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                  {allOff ? <><Eye size={12} /> {locale === 'zh' ? '上架' : 'Go live'}</> : <><EyeOff size={12} /> {locale === 'zh' ? '落架' : 'Offline'}</>}
                </button>
                <button onClick={() => openBranch(key, rms)}
                  className="px-3 py-1.5 rounded-pill text-xs font-bold bg-pink/10 text-pink hover:bg-pink/20">
                  {locale === 'zh' ? '編輯' : 'Edit'}
                </button>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-ink-soft mt-5 leading-relaxed">
        {locale === 'zh'
          ? '※ 一間分店可以有多個「分拆場地」（上環模式）：Calendar 全分店共用一個，門鎖每個場地自己一個，霸位關係喺分店入面設定。「落架」保留所有歷史訂單。'
          : '※ A branch may hold multiple bookable spaces (SW model): one shared calendar, per-space locks, blocking configured inside the branch.'}
      </p>
    </div>
  );
}
