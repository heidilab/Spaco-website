'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import {
  Mail, Eye, Send, ToggleLeft, ToggleRight, Loader2, X, AlertCircle,
  User as UserIcon, Users as StaffIcon, Check, RefreshCw,
} from 'lucide-react';

interface AutomationRow {
  key: string;
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  trigger: { zh: string; en: string };
  audience: 'customer' | 'staff';
  enabled: boolean;
}

export default function EmailAutomationPage() {
  const locale = useLocale() as 'zh' | 'en';
  const { hasPermission } = useAuth();
  const canAccess = hasPermission('gcal');

  const [rows, setRows] = useState<AutomationRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [previewSubject, setPreviewSubject] = useState<string>('');
  const [testEmail, setTestEmail] = useState('spacohk@gmail.com');

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/email-automation');
      const data = await res.json();
      setRows(data.automations || []);
    } catch {
      setFlash({ kind: 'err', text: locale === 'zh' ? '載入失敗' : 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (canAccess) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  async function handleToggle(key: string, nextEnabled: boolean) {
    setBusyKey(key);
    try {
      const res = await fetch('/api/admin/email-automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', key, enabled: nextEnabled }),
      });
      if (!res.ok) throw new Error('toggle failed');
      setRows((prev) => prev?.map((r) => r.key === key ? { ...r, enabled: nextEnabled } : r) || null);
      setFlash({
        kind: 'ok',
        text: nextEnabled
          ? (locale === 'zh' ? '✅ 已啟用' : '✅ Enabled')
          : (locale === 'zh' ? '⏸️ 已暫停' : '⏸️ Paused'),
      });
      setTimeout(() => setFlash(null), 2500);
    } catch {
      setFlash({ kind: 'err', text: locale === 'zh' ? '更新失敗' : 'Update failed' });
    } finally {
      setBusyKey(null);
    }
  }

  async function handlePreview(key: string) {
    setBusyKey(key);
    try {
      const res = await fetch('/api/admin/email-automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'preview', key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'preview failed');
      setPreviewKey(key);
      setPreviewSubject(data.subject);
      setPreviewHtml(data.html);
    } catch (err) {
      setFlash({
        kind: 'err',
        text: (locale === 'zh' ? '預覽失敗：' : 'Preview failed: ') +
          (err instanceof Error ? err.message : 'unknown'),
      });
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSendTest(key: string) {
    if (!testEmail) {
      setFlash({ kind: 'err', text: locale === 'zh' ? '請先輸入測試 email' : 'Enter a test email first' });
      return;
    }
    setBusyKey(key);
    try {
      const res = await fetch('/api/admin/email-automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', key, to: testEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'test failed');
      setFlash({
        kind: 'ok',
        text: (locale === 'zh' ? `✅ 測試 email 已寄到 ${testEmail}` : `✅ Test email sent to ${testEmail}`),
      });
      setTimeout(() => setFlash(null), 4000);
    } catch (err) {
      setFlash({
        kind: 'err',
        text: (locale === 'zh' ? '測試發送失敗：' : 'Test send failed: ') +
          (err instanceof Error ? err.message : 'unknown'),
      });
    } finally {
      setBusyKey(null);
    }
  }

  if (!canAccess) {
    return (
      <div className="text-center py-20 text-ink-soft">
        {locale === 'zh' ? '無權限存取' : 'Access Denied'}
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-pill bg-white/60 border border-charcoal/10 mb-4">
          <Mail size={14} className="text-pink" />
          <span className="text-xs font-medium text-ink-soft">Email Automation</span>
        </div>
        <h1 className="text-heading">
          {locale === 'zh' ? 'Email ' : 'Email '}
          <span className="text-gradient-pink">{locale === 'zh' ? '自動化' : 'Automation'}</span>
        </h1>
        <p className="mt-3 text-ink-soft max-w-2xl">
          {locale === 'zh'
            ? '管理所有自動發出嘅 email：開／關、預覽內容、發測試信。暫停某個 automation 之後，相關 trigger 仍然會行其他邏輯（更新 booking、push gcal 等），淨係唔會發 email。'
            : 'Toggle automated emails on/off, preview their rendering, and send test versions. Pausing an automation only suppresses the email — the rest of the trigger still fires (booking updates, gcal push, etc.).'}
        </p>
      </div>

      {/* Test email input */}
      <div className="glass-card p-5 mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
        <label className="text-sm font-semibold text-ink-soft shrink-0">
          {locale === 'zh' ? '測試收件人：' : 'Test recipient:'}
        </label>
        <input
          type="email"
          value={testEmail}
          onChange={(e) => setTestEmail(e.target.value)}
          placeholder="spacohk@gmail.com"
          className="flex-1 px-3 py-2 rounded-lg border border-charcoal/10 bg-white text-sm focus:outline-none focus:border-accent"
        />
        <p className="text-xs text-ink-soft">
          {locale === 'zh' ? '撳「測試」會寄個用 sample data 嘅版本到呢個 email' : 'Send buttons send a sample-data version to this address'}
        </p>
      </div>

      {flash && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm ${
          flash.kind === 'ok' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
        }`}>
          {flash.text}
        </div>
      )}

      {loading || !rows ? (
        <div className="glass-card p-10 text-center text-ink-soft">
          <Loader2 size={20} className="animate-spin inline mr-2" />
          {locale === 'zh' ? '載入中…' : 'Loading…'}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.key} className="glass-card p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-[10px] font-semibold ${
                      r.audience === 'staff'
                        ? 'bg-violet-100 text-violet-700'
                        : 'bg-pink-100 text-pink-700'
                    }`}>
                      {r.audience === 'staff' ? <StaffIcon size={10} /> : <UserIcon size={10} />}
                      {r.audience === 'staff' ? (locale === 'zh' ? '內部' : 'Staff') : (locale === 'zh' ? '客人' : 'Customer')}
                    </span>
                    <h3 className="font-bold text-ink">{r.name[locale]}</h3>
                  </div>
                  <p className="text-sm text-ink-soft mt-1">{r.description[locale]}</p>
                  <p className="text-xs text-ink-soft mt-2 italic">
                    {locale === 'zh' ? '何時觸發：' : 'Trigger: '}{r.trigger[locale]}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handlePreview(r.key)}
                    disabled={busyKey === r.key}
                    className="px-3 py-1.5 rounded-lg bg-white/70 border border-charcoal/10 text-xs font-medium hover:bg-white inline-flex items-center gap-1 disabled:opacity-40"
                    title={locale === 'zh' ? '預覽' : 'Preview'}
                  >
                    <Eye size={13} /> {locale === 'zh' ? '預覽' : 'Preview'}
                  </button>
                  <button
                    onClick={() => handleSendTest(r.key)}
                    disabled={busyKey === r.key || !testEmail}
                    className="px-3 py-1.5 rounded-lg bg-white/70 border border-charcoal/10 text-xs font-medium hover:bg-white inline-flex items-center gap-1 disabled:opacity-40"
                    title={locale === 'zh' ? '發測試信' : 'Send test'}
                  >
                    <Send size={13} /> {locale === 'zh' ? '測試' : 'Test'}
                  </button>
                  <button
                    onClick={() => handleToggle(r.key, !r.enabled)}
                    disabled={busyKey === r.key}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40 ${
                      r.enabled
                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                        : 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                    }`}
                  >
                    {r.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                    {r.enabled ? (locale === 'zh' ? '已啟用' : 'On') : (locale === 'zh' ? '已暫停' : 'Off')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Preview modal */}
      {previewKey && (
        <div className="fixed inset-0 z-50 bg-charcoal/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-glass-lg max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-charcoal/10">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-ink-soft mb-1">
                  {locale === 'zh' ? '預覽（用 sample 資料）' : 'Preview (sample data)'}
                </p>
                <p className="font-semibold text-ink truncate">{previewSubject}</p>
              </div>
              <button
                onClick={() => setPreviewKey(null)}
                className="w-9 h-9 rounded-full hover:bg-white/60 flex items-center justify-center shrink-0"
              >
                <X size={16} />
              </button>
            </div>
            <iframe
              srcDoc={previewHtml}
              title="email-preview"
              className="flex-1 w-full bg-cream"
              sandbox=""
            />
          </div>
        </div>
      )}
    </div>
  );
}
