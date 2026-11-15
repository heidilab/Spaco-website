import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { getConnectionStatus, getReceiptsConfig, isConfigured } from '@/lib/msgraph';
import { branchOptions, listRecentReceiptFiles } from '@/lib/receiptIngest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/onedrive/status → everything the 後台 page needs in one call.
export async function GET(req: Request) {
  const gate = await requireAdmin(req, 'staff');
  if (!gate.ok) return gate.res;
  const configured = isConfigured();
  const [connection, cfg, branches, recent] = await Promise.all([
    configured ? getConnectionStatus().catch(() => ({ connected: false })) : Promise.resolve({ connected: false }),
    getReceiptsConfig(),
    branchOptions(),
    listRecentReceiptFiles(30).catch(() => []),
  ]);
  const safeCfg = { ...cfg } as Partial<typeof cfg>;
  delete safeCfg.deltaLink;
  const toIso = (v: unknown) => (v && typeof (v as { toDate?: () => Date }).toDate === 'function' ? (v as { toDate: () => Date }).toDate().toISOString() : null);
  return NextResponse.json({
    configured, connection, branches, recent,
    config: { ...safeCfg, lastScanAt: toIso(cfg.lastScanAt), updatedAt: toIso(cfg.updatedAt), hasDelta: !!cfg.deltaLink },
  });
}
