'use client';

import { useState, useRef, useEffect } from 'react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useAuth } from '@/contexts/AuthContext';
import { signOut } from '@/lib/auth';
import { LogOut, CalendarDays, Shield, ChevronDown } from 'lucide-react';

export default function UserMenu() {
  const { user, isAdminUser } = useAuth();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!user) return null;

  const initial = user.displayName?.[0] || user.email?.[0] || '?';

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-charcoal/5 transition-colors"
      >
        {user.photoURL ? (
          <img
            src={user.photoURL}
            alt=""
            className="w-8 h-8 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center text-sm font-bold">
            {initial.toUpperCase()}
          </div>
        )}
        <span className="text-sm font-medium hidden md:block max-w-[120px] truncate">
          {user.displayName || user.email}
        </span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-2xl shadow-lg border border-charcoal/5 py-2 z-50">
          {/* User info */}
          <div className="px-4 py-3 border-b border-charcoal/5">
            <p className="text-sm font-medium truncate">{user.displayName || user.email}</p>
            <p className="text-xs text-muted truncate">{user.email}</p>
          </div>

          {/* Links */}
          <div className="py-1">
            <Link
              href="/my-bookings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-cream transition-colors"
            >
              <CalendarDays size={16} className="text-muted" />
              {locale === 'zh' ? '我的預訂' : 'My Bookings'}
            </Link>

            {isAdminUser && (
              <Link
                href="/admin"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-cream transition-colors"
              >
                <Shield size={16} className="text-accent" />
                {locale === 'zh' ? '管理後台' : 'Admin Panel'}
              </Link>
            )}
          </div>

          {/* Logout */}
          <div className="border-t border-charcoal/5 pt-1">
            <button
              onClick={() => {
                signOut();
                setOpen(false);
              }}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 w-full transition-colors"
            >
              <LogOut size={16} />
              {locale === 'zh' ? '登出' : 'Log Out'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
