'use client';

import { useEffect, useState } from 'react';
import { Link2, Search, Check, X } from 'lucide-react';
import { getAllUsers, linkBookingToMember } from '@/lib/firestore';
import { formatHkPhone } from '@/lib/whatsapp';
import { matchMembers, type MemberHit } from '@/lib/memberSearch';

/**
 * Inline "連結會員帳號" tool for guest bookings (userId null). Staff
 * search a member by name / email / phone, confirm, and the booking's
 * userId is set so the customer can open the pay-balance link and see
 * the booking on /my-bookings. Shown only when the booking has no owner.
 */
export default function LinkMemberPanel({
  bookingId,
  locale,
  staffUid,
  initialSearch,
  onLinked,
}: {
  bookingId: string;
  locale: 'zh' | 'en';
  staffUid?: string;
  /** Pre-fill the search box (e.g. the WhatsApp number stored on the booking). */
  initialSearch?: string;
  onLinked: (uid: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<MemberHit[] | null>(null);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [search, setSearch] = useState(initialSearch || '');
  const [picked, setPicked] = useState<MemberHit | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || members || loadingMembers) return;
    setLoadingMembers(true);
    getAllUsers()
      .then((list) => setMembers(list as MemberHit[]))
      .catch(() => setMsg(locale === 'zh' ? '載入會員名單失敗，請重試。' : 'Failed to load members. Please retry.'))
      .finally(() => setLoadingMembers(false));
  }, [open, members, loadingMembers, locale]);

  const hits = members ? matchMembers(members, search) : [];

  async function handleLink() {
    if (!picked || saving) return;
    setSaving(true);
    setMsg(null);
    try {
      await linkBookingToMember(bookingId, picked.uid, staffUid);
      setMsg(locale === 'zh' ? '已連結會員帳號。客人用呢個帳號登入後就可以開付款連結。' : 'Member linked. The customer can now open the pay link with this account.');
      await onLinked(picked.uid);
      setOpen(false);
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setMsg(
        code === 'already_linked'
          ? (locale === 'zh' ? '此預訂已經有會員帳號，請重新載入頁面。' : 'This booking already has an owner — reload the page.')
          : (locale === 'zh' ? '連結失敗，請重試。' : 'Link failed. Please retry.'),
      );
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-pill bg-pink/10 text-pink text-xs font-semibold hover:bg-pink/20"
        >
          <Link2 size={13} />
          {locale === 'zh' ? '連結會員帳號' : 'Link member account'}
        </button>
        {msg && <p className="text-[11px] text-emerald-700">{msg}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-pink/30 bg-pink/5 p-3 space-y-2 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-ink flex items-center gap-1.5">
          <Link2 size={13} className="text-pink" />
          {locale === 'zh' ? '連結會員帳號' : 'Link member account'}
        </span>
        <button type="button" onClick={() => setOpen(false)} className="text-ink-soft hover:text-ink" aria-label="close">
          <X size={14} />
        </button>
      </div>
      <p className="text-[11px] text-ink-soft leading-relaxed">
        {locale === 'zh'
          ? '手動開單嘅預訂未綁定會員，客人開付款連結會見到「無法讀取此預訂」。叫客人先喺網站註冊／登入，再喺下面搵返佢個帳號連結。'
          : 'Admin-created bookings have no owner, so the pay link shows "Unable to access this booking". Ask the customer to register / sign in first, then find their account below.'}
      </p>
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-soft" />
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPicked(null); }}
          placeholder={locale === 'zh' ? '搜尋姓名 / 電郵 / 電話' : 'Search name / email / phone'}
          className="w-full pl-8 pr-3 py-2 rounded-lg border border-charcoal/15 bg-white text-sm"
        />
      </div>
      {loadingMembers && <p className="text-[11px] text-ink-soft">{locale === 'zh' ? '載入會員名單中…' : 'Loading members…'}</p>}
      {members && search.trim() && hits.length === 0 && (
        <p className="text-[11px] text-ink-soft">{locale === 'zh' ? '搵唔到會員。客人可能未註冊。' : 'No member found. The customer may not have registered yet.'}</p>
      )}
      {hits.length > 0 && (
        <ul className="divide-y divide-charcoal/10 rounded-lg border border-charcoal/10 bg-white max-h-56 overflow-auto">
          {hits.map((m) => {
            const phone = m.whatsappPhone || m.phone;
            const active = picked?.uid === m.uid;
            return (
              <li key={m.uid}>
                <button
                  type="button"
                  onClick={() => setPicked(m)}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 ${active ? 'bg-pink/10' : 'hover:bg-cream'}`}
                >
                  <span className="min-w-0">
                    <span className="font-semibold text-ink block truncate">{m.displayName || (locale === 'zh' ? '（未填姓名）' : '(no name)')}</span>
                    <span className="text-ink-soft block truncate">
                      {[m.email, phone ? (formatHkPhone(phone) || phone) : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {active && <Check size={14} className="text-pink shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {picked && (
        <button
          type="button"
          onClick={handleLink}
          disabled={saving}
          className="w-full px-3 py-2 rounded-lg bg-pink text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          <Check size={13} />
          {saving
            ? (locale === 'zh' ? '連結中…' : 'Linking…')
            : (locale === 'zh' ? `確認連結：${picked.displayName || picked.email || picked.uid}` : `Confirm link: ${picked.displayName || picked.email || picked.uid}`)}
        </button>
      )}
      {msg && <p className="text-[11px] text-rose-600">{msg}</p>}
    </div>
  );
}
