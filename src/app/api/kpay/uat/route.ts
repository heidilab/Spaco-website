import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebaseAdmin';
import {
  createManagedOrder,
  buildCashierRedirectUrl,
  refundOrder,
  isKpayConfigured,
  getPublicOrigin,
} from '@/lib/kpay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * KPay UAT test-case harness — backs /kpay-uat.
 *
 * Exists so the KPay certification spreadsheet can be executed without
 * going through the real booking flow (several cases need exact
 * amounts like xx.81 / xx.82 that bookings can't produce).
 *
 * kpay-integration branch only. Remove before merging to main.
 *
 * POST { action: 'create', amount, note? }
 *   → creates a managed order, records it in _kpay_uat_orders,
 *     returns { outTradeNo, managedOrderNo, cashierUrl }
 * POST { action: 'refund', oriOrderNo, amount }
 *   → fires /v1/refund against the ORIGINAL transaction's orderNo
 *     (from the SALES callback), returns KPay's sync result verbatim
 * GET → recent UAT orders, each joined with its webhook callbacks
 *     from _kpay_webhook_debug (matched by outTradeNo in the raw body)
 */

interface UatOrderDoc {
  outTradeNo: string;
  managedOrderNo: string;
  amount: number;
  note: string;
  cashierUrl: string;
  createdAt: string;
}

export async function POST(req: NextRequest) {
  if (!isKpayConfigured()) {
    return NextResponse.json({ error: 'KPay 未設定（env vars 缺失）' }, { status: 500 });
  }
  try {
    const body = await req.json() as {
      action: 'create' | 'refund';
      amount?: number;
      note?: string;
      oriOrderNo?: string;
      origOutTradeNo?: string;
    };

    if (body.action === 'create') {
      const amount = Number(body.amount);
      if (!amount || amount <= 0) {
        return NextResponse.json({ error: '請輸入正確金額' }, { status: 400 });
      }
      // UAT prefix keeps these clearly separate from real bookings —
      // the webhook's B<prefix> booking lookup never matches, so it
      // ACKs with notFound and touches nothing.
      const outTradeNo = `UAT${Date.now()}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 32);
      const origin = getPublicOrigin(req.nextUrl.origin);

      const create = await createManagedOrder({
        managedOutTradeNo: outTradeNo,
        payAmount: amount,
        returnUrl: `${origin}/kpay-uat?returned=${outTradeNo}`,
        notifyUrl: `${origin}/api/kpay/webhook`,
        itemList: [{
          itemNo: outTradeNo,
          itemName: `SPACO UAT — ${body.note || 'test'}`.slice(0, 100),
          price: amount,
          quantity: 1,
        }],
        orderRemark: `UAT test case: ${body.note || ''}`.slice(0, 200),
      });

      if (!create.ok || !create.managedOrderNo) {
        return NextResponse.json(
          { error: `KPay 開單失敗：code=${create.code} ${create.message || ''}` },
          { status: 502 },
        );
      }

      const cashierUrl = buildCashierRedirectUrl({ managedOrderNo: create.managedOrderNo });
      const doc: UatOrderDoc = {
        outTradeNo,
        managedOrderNo: create.managedOrderNo,
        amount,
        note: body.note || '',
        cashierUrl,
        createdAt: new Date().toISOString(),
      };
      await adminDb.collection('_kpay_uat_orders').doc(outTradeNo).set(doc);
      return NextResponse.json(doc);
    }

    if (body.action === 'refund') {
      const amount = Number(body.amount);
      if (!body.oriOrderNo || !amount || amount <= 0) {
        return NextResponse.json({ error: 'oriOrderNo + 正確金額必填' }, { status: 400 });
      }
      const origin = getPublicOrigin(req.nextUrl.origin);
      const refundOutTradeNo = `UATR${Date.now()}`.slice(0, 32);
      const result = await refundOrder({
        outTradeNo: refundOutTradeNo,
        oriOrderNo: body.oriOrderNo,
        refundAmount: amount,
        notifyUrl: `${origin}/api/kpay/webhook`,
      });
      // Link the refund to its original UAT order so the list view can
      // show the refund's own trade number (what the Excel's G column
      // wants for refund cases) and match its REFUND callback.
      if (body.origOutTradeNo) {
        await adminDb.collection('_kpay_uat_orders').doc(body.origOutTradeNo).set({
          refunds: FieldValue.arrayUnion({
            refundOutTradeNo,
            amount,
            at: new Date().toISOString(),
            ok: result.ok,
            code: result.code ?? null,
            reason: result.reason ?? result.message ?? null,
          }),
        }, { merge: true });
      }
      return NextResponse.json({ refundOutTradeNo, ...result });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const [ordersSnap, debugSnap] = await Promise.all([
      adminDb.collection('_kpay_uat_orders').orderBy('createdAt', 'desc').limit(40).get(),
      adminDb.collection('_kpay_webhook_debug').orderBy('receivedAt', 'desc').limit(200).get(),
    ]);

    const callbacks = debugSnap.docs.map((d) => {
      const data = d.data() as {
        receivedAt: string;
        body?: string;
        verifyOk?: boolean;
        matchedVariant?: string;
      };
      let parsed: {
        eventType?: string;
        outTradeNo?: string;
        managedMerchantOrderNo?: string;
        orderNo?: string;
        transactionState?: number;
        transactionStateDesc?: string;
        payAmount?: number;
        payMethodId?: number;
      } = {};
      try { parsed = JSON.parse(data.body || '{}'); } catch { /* raw kept below */ }
      return {
        receivedAt: data.receivedAt,
        verifyOk: data.verifyOk ?? false,
        rawBody: data.body || '',
        eventType: parsed.eventType,
        orderNo: parsed.orderNo,
        transactionState: parsed.transactionState,
        transactionStateDesc: parsed.transactionStateDesc,
        payAmount: parsed.payAmount,
        payMethodId: parsed.payMethodId,
        tradeNo: parsed.managedMerchantOrderNo || parsed.outTradeNo || '',
      };
    });

    const orders = ordersSnap.docs.map((d) => {
      const o = d.data() as UatOrderDoc & {
        refunds?: Array<{
          refundOutTradeNo: string;
          amount: number;
          at: string;
          ok: boolean;
          code: number | null;
          reason: string | null;
        }>;
      };
      const refundTradeNos = (o.refunds || []).map((r) => r.refundOutTradeNo);
      // A callback belongs to this order if it references the order's own
      // trade number, one of its refunds' trade numbers, or (for REFUND
      // notifies that only carry the original transaction) its orderNo.
      const mine = callbacks.filter((c) => {
        if (c.tradeNo === o.outTradeNo || c.rawBody.includes(o.outTradeNo)) return true;
        return refundTradeNos.some((rn) => c.tradeNo === rn || c.rawBody.includes(rn));
      });
      // Original transaction orderNo — needed as oriOrderNo for refunds.
      const sales = mine.find((c) => c.eventType === 'SALES' && c.orderNo);
      const orderNo = sales?.orderNo || null;
      const refundCallbacks = orderNo
        ? callbacks.filter(
            (c) => c.eventType === 'REFUND'
              && !mine.includes(c)
              && c.rawBody.includes(orderNo),
          )
        : [];
      return {
        ...o,
        refunds: o.refunds || [],
        orderNo,
        callbacks: [...mine, ...refundCallbacks].map(({ rawBody: _raw, ...rest }) => rest),
      };
    });

    return NextResponse.json({ orders });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}
