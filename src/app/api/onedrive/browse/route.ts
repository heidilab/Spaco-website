import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { listChildren, getItem, displayPath } from '@/lib/msgraph';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/onedrive/browse?itemId=root|<id> → folders + Excel files inside.
export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, 'staff');
  if (!gate.ok) return gate.res;
  const itemId = req.nextUrl.searchParams.get('itemId') || 'root';
  try {
    const [item, children] = await Promise.all([
      itemId === 'root' ? Promise.resolve(null) : getItem(itemId),
      listChildren(itemId),
    ]);
    return NextResponse.json({
      item: item ? { id: item.id, name: item.name, path: displayPath(item), parentId: item.parentReference?.id || 'root' } : { id: 'root', name: 'OneDrive', path: '', parentId: null },
      children: children
        .filter((c) => c.folder || /\.xlsx$/i.test(c.name))
        .map((c) => ({
          id: c.id, name: c.name, isFolder: !!c.folder, childCount: c.folder?.childCount ?? 0,
          isExcel: !c.folder && /\.xlsx$/i.test(c.name), size: c.size || 0, path: displayPath(c),
        })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'browse failed' }, { status: 502 });
  }
}
