// Shared category/color logic for the "day cell" of any calendar built on
// top of a /attendance/staff-ledger `days[]` entry — used by the Dashboard's
// MyMonthlyCalendar.jsx and RosterReport.jsx's StaffCalendar so both render
// attendance days identically instead of drifting apart.

// Category → light color pair (for on-screen) + shortCode (for print, where
// color is stripped and a plain black-on-white short label is used instead
// — see RosterReport.jsx's #staff-cal-print rules). Also doubles as a
// ready-made legend list via Object.values(CATEGORIES).
export const CATEGORIES = {
  holiday:  { label: 'Public Holiday', shortCode: 'H',  bg: '#f5f3ff', color: '#7c3aed' },
  leave:    { label: 'Leave',          shortCode: 'L',  bg: '#fffbeb', color: '#b45309' },
  visit:    { label: 'Office Visit',   shortCode: 'V',  bg: '#eff6ff', color: '#1d4ed8' },
  dayOff:   { label: 'Day Off',        shortCode: 'DO', bg: '#fdf2f8', color: '#be185d' },
  nightOff: { label: 'Night Off',      shortCode: 'NO', bg: '#eef2ff', color: '#4338ca' },
  weekend:  { label: 'Weekend',        shortCode: 'W',  bg: '#f1f5f9', color: '#475569' },
  present:  { label: 'Present',        shortCode: 'P',  bg: '#f0fdf4', color: '#15803d' },
  absent:   { label: 'Absent',         shortCode: 'A',  bg: '#fef2f2', color: '#dc2626' },
};

// One day's category, derived from a /attendance/staff-ledger day entry (or
// null for a day with no data at all). Priority mirrors what's most useful
// to see at a glance on a calendar: Public Holiday > Leave > Day/Night Off
// (roster-assigned) > Office Visit > plain Weekend > Present > Absent.
// isFuture days never get Present/Absent/Office Visit — attendance can't
// have happened yet, only the schedule (weekend/off/leave/holiday) is known
// in advance, so a future day with none of those just stays blank.
export const categorize = (d, isFuture) => {
  if (!d) return null;
  if (d.isPublicHoliday) return 'holiday';
  if (d.leave) return 'leave';
  if (d.status === 'Weekend') {
    if (d.shiftName === 'Day Off')   return 'dayOff';
    if (d.shiftName === 'Night Off') return 'nightOff';
    return 'weekend';
  }
  if (isFuture) return null;
  if (d.hasVisit) return 'visit';
  if (d.status === 'Present') return 'present';
  return 'absent';
};

// timeIn/timeOut are Date-parseable timestamps.
export const fmtPunchTime = (v) => v ? new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

// shiftStart/shiftEnd are plain "HH:MM[:SS]" time strings, not Date-parseable
// timestamps like timeIn/timeOut above — needs its own formatter.
export const fmtShiftTime = (t) => {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
};

// Extra status pills shown alongside the "Present" label — Late In / Early
// Out (from the same lateMins/earlyMins the day-entry's IN/OUT status text
// is built from) and Miss Punch (checked in but never checked out, i.e. a
// single unpaired punch for the day). Only meaningful when cat === 'present'.
export const presentFlags = (d) => {
  if (!d) return [];
  const flags = [];
  if (d.lateMins > 0)  flags.push({ label: 'Late In',   bg: '#fffbeb', color: '#b45309', border: '#fde68a' });
  if (d.earlyMins > 0) flags.push({ label: 'Early Out', bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' });
  if (d.timeIn && !d.timeOut) flags.push({ label: 'Miss Punch', bg: '#fff7ed', color: '#c2410c', border: '#fed7aa' });
  return flags;
};

// Duty Roster line — only when an explicit roster entry exists for this day
// (not just the employee's generic default shift) and there's no real punch
// time to show instead; covers future days and past days marked absent,
// skipped for Day/Night Off/Holiday/Leave since those labels already say
// everything useful.
export const dutyRosterRange = (d, cat, hasPunch) => {
  if (!d?.hasRoster || hasPunch || ['dayOff', 'nightOff', 'holiday', 'leave'].includes(cat)) return null;
  if (!d.shiftStart && !d.shiftEnd) return null;
  return `${fmtShiftTime(d.shiftStart) || '—'} - ${fmtShiftTime(d.shiftEnd) || '—'}`;
};
