import ExcelJS from 'exceljs';
import { downloadBlob } from '../../utils/printHelper.js';

/** Download a simple styled .xlsx. columns: [{ header, key, width?, numeric? }], rows: array of objects keyed by `key`.
 *  totals: optional array of keys to sum into a final bold row. */
export async function downloadSheet({ filename, sheetName = 'Sheet1', title, subtitle, columns, rows, totals = [] }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 30));
  let r = 1;
  if (title) { ws.getCell(r, 1).value = title; ws.getCell(r, 1).font = { bold: true, size: 14 }; r++; }
  if (subtitle) { ws.getCell(r, 1).value = subtitle; ws.getCell(r, 1).font = { color: { argb: 'FF6B7280' } }; r++; }
  if (title || subtitle) r++;
  const head = ws.getRow(r);
  columns.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FF374151' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FFDEDEDE' } } };
    cell.alignment = { horizontal: c.numeric ? 'right' : 'left', vertical: 'middle', wrapText: true };
    ws.getColumn(i + 1).width = c.width || (c.numeric ? 14 : 22);
  });
  r++;
  rows.forEach(row => {
    columns.forEach((c, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = row[c.key] ?? '';
      if (c.numeric) { cell.numFmt = '#,##0.00'; cell.alignment = { horizontal: 'right' }; }
    });
    r++;
  });
  if (totals.length) {
    ws.getCell(r, 1).value = 'Total';
    columns.forEach((c, i) => {
      const cell = ws.getCell(r, i + 1);
      if (totals.includes(c.key)) { cell.value = rows.reduce((s, x) => s + (Number(x[c.key]) || 0), 0); cell.numFmt = '#,##0.00'; cell.alignment = { horizontal: 'right' }; }
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.border = { top: { style: 'medium', color: { argb: 'FFD1D5DB' } } };
    });
  }
  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}
