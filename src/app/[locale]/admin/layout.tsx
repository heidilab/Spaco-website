'use client';

import { useLocale } from 'next-intl';
import { Link, usePathname } from '@/i18n/routing';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard, CalendarDays, ListOrdered,
  Calculator, ChevronLeft, Shield, Image, Users, UserCog, Receipt, FileText, HelpCircle, Search, CalendarClock,
} from 'lucide-react';

const allSidebarLinks = [
  { href: '/admin', icon: LayoutDashboard, label: { zh: '控制中心', en: 'Dashboard' }, permission: null },
  { href: '/admin/content', icon: Image, label: { zh: '內容管理', en: 'Content' }, permission: 'content' },
  { href: '/admin/seo', icon: Search, label: { zh: 'SEO 管理', en: 'SEO' }, permission: 'seo' },
  { href: '/admin/faq', icon: HelpCircle, label: { zh: '常見問題管理', en: 'FAQ' }, permission: 'faq' },
  { href: '/admin/receipts', icon: Receipt, label: { zh: '待確認入數紙', en: 'Pending Receipts' }, permission: 'bookings' },
  { href: '/admin/bookings', icon: ListOrdered, label: { zh: '預訂管理', en: 'Bookings' }, permission: 'bookings' },
  { href: '/admin/calendar', icon: CalendarDays, label: { zh: '總日曆', en: 'Calendar' }, permission: 'calendar' },
  { href: '/admin/calendar-sync', icon: CalendarClock, label: { zh: 'Google 同步', en: 'Google Sync' }, permission: 'gcal' },
  { href: '/admin/documents', icon: FileText, label: { zh: '單據管理', en: 'Documents' }, permission: 'documents' },
  { href: '/admin/deposit', icon: Calculator, label: { zh: '按金結算', en: 'Deposit' }, permission: 'deposit' },
  { href: '/admin/members', icon: Users, label: { zh: '會員管理', en: 'Members' }, permission: 'members' },
  { href: '/admin/staff', icon: UserCog, label: { zh: '員工管理', en: 'Staff' }, permission: 'staff' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, isAdminUser, userRole, hasPermission } = useAuth();
  const locale = useLocale() as 'zh' | 'en';
  const pathname = usePathname();

  if (loading) {
    return (
      <div className="pt-28 min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-ink-soft">Loading...</div>
      </div>
    );
  }

  if (!user || !isAdminUser) {
    return (
      <div className="pt-28 min-h-screen flex items-center justify-center">
        <div className="glass-card p-10 max-w-md text-center">
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-warm flex items-center justify-center text-white shadow-glow">
            <Shield size={28} />
          </div>
          <h1 className="text-2xl font-bold font-display mb-2">
            <span className="text-gradient-warm">
              {locale === 'zh' ? '無權限存取' : 'Access Denied'}
            </span>
          </h1>
          <p className="text-ink-soft mb-6">
            {locale === 'zh' ? '此頁面僅限管理員存取' : 'This page is restricted to admins'}
          </p>
          <Link href="/" className="btn-primary">
            {locale === 'zh' ? '返回首頁' : 'Back to Home'}
          </Link>
        </div>
      </div>
    );
  }

  // Filter sidebar links based on role permissions
  const visibleLinks = allSidebarLinks.filter((link) => {
    if (link.permission === null) return true; // Dashboard always visible
    return hasPermission(link.permission);
  });

  const roleLabels: Record<string, { zh: string; en: string }> = {
    admin: { zh: '管理員', en: 'Admin' },
    cs: { zh: '客服', en: 'CS' },
    cleaner: { zh: '清潔員', en: 'Cleaner' },
    marketing: { zh: '市場推廣', en: 'Marketing' },
  };

  return (
    <div className="pt-28 min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 fixed left-0 top-28 bottom-0 hidden lg:flex flex-col">
        <div className="m-4 mr-0 flex-1 glass-strong rounded-3xl flex flex-col overflow-hidden">
          <div className="p-5 border-b border-white/40">
            <h2 className="text-lg font-bold font-display flex items-center gap-2 text-ink">
              <span className="w-7 h-7 rounded-xl bg-gradient-pink flex items-center justify-center text-white shadow-glow">
                <Shield size={14} />
              </span>
              Admin
            </h2>
            <p className="text-xs text-ink-soft mt-2 truncate">{user.email}</p>
            <span className="inline-block mt-2 px-2.5 py-0.5 rounded-pill text-[10px] font-bold bg-gradient-pink text-white uppercase tracking-wider">
              {roleLabels[userRole || 'admin']?.[locale]}
            </span>
          </div>

          <nav className="flex-1 py-3 overflow-y-auto">
            {visibleLinks.map((link) => {
              const isActive = pathname === link.href || (link.href !== '/admin' && pathname.startsWith(link.href));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-3 mx-3 px-4 py-2.5 my-0.5 rounded-2xl text-sm transition-all ${
                    isActive
                      ? 'bg-gradient-pink text-white font-semibold shadow-glow'
                      : 'text-ink-soft hover:bg-white/60 hover:text-ink'
                  }`}
                >
                  <link.icon size={18} />
                  {link.label[locale]}
                </Link>
              );
            })}
          </nav>

          <div className="p-4 border-t border-white/40">
            <Link href="/" className="flex items-center gap-2 text-sm text-ink-soft hover:text-pink transition-colors">
              <ChevronLeft size={16} />
              {locale === 'zh' ? '返回網站' : 'Back to Site'}
            </Link>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 lg:ml-64 p-6 md:p-10">
        {children}
      </main>
    </div>
  );
}
