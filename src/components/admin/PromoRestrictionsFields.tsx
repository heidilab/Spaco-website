'use client';
import { useEffect, useState } from 'react';
import { loadAllVenues } from '@/lib/venueRegistry';
import { ALL_PACKAGES } from '@/lib/packages';
import type { Venue } from '@/types';
import { type PromoRestrictions, promoRestrictionError } from '@/lib/promoEligibility';

export function restrictionErrorText(error: string, locale: 'zh' | 'en') {
  const messages: Record<string, [string, string]> = {
    invalid_dates: ['請填寫有效嘅不適用日期，結束日期不可早於開始日期', 'Enter valid excluded dates, with end on or after start'],
    select_packages: ['請至少選擇一個適用套餐', 'Select at least one eligible package'],
    no_booking_type: ['請開放一般訂場或至少一種套餐', 'Allow standard bookings or packages'],
  };
  return messages[error]?.[locale === 'zh' ? 0 : 1] || error;
}
export default function PromoRestrictionsFields({ value, onChange, locale }: {
  value: PromoRestrictions; onChange: (patch: PromoRestrictions) => void; locale: 'zh' | 'en';
}) {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [selectedBranches, setSelectedBranches] = useState(!!value.venueIds?.length);
  useEffect(() => { let active = true; loadAllVenues().then(v => { if (active) setVenues(v); }); return () => { active = false; }; }, []);
  const zh = locale === 'zh';
  const ranges = value.excludedDateRanges || [];
  const scope = value.packageScope || 'all';
  const input = 'rounded-xl border border-charcoal/20 bg-white px-3 py-2 text-sm max-w-full';
  const error = promoRestrictionError(value);
  return <div className="space-y-5 my-4 rounded-xl border border-charcoal/10 p-4">
    <fieldset className="space-y-2"><legend className="font-semibold text-sm">{zh ? '適用分店／場地' : 'Eligible branches / spaces'}</legend>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!venues.length} checked={!selectedBranches} onChange={e => { setSelectedBranches(!e.target.checked); onChange({ venueIds: e.target.checked ? [] : venues.map(v => v.id) }); }} />{zh ? '全部分店（包括日後新增）' : 'All branches (including future branches)'}</label>
      {selectedBranches && <><div className="flex flex-wrap gap-3">{venues.map(v => <label key={v.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.venueIds?.includes(v.id) || false} onChange={e => {
        const ids = e.target.checked ? [...(value.venueIds || []), v.id] : (value.venueIds || []).filter(id => id !== v.id);
        // Empty allowlist means all for legacy codes; keep at least one selected here.
        if (ids.length) onChange({ venueIds: ids });
      }} />{v.name[locale] || v.name.zh}</label>)}</div><p className="text-xs text-ink-soft">{zh ? '指定分店時至少保留一個場地；分房可獨立選擇。' : 'Keep at least one space selected. Split rooms can be selected separately.'}</p></>}
    </fieldset>
    <fieldset className="space-y-2"><legend className="font-semibold text-sm">{zh ? '包場套餐' : 'Event packages'}</legend>
      <select aria-label={zh ? '套餐適用方式' : 'Package eligibility'} className={input+' w-full'} value={scope} onChange={e => onChange({ packageScope: e.target.value as PromoRestrictions['packageScope'] })}>
        <option value="all">{zh ? '所有套餐適用' : 'All packages'}</option><option value="include">{zh ? '只適用於指定套餐' : 'Only selected packages'}</option><option value="exclude">{zh ? '排除指定套餐' : 'All except selected packages'}</option><option value="none">{zh ? '所有包場套餐不適用' : 'No packages'}</option>
      </select>
      {(scope === 'include' || scope === 'exclude') && <div className="flex flex-wrap gap-3">{ALL_PACKAGES.map(p => <label key={p.slug} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.packageSlugs?.includes(p.slug) || false} onChange={e => onChange({ packageSlugs: e.target.checked ? [...(value.packageSlugs || []), p.slug] : (value.packageSlugs || []).filter(s => s !== p.slug) })} />{p.name[locale]}</label>)}</div>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.appliesToStandardBookings !== false} onChange={e => onChange({ appliesToStandardBookings: e.target.checked })} />{zh ? '一般時租訂場亦適用（非套餐）' : 'Also allow standard hourly bookings (not a package)'}</label>
    </fieldset>
    <fieldset className="space-y-2"><legend className="font-semibold text-sm">{zh ? '不適用活動日期' : 'Excluded event dates'}</legend>
      <p className="text-xs text-ink-soft">{zh ? '按活動日期，唔係輸入優惠碼嗰日。單日填相同起訖日期；跨日活動碰到任何排除日期亦不適用。留空代表不排除日期。' : 'Based on event dates, not redemption day. Use the same start/end for one day. Multi-day events overlapping any exclusion are ineligible. No rows means no excluded dates.'}</p>
      {ranges.map((r, i) => <div key={i} className="flex flex-wrap items-center gap-2">
        <input aria-label={`${zh ? '不適用開始日期' : 'Excluded start'} ${i+1}`} type="date" className={input} value={r.start} onChange={e => onChange({ excludedDateRanges: ranges.map((x,j) => j===i ? {...x,start:e.target.value,end:x.end || e.target.value} : x) })} />
        <span>—</span><input aria-label={`${zh ? '不適用結束日期' : 'Excluded end'} ${i+1}`} type="date" min={r.start} className={input} value={r.end} onChange={e => onChange({ excludedDateRanges: ranges.map((x,j) => j===i ? {...x,end:e.target.value} : x) })} />
        <button type="button" className="text-sm text-rose-600 p-2" onClick={() => onChange({ excludedDateRanges: ranges.filter((_,j) => j!==i) })}>{zh ? '移除' : 'Remove'}</button>
      </div>)}
      <button type="button" className="text-sm text-pink font-semibold py-2" onClick={() => onChange({ excludedDateRanges: [...ranges,{start:'',end:''}] })}>{zh ? '＋ 新增不適用日期／期間' : '+ Add excluded date / range'}</button>
    </fieldset>
    {error && <p role="alert" className="text-xs text-rose-600">{restrictionErrorText(error, locale)}</p>}
  </div>;
}
