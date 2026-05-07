'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { getAllStaff, setStaffRole, removeStaff, findUserByEmail } from '@/lib/content';
import { StaffRole } from '@/types';
import { UserCog, Plus, Trash2, Shield, Headphones, Sparkles, Search, AlertCircle, Megaphone } from 'lucide-react';

interface StaffData {
  uid: string;
  role?: string;
  displayName?: string;
  email?: string;
  [key: string]: unknown;
}

const roleConfig: Record<StaffRole, { icon: typeof Shield; color: string; label: { zh: string; en: string }; desc: { zh: string; en: string } }> = {
  admin: {
    icon: Shield,
    color: 'bg-accent/10 text-accent',
    label: { zh: '管理員', en: 'Admin' },
    desc: { zh: '全權存取所有後台功能', en: 'Full access to all admin features' },
  },
  cs: {
    icon: Headphones,
    color: 'bg-blue-50 text-blue-600',
    label: { zh: '客服', en: 'Customer Service' },
    desc: { zh: '會員資料、預訂管理、日曆、按金結算', en: 'Members, bookings, calendar, deposit' },
  },
  cleaner: {
    icon: Sparkles,
    color: 'bg-green-50 text-green-600',
    label: { zh: '清潔員', en: 'Cleaner' },
    desc: { zh: '只可查看預訂日曆', en: 'Calendar view only' },
  },
  marketing: {
    icon: Megaphone,
    color: 'bg-purple-50 text-purple-600',
    label: { zh: '市場推廣', en: 'Marketing' },
    desc: { zh: '內容管理、SEO、常見問題、總日曆', en: 'Content, SEO, FAQ, calendar' },
  },
};

export default function AdminStaffPage() {
  const locale = useLocale() as 'zh' | 'en';
  const { user, hasPermission } = useAuth();
  const [staff, setStaff] = useState<StaffData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState<StaffRole>('cs');
  const [addError, setAddError] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const canAccess = hasPermission('staff');

  useEffect(() => {
    if (canAccess) loadStaff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  const loadStaff = async () => {
    const data = await getAllStaff();
    setStaff(data as StaffData[]);
    setLoading(false);
  };

  const handleAddStaff = async () => {
    setAddError('');
    setAddLoading(true);

    const foundUser = await findUserByEmail(addEmail);
    if (!foundUser) {
      setAddError(locale === 'zh' ? '找不到此電郵的用戶，該用戶需先在網站註冊' : 'User not found. They must register on the website first.');
      setAddLoading(false);
      return;
    }

    await setStaffRole(
      foundUser.uid as string,
      addRole,
      (foundUser as { displayName?: string }).displayName || '',
      addEmail,
      user!.uid
    );

    setShowAddModal(false);
    setAddEmail('');
    setAddRole('cs');
    setAddLoading(false);
    await loadStaff();
  };

  const handleRemoveStaff = async (uid: string) => {
    if (uid === user?.uid) return; // Can't remove yourself
    await removeStaff(uid);
    await loadStaff();
  };

  const handleChangeRole = async (staffMember: StaffData, newRole: StaffRole) => {
    await setStaffRole(
      staffMember.uid,
      newRole,
      (staffMember.displayName || '') as string,
      (staffMember.email || '') as string,
      user!.uid
    );
    await loadStaff();
  };

  if (!canAccess) {
    return <div className="text-center py-20 text-muted">{locale === 'zh' ? '無權限存取' : 'Access Denied'}</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-heading">{locale === 'zh' ? '員工管理' : 'Staff Management'}</h1>
        <button onClick={() => setShowAddModal(true)} className="btn-primary text-sm">
          <Plus size={16} /> {locale === 'zh' ? '新增員工' : 'Add Staff'}
        </button>
      </div>

      {/* Role Legend */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {(Object.keys(roleConfig) as StaffRole[]).map((role) => {
          const config = roleConfig[role];
          const Icon = config.icon;
          return (
            <div key={role} className={`rounded-2xl p-4 ${config.color}`}>
              <div className="flex items-center gap-2 mb-1">
                <Icon size={16} />
                <span className="font-semibold text-sm">{config.label[locale]}</span>
              </div>
              <p className="text-xs opacity-70">{config.desc[locale]}</p>
            </div>
          );
        })}
      </div>

      {/* Staff List */}
      {loading ? (
        <div className="animate-pulse text-muted">Loading...</div>
      ) : (
        <div className="space-y-3">
          {staff.map((s) => {
            const role = (s.role || 'admin') as StaffRole;
            const config = roleConfig[role];
            const isSelf = s.uid === user?.uid;
            return (
              <div key={s.uid} className="glass-card p-5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl ${config.color} flex items-center justify-center`}>
                    <config.icon size={18} />
                  </div>
                  <div>
                    <p className="font-medium">
                      {s.displayName || s.email || s.uid}
                      {isSelf && <span className="text-xs text-muted ml-2">({locale === 'zh' ? '你' : 'You'})</span>}
                    </p>
                    <p className="text-xs text-muted">{s.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={role}
                    onChange={(e) => handleChangeRole(s, e.target.value as StaffRole)}
                    disabled={isSelf}
                    className="px-3 py-1.5 rounded-lg border border-charcoal/10 text-sm focus:outline-none focus:border-accent disabled:opacity-50"
                  >
                    <option value="admin">{roleConfig.admin.label[locale]}</option>
                    <option value="cs">{roleConfig.cs.label[locale]}</option>
                    <option value="cleaner">{roleConfig.cleaner.label[locale]}</option>
                  </select>
                  {!isSelf && (
                    <button
                      onClick={() => handleRemoveStaff(s.uid)}
                      className="w-9 h-9 rounded-lg bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-100 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Staff Modal */}
      {showAddModal && (
        <>
          <div className="fixed inset-0 bg-charcoal/50 z-50" onClick={() => setShowAddModal(false)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 glass-strong rounded-3xl p-8 shadow-glass-lg w-full max-w-md mx-4">
            <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
              <UserCog size={20} className="text-accent" />
              {locale === 'zh' ? '新增員工' : 'Add Staff Member'}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted mb-1.5 block">{locale === 'zh' ? '員工電郵' : 'Staff Email'}</label>
                <div className="relative">
                  <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="email"
                    value={addEmail}
                    onChange={(e) => setAddEmail(e.target.value)}
                    placeholder={locale === 'zh' ? '輸入已註冊嘅電郵地址' : 'Enter registered email'}
                    className="w-full pl-11 pr-4 py-3 rounded-xl border border-charcoal/10 focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm text-muted mb-1.5 block">{locale === 'zh' ? '角色' : 'Role'}</label>
                <select
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value as StaffRole)}
                  className="w-full px-4 py-3 rounded-xl border border-charcoal/10 focus:outline-none focus:border-accent"
                >
                  <option value="admin">{roleConfig.admin.label[locale]} — {roleConfig.admin.desc[locale]}</option>
                  <option value="cs">{roleConfig.cs.label[locale]} — {roleConfig.cs.desc[locale]}</option>
                  <option value="cleaner">{roleConfig.cleaner.label[locale]} — {roleConfig.cleaner.desc[locale]}</option>
                </select>
              </div>

              {addError && (
                <div className="flex items-start gap-2 p-3 bg-red-50 rounded-xl text-sm text-red-600">
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                  {addError}
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={handleAddStaff}
                disabled={!addEmail || addLoading}
                className="flex-1 btn-primary justify-center disabled:opacity-50"
              >
                {addLoading ? '...' : (locale === 'zh' ? '確認新增' : 'Add')}
              </button>
              <button onClick={() => setShowAddModal(false)} className="flex-1 btn-outline justify-center">
                {locale === 'zh' ? '取消' : 'Cancel'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
