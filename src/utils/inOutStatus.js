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
/** Short text for a custom off shift ("Due Day Off" → "Due D/O"); the system Day Off / Night Off keep DO / NO. */
export const offShort = (offType) => String(offType || '').split('Night Off').join('N/O').split('Day Off').join('D/O');
export const isSystemOff = (offType) => offType === 'Day Off' || offType === 'Night Off';

export const inRowStatus = (day, isWeekend, isHoliday, LL) => {
  // Holiday name shortened exactly like the Yearly IN & OUT Log (first 8
  // characters); the full name is the hover title on screen/print.
  if (isHoliday)     return { text: day?.holidayName ? String(day.holidayName).slice(0, 8) : LL('साबि', 'PH'), title: day?.holidayName || '', color: '#92400e', bg: '#fef3c7' };
  if (day?.leave)    return { text: leaveShort(day.leave), color: '#5b21b6', bg: '#ede9fe' };
  if (day?.visit)    return { text: LL('भ्रमण', 'OV'), color: '#1e40af', bg: '#dbeafe' };
  if (day?.offType)  return day.offType === 'Night Off'
    ? { text: LL('रा.अ', 'NO'), color: '#4338ca', bg: '#e0e7ff' }
    : day.offType === 'Day Off' ? { text: LL('दि.अ', 'DO'), color: '#6b7280', bg: '#e5e7eb' }
    : { text: offShort(day.offType), title: day.offType, color: '#6b7280', bg: '#e5e7eb' };
  if (isWeekend)     return { text: LL('ब', 'W'), color: '#6b7280', bg: '#e5e7eb' };
  // No punch at all on a past working day (server-computed, see /half-in-out).
  if (day?.absent)   return { text: LL('अनु', 'AB'), color: '#991b1b', bg: '#fee2e2' };
  return null;
};

/* Symbol shown ABOVE the Time In when the staff actually punched on a Public
   Holiday (H.P) or a Weekend/Day Off (W.P). Holiday wins over weekend. Same
   codes as the Present/Absent reports. Returns null for an ordinary day. */
export const presentSymbol = (day, isWeekend, isHoliday, LL) => {
  if (!day?.timeIn) return null;
  if (isHoliday) return { text: LL('उसा', 'H.P'), title: LL('सार्वजनिक बिदामा उपस्थित', 'Present on Public Holiday'), color: '#92400e' };
  if (isWeekend) return { text: LL('उस', 'W.P'), title: LL('सप्ताहन्तमा उपस्थित', 'Present on Weekend'), color: '#0f766e' };
  return null;
};

/* Print-HTML content for an IN cell: the time (plus a "SL 1/2" tag for a
   half-day leave), or the status short name when there's no punch. */
export const inRowPrintHtml = (timeText, day, isWeekend, isHoliday, LL) => {
  if (timeText) {
    const half = day?.leave?.halfDay
      ? `<br/><span style="font-size:6.5px;font-weight:800;color:#5b21b6">${leaveShort(day.leave)} 1/2</span>`
      : '';
    const sym = presentSymbol(day, isWeekend, isHoliday, LL);
    const top = sym ? `<span style="display:block;font-size:6.5px;font-weight:800;color:${sym.color}">${sym.text}</span>` : '';
    return `${top}${timeText}${half}`;
  }
  const st = inRowStatus(day, isWeekend, isHoliday, LL);
  return st ? `<span ${st.title ? `title="${String(st.title).replace(/"/g, '&quot;')}" ` : ''}style="font-weight:800;color:${st.color}">${st.text}</span>` : '';
};

/* Plain-text version of the above for Excel export. */
export const inRowExcelText = (timeText, day, isWeekend, isHoliday, LL) => {
  if (timeText) {
    const sym = presentSymbol(day, isWeekend, isHoliday, LL);
    const t = day?.leave?.halfDay ? `${timeText} (${leaveShort(day.leave)} 1/2)` : timeText;
    return sym ? `${sym.text}
${t}` : t;
  }
  return inRowStatus(day, isWeekend, isHoliday, LL)?.text || '';
};
