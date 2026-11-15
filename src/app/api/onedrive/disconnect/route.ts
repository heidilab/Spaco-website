import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { disconnect } from '@/lib/msgraph';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const gate = await requireAdmin(req, 'staff');
  if (!gate.ok) return gate.res;
  await disconnect();
  return NextResponse.json({ ok: true });
}
