import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { folderDelta, getReceiptsConfig, saveReceiptsConfig } from '@/lib/msgraph';
import type { ExcelColumnKey, OneDriveExcelTarget, OneDriveReceiptsConfig } from '@/types';

export const runtime = 'nodejs';

const COLUMN_KEYS: ExcelColumnKey[] = ['id', 'date', 'branch', 'item', 'vendor', 'amount', 'category', 'note', 'reviewed', 'link'];

// POST /api/onedrive/config — save what Heidi picked. A newly chosen
// branch folder starts its delta from NOW (token=latest): files already in
// it are hers from before and are already in her Excel.
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, 'staff');
  if (!gate.ok) return gate.res;
  let body: Partial<OneDriveReceiptsConfig> & {
    clearExcel?: boolean;
    excelForBranch?: { branchKey: string; excel: Partial<OneDriveExcelTarget> };
    clearExcelForBranch?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const current = await getReceiptsConfig();
  const patch: Partial<OneDriveReceiptsConfig> = {};
  try {
    if (Array.isArray(body.branchFolders)) {
      const folders = body.branchFolders
        .filter((b) => b && b.id && b.branchKey)
        .map((b) => ({ id: String(b.id), name: String(b.name || ''), path: String(b.path || ''), branchKey: String(b.branchKey) }));
      // One folder per branch; the same folder may serve several branches
      // only by mistake, so keep the last choice per branch key.
      const byBranch = new Map(folders.map((f) => [f.branchKey, f]));
      patch.branchFolders = Array.from(byBranch.values());
      const deltaLinks: Record<string, string> = {};
      for (const f of patch.branchFolders) {
        const existing = current.deltaLinks?.[f.id];
        deltaLinks[f.id] = existing || (await folderDelta(f.id, 'latest')).deltaLink;
      }
      patch.deltaLinks = deltaLinks;
      patch.lastScanError = '';
    }
    if (body.clearExcel) {
      await saveReceiptsConfig({ ...patch, excel: null as unknown as undefined });
      return NextResponse.json({ ok: true, config: await getReceiptsConfig() });
    }
    if (body.clearExcelForBranch) {
      const next = { ...(current.excelByBranch || {}) };
      delete next[body.clearExcelForBranch];
      patch.excelByBranch = next;
    }
    const parseTarget = (x: Partial<OneDriveExcelTarget>): OneDriveExcelTarget | string => {
      const columns: Partial<Record<ExcelColumnKey, string>> = {};
      for (const k of COLUMN_KEYS) {
        const v = x.columns?.[k];
        if (typeof v === 'string' && /^[A-Za-z]{1,3}$/.test(v)) columns[k] = v.toUpperCase();
      }
      if (!columns.id) return 'id column required';
      if (!x.worksheet) return 'worksheet required';
      return {
        itemId: String(x.itemId), name: String(x.name || ''), path: String(x.path || ''),
        worksheet: String(x.worksheet), ...(x.table ? { table: String(x.table) } : {}),
        headerRow: Number(x.headerRow) >= 1 ? Math.floor(Number(x.headerRow)) : 1, columns,
      };
    };
    if (body.excelForBranch && body.excelForBranch.branchKey && body.excelForBranch.excel?.itemId) {
      const t = parseTarget(body.excelForBranch.excel);
      if (typeof t === 'string') return NextResponse.json({ error: t }, { status: 400 });
      patch.excelByBranch = { ...(patch.excelByBranch || current.excelByBranch || {}), [String(body.excelForBranch.branchKey)]: t };
    }
    if (body.excel && body.excel.itemId) {
      const t = parseTarget(body.excel);
      if (typeof t === 'string') return NextResponse.json({ error: t }, { status: 400 });
      patch.excel = t;
    }
    await saveReceiptsConfig(patch);
    const saved = await getReceiptsConfig();
    const safe: Partial<OneDriveReceiptsConfig> = { ...saved };
    delete safe.deltaLinks;
    return NextResponse.json({ ok: true, config: safe });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'save failed' }, { status: 502 });
  }
}
