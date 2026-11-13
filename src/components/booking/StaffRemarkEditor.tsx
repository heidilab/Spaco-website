'use client';

// 內部備註 — the remark staff leave on a booking for colleagues and the
// cleaner. Used on the admin calendar (booking pop-up) and on the booking
// detail page. Saving goes through /api/admin/booking-remark, which also
// rewrites the booking's Google Calendar event.

import { useEffect, useState } from 'react';
import { Loader2, StickyNote } from 'lucide-react';
import { adminApiFetch } from '@/lib/adminApiFetch';
import { STAFF_REMARK_MAX } from '@/lib/staffRemark';

type CalendarResult = 'updated' | 'created' | 'not_on_calendar' | 'failed';

export default function StaffRemarkEditor({
  bookingId, remark, locale, canEdit, onSaved,
}: {
  bookingId: string;
  remark: string | undefined;
  locale: 'zh' | 'en';
  /** CS / admin can write; everyone else on the calendar reads. */
  canEdit: boolean;
  onSaved?: (remark: string) => void;
}) {
  const zh = locale === 'zh';
  const [draft, setDraft] = useState(remark || '');
  const [saved, setSaved] = useState(remark || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // A different booking (or a fresh load of the same one) resets the box.
  useEffect(() => { setDraft(remark || ''); setSaved(remark || ''); setMessage(null); }, [bookingId, remark]);

  const calendarText = (c: CalendarResult): string => {
    if (c === 'updated' || c === 'created') return zh ? '已儲存，並已更新 Google 日曆。' : 'Saved and Google Calendar updated.';
    if (c === 'not_on_calendar') return zh
      ? '已儲存。呢張單未喺 Google 日曆（未確認付款）；確認之後備註會一齊出現。'
      : 'Saved. This booking is not on Google Calendar yet (payment not confirmed); the remark goes with it once confirmed.';
    return zh
      ? '已儲存，但更新 Google 日曆失敗 — 請喺訂單頁再撳一次同步。'
      : 'Saved, but the Google Calendar update failed — re-sync from the booking page.';
  };

  async function save() {
    setSaving(true); setMessage(null);
    try {
      const res = await adminApiFetch('/api/admin/booking-remark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, remark: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'save failed');
      setDraft(data.remark); setSaved(data.remark);
      setMessage({ ok: data.calendar !== 'failed', text: calendarText(data.calendar) });
      onSaved?.(data.remark);
    } catch {
      setMessage({ ok: false, text: zh ? '儲存失敗，請再試。' : 'Could not save — please try again.' });
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit) {
    if (!saved) return null;
    return (
      <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
        <p className="text-xs font-semibold mb-1 flex items-center gap-1"><StickyNote size={12} />{zh ? '內部備註' : 'Staff remark'}</p>
        <p className="whitespace-pre-wrap">{saved}</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3">
      <label className="text-xs font-semibold text-amber-900 mb-1 flex items-center gap-1">
        <StickyNote size={12} />
        {zh ? '內部備註（俾同事／清潔睇，客人睇唔到）' : 'Staff remark (for colleagues / cleaner — not shown to the customer)'}
      </label>
      <textarea
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setMessage(null); }}
        maxLength={STAFF_REMARK_MAX}
        rows={3}
        placeholder={zh ? '例如：要預備 2 張長枱；客人會早 30 分鐘到；留意要收返麥克風' : 'e.g. set out 2 long tables; guest arrives 30 min early'}
        className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-ink"
      />
      <div className="flex items-center gap-3 mt-2">
        <button
          type="button" onClick={save} disabled={saving || draft.trim() === saved.trim()}
          className="rounded-full bg-amber-600 text-white text-xs font-semibold px-4 py-1.5 disabled:opacity-40 flex items-center gap-1.5"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          {zh ? '儲存備註' : 'Save remark'}
        </button>
        <span className="text-[11px] text-amber-800">{zh ? '儲存後會同步去 Google 日曆' : 'Saving also updates Google Calendar'}</span>
      </div>
      {message && (
        <p className={`text-xs mt-2 ${message.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{message.text}</p>
      )}
    </div>
  );
}
