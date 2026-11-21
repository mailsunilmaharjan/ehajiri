/**
 * Excel export that looks like the on-screen grid: grey bold heading, grey S.N. column,
 * thin borders on every cell, bold grey total rows. Uses xlsx-js-style (SheetJS + cell styles).
 */
const GREY = 'F4F4F4';
const LINE = { style: 'thin', color: { rgb: 'BFBFBF' } };
const BORDER = { top: LINE, bottom: LINE, left: LINE, right: LINE };
const FILL = { patternType: 'solid', fgColor: { rgb: GREY } };

export async function loadXlsx() {
  const m = await import('xlsx-js-style');
  return m.default || m;
}

/** Style a block of rows r0..r1 (0-based) as a grid. */
export function styleGrid(XLSX, ws, { r0, r1, headRows = 1, footRows = 0, snCol = -1, cols }) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  const c1 = cols != null ? cols - 1 : range.e.c;
  for (let r = r0; r <= r1; r++) {
    for (let c = 0; c <= c1; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr] || (ws[addr] = { t: 's', v: '' });
      const isHead = r < r0 + headRows;
      const isFoot = r > r1 - footRows;
      const s = { border: BORDER, alignment: { vertical: 'center', wrapText: true } };
      if (cell.t === 'n') s.alignment.horizontal = 'right';
      if (isHead || isFoot) { s.font = { bold: true }; s.fill = FILL; }
      if (c === snCol && !isHead) { s.fill = FILL; s.alignment.horizontal = 'center'; }
      if (cell.t === 'n' && !cell.z) cell.z = '#,##0.00';
      cell.s = s;
    }
  }
}

/** Company / title lines above the grid: first line big and bold, the rest bold. */
export function styleTitle(ws, XLSX, rows) {
  for (let r = 0; r < rows; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    if (cell) cell.s = { font: { bold: true, sz: r === 0 ? 14 : 11 } };
  }
}

/** Export an on-screen <table> under a few title lines, styled like the grid. */
export async function exportTable({ table: src, head, sheetName, file }) {
  const XLSX = await loadXlsx();
  // screen-only filler (blank rows, remarks box) stays out of the file
  const table = src.cloneNode(true);
  table.querySelectorAll('tr.blank, tr.remarks-row, .screen-only').forEach((el) => el.remove());
  const ws = XLSX.utils.aoa_to_sheet(head.length ? head : [['']]);
  const r0 = XLSX.utils.decode_range(ws['!ref']).e.r + 2;   // one blank row after the titles
  XLSX.utils.sheet_add_dom(ws, table, { origin: { r: r0, c: 0 }, raw: false });
  const r1 = XLSX.utils.decode_range(ws['!ref']).e.r;
  const headRows = table.tHead ? table.tHead.rows.length : 0;
  const footRows = table.tFoot ? table.tFoot.rows.length : 0;
  const firstHead = table.tHead?.rows[0];
  let snCol = -1;
  if (firstHead) {
    let c = 0;
    for (const th of firstHead.cells) {
      if (th.classList.contains('sn') && snCol < 0) snCol = c;
      c += th.colSpan || 1;
    }
  }
  styleTitle(ws, XLSX, head.filter((h) => h.length).length);
  styleGrid(XLSX, ws, { r0, r1, headRows, footRows, snCol });
  ws['!cols'] = Array.from({ length: XLSX.utils.decode_range(ws['!ref']).e.c + 1 }, (_, i) => ({ wch: i === snCol ? 6 : i === 0 ? 14 : 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 30));
  XLSX.writeFile(wb, file);
}
