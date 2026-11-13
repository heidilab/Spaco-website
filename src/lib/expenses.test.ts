// 固定開支 (Heidi 2026-11-13): a deleted template kept showing in the month,
// and a template deleted and added again seeded 「寬頻」 twice.

import { describe, it, expect, vi } from 'vitest';
vi.mock('./firebase', () => ({ db: {} }));
import { rowsRemovedWithTemplate, templatesToSeed, sameExpenseItem } from './expenses';
import type { ExpenseRecord, ExpenseTemplate } from '@/types';

const tpl = (id: string, name: string, active = true): ExpenseTemplate => ({ id, branchKey: 'sw', name, amount: 218, order: 0, active });
const row = (id: string, item: string, month: string, templateId?: string, source: 'recurring' | 'manual' = 'recurring'): ExpenseRecord =>
  ({ id, branchKey: 'sw', month, date: `${month}-01`, item, amount: 218, source, templateId, createdBy: 'u', createdAt: null } as ExpenseRecord);

describe('deleting a template takes this month and later months with it', () => {
  const rows = [
    row('a', 'HGC寬頻', '2026-09', 't1'),
    row('b', 'HGC寬頻', '2026-10', 't1'),
    row('c', 'HGC寬頻', '2026-11', 't1'),
    row('d', 'HGC寬頻', '2026-12', 't1'),
    row('e', '租金', '2026-11', 't2'),
    row('f', 'HGC寬頻', '2026-11', undefined, 'manual'),
  ];
  it('removes the rows of that template from the chosen month on', () => {
    expect(rowsRemovedWithTemplate(rows, 't1', '2026-11').map((r) => r.id)).toEqual(['c', 'd']);
  });
  it('leaves earlier months, other templates and manual rows alone', () => {
    const kept = rows.filter((r) => !rowsRemovedWithTemplate(rows, 't1', '2026-11').includes(r)).map((r) => r.id);
    expect(kept).toEqual(['a', 'b', 'e', 'f']);
  });
});

describe('seeding a month never doubles an item', () => {
  it('a template already seeded (by id) is skipped', () => {
    expect(templatesToSeed([tpl('t1', 'HGC寬頻')], [row('a', 'HGC寬頻', '2026-11', 't1')])).toEqual([]);
  });
  it('a re-added template whose name is already on the month is skipped (the 寬頻 duplicate)', () => {
    // t1 deleted, then 「HGC寬頻」 added again as t9 → the month already has the row.
    expect(templatesToSeed([tpl('t9', 'HGC 寬頻')], [row('a', 'HGC寬頻', '2026-11', 't1')])).toEqual([]);
  });
  it('new and still-missing templates are seeded; inactive ones are not', () => {
    const out = templatesToSeed([tpl('t2', '租金'), tpl('t3', 'SimCard', false)], [row('a', 'HGC寬頻', '2026-11', 't1')]);
    expect(out.map((t) => t.id)).toEqual(['t2']);
  });
  it('a manual row with the same name also counts as present', () => {
    expect(templatesToSeed([tpl('t1', 'HGC寬頻')], [row('f', 'HGC寬頻', '2026-11', undefined, 'manual')])).toHaveLength(1);
    // (manual rows are one-offs, not the fixed item — the fixed item is still seeded)
  });
});

describe('sameExpenseItem', () => {
  it('ignores case and spaces, never matches empty', () => {
    expect(sameExpenseItem('HGC寬頻', 'hgc 寬頻')).toBe(true);
    expect(sameExpenseItem('租金', '管理費')).toBe(false);
    expect(sameExpenseItem('', '')).toBe(false);
  });
});
