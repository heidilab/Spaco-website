'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * KPay UAT 測試工具 — 執行 KPay 認證測試案例表格用。
 * kpay-integration branch only. Remove before merging to main.
 *
 * 冇 auth：只存在於測試分支 deployment，開單全部行 UAT sandbox，
 * 唔會影響真實預訂（webhook 對 UAT 單一律 ACK + 唔郁 booking）。
 */

interface Callback {
  receivedAt: string;
  verifyOk: boolean;
  eventType?: string;
  orderNo?: string;
  transactionState?: number;
  transactionStateDesc?: string;
  payAmount?: number;
  tradeNo?: string;
}

interface UatOrder {
  outTradeNo: string;
  managedOrderNo: string;
  amount: number;
  note: string;
  cashierUrl: string;
  createdAt: string;
  orderNo: string | null;
  callbacks: Callback[];
}

const STATE_LABEL: Record<number, string> = {
  1: '處理中',
  2: '✅ 成功',
  3: '❌ 失敗',
  4: '↩️ 已退款',
  5: '🚫 已取消',
};

function stateBadge(cb: Callback): string {
  const s = cb.transactionState;
  const label = (s && STATE_LABEL[s]) || cb.transactionStateDesc || `state=${s}`;
  return `${cb.eventType || '?'} ${label}`;
}

export default function KpayUatPage() {
  const [amount, setAmount] = useState('1.00');
  const [note, setNote] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<UatOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<UatOrder[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [refundResult, setRefundResult] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch('/api/kpay/uat');
      const data = await res.json();
      if (data.orders) setOrders(data.orders);
      else setError(data.error || '載入失敗');
    } catch (e) {
      setError(e instanceof Error ? e.message : '載入失敗');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function createOrder() {
    setError(null);
    setCreated(null);
    setCreating(true);
    try {
      const res = await fetch('/api/kpay/uat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', amount: Number(amount), note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setCreated(data);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '開單失敗');
    } finally {
      setCreating(false);
    }
  }

  async function doRefund(o: UatOrder) {
    if (!o.orderNo) return;
    const amt = window.prompt(
      `退款金額（原單 HK$${o.amount}）：\n・全額退款 → 直接按確定\n・部分退款 → 改細個數`,
      String(o.amount),
    );
    if (amt === null) return;
    setRefunding(o.outTradeNo);
    setRefundResult(null);
    try {
      const res = await fetch('/api/kpay/uat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refund', oriOrderNo: o.orderNo, amount: Number(amt) }),
      });
      const data = await res.json();
      setRefundResult(
        data.ok
          ? `✅ 退款請求成功（${o.outTradeNo}）— 記住去下面撳「重新整理」等 REFUND 回調`
          : `❌ 退款失敗：code=${data.code} ${data.reason || data.message || ''}（呢個可能正正就係「退款失敗」測試案例想要嘅結果）`,
      );
      refresh();
    } catch (e) {
      setRefundResult(`❌ ${e instanceof Error ? e.message : '退款請求出錯'}`);
    } finally {
      setRefunding(null);
    }
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text);
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 px-4 py-8 md:px-10">
      <div className="max-w-5xl mx-auto space-y-8">
        <header>
          <h1 className="text-2xl font-bold">🧪 KPay UAT 測試工具</h1>
          <p className="text-sm text-gray-500 mt-1">
            內部測試用 · 只限 kpay-integration 分支 · 所有訂單行 KPay UAT sandbox
          </p>
        </header>

        {/* 建立訂單 */}
        <section className="bg-white rounded-xl shadow p-6 space-y-4">
          <h2 className="font-bold text-lg">1️⃣ 建立測試訂單</h2>
          <div className="flex flex-wrap gap-3 items-end">
            <label className="block">
              <span className="text-sm text-gray-600">金額 (HK$)</span>
              <input
                type="number" step="0.01" min="0.1" value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="block border rounded-lg px-3 py-2 w-32 mt-1"
              />
            </label>
            <label className="block flex-1 min-w-48">
              <span className="text-sm text-gray-600">備註（填 Excel 案例編號，例：案例1 信用卡支付成功）</span>
              <input
                type="text" value={note}
                onChange={(e) => setNote(e.target.value)}
                className="block border rounded-lg px-3 py-2 w-full mt-1"
              />
            </label>
            <button
              onClick={createOrder} disabled={creating}
              className="bg-pink-600 text-white font-bold px-6 py-2.5 rounded-lg hover:bg-pink-700 disabled:opacity-50"
            >
              {creating ? '開緊單…' : '建立訂單'}
            </button>
          </div>
          <div className="text-xs text-gray-500">
            快速金額：
            {['1.00', '2.00', '10.81', '10.82'].map((a) => (
              <button key={a} onClick={() => setAmount(a)} className="ml-2 underline hover:text-pink-600">
                ${a}
              </button>
            ))}
            <span className="ml-3">（PayMe 測試：成功用 xx.81 / 失敗用 xx.82）</span>
          </div>

          {created && (
            <div className="border-2 border-pink-500 rounded-lg p-4 bg-pink-50 space-y-2">
              <p className="font-bold">✅ 訂單已建立 — 未付款住！</p>
              <p className="text-sm">
                訂單號（Excel G 欄用）：
                <code className="bg-white px-2 py-0.5 rounded border ml-1">{created.outTradeNo}</code>
                <button onClick={() => copy(created.outTradeNo)} className="ml-2 text-pink-600 underline text-xs">複製</button>
              </p>
              <a
                href={created.cashierUrl}
                className="inline-block bg-pink-600 text-white font-bold px-6 py-2.5 rounded-lg hover:bg-pink-700"
              >
                去 KPay 收銀台付款 →
              </a>
            </div>
          )}
          {error && <p className="text-sm text-rose-600">⚠️ {error}</p>}
        </section>

        {/* 訂單記錄 */}
        <section className="bg-white rounded-xl shadow p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-lg">2️⃣ 訂單記錄 + 回調通知</h2>
            <button
              onClick={refresh} disabled={loadingList}
              className="border px-4 py-1.5 rounded-lg text-sm hover:bg-gray-100 disabled:opacity-50"
            >
              {loadingList ? '載入中…' : '🔄 重新整理'}
            </button>
          </div>
          {refundResult && <p className="text-sm bg-amber-50 border border-amber-300 rounded p-2">{refundResult}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-3">時間</th>
                  <th className="py-2 pr-3">備註</th>
                  <th className="py-2 pr-3">金額</th>
                  <th className="py-2 pr-3">訂單號 (G欄)</th>
                  <th className="py-2 pr-3">回調通知</th>
                  <th className="py-2">動作</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.outTradeNo} className="border-b align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {new Date(o.createdAt).toLocaleString('zh-HK', { hour12: false })}
                    </td>
                    <td className="py-2 pr-3">{o.note || '—'}</td>
                    <td className="py-2 pr-3">${o.amount}</td>
                    <td className="py-2 pr-3">
                      <code className="text-xs">{o.outTradeNo}</code>
                      <button onClick={() => copy(o.outTradeNo)} className="ml-1 text-pink-600 underline text-xs">複製</button>
                    </td>
                    <td className="py-2 pr-3">
                      {o.callbacks.length === 0 && <span className="text-gray-400">未收到</span>}
                      {o.callbacks.map((cb, i) => (
                        <div key={i} className="whitespace-nowrap">
                          {stateBadge(cb)}
                          <span className={cb.verifyOk ? 'text-green-600' : 'text-rose-600'}>
                            {cb.verifyOk ? ' 簽名✓' : ' 簽名✗'}
                          </span>
                          <span className="text-gray-400 text-xs ml-1">
                            {new Date(cb.receivedAt).toLocaleTimeString('zh-HK', { hour12: false })}
                          </span>
                        </div>
                      ))}
                    </td>
                    <td className="py-2 whitespace-nowrap">
                      <a href={o.cashierUrl} className="text-pink-600 underline text-xs mr-2">再開收銀台</a>
                      {o.orderNo && (
                        <button
                          onClick={() => doRefund(o)}
                          disabled={refunding === o.outTradeNo}
                          className="border border-rose-400 text-rose-600 px-2 py-0.5 rounded text-xs hover:bg-rose-50 disabled:opacity-50"
                        >
                          {refunding === o.outTradeNo ? '退緊…' : '退款'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-gray-400">未有測試訂單</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400">
            付款完成後 KPay 通常幾秒內送回調 — 撳「重新整理」直到見到通知出現。「簽名✓」= 我哋成功驗證 KPay 簽名（Excel 入面「確認收到通知回調」嘅證據）。
          </p>
        </section>
      </div>
    </div>
  );
}
