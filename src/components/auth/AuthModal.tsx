'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { X, Mail, User as UserIcon } from 'lucide-react';
import { signInWithGoogle, signInWithEmail, registerWithEmail } from '@/lib/auth';
import { motion, AnimatePresence } from 'framer-motion';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const locale = useLocale();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const t = {
    login: locale === 'zh' ? '登入' : 'Log In',
    register: locale === 'zh' ? '註冊' : 'Sign Up',
    google: locale === 'zh' ? '以 Google 帳號登入' : 'Continue with Google',
    or: locale === 'zh' ? '或' : 'or',
    email: locale === 'zh' ? '電郵地址' : 'Email',
    password: locale === 'zh' ? '密碼' : 'Password',
    name: locale === 'zh' ? '姓名' : 'Full Name',
    noAccount: locale === 'zh' ? '未有帳號？' : "Don't have an account?",
    hasAccount: locale === 'zh' ? '已有帳號？' : 'Already have an account?',
    submit: locale === 'zh' ? (mode === 'login' ? '登入' : '建立帳號') : (mode === 'login' ? 'Log In' : 'Create Account'),
  };

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      setError('');
      await signInWithGoogle();
      onClose();
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        // Customer closed the Google window — not an error, invite retry.
        setError(locale === 'zh'
          ? 'Google 登入視窗已關閉，請再撳一次「以 Google 帳號登入」完成登入。'
          : 'The Google sign-in window was closed — tap "Sign in with Google" again to continue.');
      } else if (code === 'auth/network-request-failed') {
        setError(locale === 'zh' ? '網絡不穩定，請檢查連線後再試。' : 'Network issue — please check your connection and retry.');
      } else {
        const message = err instanceof Error ? err.message : 'Login failed';
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError('');
      if (mode === 'login') {
        await signInWithEmail(email, password);
      } else {
        await registerWithEmail(email, password, name);
      }
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Auth failed';
      if (message.includes('wrong-password') || message.includes('user-not-found')) {
        setError(locale === 'zh' ? '電郵或密碼錯誤' : 'Invalid email or password');
      } else if (message.includes('email-already-in-use')) {
        setError(locale === 'zh' ? '此電郵已被註冊' : 'Email already registered');
      } else if (message.includes('weak-password')) {
        setError(locale === 'zh' ? '密碼至少需要 6 個字元' : 'Password must be at least 6 characters');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-ink/55 backdrop-blur-md"
            onClick={onClose}
          />

          {/* Modal — centered via parent flex; framer-motion only animates opacity/scale */}
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-md"
          >
            <div className="glass-strong rounded-[28px] p-7 md:p-8 shadow-glass-lg max-h-[90vh] overflow-y-auto">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold font-display text-gradient-pink">
                  {mode === 'login' ? t.login : t.register}
                </h2>
                <button
                  onClick={onClose}
                  className="w-9 h-9 rounded-full bg-white/60 flex items-center justify-center hover:bg-white/90 transition-colors text-ink-soft hover:text-ink"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Google Login */}
              <button
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 px-4 py-3.5 bg-white/80 backdrop-blur-md border border-white/80 rounded-pill font-medium hover:bg-white text-ink transition-all disabled:opacity-50 hover:-translate-y-0.5"
              >
                <svg width="20" height="20" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                {t.google}
              </button>

              {/* Divider */}
              <div className="flex items-center gap-4 my-5">
                <div className="flex-1 h-px bg-ink/10" />
                <span className="text-xs text-ink-soft uppercase tracking-wider font-semibold">{t.or}</span>
                <div className="flex-1 h-px bg-ink/10" />
              </div>

              {/* Email Form */}
              <form onSubmit={handleEmailSubmit} className="space-y-4">
                {mode === 'register' && (
                  <div>
                    <label className="text-sm text-ink-soft mb-1.5 block font-medium">{t.name}</label>
                    <div className="relative">
                      <UserIcon size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-soft" />
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        className="w-full pl-11 pr-4 py-3 rounded-pill bg-white/70 backdrop-blur-md border border-white/80 focus:outline-none focus:border-pink/50 focus:bg-white text-ink"
                        placeholder={t.name}
                      />
                    </div>
                  </div>
                )}
                <div>
                  <label className="text-sm text-ink-soft mb-1.5 block font-medium">{t.email}</label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-soft" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full pl-11 pr-4 py-3 rounded-pill bg-white/70 backdrop-blur-md border border-white/80 focus:outline-none focus:border-pink/50 focus:bg-white text-ink"
                      placeholder={t.email}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm text-ink-soft mb-1.5 block font-medium">{t.password}</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="w-full px-5 py-3 rounded-pill bg-white/70 backdrop-blur-md border border-white/80 focus:outline-none focus:border-pink/50 focus:bg-white text-ink"
                    placeholder="••••••"
                  />
                </div>

                {error && (
                  <p className="text-rose-700 text-sm bg-rose-100/80 border border-rose-200 p-3 rounded-2xl">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full btn-primary justify-center py-3.5 disabled:opacity-50"
                >
                  {loading ? '...' : t.submit}
                </button>
              </form>

              {/* Toggle mode */}
              <p className="text-center text-sm text-ink-soft mt-6">
                {mode === 'login' ? t.noAccount : t.hasAccount}{' '}
                <button
                  onClick={() => {
                    setMode(mode === 'login' ? 'register' : 'login');
                    setError('');
                  }}
                  className="text-pink font-semibold hover:underline"
                >
                  {mode === 'login' ? t.register : t.login}
                </button>
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
