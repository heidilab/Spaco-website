'use client';

/**
 * Internal SOP — how to handle lock passcodes for branches whose locks
 * aren't connected to a TTLock gateway yet. Linked from the booking
 * detail page's lock-passcode panel when it's in manual mode.
 */

import { useState, useEffect } from 'react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useAuth } from '@/contexts/AuthContext';
import { getSiteContent } from '@/lib/content';
import {
  ArrowLeft, KeyRound, Smartphone, Type, Send, AlertTriangle,
  CheckCircle2, Clock, Building2, BookOpen,
} from 'lucide-react';

// The branches whose lock status this SOP reflects. Order + names only;
// connected/manual status is read LIVE from the lock config below.
const LOCK_VENUES: { id: string; name: { zh: string; en: string } }[] = [
  { id: 'cwb',     name: { zh: '銅鑼灣 (CWB)', en: 'Causeway Bay' } },
  { id: 'wanchai', name: { zh: '灣仔 (Wanchai)', en: 'Wan Chai' } },
  { id: 'sw-a',    name: { zh: '上環 Room A (SW-A)', en: 'Sheung Wan A' } },
  { id: 'sw-b',    name: { zh: '上環 Room B (SW-B)', en: 'Sheung Wan B' } },
  { id: 'sw-ab',   name: { zh: '上環全層 (SW-AB)', en: 'Sheung Wan A+B' } },
  { id: 'tst',     name: { zh: '尖沙咀 (TST)', en: 'Tsim Sha Tsui' } },
];

export default function ManualLockPasscodeSopPage() {
  const locale = useLocale() as 'zh' | 'en';
  const { hasPermission } = useAuth();
  const canAccess = hasPermission('bookings');

  // Live lockId map (venueId → lockId), read from the same Firestore
  // settings the passcode engine uses. Mirrors getVenueLockMap() so the
  // table below reflects reality — set a lockId in 內容管理 → 系統設定 and
  // this branch flips to "connected" with no code change.
  const [lockMap, setLockMap] = useState<Record<string, number>>({});
  const [loadingLocks, setLoadingLocks] = useState(true);
  useEffect(() => {
    if (!canAccess) return;
    (async () => {
      try {
        const cms = await getSiteContent('settings');
        const map: Record<string, number> = {};
        if (cms) {
          for (const [k, v] of Object.entries(cms)) {
            if (!k.startsWith('ttlock_')) continue;
            const raw = ((v as { zh?: string; en?: string })?.zh || (v as { zh?: string; en?: string })?.en || '').trim();
            const parsed = parseInt(raw, 10);
            if (Number.isFinite(parsed) && parsed > 0) map[k.slice('ttlock_'.length)] = parsed;
          }
        }
        setLockMap(map);
      } finally {
        setLoadingLocks(false);
      }
    })();
  }, [canAccess]);

  if (!canAccess) {
    return (
      <div className="text-center py-20 text-muted">
        {locale === 'zh' ? '無權限存取' : 'Access Denied'}
      </div>
    );
  }

  // The doc is bilingual-aware but the content is mostly Cantonese — admins/CS
  // are HK-based and the SOP describes a real ops workflow. English column
  // would be unmaintained noise, so we just translate the chrome.
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Link href="/admin" className="inline-flex items-center gap-2 text-sm text-ink-soft hover:text-pink">
        <ArrowLeft size={14} /> {locale === 'zh' ? '返回控制中心' : 'Back to dashboard'}
      </Link>

      <div className="flex items-center gap-3">
        <KeyRound size={28} className="text-pink" />
        <h1 className="text-heading">
          <span className="text-gradient-pink">{locale === 'zh' ? '手動門鎖密碼 SOP' : 'Manual Lock Passcode SOP'}</span>
        </h1>
      </div>

      <p className="text-sm text-ink-soft leading-relaxed">
        呢份指南係畀 admin / CS 用嘅。當有 booking 喺<strong> 未配 TTLock Gateway 嘅分店</strong>確認之後，
        系統唔可以自動 push 密碼落鎖 — 需要員工跟以下 4 步手動處理。
      </p>

      {/* Affected branches */}
      <div className="glass-card p-6 space-y-3">
        <h2 className="font-bold flex items-center gap-2">
          <Building2 size={18} className="text-pink" />
          {locale === 'zh' ? '受影響嘅分店' : 'Affected branches'}
        </h2>
        {loadingLocks ? (
          <p className="text-sm text-ink-soft animate-pulse">{locale === 'zh' ? '讀取門鎖設定中…' : 'Loading lock config…'}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-soft border-b">
                <th className="py-2">{locale === 'zh' ? '分店' : 'Branch'}</th>
                <th className="py-2">{locale === 'zh' ? '狀態' : 'Status'}</th>
                <th className="py-2 text-right">{locale === 'zh' ? '點處理' : 'Handling'}</th>
              </tr>
            </thead>
            <tbody>
              {LOCK_VENUES.map((v) => {
                const lockId = lockMap[v.id];
                const connected = !!lockId;
                return (
                  <tr key={v.id} className="border-b border-charcoal/10 last:border-0">
                    <td className="py-2 font-semibold">{v.name[locale]}</td>
                    <td className="py-2">
                      {connected ? (
                        <span className="chip text-[10px] bg-emerald-100 text-emerald-800">✅ {locale === 'zh' ? '已連接' : 'Connected'} · lockId {lockId}</span>
                      ) : (
                        <span className="chip text-[10px] bg-amber-100 text-amber-800">⚠️ {locale === 'zh' ? '未設定 lockId' : 'No lockId'}</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {connected
                        ? <span className="text-ink-soft">{locale === 'zh' ? '系統自動處理' : 'Automatic'}</span>
                        : <span className="font-medium text-pink">{locale === 'zh' ? '手動（跟下面 4 步）' : 'Manual (4 steps below)'}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="text-xs text-ink-soft">
          {locale === 'zh'
            ? '📌 呢個表即時反映真實設定。喺 內容管理 → 文字內容 → 系統設定 填返該分店嘅 lockId，個分店就會即刻轉做「已連接 · 系統自動」，唔需要改 code。'
            : '📌 This table is live. Set a branch\'s lockId in Content → Text → Settings and it flips to "Connected · Automatic" with no code change.'}
        </p>
      </div>

      {/* When to fire this SOP */}
      <div className="glass-card p-6 space-y-3">
        <h2 className="font-bold flex items-center gap-2">
          <Clock size={18} className="text-pink" />
          {locale === 'zh' ? '幾時要做？' : 'When to do this'}
        </h2>
        <ul className="text-sm space-y-2 text-ink list-disc pl-5">
          <li>
            <strong>客人付完款 / Admin approve 入數紙之後</strong>，個 booking 變「已確認」status
          </li>
          <li>
            <strong>活動前 2 日內</strong>係最遲處理時間（客人需要密碼入場）
          </li>
          <li>
            如果 booking 喺受影響分店：booking 詳情頁「門鎖密碼」panel 會顯示<strong className="text-pink">「手動」chip + 輸入位</strong>
          </li>
        </ul>
      </div>

      {/* The 4 steps */}
      <div className="glass-card p-6 space-y-5">
        <h2 className="font-bold flex items-center gap-2">
          <BookOpen size={18} className="text-pink" />
          {locale === 'zh' ? '4 步處理流程' : 'The 4 steps'}
        </h2>

        <StepCard
          step={1}
          icon={<Smartphone size={18} />}
          title="喺手機 TTLock app 入面生成密碼"
        >
          <ol className="list-decimal pl-5 text-sm space-y-1.5">
            <li>用 <code className="text-xs bg-charcoal/5 px-1.5 py-0.5 rounded">spacohk@gmail.com</code> 登入 TTLock app</li>
            <li>揀返對應嘅鎖（例如 &ldquo;cwb&rdquo;, &ldquo;SW Room A&rdquo;, &ldquo;TST 雲龍&rdquo; 等）</li>
            <li>撳「密碼」(Passcode) → 「生成密碼」(Generate)</li>
            <li>揀「自定期限密碼」(Custom period)，輸入：
              <ul className="list-disc pl-5 text-xs text-ink-soft mt-1">
                <li>開始時間：<strong>booking 開始時間 − 1 小時</strong>（例如 booking 8pm 開始就揀 7pm）</li>
                <li>結束時間：<strong>booking 結束時間</strong></li>
              </ul>
            </li>
            <li>App 會顯示一個 6 位數字密碼 — <strong>記住或截圖</strong></li>
          </ol>
          <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
            ⚠️ 如果鎖喺你 BLE 範圍內，密碼會即時同步落鎖。如果唔喺範圍，密碼會 queue 起，下次有員工開 TTLock app 行近個鎖就 sync。
          </div>
        </StepCard>

        <StepCard
          step={2}
          icon={<Type size={18} />}
          title="入後台輸入密碼"
        >
          <ol className="list-decimal pl-5 text-sm space-y-1.5">
            <li>入 <Link href="/admin/bookings" className="text-pink underline">Admin → 預訂管理</Link></li>
            <li>揀返該個 booking → 入詳情頁</li>
            <li>拉到「門鎖密碼」panel（panel 上面有粉紅色「手動」chip）</li>
            <li>喺輸入位 paste 你 step 1 生成嘅 6 位數密碼</li>
            <li>撳「<strong>儲存並寄 email</strong>」掣</li>
          </ol>
        </StepCard>

        <StepCard
          step={3}
          icon={<Send size={18} />}
          title="客人自動收到 email"
        >
          <p className="text-sm">系統會即刻寄一封門鎖密碼 email 畀客人，包括：</p>
          <ul className="list-disc pl-5 text-sm space-y-1 mt-2">
            <li>密碼數字 + 有效期</li>
            <li>場地地址</li>
            <li>分店嘅<strong>門鎖使用指南圖</strong></li>
            <li>「⚠️ 唔好觸摸圓形指模掣」等 4 項重要提醒</li>
          </ul>
          <p className="text-xs text-ink-soft mt-3">
            如果客人話冇收到 email，可以喺 panel 撳「<strong>重發 email 畀客人</strong>」掣再寄一次。
          </p>
        </StepCard>

        <StepCard
          step={4}
          icon={<CheckCircle2 size={18} />}
          title="活動當日確認"
        >
          <ul className="list-disc pl-5 text-sm space-y-1">
            <li>客人應該可以喺活動開始前 1 小時起用密碼開鎖</li>
            <li>如果客人到場開唔到，先 check 佢有冇<strong>掂咗指模掣</strong>（重要！）— 應該叫佢直接撳數字鍵</li>
            <li>如果係 BLE-queued 密碼（鎖未 sync），可能要員工帶 TTLock app 行去鎖附近 sync 一次</li>
          </ul>
        </StepCard>
      </div>

      {/* Common issues */}
      <div className="glass-card p-6 space-y-3">
        <h2 className="font-bold flex items-center gap-2">
          <AlertTriangle size={18} className="text-amber-500" />
          常見問題
        </h2>
        <div className="space-y-3 text-sm">
          <div>
            <p className="font-semibold">❓ TTLock app 揾唔到對應嘅鎖？</p>
            <p className="text-ink-soft pl-4">
              Confirm 你用緊 <code className="text-xs bg-charcoal/5 px-1 rounded">spacohk@gmail.com</code> 登入。
              如果仲係冇，可能要由公司頭啦 transfer 個 lock 嘅 owner / share access 畀你。
            </p>
          </div>
          <div>
            <p className="font-semibold">❓ 客人話密碼錯誤？</p>
            <p className="text-ink-soft pl-4">
              90% 個 case 係佢掂咗圓形指模掣。叫佢<strong>直接撳數字鍵</strong>輸入密碼，唔好掂指模掣。
            </p>
          </div>
          <div>
            <p className="font-semibold">❓ 入錯密碼之後想改？</p>
            <p className="text-ink-soft pl-4">
              喺後台 panel 撳「重發 email」之前要先 delete 舊密碼。而家無 UI 直接刪密碼 — 可以 contact 開發者，或者直接 input 新密碼覆寫舊 record（舊密碼仍然 valid，但 email 顯示嘅係新嗰個）。
            </p>
          </div>
        </div>
      </div>

      <p className="text-xs text-center text-ink-soft py-4">
        最後更新：2026-05-12 · 將來 Gateway 安裝完成後此頁將失效
      </p>
    </div>
  );
}

function StepCard({
  step, icon, title, children,
}: {
  step: number;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-charcoal/10 rounded-xl p-5">
      <div className="flex items-center gap-3 mb-3">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gradient-pink text-white font-bold text-sm">
          {step}
        </span>
        <span className="text-pink">{icon}</span>
        <h3 className="font-semibold">{title}</h3>
      </div>
      <div className="ml-10 text-ink">{children}</div>
    </div>
  );
}
