'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { getAllUsers, getUserBookings } from '@/lib/firestore';
import { BookingRecord } from '@/types';
import { Search, CalendarDays, Award, ChevronRight, ArrowLeft, Clock } from 'lucide-react';
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
  const { hasPermission } = useAuth();
  const [members, setMembers] = useState<MemberData[]>([]);
  const [filtered, setFiltered] = useState<MemberData[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedMember, setSelectedMember] = useState<MemberData | null>(null);
  const [memberBookings, setMemberBookings] = useState<BookingRecord[]>([]);
  const [pointsAdjust, setPointsAdjust] = useState(0);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const canAccess = hasPermission('members');

  useEffect(() => {
    if (!canAccess) return;
    getAllUsers().then((data) => {
      setMembers(data as MemberData[]);
      setFiltered(data as MemberData[]);
      setLoading(false);
    });
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
    const bookings = await getUserBookings(member.uid);
    setMemberBookings(bookings);
    setLoadingDetail(false);
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
              <div className="flex justify-between">
                <span className="text-muted">{locale === 'zh' ? '電話' : 'Phone'}</span>
                <span className="font-medium">{selectedMember.phone || '-'}</span>
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
      </div>
    );
  }

  // List View
  return (
    <div>
      <h1 className="text-heading mb-8">{locale === 'zh' ? '會員管理' : 'Member Management'}</h1>

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
