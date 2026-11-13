// Financial Master monthly tab → styled worksheet.
//
// Kept apart from financialMasterSheet (which lays the tab out and stays
// free of xlsx) so the layout is unit-tested without the library. The
// caller passes the lazily-imported xlsx-js-style module.

import type { MasterSheet, MasterCellStyle } from './financialMasterSheet';

// Look of the monthly tab — her sheet's bands and number formats.
const MONEY_FMT = '[$$-404]#,##0.00';
const MASTER_STYLES: Record<MasterCellStyle, { fill?: string; bold?: boolean; sz?: number; numFmt?: string; align?: 'left' | 'center' | 'right'; wrap?: boolean }> = {
  title: { bold: true, sz: 20 },
  bandCR: { fill: 'F4B183', bold: true },
  bandDR: { fill: 'A9D08E', bold: true },
  bandSource: { fill: 'FFF2CC', bold: true },
  bandDeposit: { fill: 'FFF2CC', bold: true, wrap: true },
  bandRemarks: { fill: 'D9E1F2', bold: true },
  group: { fill: 'FCE4D6', bold: true },
  header: { fill: 'FCE4D6', bold: true, wrap: true },
  date: { numFmt: '[$-F800]dddd\\,\\ mmmm\\ dd\\,\\ yyyy' },
  text: {},
  money: { numFmt: MONEY_FMT },
  moneyBold: { numFmt: MONEY_FMT, bold: true },
  txDate: { numFmt: 'd/m/yyyy;@' },
  remarks: { align: 'left', wrap: true },
  sum: { numFmt: MONEY_FMT, bold: true },
  label: { bold: true, align: 'right' },
  footMoney: { numFmt: MONEY_FMT, align: 'left' },
  footLabel: { align: 'right' },
};

/** Turn a laid-out monthly tab into a styled worksheet. */
export function masterSheetToWorksheet(
  XLSX: typeof import('xlsx-js-style'),
  sheet: MasterSheet,
) {
  const ws: Record<string, unknown> = {};
  const thin = { style: 'thin', color: { rgb: '7F7F7F' } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };
  const LAST_COL = sheet.cols.length - 1;
  const styleOf = (tag: MasterCellStyle, bordered: boolean) => {
    const d = MASTER_STYLES[tag];
    return {
      font: { sz: d.sz ?? 12, bold: !!d.bold },
      alignment: { horizontal: d.align ?? 'center', vertical: 'center', wrapText: !!d.wrap },
      ...(d.fill ? { fill: { fgColor: { rgb: d.fill } } } : {}),
      ...(d.numFmt ? { numFmt: d.numFmt } : {}),
      ...(bordered ? { border } : {}),
    };
  };
  // Every cell of the table (header block + body) exists and is boxed, so
  // merged and empty cells still draw their grid.
  for (let r = 1; r <= sheet.bodyRows.last; r++) {
    for (let c = 0; c <= LAST_COL; c++) {
      ws[XLSX.utils.encode_cell({ r, c })] = { t: 's', v: '', s: styleOf(r <= 4 ? 'group' : 'text', true) };
    }
  }
  for (const cell of sheet.cells) {
    const inTable = cell.r >= 1 && cell.r <= sheet.bodyRows.last;
    ws[XLSX.utils.encode_cell({ r: cell.r, c: cell.c })] = {
      t: typeof cell.v === 'number' ? 'n' : 's',
      v: cell.v,
      ...(cell.f ? { f: cell.f } : {}),
      s: styleOf(cell.style, inTable),
    };
  }
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(sheet.rowCount, 1), c: LAST_COL } });
  ws['!merges'] = sheet.merges;
  ws['!cols'] = sheet.cols.map((wch) => ({ wch }));
  ws['!rows'] = [{ hpt: 33 }];
  return ws as import('xlsx-js-style').WorkSheet;
}
