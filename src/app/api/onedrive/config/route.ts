import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { folderDelta, getReceiptsConfig, saveReceiptsConfig } from '@/lib/msgraph';
import type { ExcelColumnKey, OneDriveReceiptsConfig } from '@/types';

export const runtime = 'nodejs';

const COLUMN_KEYS: ExcelColumnKey[] = ['id', 'date', 'branch', 'item', 'vendor', 'amount', 'category', 'note', 'reviewed', 'link'];

// POST /api/onedrive/config — save what Heidi picked. Choosing a new
// receipts folder starts the delta from NOW (token=latest): files already
// in the folder are hers from before and are already in her Excel.
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, 'staff');
  if (!gate.ok) return gate.res;
  let body: Partial<OneDriveReceiptsConfig> & { clearExcel?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const current = await getReceiptsConfig();
  const patch: Partial<OneDriveReceiptsConfig> = {};
  try {
    if (body.receiptsFolder && body.receiptsFolder.id) {
      const f = body.receiptsFolder;
      patch.receiptsFolder = { id: String(f.id), name: String(f.name || ''), path: String(f.path || '') };
      if (f.id !== current.receiptsFolder?.id) {
        patch.deltaLink = (await folderDelta(f.id, 'latest')).deltaLink;
        patch.branchFolders = [];
        patch.lastScanError = '';
      }
    }
    if (Array.isArray(body.branchFolders)) {
      patch.branchFolders = body.branchFolders
        .filter((b) => b && b.id && b.branchKey)
        .map((b) => ({ id: String(b.id), name: String(b.name || ''), path: String(b.path || ''), branchKey: String(b.branchKey) }));
    }
    if (body.clearExcel) {
      patch.excel = undefined;
      await saveReceiptsConfig({ ...patch, excel: null as unknown as undefined });
      return NextResponse.json({ ok: true, config: await getReceiptsConfig() });
    }
    if (body.excel && body.excel.itemId) {
      const x = body.excel;
      const columns: Partial<Record<ExcelColumnKey, string>> = {};
      for (const k of COLUMN_KEYS) {
        const v = x.columns?.[k];
        if (typeof v === 'string' && /^[A-Za-z]{1,3}$/.test(v)) columns[k] = v.toUpperCase();
      }
      if (!columns.id) return NextResponse.json({ error: 'id column required' }, { status: 400 });
      patch.excel = {
        itemId: String(x.itemId), name: String(x.name || ''), path: String(x.path || ''),
        worksheet: String(x.worksheet || ''), ...(x.table ? { table: String(x.table) } : {}),
        headerRow: Number(x.headerRow) >= 1 ? Math.floor(Number(x.headerRow)) : 1, columns,
      };
      if (!patch.excel.worksheet) return NextResponse.json({ error: 'worksheet required' }, { status: 400 });
    }
    await saveReceiptsConfig(patch);
    const saved = await getReceiptsConfig();
    const safe: Partial<OneDriveReceiptsConfig> = { ...saved };
    delete safe.deltaLink;
    return NextResponse.json({ ok: true, config: safe });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'save failed' }, { status: 502 });
  }
}
