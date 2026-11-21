/* Double duty: stacked, row-aligned lines for the report grids.
   Every stacked cell (Shift, Time In, Time Out, IN Status, OUT Status) draws one fixed-height
   line per duty, so duty 1 sits on the same line in every column and duty 2 on the next. */

export const DUTY_LINE_H = 20;   // px — the one line height shared by all stacked cells

const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

export const fmtDutyTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const lineStyle = { height: DUTY_LINE_H, lineHeight: `${DUTY_LINE_H}px`, whiteSpace: 'nowrap', display: 'block' };

/* lines: [{ text, color, bold, title }] */
export const DutyLines = ({ lines, fontSize }) => (
  <span style={{ display: 'inline-flex', flexDirection: 'column', fontSize }}>
    {lines.map((l, i) => (
      <span key={i} title={l.title || ''} style={{ ...lineStyle, color: l.color || '#1f2937', fontWeight: l.bold ? 700 : 400 }}>{l.text}</span>
    ))}
  </span>
);

/* Shift names as stacked lines (the server joins duties with a line break) */
export const ShiftLines = ({ value, color = '#1f2937', fontSize }) => (
  <DutyLines fontSize={fontSize} lines={String(value || '—').split('\n').map(t => ({ text: t, color }))} />
);

export const dutyInLines = (duties) => duties.map(d => {
  const bad = d.lateMins > 0;
  return {
    text: d.timeIn ? fmtDutyTime(d.timeIn) : '—',
    color: !d.timeIn ? '#d1d5db' : (bad ? '#dc2626' : '#1f2937'), bold: bad,
    title: d.missing ? `${d.start}-${d.end}: no punch` : `${d.start}-${d.end}${bad ? ` · late ${d.lateMins} min` : ''}`,
  };
});

export const dutyOutLines = (duties) => duties.map(d => {
  const bad = d.earlyMins > 0;
  return {
    text: d.timeOut ? fmtDutyTime(d.timeOut) : '—',
    color: !d.timeOut ? '#d1d5db' : (bad ? '#dc2626' : '#1f2937'), bold: bad,
    title: d.missing ? `${d.start}-${d.end}: no punch` : `${d.start}-${d.end}${bad ? ` · early out ${d.earlyMins} min` : ''}`,
  };
});

/* IN / OUT status per duty — same wording as the single-shift columns */
export const dutyInStatusLines = (duties) => duties.map(d => {
  if (!d.timeIn) return { text: '—', color: '#d1d5db' };
  if (d.lateMins > 0) return { text: `Late By ${hhmm(d.lateMins)}`, color: '#ef4444', bold: true };
  if (d.earlyInMins > 0) return { text: `Early In ${hhmm(d.earlyInMins)}`, color: '#10b981', bold: true };
  return { text: 'On Time' };
});

export const dutyOutStatusLines = (duties) => duties.map(d => {
  if (!d.timeOut) return { text: '—', color: '#d1d5db' };
  if (d.earlyMins > 0) return { text: `Early Out ${hhmm(d.earlyMins)}`, color: '#f59e0b', bold: true };
  if (d.lateOutMins > 0) return { text: `Late Out ${hhmm(d.lateOutMins)}`, color: '#3b82f6', bold: true };
  return { text: 'On Time' };
});

/* Plain-HTML versions for the print views: one <div> per duty, same line height */
export const dutyHtml = (lines) =>
  lines.map(l => `<div style="height:${DUTY_LINE_H - 6}px;line-height:${DUTY_LINE_H - 6}px;white-space:nowrap;${l.color ? `color:${l.color};` : ''}${l.bold ? 'font-weight:700;' : ''}">${l.text}</div>`).join('');
