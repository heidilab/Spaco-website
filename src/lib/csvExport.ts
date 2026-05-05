/**
 * Lightweight CSV export — Excel-friendly (UTF-8 BOM so Chinese renders).
 * No external dependency.
 */

export type CsvCell = string | number | null | undefined;

/**
 * Properly escape a CSV cell:
 *  - wrap in quotes if it contains , " or newline
 *  - double up internal quotes
 */
function escapeCell(value: CsvCell): string {
  if (value == null) return '';
  let s = String(value);
  // Strip carriage returns to avoid Excel splitting
  s = s.replace(/\r/g, '');
  if (/[",\n]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Build a CSV string from rows. First row should be headers. */
export function buildCsv(rows: CsvCell[][]): string {
  return rows.map((r) => r.map(escapeCell).join(',')).join('\n');
}

/** Trigger a download of `csv` with the given filename in the user's browser. */
export function downloadCsv(filename: string, csv: string) {
  // Prepend UTF-8 BOM so Excel detects encoding correctly (especially for CJK)
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Cleanup
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
