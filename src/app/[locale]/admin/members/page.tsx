'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { getAllUsers, getUserBookings, updateMemberPhoneEverywhere } from '@/lib/firestore';
import { BookingRecord } from '@/types';
import { Search, CalendarDays, Award, ChevronRight, ArrowLeft, Clock, Download, Users } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface MemberData {
  uid: string;
  email?: string;
  displayName?: string;
  phone?: string;
  loyaltyPoints?: number;
  createdAt?: { seconds: number };
  [key: string]: unknown;
}

export default function AdminMembersPage() {
  const locale = useLocale() as 'zh' | 'en';
  const searchParams = useSearchParams();
  const { hasPermission } = useAuth();
  const [members, setMembers] = useState<MemberData[]>([]);
  const [filtered, setFiltered] = useState<MemberData[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedMember, setSelectedMember] = useState<MemberData | null>(null);
  const [memberBookings, setMemberBookings] = useState<BookingRecord[]>([]);
  const [pointsAdjust, setPointsAdjust] = useState(0);
  const [loadingDetail, setLoadingDetail] = useState(false);
  // Editable phone — Heidi's 2026-05-23 spec: admin must be able to
  // correct mistyped numbers (customer flags via WhatsApp). Saving
  // syncs to user.phone AND every booking's whatsappPhone so the
  // bookings list / pay-balance link all show the right number.
  const [phoneDraft, setPhoneDraft] = useState('');
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [phoneMsg, setPhoneMsg] = useState<string | null>(null);
  const canAccess = hasPermission('members');

  useEffect(() => {
    if (!canAccess) return;
    getAllUsers().then((data) => {
      const list = data as MemberData[];
      setMembers(list);
      setFiltered(list);
      setLoading(false);
      // ?uid=xxx in the URL → auto-open that member's detail. Used by
      // the "會員資料" name link on /admin/bookings/[id], so admin
      // can jump directly to the customer profile with one click.
      const targetUid = searchParams.get('uid');
      if (targetUid) {
        const hit = list.find((m) => m.uid === targetUid);
        if (hit) {
          setSelectedMember(hit);
          setLoadingDetail(true);
          getUserBookings(hit.uid)
            .then((bs) => setMemberBookings(bs))
            .finally(() => setLoadingDetail(false));
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  useEffect(() => {
    if (!search) {
      setFiltered(members);
      return;
    }
    const s = search.toLowerCase();
    setFiltered(members.filter((m) =>
      (m.displayName || '').toLowerCase().includes(s) ||
      (m.email || '').toLowerCase().includes(s) ||
      (m.phone || '').includes(s)
    ));
  }, [search, members]);

  const viewMember = async (member: MemberData) => {
    setSelectedMember(member);
    setLoadingDetail(true);
    setPointsAdjust(0);
    setPhoneDraft(member.phone || '');
    setPhoneMsg(null);
    const bookings = await getUserBookings(member.uid);
    setMemberBookings(bookings);
    setLoadingDetail(false);
  };

  const savePhone = async () => {
    if (!selectedMember) return;
    const next = phoneDraft.trim();
    if (next === (selectedMember.phone || '')) return;
    setPhoneSaving(true);
    setPhoneMsg(null);
    try {
      const count = await updateMemberPhoneEverywhere(selectedMember.uid, next);
      setSelectedMember({ ...selectedMember, phone: next });
      setMembers((prev) =>
        prev.map((m) => (m.uid === selectedMember.uid ? { ...m, phone: next } : m)),
      );
      // Refresh booking list so the WhatsApp column / send-link buttons
      // pick up the new number immediately.
      setMemberBookings((prev) => prev.map((b) => ({ ...b, whatsappPhone: next })));
      setPhoneMsg(
        locale === 'zh'
          ? `✓ 已更新會員資料同 ${count} 張預訂嘅電話`
          : `✓ Phone updated on profile + ${count} booking(s)`,
      );
    } catch (err) {
      setPhoneMsg(
        (locale === 'zh' ? '失敗：' : 'Failed: ')
        + (err instanceof Error ? err.message : 'unknown'),
      );
    } finally {
      setPhoneSaving(false);
    }
  };

  const adjustPoints = async () => {
    if (!selectedMember || pointsAdjust === 0) return;
    const newPoints = (selectedMember.loyaltyPoints || 0) + pointsAdjust;
    await updateDoc(doc(db, 'users', selectedMember.uid), { loyaltyPoints: Math.max(0, newPoints) });
    setSelectedMember({ ...selectedMember, loyaltyPoints: Math.max(0, newPoints) });
    setPointsAdjust(0);
    // Refresh list
    const updated = members.map((m) =>
      m.uid === selectedMember.uid ? { ...m, loyaltyPoints: Math.max(0, newPoints) } : m
    );
    setMembers(updated);
  };

  const formatDate = (ts: { seconds: number } | undefined) => {
    if (!ts) return '-';
    return new Date(ts.seconds * 1000).toLocaleDateString();
  };

  // ───── Export ─────
  // Export uses the FILTERED list (so searched results can be exported
  // standalone). Lazy-imports xlsx / jspdf to keep the page bundle
  // small — these libs are ~300KB each and only needed when admin
  // clicks Export. Filename includes today's date so multiple exports
  // don't overwrite. CSV uses UTF-8 BOM so Excel opens Chinese chars
  // correctly without manual encoding selection.
  const [exportOpen, setExportOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!exportOpen) return;
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [exportOpen]);

  const buildExportRows = () => {
    const headers = locale === 'zh'
      ? ['姓名', 'Email', '電話', '註冊日期', '積分']
      : ['Name', 'Email', 'Phone', 'Joined', 'Points'];
    const rows = filtered.map((m) => [
      m.displayName || '-',
      m.email || '-',
      m.phone || '-',
      formatDate(m.createdAt),
      String(m.loyaltyPoints || 0),
    ]);
    return { headers, rows };
  };

  const todayStamp = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const exportCSV = () => {
    const { headers, rows } = buildExportRows();
    const escape = (s: string) => {
      const needs = /[",\n]/.test(s);
      return needs ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))];
    // UTF-8 BOM — without it Excel mis-decodes Traditional Chinese.
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, `spaco-members-${todayStamp()}.csv`);
    setExportOpen(false);
  };

  const exportXLSX = async () => {
    const XLSX = await import('xlsx');
    const { headers, rows } = buildExportRows();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    // Auto-width approximation — pick widest cell per column.
    ws['!cols'] = headers.map((_, colIdx) => {
      const widest = Math.max(
        headers[colIdx].length,
        ...rows.map((r) => (r[colIdx] || '').length),
      );
      return { wch: Math.min(40, Math.max(10, widest + 2)) };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, locale === 'zh' ? '會員列表' : 'Members');
    XLSX.writeFile(wb, `spaco-members-${todayStamp()}.xlsx`);
    setExportOpen(false);
  };

  const exportPDF = async () => {
    const [{ default: jsPDF }, autoTableMod] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const autoTable = (autoTableMod as unknown as { default: (doc: InstanceType<typeof jsPDF>, opts: Record<string, unknown>) => void }).default;
    const { headers, rows } = buildExportRows();
    const docPdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    docPdf.setFontSize(16);
    docPdf.text(
      locale === 'zh' ? `SPACO 會員列表 (${filtered.length} 個會員)` : `SPACO Members (${filtered.length} total)`,
      40,
      40,
    );
    docPdf.setFontSize(10);
    docPdf.text(`Exported: ${todayStamp()}`, 40, 60);
    autoTable(docPdf, {
      head: [headers],
      body: rows,
      startY: 80,
      styles: { fontSize: 9, cellPadding: 6 },
      headStyles: { fillColor: [236, 72, 153], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [250, 245, 250] },
    });
    docPdf.save(`spaco-members-${todayStamp()}.pdf`);
    setExportOpen(false);
  };

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!canAccess) {
    return <div className="text-center py-20 text-muted">{locale === 'zh' ? '無權限存取' : 'Access Denied'}</div>;
  }

  // Detail View
  if (selectedMember) {
    return (
      <div>
        <button
          onClick={() => setSelectedMember(null)}
          className="flex items-center gap-2 text-sm text-muted hover:text-charcoal mb-6 transition-colors"
        >
          <ArrowLeft size={16} /> {locale === 'zh' ? '返回會員列表' : 'Back to Members'}
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Profile Card */}
          <div className="glass-card p-6">
            <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center text-accent text-2xl font-bold mb-4">
              {(selectedMember.displayName || selectedMember.email || '?')[0].toUpperCase()}
            </div>
            <h2 className="text-xl font-bold">{selectedMember.displayName || '-'}</h2>
            <p className="text-sm text-muted mt-1">{selectedMember.email}</p>
            <div className="mt-4 space-y-3 text-sm">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-muted">{locale === 'zh' ? '電話' : 'Phone'}</span>
                  {phoneDraft.trim() !== (selectedMember.phone || '') && (
                    <button
                      onClick={savePhone}
                      disabled={phoneSaving}
                      className="px-3 py-1 rounded-pill bg-pink text-white text-xs font-semibold hover:bg-pink/90 disabled:opacity-40"
                    >
                      {phoneSaving
                        ? (locale === 'zh' ? '儲存中…' : 'Saving…')
                        : (locale === 'zh' ? '儲存 (同步預訂)' : 'Save (sync bookings)')}
                    </button>
                  )}
                </div>
                <input
                  type="tel"
                  value={phoneDraft}
                  onChange={(e) => setPhoneDraft(e.target.value)}
                  placeholder={locale === 'zh' ? '例：+852 9282 3060' : 'e.g. +852 9282 3060'}
                  className="w-full px-3 py-2 rounded-lg border border-charcoal/15 text-sm bg-white"
                />
                {phoneMsg && (
                  <p className={`text-[11px] mt-1 ${phoneMsg.startsWith('✓') ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {phoneMsg}
                  </p>
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-muted">{locale === 'zh' ? '註冊日期' : 'Joined'}</span>
                <span className="font-medium">{formatDate(selectedMember.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">{locale === 'zh' ? '總預訂' : 'Bookings'}</span>
                <span className="font-medium">{memberBookings.length}</span>
              </div>
            </div>
          </div>

          {/* Points Card */}
          <div className="glass-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Award size={20} className="text-accent" />
              <h3 className="font-bold">{locale === 'zh' ? '積分管理' : 'Loyalty Points'}</h3>
            </div>
            <p className="text-4xl font-bold mb-6">{selectedMember.loyaltyPoints || 0}</p>
            <p className="text-xs text-muted mb-4">
              = HK${((selectedMember.loyaltyPoints || 0) / 100).toFixed(2)} {locale === 'zh' ? '可抵扣' : 'redeemable'}
            </p>
            <div className="flex gap-2">
              <input
                type="number"
                value={pointsAdjust || ''}
                onChange={(e) => setPointsAdjust(Number(e.target.value))}
                placeholder={locale === 'zh' ? '輸入調整數（正/負）' : 'Adjust (+/-)'}
                className="flex-1 px-3 py-2 rounded-xl border border-charcoal/10 text-sm focus:outline-none focus:border-accent"
              />
              <button
                onClick={adjustPoints}
                disabled={pointsAdjust === 0}
                className="px-4 py-2 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors"
              >
                {locale === 'zh' ? '調整' : 'Adjust'}
              </button>
            </div>
          </div>

          {/* Bookings */}
          <div className="glass-card p-6 lg:col-span-1">
            <h3 className="font-bold mb-4 flex items-center gap-2">
              <CalendarDays size={18} className="text-accent" />
              {locale === 'zh' ? '預訂記錄' : 'Booking History'}
            </h3>
            {loadingDetail ? (
              <div className="animate-pulse text-muted text-sm">Loading...</div>
            ) : memberBookings.length === 0 ? (
              <p className="text-sm text-muted">{locale === 'zh' ? '暫無記錄' : 'No bookings'}</p>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {memberBookings.map((b) => (
                  <div key={b.id} className="p-3 rounded-xl bg-cream text-sm">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium">{b.date}</p>
                        <p className="text-xs text-muted flex items-center gap-1">
                          <Clock size={10} /> {b.startTime}-{b.endTime} | {b.guestCount} pax
                        </p>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        b.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                        b.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {b.status}
                      </span>
                    </div>
                    <p className="font-semibold mt-1">HK${b.pricing?.subtotal?.toLocaleString() || 0}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Points transaction history — derived from bookings:
         *  + pointsActuallyCredited on settled bookings (earned)
         *  − pointsActuallyDeducted on bookings where the customer
         *    redeemed points at checkout (spent)
         *  No separate `loyalty_transactions` collection yet; the
         *  per-booking timestamps + amounts are enough to render a
         *  full timeline. */}
        <div className="glass-card p-6 mt-6">
          <h3 className="font-bold mb-4 flex items-center gap-2">
            <Award size={18} className="text-accent" />
            {locale === 'zh' ? '積分交易記錄' : 'Points History'}
          </h3>
          {(() => {
            type Tx = { id: string; ts: number; kind: 'credit' | 'redeem'; amount: number; bookingId: string; note?: string };
            const txs: Tx[] = [];
            for (const b of memberBookings) {
              const credited = b.pointsActuallyCredited || 0;
              const credAt = b.pointsCreditedAt as { seconds?: number } | undefined;
              if (credited > 0 && credAt?.seconds) {
                txs.push({
                  id: `${b.id}-credit`,
                  ts: credAt.seconds * 1000,
                  kind: 'credit',
                  amount: credited,
                  bookingId: b.id,
                  note: `${b.date} ${b.startTime}-${b.endTime}`,
                });
              }
              const deducted = b.pointsActuallyDeducted || 0;
              const redAt = b.pointsRedeemedAt as { seconds?: number } | undefined;
              if (deducted > 0 && redAt?.seconds) {
                txs.push({
                  id: `${b.id}-redeem`,
                  ts: redAt.seconds * 1000,
                  kind: 'redeem',
                  amount: deducted,
                  bookingId: b.id,
                  note: `${b.date} ${b.startTime}-${b.endTime}`,
                });
              }
            }
            txs.sort((a, b) => b.ts - a.ts);
            if (txs.length === 0) {
              return (
                <p className="text-sm text-muted">
                  {locale === 'zh' ? '暫無積分交易' : 'No transactions yet'}
                </p>
              );
            }
            return (
              <ul className="space-y-2 text-sm max-h-[320px] overflow-y-auto">
                {txs.map((tx) => (
                  <li
                    key={tx.id}
                    className={`flex items-center justify-between gap-3 p-3 rounded-xl ${
                      tx.kind === 'credit' ? 'bg-emerald-50' : 'bg-rose-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-ink truncate">
                        {tx.kind === 'credit'
                          ? (locale === 'zh' ? '消費獲得積分' : 'Earned (booking settled)')
                          : (locale === 'zh' ? '預訂時抵扣積分' : 'Redeemed at checkout')}
                      </p>
                      <p className="text-xs text-muted truncate">
                        {tx.note}
                        {' · '}
                        {new Date(tx.ts).toLocaleString(locale === 'zh' ? 'zh-HK' : 'en-HK')}
                      </p>
                    </div>
                    <span className={`font-bold whitespace-nowrap ${
                      tx.kind === 'credit' ? 'text-emerald-700' : 'text-rose-700'
                    }`}>
                      {tx.kind === 'credit' ? '+' : '−'}
                      {tx.amount.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            );
          })()}
        </div>
      </div>
    );
  }

  // List View
  return (
    <div>
      {/* Header — title + member count + export menu.
       *  Count shows "X / total" when search is filtering, else just X.
       *  Export uses the FILTERED list so admin can search-then-export.
       *  The pink "X 個會員" chip beside the title is glanceable at a
       *  distance — main metric for member-management at-a-glance. */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-heading">{locale === 'zh' ? '會員管理' : 'Member Management'}</h1>
          {!loading && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-pill bg-pink/10 text-pink text-sm font-semibold">
              <Users size={14} />
              {search
                ? `${filtered.length} / ${members.length}`
                : `${members.length}`}
              <span className="font-normal opacity-75">
                {locale === 'zh' ? '個會員' : ' members'}
              </span>
            </span>
          )}
        </div>
        <div className="relative" ref={exportMenuRef}>
          <button
            type="button"
            onClick={() => setExportOpen((o) => !o)}
            disabled={loading || filtered.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-pill bg-charcoal text-white text-sm font-semibold hover:bg-charcoal/85 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={16} />
            {locale === 'zh' ? '匯出列表' : 'Export'}
          </button>
          {exportOpen && (
            <div className="absolute right-0 mt-2 w-44 rounded-xl bg-white shadow-xl border border-charcoal/10 overflow-hidden z-20">
              {[
                { key: 'csv', label: 'CSV (.csv)', fn: exportCSV },
                { key: 'xlsx', label: 'Excel (.xlsx)', fn: exportXLSX },
                { key: 'pdf', label: 'PDF (.pdf)', fn: exportPDF },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={opt.fn}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-cream transition-colors"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="relative mb-6">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={locale === 'zh' ? '搜尋姓名、電郵或電話...' : 'Search name, email or phone...'}
          className="w-full pl-11 pr-4 py-3 rounded-xl border border-charcoal/10 bg-white focus:outline-none focus:border-accent"
        />
      </div>

      {loading ? (
        <div className="animate-pulse text-muted">Loading...</div>
      ) : (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-charcoal/5">
                  <th className="text-left px-6 py-4 text-xs font-semibold text-muted uppercase">{locale === 'zh' ? '姓名' : 'Name'}</th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-muted uppercase">Email</th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-muted uppercase">{locale === 'zh' ? '電話' : 'Phone'}</th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-muted uppercase">{locale === 'zh' ? '註冊日期' : 'Joined'}</th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-muted uppercase">{locale === 'zh' ? '積分' : 'Points'}</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((member) => (
                  <tr key={member.uid} className="border-b border-charcoal/5 last:border-0 hover:bg-cream/50 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium">{member.displayName || '-'}</td>
                    <td className="px-6 py-4 text-sm text-muted">{member.email || '-'}</td>
                    <td className="px-6 py-4 text-sm">{member.phone || '-'}</td>
                    <td className="px-6 py-4 text-sm">{formatDate(member.createdAt)}</td>
                    <td className="px-6 py-4 text-sm font-medium">{member.loyaltyPoints || 0}</td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => viewMember(member)}
                        className="w-8 h-8 rounded-lg bg-cream flex items-center justify-center hover:bg-charcoal/10 transition-colors"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
