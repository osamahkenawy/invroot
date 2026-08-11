/**
 * Build a CSV string and trigger a browser download.
 * @param {string} filename  - e.g. "sales-report.csv"
 * @param {Array<{label:string, value:(string|function)}>} columns
 *        value is either a row-object key or a (row)=>cell function
 * @param {object[]} rows
 */
export function downloadCsv(filename, columns, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map(c => esc(c.label)).join(',');
  const body = rows.map(r =>
    columns.map(c => esc(typeof c.value === 'function' ? c.value(r) : r[c.value])).join(',')
  ).join('\n');

  // Prepend a UTF-8 BOM so Excel opens Arabic/accented text correctly.
  const csv = '﻿' + header + '\n' + body;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
