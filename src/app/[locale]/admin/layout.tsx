'use client';

import { useState, useEffect } from 'react';
import { useLocale } from 'next-intl';
import { Link, usePathname } from '@/i18n/routing';
import { useAuth } from '@/contexts/AuthContext';
import { signInWithGoogle } from '@/lib/auth';
import {
  LayoutDashboard, CalendarDays, ListOrdered,
  ChevronLeft, ChevronDown, ChevronUp, Shield, Image, Users, UserCog, Receipt, FileText, HelpCircle, Search, CalendarClock, Mail, Tag, BarChart3,
  BookOpen, LogIn, Menu, X, Newspaper, Store,
} from 'lucide-react';
import AdminPushSetup from '@/components/admin/AdminPushSetup';
import { Wallet } from 'lucide-react';

interface NavChild { href: string; icon: typeof LayoutDashboard; label: { zh: string; en: string }; permission: string | null }
interface NavItem extends NavChild { children?: NavChild[] }

// Heidi's 2026-08 ordering. "Merged" pages stay at their own URLs but
// live as sub-items under their parent (collapsible group).
const allSidebarLinks: NavItem[] = [
  { href: '/admin', icon: LayoutDashboard, label: { zh: '控制中心', en: 'Dashboard' }, permission: null },
  {
    href: '/admin/bookings', icon: ListOrdered, label: { zh: '預訂管理', en: 'Bookings' }, permission: 'bookings',
    children: [
      { href: '/admin/receipts', icon: Receipt, label: { zh: '待確認入數紙', en: 'Pending Receipts' }, permission: 'bookings' },
    ],
  },
  { href: '/admin/calendar', icon: CalendarDays, label: { zh: '總日曆', en: 'Calendar' }, permission: 'calendar' },
  { href: '/admin/venues', icon: Store, label: { zh: '分店管理', en: 'Venues' }, permission: 'content' },
  { href: '/admin/finance', icon: BarChart3, label: { zh: '財務總覽', en: 'Finance' }, permission: 'documents' },
  { href: '/admin/expenses', icon: Wallet, label: { zh: '支出管理', en: 'Expenses' }, permission: 'documents' },
  { href: '/admin/documents', icon: FileText, label: { zh: '單據管理', en: 'Documents' }, permission: 'documents' },
  { href: '/admin/promo-codes', icon: Tag, label: { zh: '優惠碼', en: 'Promo Codes' }, permission: 'gcal' },
  {
    href: '/admin/content', icon: Image, label: { zh: '內容管理', en: 'Content' }, permission: 'content',
    children: [
      { href: '/admin/seo', icon: Search, label: { zh: 'SEO 管理', en: 'SEO' }, permission: 'seo' },
      { href: '/admin/faq', icon: HelpCircle, label: { zh: '常見問題管理', en: 'FAQ' }, permission: 'faq' },
      { href: '/admin/articles', icon: Newspaper, label: { zh: '文章分享', en: 'Articles' }, permission: 'content' },
    ],
  },
  {
    href: '/admin/traffic', icon: BarChart3, label: { zh: '流量報表', en: 'Traffic' }, permission: 'members',
    children: [
      { href: '/admin/utm-links', icon: Tag, label: { zh: '追蹤 Link 產生器', en: 'UTM Links' }, permission: 'members' },
    ],
  },
  { href: '/admin/members', icon: Users, label: { zh: '會員管理', en: 'Members' }, permission: 'members' },
  { href: '/admin/staff', icon: UserCog, label: { zh: '員工管理', en: 'Staff' }, permission: 'staff' },
  {
    // 系統管理 — umbrella with no page of its own; expands to reveal
    // the integration/ops tools.
    href: '#system', icon: Shield, label: { zh: '系統管理', en: 'System' }, permission: 'gcal',
    children: [
      { href: '/admin/email-automation', icon: Mail, label: { zh: 'Email 自動化', en: 'Email Automation' }, permission: 'gcal' },
      { href: '/admin/calendar-sync', icon: CalendarClock, label: { zh: 'Google 同步', en: 'Google Sync' }, permission: 'gcal' },
      { href: '/admin/help/lock-passcode-manual', icon: BookOpen, label: { zh: '門鎖密碼 SOP', en: 'Lock Passcode SOP' }, permission: 'bookings' },
    ],
  },
];

/**
 * Red banner shown on every non-production admin deployment (preview,
 * localhost). Payment links generated here point to the UAT sandbox, so
 * staff must never send them to real customers — this makes the test
 * environment impossible to mistake for spacohk.com.
 */
function TestEnvBanner({ locale }: { locale: 'zh' | 'en' }) {
  const [isTest, setIsTest] = useState(false);
  useEffect(() => {
    const host = window.location.hostname;
    setIsTest(host !== 'spacohk.com' && host !== 'www.spacohk.com');
  }, []);
  if (!isTest) return null;
  return (
    <div className="mb-6 rounded-xl border-2 border-rose-400 bg-rose-50 px-4 py-3 text-rose-800">
      <p className="font-bold text-sm">
        {locale === 'zh' ? '⚠️ 測試環境（非正式網站）' : '⚠️ Test environment (not the live site)'}
      </p>
      <p className="text-xs mt-0.5">
        {locale === 'zh'
          ? '此處的付款連結指向 KPay 測試沙盒，切勿發送給真實客人。日常操作請用 spacohk.com/zh/admin。'
          : 'Payment links here point to the KPay sandbox — never send them to real customers. Use spacohk.com/zh/admin for real work.'}
      </p>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, isAdminUser, userRole, hasPermission } = useAuth();
  const locale = useLocale() as 'zh' | 'en';
  const pathname = usePathname();
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Which nav groups are manually expanded (auto-expands on active child).
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  async function handleGoogleSignIn() {
    setSigningIn(true);
    setSignInError(null);
    try {
      await signInWithGoogle();
      // useAuth's onAuthStateChanged subscription re-renders this layout
      // with the new user; no further work needed here.
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setSigningIn(false);
    }
  }

  if (loading) {
    return (
      <div className="pt-28 min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-ink-soft">Loading...</div>
      </div>
    );
  }

  // Not signed in — invite the visitor to log in with Google. We don't
  // know yet whether they're an admin; the next render after sign-in
  // will fall through to the access-denied branch if they aren't one.
  if (!user) {
    return (
      <div className="pt-28 min-h-screen flex items-center justify-center">
        <div className="glass-card p-10 max-w-md text-center">
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-pink flex items-center justify-center text-white shadow-glow">
            <Shield size={28} />
          </div>
          <h1 className="text-2xl font-bold font-display mb-2">
            <span className="text-gradient-pink">
              {locale === 'zh' ? '管理員登入' : 'Admin Sign In'}
            </span>
          </h1>
          <p className="text-ink-soft mb-6 text-sm">
            {locale === 'zh'
              ? '請用你嘅 Google 帳號登入。如果未開通管理員權限，請聯絡 spacohk@gmail.com。'
              : 'Sign in with your Google account. If your account is not yet authorised as an admin, contact spacohk@gmail.com.'}
          </p>
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={signingIn}
            className="inline-flex items-center justify-center gap-3 w-full px-5 py-3 rounded-2xl border border-charcoal/15 bg-white hover:bg-white/90 font-semibold disabled:opacity-50"
          >
            {/* Inline Google "G" mark — no extra dependency. */}
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.49h4.84a4.13 4.13 0 01-1.79 2.72v2.26h2.9c1.69-1.56 2.69-3.86 2.69-6.63z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.46-.8 5.95-2.18l-2.9-2.26c-.8.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 009 18z" fill="#34A853"/>
              <path d="M3.96 10.71A5.41 5.41 0 013.68 9c0-.6.1-1.17.28-1.71V4.96H.96A9 9 0 000 9c0 1.45.35 2.83.96 4.04l3-2.33z" fill="#FBBC05"/>
              <path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.97 8.97 0 009 0 9 9 0 00.96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            {signingIn
              ? (locale === 'zh' ? '登入中…' : 'Signing in…')
              : (locale === 'zh' ? '用 Google 登入' : 'Continue with Google')}
          </button>
          {signInError && (
            <p className="text-xs text-rose-500 mt-3">{signInError}</p>
          )}
          <Link href="/" className="block mt-6 text-xs text-ink-soft hover:text-pink">
            ← {locale === 'zh' ? '返回首頁' : 'Back to Home'}
          </Link>
        </div>
      </div>
    );
  }

  // Signed in but not an authorised admin user.
  if (!isAdminUser) {
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
          <p className="text-ink-soft mb-2 text-sm">
            {locale === 'zh' ? '此頁面僅限管理員存取' : 'This page is restricted to admins'}
          </p>
          <p className="text-xs text-ink-soft mb-6 break-all">
            {locale === 'zh' ? '你登入嘅帳號：' : 'Signed in as: '}<strong>{user.email}</strong>
          </p>
          <Link href="/" className="btn-primary">
            {locale === 'zh' ? '返回首頁' : 'Back to Home'}
          </Link>
        </div>
      </div>
    );
  }

  // Filter sidebar links based on role permissions. A parent shows if
  // its own permission passes OR any child's does.
  const canSee = (perm: string | null) => perm === null || hasPermission(perm);
  const visibleLinks = allSidebarLinks
    .map((link) => ({
      ...link,
      children: link.children?.filter((c) => canSee(c.permission)),
    }))
    .filter((link) => canSee(link.permission) || (link.children && link.children.length > 0));

  const roleLabels: Record<string, { zh: string; en: string }> = {
    admin: { zh: '管理員', en: 'Admin' },
    cs: { zh: '客服', en: 'CS' },
    cleaner: { zh: '清潔員', en: 'Cleaner' },
    marketing: { zh: '市場推廣', en: 'Marketing' },
  };

  // Body of the sidebar — reused by the desktop fixed aside and the
  // mobile slide-in drawer so the two stay in lockstep.
  const sidebarBody = (
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
          const kids = link.children || [];
          const hasKids = kids.length > 0;
          const isGroupOnly = link.href.startsWith('#');
          const childActive = kids.some((c) => pathname === c.href || pathname.startsWith(c.href + '/'));
          const selfActive = !isGroupOnly
            && (pathname === link.href || (link.href !== '/admin' && pathname.startsWith(link.href + '/')));
          const isOpen = expandedGroups[link.href] ?? (childActive || (selfActive && hasKids));
          const rowCls = (active: boolean) =>
            `flex items-center gap-3 mx-3 px-4 py-2.5 my-0.5 rounded-2xl text-sm transition-all ${
              active
                ? 'bg-gradient-pink text-white font-semibold shadow-glow'
                : 'text-ink-soft hover:bg-white/60 hover:text-ink'
            }`;
          const chevron = hasKids && (
            <span className="ml-auto">{isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
          );
          return (
            <div key={link.href}>
              {isGroupOnly ? (
                <button
                  type="button"
                  onClick={() => setExpandedGroups((prev) => ({ ...prev, [link.href]: !isOpen }))}
                  className={`w-[calc(100%-1.5rem)] ${rowCls(childActive)}`}
                >
                  <link.icon size={18} />
                  {link.label[locale]}
                  {chevron}
                </button>
              ) : (
                <Link
                  href={link.href}
                  onClick={() => {
                    if (hasKids) setExpandedGroups((prev) => ({ ...prev, [link.href]: true }));
                    setMobileNavOpen(false);
                  }}
                  className={rowCls(selfActive && !childActive)}
                >
                  <link.icon size={18} />
                  {link.label[locale]}
                  {chevron}
                </Link>
              )}
              {hasKids && isOpen && kids.map((c) => {
                const cActive = pathname === c.href || pathname.startsWith(c.href + '/');
                return (
                  <Link
                    key={c.href}
                    href={c.href}
                    onClick={() => setMobileNavOpen(false)}
                    className={`flex items-center gap-2.5 ml-9 mr-3 px-3.5 py-2 my-0.5 rounded-xl text-[13px] transition-all ${
                      cActive
                        ? 'bg-gradient-pink text-white font-semibold shadow-glow'
                        : 'text-ink-soft hover:bg-white/60 hover:text-ink'
                    }`}
                  >
                    <c.icon size={15} />
                    {c.label[locale]}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="p-4 border-t border-white/40 space-y-3">
        {/* Push notifications — only offered to roles that receive staff
            notifications (bookings permission = admin + cs). */}
        {hasPermission('bookings') && <AdminPushSetup />}
        <Link
          href="/"
          onClick={() => setMobileNavOpen(false)}
          className="flex items-center gap-2 text-sm text-ink-soft hover:text-pink transition-colors"
        >
          <ChevronLeft size={16} />
          {locale === 'zh' ? '返回網站' : 'Back to Site'}
        </Link>
      </div>
    </div>
  );

  return (
    <div className="pt-28 min-h-screen flex">
      {/* Desktop sidebar (lg+) */}
      <aside className="w-64 fixed left-0 top-28 bottom-0 hidden lg:flex flex-col">
        {sidebarBody}
      </aside>

      {/* Mobile hamburger — small floating pill on the top-left of the
          content area, visible only below the lg breakpoint. */}
      <button
        type="button"
        onClick={() => setMobileNavOpen(true)}
        className="lg:hidden fixed top-32 left-4 z-30 inline-flex items-center gap-2 px-3 py-2 rounded-full glass-strong text-ink shadow-md"
        aria-label={locale === 'zh' ? '打開選單' : 'Open menu'}
      >
        <Menu size={18} />
        <span className="text-xs font-semibold">{locale === 'zh' ? '選單' : 'Menu'}</span>
      </button>

      {/* Mobile drawer (below lg). Backdrop closes on tap; the inner
          panel slides in from the left and contains the same sidebarBody. */}
      {mobileNavOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 z-40 bg-black/40"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="lg:hidden fixed left-0 top-0 bottom-0 z-50 w-72 flex flex-col">
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="absolute top-6 right-6 z-50 p-1.5 rounded-full bg-white/80 text-ink"
              aria-label={locale === 'zh' ? '關閉選單' : 'Close menu'}
            >
              <X size={18} />
            </button>
            {sidebarBody}
          </aside>
        </>
      )}

      {/* Main Content */}
      <main className="flex-1 lg:ml-64 p-6 md:p-10">
        <TestEnvBanner locale={locale} />
        {children}
      </main>
    </div>
  );
}
