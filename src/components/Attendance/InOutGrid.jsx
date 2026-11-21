import React from 'react';
import Avatar from '../Common/Avatar.jsx';
import { leaveShort, presentSymbol } from '../../utils/inOutStatus.js';

/* Shared IN & OUT matrix look (same as the Yearly IN & OUT report), used by the Monthly and Half Monthly
 * IN & OUT reports: one block per staff member —
 *     Day         Sun Mon Tue …      (weekday under each date; weekend in red)
 *     In          09:58  AB  W …     (status cells filled: AB red, W grey, leave purple, holiday yellow)
 *     Out
 *     WorkedHour
 *     OT
 * with SN + Staff merged down the block and optional Total WH / Total OT columns. */

export const IO_ROWS = [
  { key:'in',  label:'IN',         color:'#1a56db' },
  { key:'out', label:'OUT',        color:'#059669' },
  { key:'wh',  label:'WorkedHour', color:'#374151' },
  { key:'ot',  label:'OT',         color:'#7c3aed' },
];
const ROW_LABEL_NP = { in:'आएको', out:'गएको', wh:'घण्टा', ot:'ओभरटाइम' };
const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const ROW_BG = { in:'white', out:'white', wh:'#f0f9ff', ot:'#faf5ff' };
// time / hour text colours — same as the Daily Attendance report's Time In, Time Out, Total Hrs and OT columns
const VALUE_COLOR = { in:'#3b82f6', out:'#6b7280', wh:'#0369a1', ot:'#059669' };

export const IO_TH = {
  background:'#efefef', color:'#374151', fontWeight:700, fontSize:12.5,
  padding:'4px 5px', borderRight:'1px solid #dedede', borderBottom:'2px solid #dedede',
  textAlign:'center', whiteSpace:'nowrap', userSelect:'none',
};
const TD = {
  padding:'4px 3px', fontSize:12.5, borderRight:'1px solid #e5e7eb',
  textAlign:'center', verticalAlign:'middle', whiteSpace:'nowrap', width:52, minWidth:52,
};
const rowBorder = (key) => (key === 'ot' ? '2px solid #d1d5db' : (key === 'out' || key === 'wh') ? '1px solid #cbd5e1' : '1px solid #f3f4f6');

const fmtTime = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

/** What one cell shows: { text, color, bg, mono, small, bold, title, top, topColor, topTitle, sub } */
export function cellValue(day, key, isWeekend, isHoliday, holidayName, L) {
  const dash = { text:'—', color:'#e5e7eb', bg:ROW_BG[key] };
  const hasIn = !!(day?.timeIn || day?.duties?.some((d) => d.timeIn));
  if (!hasIn) {
    // Public Holiday wins over a same-day leave (same precedence as attendance.js)
    if (isHoliday) {
      if (key === 'in') return { text:(holidayName || L('साबि','PH')).slice(0, 8), color:'#92400e', bg:'#fef3c7', small:true, bold:true, title:holidayName || L('सार्वजनिक बिदा','Public Holiday') };
      return { ...dash, bg:key === 'out' ? '#fef9e7' : ROW_BG[key] };
    }
    if (day?.leave && !day.leave.halfDay) {
      if (key === 'in') return { text:leaveShort(day.leave), color:'#5b21b6', bg:'#ede9fe', bold:true, leave:true, title:day.leave.name };
      return dash;
    }
    if (day?.visit && key === 'in') {
      const tip = [day.visit.purpose, day.visit.location].filter(Boolean).join(' | ');
      return { text:L('भ्रमण','OV'), color:'#1e40af', bg:'#dbeafe', bold:true, title:tip || L('कार्यालय भ्रमण','Office Visit') };
    }
    if (day?.offType && key === 'in') {
      const night = day.offType === 'Night Off';
      const text = night ? L('रा.अ','NO') : day.offType === 'Day Off' ? L('दि.अ','DO') : String(day.offType).split('Night Off').join('N/O').split('Day Off').join('D/O');
      return { text, color:night ? '#4338ca' : '#6b7280', bg:night ? '#e0e7ff' : '#e5e7eb', bold:true, title:day.offType };
    }
    if (isWeekend) {
      if (key === 'ot') return dash;
      return { text:L('स','W'), color:'#9ca3af', bg:'#f3f4f6', weekend:true, title:L('सप्ताहन्त','Weekend') };
    }
    if (day?.absent && key === 'in') return { text:L('अनु','AB'), color:'#991b1b', bg:'#fee2e2', bold:true, title:L('अनुपस्थित','Absent') };
  }
  let text = null;
  if (key === 'in')  text = day?.duties ? day.duties.map((d) => (d.timeIn ? fmtTime(d.timeIn) : '—')).join('\n') : fmtTime(day?.timeIn);
  if (key === 'out') text = day?.duties ? day.duties.map((d) => (d.timeOut ? fmtTime(d.timeOut) : '—')).join('\n') : fmtTime(day?.timeOut);
  if (key === 'wh')  text = day?.workedHrs || null;
  if (key === 'ot')  text = day?.otHrs || null;
  if (!text) return dash;
  const single = key === 'in' && day?.punches === 1;
  const sym = key === 'in' ? presentSymbol(day, isWeekend, isHoliday, L) : null;
  return {
    text, bold:true, bg:ROW_BG[key],
    color:single ? '#f59e0b' : VALUE_COLOR[key],
    title:single ? L('एकल पन्च मात्र','Single punch only') : '',
    warn:single,
    top:sym?.text, topColor:sym?.color, topTitle:sym?.title,
    sub:key === 'in' && day?.leave?.halfDay ? `${leaveShort(day.leave)} 1/2` : null,
  };
}

const Cell = ({ c, title }) => (
  <td style={{ ...TD, background:c.bg }} title={c.title || title}>
    {c.text === '—'
      ? <span style={{ color:c.color, fontSize:10, fontWeight:600 }}>—</span>
      : c.weekend
        ? <span style={{ color:c.color, fontSize:11, fontWeight:600 }}>{c.text}</span>
        : <div style={{ display:'flex', flexDirection:'column', alignItems:'center', lineHeight:1.15 }}>
            {c.top && <span title={c.topTitle || ''} style={{ fontSize:9, fontWeight:800, color:c.topColor, marginBottom:1, cursor:'help' }}>{c.top}</span>}
            <span style={{ fontFamily:c.mono ? 'monospace' : 'inherit', fontSize:c.small ? 9 : c.leave ? 10 : 13, lineHeight:c.leave ? 1.1 : undefined, fontWeight:c.bold ? 700 : 600,
              color:c.color, whiteSpace:'pre-line', cursor:c.title ? 'help' : undefined }}>
              {c.text}{c.warn && <span style={{ fontSize:9, marginLeft:1 }}>⚠</span>}
            </span>
            {c.sub && <span style={{ fontSize:9, fontWeight:800, color:'#5b21b6', marginTop:1 }}>{c.sub}</span>}
          </div>}
  </td>
);

/** Frozen 2-row header: SN | Staff | day numbers … | totals, and under the numbers a "Day" row with the
 *  weekday (weekend in red). `dayLabel(d, i)` gives each date's number. */
export function InOutHead({ dates, dayLabel, totals = [], L, staffWidth = 170 }) {
  const dayRow = { ...IO_TH, fontSize:10, fontWeight:700, background:'#efefef', borderBottom:'2px solid #dedede', padding:'3px 3px' };
  return (
    <thead style={{ position:'sticky', top:0, zIndex:5 }}>
      <tr>
        <th rowSpan={2} style={{ ...IO_TH, minWidth:34, position:'sticky', left:0, zIndex:4 }}>SN</th>
        <th rowSpan={2} style={{ ...IO_TH, textAlign:'left', minWidth:staffWidth, position:'sticky', left:34, zIndex:4 }}>{L('कर्मचारी','Staff')}</th>
        <th style={{ ...IO_TH, minWidth:82, borderBottom:'1px solid #dedede' }} />
        {dates.map((d, i) => <th key={d.date} style={{ ...IO_TH, minWidth:52, width:52, borderBottom:'1px solid #dedede' }}>{dayLabel(d, i)}</th>)}
        {totals.map((t) => (
          <th key={t} rowSpan={2} style={{ ...IO_TH, background:'#f0fdf4', color:t === 'wh' ? '#065f46' : '#059669', minWidth:64,
            borderLeft:t === totals[0] ? '2px solid #c9d1db' : undefined }}>
            {t === 'wh' ? L('कुल WH','Total WH') : L('कुल OT','Total OT')}
          </th>
        ))}
      </tr>
      <tr>
        <th style={{ ...dayRow, color:'#9ca3af', textAlign:'left', paddingLeft:8, borderLeft:'3px solid #e5e7eb' }}>{L('दिन','Day')}</th>
        {dates.map((d) => (
          <th key={d.date} style={{ ...dayRow, color:d.isWeekend ? '#dc2626' : '#6b7280' }}>{weekdayOf(d)}</th>
        ))}
      </tr>
    </thead>
  );
}

/** One staff member's 4-row block (IN / OUT / WorkedHour / OT); the weekday row lives in the frozen header. */
export function InOutBlock({ emp, idx, dates, totals = [], language, fd, staffInfo, staffWidth = 170 }) {
  const L = (np, en) => (language === 'np' ? np : en);
  const label = (r) => (language === 'np' ? (ROW_LABEL_NP[r.key] || r.label) : r.label);
  const tip = (date) => (fd ? fd(date) : date);
  const flags = (d) => ({
    isWeekend:emp.days?.[d.date]?.isWeekend ?? d.isWeekend,
    isHoliday:emp.days?.[d.date]?.isHoliday ?? d.isHoliday,
    holidayName:emp.days?.[d.date]?.holidayName ?? d.holidayName,
  });
  const totalValue = (which) => (which === 'wh' ? emp.totalWorkedHrs : (emp.eligibleForOt ? emp.totalApprovedOTFormatted : null));
  const blockEnd = '2px solid #d1d5db';
  return (
    <>
      {IO_ROWS.map((r, ri) => (
        <tr key={r.key} style={{ background:ROW_BG[r.key] }}>
          {ri === 0 && <>
            <td rowSpan={4} style={{ ...TD, width:34, minWidth:34, background:'#efefef', color:'#6b7280', position:'sticky', left:0, zIndex:1,
              borderRight:'1px solid #dedede', borderBottom:blockEnd }}>{idx + 1}</td>
            <td rowSpan={4} style={{ ...TD, width:'auto', minWidth:staffWidth, textAlign:'left', whiteSpace:'normal', padding:'6px 10px',
              background:'white', color:'#1f2937', position:'sticky', left:34, zIndex:1, borderRight:'1px solid #dedede', borderBottom:blockEnd }}>
              <span style={{ display:'flex', alignItems:'flex-start', gap:6 }}>
                <Avatar photo={emp.profilePhoto} name={emp.fullName} size={20} />
                <span>
                  <div style={{ fontWeight:700 }}>{emp.fullName}</div>
                  {staffInfo}
                </span>
              </span>
            </td>
          </>}
          <td style={{ ...TD, width:82, minWidth:82, fontSize:11, color:r.color, fontWeight:600, textAlign:'left', paddingLeft:8,
            background:r.key === 'wh' ? ROW_BG.wh : '#fafafa', borderLeft:`3px solid ${r.color}33`, borderBottom:rowBorder(r.key) }}>{label(r)}</td>
          {dates.map((d) => {
            const f = flags(d);
            const c = cellValue(emp.days?.[d.date], r.key, f.isWeekend, f.isHoliday, f.holidayName, L);
            return <CellWithBorder key={d.date} c={c} title={tip(d.date)} border={rowBorder(r.key)} />;
          })}
          {totals.map((t) => {
            const v = r.key === t ? totalValue(t) : null;
            const show = v && v !== '—';
            return (
              <td key={t} style={{ ...TD, minWidth:64, background:show ? '#f0fdf4' : '#f8fafc', borderBottom:rowBorder(r.key),
                borderLeft:t === totals[0] ? '2px solid #c9d1db' : undefined }}>
                {show
                  ? <strong style={{ fontFamily:'monospace', fontSize:12, fontWeight:900, color:t === 'wh' ? '#065f46' : '#059669' }}>{v}</strong>
                  : <span style={{ color:'#d1d5db', fontSize:11 }}>—</span>}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

const CellWithBorder = ({ c, title, border }) => {
  const el = Cell({ c, title });
  return React.cloneElement(el, { style:{ ...el.props.style, borderBottom:border } });
};

/* ── Print & Excel: the same block layout and colours as the screen ─────────────────────────────── */
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const flagsOf = (emp, d) => ({
  isWeekend:emp.days?.[d.date]?.isWeekend ?? d.isWeekend,
  isHoliday:emp.days?.[d.date]?.isHoliday ?? d.isHoliday,
  holidayName:emp.days?.[d.date]?.holidayName ?? d.holidayName,
});
const weekdayOf = (d) => (d.dayKey ? d.dayKey.slice(0, 3) : WEEKDAYS[new Date(d.date).getDay()]);
const totalOf = (emp, which) => {
  const v = which === 'wh' ? emp.totalWorkedHrs : (emp.eligibleForOt ? emp.totalApprovedOTFormatted : null);
  return v && v !== '—' ? v : '';
};
const rowLabelOf = (r, language) => (language === 'np' ? (ROW_LABEL_NP[r.key] || r.label) : r.label);

/** HTML table for the print window (2-row header with the weekday row; 4 rows per staff). staffHtml(emp) = lines under the name. */
export function ioPrintTable({ employees, dates, dayLabel, totals = [], language, staffHtml }) {
  const L = (np, en) => (language === 'np' ? np : en);
  const B = 'border:1px solid #dedede;';
  const th = (t, x = '') => `<th style="padding:3px 3px;${B}background:#efefef;color:#374151;font-size:8.5px;${x}">${t}</th>`;
  const head = '<thead><tr>'
    + th('SN', '" rowspan="2') + th(L('कर्मचारी', 'Staff'), 'text-align:left" rowspan="2') + th('')
    + dates.map((d, i) => th(esc(dayLabel(d, i)))).join('')
    + totals.map((t) => th(t === 'wh' ? L('कुल WH', 'Total WH') : L('कुल OT', 'Total OT'), `background:#f0fdf4;color:${t === 'wh' ? '#065f46' : '#059669'}" rowspan="2`)).join('')
    + '</tr><tr>'
    + th(L('दिन', 'Day'), 'background:#efefef;color:#9ca3af;text-align:left;font-size:7.5px')
    + dates.map((d) => th(weekdayOf(d), `background:#efefef;font-size:7.5px;color:${d.isWeekend ? '#dc2626' : '#6b7280'}`)).join('')
    + '</tr></thead>';
  const td = (content, st) => `<td style="padding:1px 2px;${B}text-align:center;font-size:8px;${st}">${content}</td>`;
  const body = employees.map((emp, i) => IO_ROWS.map((r, ri) => {
    const last = r.key === 'ot' ? 'border-bottom:2px solid #9ca3af;' : '';
    const lead = ri === 0
      ? `<td rowspan="4" style="padding:2px 4px;${B}border-bottom:2px solid #9ca3af;background:#efefef;color:#6b7280;text-align:center;vertical-align:middle">${i + 1}</td>
         <td rowspan="4" style="padding:2px 5px;${B}border-bottom:2px solid #9ca3af;vertical-align:middle;font-size:8.5px"><div style="font-weight:700">${esc(emp.fullName)}</div>${staffHtml ? staffHtml(emp) : ''}</td>`
      : '';
    const cells = dates.map((d) => {
      const f = flagsOf(emp, d);
      const c = cellValue(emp.days?.[d.date], r.key, f.isWeekend, f.isHoliday, f.holidayName, L);
      if (c.text === '—') return td('', `background:${c.bg};${last}`);
      const top = c.top ? `<div style="font-size:6px;font-weight:800;color:${c.topColor}">${esc(c.top)}</div>` : '';
      const sub = c.sub ? `<div style="font-size:6px;font-weight:800;color:#5b21b6">${esc(c.sub)}</div>` : '';
      return td(`${top}${esc(c.text).replace(/\n/g, '<br>')}${c.warn ? '⚠' : ''}${sub}`,
        `background:${c.bg};color:${c.color};font-weight:${c.bold ? 700 : 600};${c.small ? 'font-size:6.5px;' : c.leave ? 'font-size:7px;' : ''}${last}`);
    }).join('');
    const tots = totals.map((t) => {
      const v = r.key === t ? totalOf(emp, t) : '';
      return td(esc(v), `background:${v ? '#f0fdf4' : '#f8fafc'};color:${t === 'wh' ? '#065f46' : '#059669'};font-weight:800;${last}`);
    }).join('');
    return `<tr>${lead}${td(rowLabelOf(r, language), `background:${r.key === 'wh' ? ROW_BG.wh : '#fafafa'};color:${r.color};font-weight:700;text-align:left;border-left:3px solid ${r.color}55;${last}`)}${cells}${tots}</tr>`;
  }).join('')).join('');
  return `<table style="border-collapse:collapse;width:100%;font-size:8px;-webkit-print-color-adjust:exact;print-color-adjust:exact">${head}<tbody>${body}</tbody></table>`;
}

/** Writes the table into an ExcelJS sheet with the screen colours: 2 header rows (day numbers, then the weekday
 *  "Day" row), then 4 rows per staff (IN / OUT / WorkedHour / OT). Header + SN/Staff/label columns are frozen. */
export function ioExcelTable(ws, { employees, dates, dayLabel, totals = [], language, staffText }) {
  const L = (np, en) => (language === 'np' ? np : en);
  const argb = (hex) => {
    const h = (!hex || hex === 'white') ? 'ffffff' : String(hex).replace('#', '');
    return `FF${(h.length === 3 ? h.split('').map((x) => x + x).join('') : h).toUpperCase()}`;
  };
  const fill = (hex) => ({ type:'pattern', pattern:'solid', fgColor:{ argb:argb(hex) } });
  const thin = { style:'thin', color:{ argb:'FFDEDEDE' } };
  const heavy = { style:'medium', color:{ argb:'FF9CA3AF' } };
  const box = (bottom = thin) => ({ top:thin, left:thin, right:thin, bottom });
  const nCols = 3 + dates.length + totals.length;
  const isTot = (col) => col > 3 + dates.length;

  const h1 = ws.addRow(['SN', L('कर्मचारी', 'Staff'), '', ...dates.map((d, i) => dayLabel(d, i)),
    ...totals.map((t) => (t === 'wh' ? L('कुल WH', 'Total WH') : L('कुल OT', 'Total OT')))]);
  const h2 = ws.addRow(['', '', L('दिन', 'Day'), ...dates.map(weekdayOf), ...totals.map(() => '')]);
  // merge before styling (ExcelJS resets a merged range's other cells)
  [1, 2].forEach((c) => ws.mergeCells(h1.number, c, h2.number, c));
  totals.forEach((_, k) => ws.mergeCells(h1.number, 4 + dates.length + k, h2.number, 4 + dates.length + k));
  h1.eachCell({ includeEmpty:true }, (cell, col) => {
    cell.font = { bold:true, size:10, color:{ argb:isTot(col) ? 'FF059669' : 'FF374151' } };
    cell.fill = fill(isTot(col) ? '#f0fdf4' : '#efefef');
    cell.alignment = { horizontal:col === 2 ? 'left' : 'center', vertical:'middle' };
    cell.border = box();
  });
  h2.eachCell({ includeEmpty:true }, (cell, col) => {
    if (col <= 2 || isTot(col)) { cell.border = box(heavy); return; }
    const d = dates[col - 4];
    cell.font = { bold:true, size:8, color:{ argb:col === 3 ? 'FF9CA3AF' : (d?.isWeekend ? 'FFDC2626' : 'FF6B7280') } };
    cell.fill = fill('#efefef');
    cell.alignment = { horizontal:col === 3 ? 'left' : 'center', vertical:'middle' };
    cell.border = box(heavy);
  });

  employees.forEach((emp, i) => {
    const start = ws.rowCount + 1;
    IO_ROWS.forEach((r, ri) => {
      const values = dates.map((d) => {
        const f = flagsOf(emp, d);
        return cellValue(emp.days?.[d.date], r.key, f.isWeekend, f.isHoliday, f.holidayName, L);
      });
      const row = ws.addRow([ri === 0 ? i + 1 : '', ri === 0 ? (staffText ? staffText(emp) : emp.fullName) : '', rowLabelOf(r, language),
        ...values.map((c) => (c.text === '—' ? '' : [c.top, `${c.text}${c.warn ? ' ⚠' : ''}`, c.sub].filter(Boolean).join('\n'))),
        ...totals.map((t) => (r.key === t ? totalOf(emp, t) : ''))]);
      const bottom = r.key === 'ot' ? heavy : thin;
      row.eachCell({ includeEmpty:true }, (cell, col) => {
        cell.border = box(bottom);
        cell.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
        if (col === 3) {
          cell.font = { bold:true, size:9, color:{ argb:argb(r.color) } };
          cell.fill = fill(r.key === 'wh' ? ROW_BG.wh : '#fafafa');
          cell.alignment = { horizontal:'left', vertical:'middle' };
        } else if (col > 3 && !isTot(col)) {
          const c = values[col - 4];
          cell.fill = fill(c.bg);
          cell.font = { size:c.small ? 7 : c.leave ? 8 : 9, bold:!!c.bold, color:{ argb:argb(c.color) } };
        } else if (isTot(col)) {
          const t = totals[col - 4 - dates.length];
          const has = r.key === t && totalOf(emp, t);
          cell.fill = fill(has ? '#f0fdf4' : '#f8fafc');
          cell.font = { bold:true, size:9, color:{ argb:t === 'wh' ? 'FF065F46' : 'FF059669' } };
        }
      });
    });
    ws.mergeCells(start, 1, start + 3, 1);
    ws.mergeCells(start, 2, start + 3, 2);
    const sn = ws.getCell(start, 1);
    sn.fill = fill('#efefef'); sn.font = { color:{ argb:'FF6B7280' } }; sn.alignment = { horizontal:'center', vertical:'middle' };
    sn.border = box(heavy);
    const st = ws.getCell(start, 2);
    st.alignment = { horizontal:'left', vertical:'middle', wrapText:true }; st.font = { bold:true, size:9.5 };
    st.border = box(heavy);
  });

  ws.columns = [{ width:5 }, { width:28 }, { width:11 }, ...dates.map(() => ({ width:7 })), ...totals.map(() => ({ width:9 }))];
  ws.views = [{ state:'frozen', xSplit:3, ySplit:h2.number }];
  return nCols;
}

