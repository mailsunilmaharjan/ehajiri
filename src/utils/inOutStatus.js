/* Shared IN-row status helpers for the Monthly / Half-Monthly / Yearly
   IN & OUT reports — used by the on-screen badges AND the Print/Excel
   output, so a leave/holiday/weekend day reads the same everywhere. */

/* Leave short name: the leave type's configured code (AL, SL, CL…) from
   Settings → Leave Types; falls back to initials of the name only for an
   old API response / orphaned leave with no type code. */
export const leaveShort = (leave) => {
  if (!leave) return '';
  if (leave.code) return String(leave.code);
  const name = (leave.name || '').trim();
  if (!name) return 'L';
  const words = name.split(/\s+/);
  return words.length > 1 ? words.map(w => w[0].toUpperCase()).join('') : name.slice(0, 2).toUpperCase();
};

/* Status for an IN cell with no punch — same precedence as the on-screen
   DayCell (Public Holiday > Leave > Office Visit > Day/Night Off > Weekend).
   Returns null when there's nothing to show. */
export const inRowStatus = (day, isWeekend, isHoliday, LL) => {
  if (isHoliday)     return { text: LL('साबि', 'PH'), color: '#92400e', bg: '#fef3c7' };
  if (day?.leave)    return { text: leaveShort(day.leave), color: '#5b21b6', bg: '#ede9fe' };
  if (day?.visit)    return { text: LL('भ्रमण', 'OV'), color: '#1e40af', bg: '#dbeafe' };
  if (day?.offType)  return day.offType === 'Night Off'
    ? { text: LL('रा.अ', 'NO'), color: '#4338ca', bg: '#e0e7ff' }
    : { text: LL('दि.अ', 'DO'), color: '#6b7280', bg: '#e5e7eb' };
  if (isWeekend)     return { text: LL('ब', 'W'), color: '#6b7280', bg: '#e5e7eb' };
  return null;
};

/* Print-HTML content for an IN cell: the time (plus a "SL 1/2" tag for a
   half-day leave), or the status short name when there's no punch. */
export const inRowPrintHtml = (timeText, day, isWeekend, isHoliday, LL) => {
  if (timeText) {
    const half = day?.leave?.halfDay
      ? `<br/><span style="font-size:6.5px;font-weight:800;color:#5b21b6">${leaveShort(day.leave)} 1/2</span>`
      : '';
    return `${timeText}${half}`;
  }
  const st = inRowStatus(day, isWeekend, isHoliday, LL);
  return st ? `<span style="font-weight:800;color:${st.color}">${st.text}</span>` : '';
};

/* Plain-text version of the above for Excel export. */
export const inRowExcelText = (timeText, day, isWeekend, isHoliday, LL) => {
  if (timeText) return day?.leave?.halfDay ? `${timeText} (${leaveShort(day.leave)} 1/2)` : timeText;
  return inRowStatus(day, isWeekend, isHoliday, LL)?.text || '';
};
