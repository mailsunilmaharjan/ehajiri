// ============================================================
//  Date Utility — AD ↔ BS conversion + global format engine
// ============================================================

// BS month days per year (Baisakh=1 … Chaitra=12)
// 2076-2086 verified against ashesh.com.np/nepali-calendar (2083 parsed
// month-by-month) and cross-checked with the nepali-datetime + nepali-date-
// converter datasets — left exactly as originally entered.
//
// 2000-2075 and 2087-2099 extracted from the nepali-datetime@2.0.0 npm
// package's own bundled table (not hand-typed) — added because any BS date
// outside the previous 2076-2086-only range (an 11-year window covering
// roughly AD 2019-2030) silently fell back to a flat 30-day/month
// approximation in getBSDays() below, which compounds into months of drift
// for anything decades old or new — most consequentially birth dates:
// converting a staff member's real DOB (e.g. an adult born in the 1970s,
// BS ~2020s) through that flat fallback landed the AD equivalent several
// MONTHS off, so a Magh birthday could resurface as an Ashwin one once
// re-derived (see the Dashboard's upcoming-birthdays widget). This new
// range was spot-checked against the existing 2076-2083 rows above — every
// one matches exactly. 2084-2086 do NOT match the same package's data
// (Nepal's official calendar isn't finalized this far ahead when a table
// like this gets published, so different sources can briefly disagree on
// not-yet-official future years) — left untouched rather than silently
// overwritten; flagged for verification against an authoritative source
// before those 3 years are ever changed.
export const BS_DATA = {
  2000: [30,32,31,32,31,30,30,30,29,30,29,31],
  2001: [31,31,32,31,31,31,30,29,30,29,30,30],
  2002: [31,31,32,32,31,30,30,29,30,29,30,30],
  2003: [31,32,31,32,31,30,30,30,29,29,30,31],
  2004: [30,32,31,32,31,30,30,30,29,30,29,31],
  2005: [31,31,32,31,31,31,30,29,30,29,30,30],
  2006: [31,31,32,32,31,30,30,29,30,29,30,30],
  2007: [31,32,31,32,31,30,30,30,29,29,30,31],
  2008: [31,31,31,32,31,31,29,30,30,29,29,31],
  2009: [31,31,32,31,31,31,30,29,30,29,30,30],
  2010: [31,31,32,32,31,30,30,29,30,29,30,30],
  2011: [31,32,31,32,31,30,30,30,29,29,30,31],
  2012: [31,31,31,32,31,31,29,30,30,29,30,30],
  2013: [31,31,32,31,31,31,30,29,30,29,30,30],
  2014: [31,31,32,32,31,30,30,29,30,29,30,30],
  2015: [31,32,31,32,31,30,30,30,29,29,30,31],
  2016: [31,31,31,32,31,31,29,30,30,29,30,30],
  2017: [31,31,32,31,31,31,30,29,30,29,30,30],
  2018: [31,32,31,32,31,30,30,29,30,29,30,30],
  2019: [31,32,31,32,31,30,30,30,29,30,29,31],
  2020: [31,31,31,32,31,31,30,29,30,29,30,30],
  2021: [31,31,32,31,31,31,30,29,30,29,30,30],
  2022: [31,32,31,32,31,30,30,30,29,29,30,30],
  2023: [31,32,31,32,31,30,30,30,29,30,29,31],
  2024: [31,31,31,32,31,31,30,29,30,29,30,30],
  2025: [31,31,32,31,31,31,30,29,30,29,30,30],
  2026: [31,32,31,32,31,30,30,30,29,29,30,31],
  2027: [30,32,31,32,31,30,30,30,29,30,29,31],
  2028: [31,31,32,31,31,31,30,29,30,29,30,30],
  2029: [31,31,32,31,32,30,30,29,30,29,30,30],
  2030: [31,32,31,32,31,30,30,30,29,29,30,31],
  2031: [30,32,31,32,31,30,30,30,29,30,29,31],
  2032: [31,31,32,31,31,31,30,29,30,29,30,30],
  2033: [31,31,32,32,31,30,30,29,30,29,30,30],
  2034: [31,32,31,32,31,30,30,30,29,29,30,31],
  2035: [30,32,31,32,31,31,29,30,30,29,29,31],
  2036: [31,31,32,31,31,31,30,29,30,29,30,30],
  2037: [31,31,32,32,31,30,30,29,30,29,30,30],
  2038: [31,32,31,32,31,30,30,30,29,29,30,31],
  2039: [31,31,31,32,31,31,29,30,30,29,30,30],
  2040: [31,31,32,31,31,31,30,29,30,29,30,30],
  2041: [31,31,32,32,31,30,30,29,30,29,30,30],
  2042: [31,32,31,32,31,30,30,30,29,29,30,31],
  2043: [31,31,31,32,31,31,29,30,30,29,30,30],
  2044: [31,31,32,31,31,31,30,29,30,29,30,30],
  2045: [31,32,31,32,31,30,30,29,30,29,30,30],
  2046: [31,32,31,32,31,30,30,30,29,29,30,31],
  2047: [31,31,31,32,31,31,30,29,30,29,30,30],
  2048: [31,31,32,31,31,31,30,29,30,29,30,30],
  2049: [31,32,31,32,31,30,30,30,29,29,30,30],
  2050: [31,32,31,32,31,30,30,30,29,30,29,31],
  2051: [31,31,31,32,31,31,30,29,30,29,30,30],
  2052: [31,31,32,31,31,31,30,29,30,29,30,30],
  2053: [31,32,31,32,31,30,30,30,29,29,30,30],
  2054: [31,32,31,32,31,30,30,30,29,30,29,31],
  2055: [31,31,32,31,31,31,30,29,30,29,30,30],
  2056: [31,31,32,31,32,30,30,29,30,29,30,30],
  2057: [31,32,31,32,31,30,30,30,29,29,30,31],
  2058: [30,32,31,32,31,30,30,30,29,30,29,31],
  2059: [31,31,32,31,31,31,30,29,30,29,30,30],
  2060: [31,31,32,32,31,30,30,29,30,29,30,30],
  2061: [31,32,31,32,31,30,30,30,29,29,30,31],
  2062: [30,32,31,32,31,31,29,30,29,30,29,31],
  2063: [31,31,32,31,31,31,30,29,30,29,30,30],
  2064: [31,31,32,32,31,30,30,29,30,29,30,30],
  2065: [31,32,31,32,31,30,30,30,29,29,30,31],
  2066: [31,31,31,32,31,31,29,30,30,29,29,31],
  2067: [31,31,32,31,31,31,30,29,30,29,30,30],
  2068: [31,31,32,32,31,30,30,29,30,29,30,30],
  2069: [31,32,31,32,31,30,30,30,29,29,30,31],
  2070: [31,31,31,32,31,31,29,30,30,29,30,30],
  2071: [31,31,32,31,31,31,30,29,30,29,30,30],
  2072: [31,32,31,32,31,30,30,29,30,29,30,30],
  2073: [31,32,31,32,31,30,30,30,29,29,30,31],
  2074: [31,31,31,32,31,31,30,29,30,29,30,30],
  2075: [31,31,32,31,31,31,30,29,30,29,30,30],
  2076: [31,32,31,32,31,30,30,30,29,29,30,30],
  2077: [31,32,31,32,31,30,30,30,29,30,29,31],
  2078: [31,31,31,32,31,31,30,29,30,29,30,30],
  2079: [31,31,32,31,31,31,30,29,30,29,30,30],
  2080: [31,32,31,32,31,30,30,30,29,29,30,30],
  2081: [31,32,31,32,31,30,30,30,29,30,29,31],
  2082: [31,31,32,31,31,31,30,29,30,29,30,30],
  2083: [31,31,32,31,31,31,30,29,30,29,30,30],
  2084: [31,31,32,31,31,30,30,30,29,30,30,30],
  2085: [31,32,31,32,30,31,30,30,29,30,30,30],
  2086: [30,32,31,32,31,30,30,30,29,30,30,30],
  2087: [31,31,32,32,31,30,30,29,30,29,30,30],
  2088: [31,32,31,32,31,30,30,30,29,29,30,31],
  2089: [30,32,31,32,31,30,30,30,29,30,29,31],
  2090: [31,31,32,31,31,31,30,29,30,29,30,30],
  2091: [31,31,32,32,31,30,30,29,30,29,30,30],
  2092: [31,32,31,32,31,30,30,30,29,29,30,31],
  2093: [31,31,31,32,31,31,29,30,30,29,29,31],
  2094: [31,31,32,31,31,31,30,29,30,29,30,30],
  2095: [31,31,32,32,31,30,30,29,30,29,30,30],
  2096: [31,32,31,32,31,30,30,30,29,29,30,31],
  2097: [31,31,31,32,31,31,29,30,30,29,30,30],
  2098: [31,31,32,31,31,31,30,29,30,29,30,30],
  2099: [31,31,32,32,31,30,30,29,30,29,30,30],
};

// Reference point: BS 2081/01/01 = AD 2024/04/13 (Nepal New Year 2081)
const REF_BS  = { year: 2081, month: 1, day: 1 };
const REF_AD  = new Date(2024, 3, 13); // month is 0-indexed; April 13, 2024

// ── Nepal-anchored "now" ──────────────────────────────────────────────────
// eHajiri is a Nepal-only attendance system, so "today" must always mean
// Nepal wall-clock time (UTC+5:45, no DST) — never the viewer's own OS/
// browser timezone and never raw UTC. Neither `new Date()` + local getters
// nor `new Date().toISOString()` give that: the former drifts a day
// whenever the viewer's own clock isn't set to Nepal time, the latter
// drifts for every viewer during Nepal's 00:00-05:45 window since it's
// always UTC. These two are the only correct ways to get "today" in Nepal.
const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;

/**
 * Drop-in replacement for `new Date()` wherever the result is read via
 * LOCAL getters (getFullYear/getMonth/getDate/getHours/...). Shifts the
 * epoch by (Nepal's offset − the viewer's own offset), so those same local
 * getters — unchanged at the call site — report Nepal wall-clock time
 * instead of the viewer's own OS time.
 */
export function getNepalNow() {
  const now = new Date();
  const localOffsetMs = -now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() + NEPAL_OFFSET_MS - localOffsetMs);
}

/** Nepal calendar date (YYYY-MM-DD) for any timestamp/date input, not just "now". */
export function toNepalISO(input) {
  const d = new Date(new Date(input).getTime() + NEPAL_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Drop-in replacement for `new Date().toISOString().split('T')[0]` — today's Nepal calendar date as YYYY-MM-DD. */
export function getNepalTodayISO() {
  return toNepalISO(Date.now());
}

/**
 * Adds `n` days to a YYYY-MM-DD date string, returning a new YYYY-MM-DD.
 * Plain calendar-day math (not Nepal-offset-aware) — meant to be applied on
 * top of an already-Nepal-derived ISO date, e.g. `addDaysISO(getNepalTodayISO(), -1)`.
 * Originally local to TaskList.jsx's date-bucket badges/"My Yesterday Task"
 * filter, promoted here once TaskDashboard.jsx needed the same math.
 */
export function addDaysISO(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/**
 * Converts a stored UTC timestamp into the "YYYY-MM-DDTHH:mm" shape a
 * <input type="datetime-local"> needs, in Nepal wall-clock time — not the
 * viewer's own OS timezone. Same fixed-offset technique as getNepalNow():
 * shift the epoch, then read it back with UTC getters so the browser's own
 * offset never enters into it. Originally local to TaskList.jsx (Task
 * followups' "Next Followup & Time" + Field Visit's own checkpoint
 * timestamps both need it), promoted here once a third caller needed it.
 */
export function isoToNepalLocalInput(isoUtc) {
  if (!isoUtc) return '';
  const d = new Date(new Date(isoUtc).getTime() + NEPAL_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** Date part goes through fd() (the company's AD/BS calendar setting), the time part is read straight off the Nepal-shifted string. */
export function formatNepalDateTime(isoUtc, fd) {
  if (!isoUtc) return '—';
  const [datePart, timePart] = isoToNepalLocalInput(isoUtc).split('T');
  const [hh, mm] = timePart.split(':').map(Number);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const hh12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${fd(datePart)} ${hh12}:${String(mm).padStart(2, '0')} ${ampm}`;
}

/** Time-of-day only ("4:30 PM"), Nepal wall-clock — for compact UI like the Field Visit journey bar. */
export function formatNepalTime(isoUtc) {
  if (!isoUtc) return '—';
  const timePart = isoToNepalLocalInput(isoUtc).split('T')[1];
  const [hh, mm] = timePart.split(':').map(Number);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const hh12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${hh12}:${String(mm).padStart(2, '0')} ${ampm}`;
}

/** Shared fiscal-year lookup — consolidates the identical copy previously duplicated across report files. */
export function getCurrentFiscalYear(fiscalYears = []) {
  const today = getNepalTodayISO();
  return fiscalYears.find(fy => fy.startDate <= today && fy.endDate >= today)
      || fiscalYears.find(fy => fy.isDefault)
      || fiscalYears[fiscalYears.length - 1]
      || null;
}

export function getBSDays(year, month) {
  const row = BS_DATA[year];
  if (!row) return 30; // fallback
  return row[month - 1];
}

/** Convert AD date string / Date → { year, month, day } in BS */
export function adToBS(input) {
  if (!input) return null;
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d)) return null;

  // Normalize to a pure calendar date (midnight) before diffing. `d` often
  // carries the actual current time-of-day (e.g. getNepalNow()'s output) —
  // diffing that directly against REF_AD's midnight and rounding meant the
  // fractional day crossed the 0.5-day mark at exactly 12:00 PM, rounding
  // up to the NEXT day's BS date for the rest of the afternoon/evening even
  // though the AD calendar date hadn't changed yet.
  const dMidnight   = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const refMidnight = new Date(REF_AD.getFullYear(), REF_AD.getMonth(), REF_AD.getDate());
  const diffDays = Math.round((dMidnight - refMidnight) / 86400000);

  let { year, month, day } = { ...REF_BS };

  if (diffDays >= 0) {
    let rem = diffDays;
    while (rem > 0) {
      const daysLeft = getBSDays(year, month) - day;
      if (rem <= daysLeft) { day += rem; rem = 0; }
      else {
        rem -= (daysLeft + 1);
        month++; day = 1;
        if (month > 12) { month = 1; year++; }
      }
    }
  } else {
    let rem = -diffDays;
    while (rem > 0) {
      if (day > 1) { day--; rem--; }
      else {
        month--; if (month < 1) { month = 12; year--; }
        day = getBSDays(year, month); rem--;
      }
    }
  }
  return { year, month, day };
}

/**
 * Convert a Bikram Sambat date → AD Date object (local time).
 * Uses the same BS_DATA reference table as adToBS.
 *
 * @param {number} bsYear
 * @param {number} bsMonth  (1–12)
 * @param {number} bsDay
 * @returns {Date}
 */
export function bsToAD(bsYear, bsMonth, bsDay) {
  let { year, month, day } = { ...REF_BS };
  let diffDays = 0;

  // Compare current traversal position against target
  const cmp = (y, m, d) => {
    if (y !== bsYear) return y < bsYear ? -1 : 1;
    if (m !== bsMonth) return m < bsMonth ? -1 : 1;
    if (d !== bsDay)   return d < bsDay   ? -1 : 1;
    return 0;
  };

  const direction = cmp(year, month, day);
  if (direction === 0) {
    return new Date(REF_AD.getFullYear(), REF_AD.getMonth(), REF_AD.getDate());
  }

  if (direction < 0) {
    // REF_BS is before target → move forward
    while (cmp(year, month, day) !== 0) {
      day++; diffDays++;
      if (day > getBSDays(year, month)) { day = 1; month++; }
      if (month > 12) { month = 1; year++; }
    }
    return new Date(REF_AD.getFullYear(), REF_AD.getMonth(), REF_AD.getDate() + diffDays);
  } else {
    // REF_BS is after target → move backward
    while (cmp(year, month, day) !== 0) {
      day--; diffDays++;
      if (day < 1) {
        month--;
        if (month < 1) { month = 12; year--; }
        day = getBSDays(year, month);
      }
    }
    return new Date(REF_AD.getFullYear(), REF_AD.getMonth(), REF_AD.getDate() - diffDays);
  }
}

// ---- Month names ----
const AD_MONTHS_LONG  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const AD_MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const BS_MONTHS_NP = ['बैशाख','जेठ','असार','श्रावण','भाद्र','आश्विन','कार्तिक','मंसिर','पुष','माघ','फागुन','चैत्र'];
export const BS_MONTHS_EN = ['Baisakh','Jestha','Ashadh','Shrawan','Bhadra','Ashwin','Kartik','Mangsir','Poush','Magh','Falgun','Chaitra'];

const NP_DIGITS = ['०','१','२','३','४','५','६','७','८','९'];

export function toNepaliDigits(n) {
  return String(n).replace(/[0-9]/g, d => NP_DIGITS[+d]);
}

function pad(n, useNp) {
  const s = String(n).padStart(2, '0');
  return useNp ? toNepaliDigits(s) : s;
}
function num(n, useNp) {
  return useNp ? toNepaliDigits(n) : String(n);
}

/**
 * Main formatter — used everywhere in the app.
 *
 * @param {string|Date} input  — raw date (YYYY-MM-DD or Date object)
 * @param {object} opts
 *   calendar   : 'en' | 'np'
 *   format     : one of the FORMAT_OPTIONS keys
 *   nepaliDigits : boolean
 * @returns {string}
 */
export function formatDate(input, { calendar = 'en', format = 'dd-MMM-yyyy', nepaliDigits = false } = {}) {
  if (!input || input === '—' || input === '-') return '—';

  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d)) return String(input);

  if (calendar === 'np') {
    const bs = adToBS(d);
    if (!bs) return String(input);
    const { year, month, day } = bs;
    const mnLong  = BS_MONTHS_NP[month - 1];
    const mnShort = BS_MONTHS_EN[month - 1]; // short BS in English
    const y  = num(year, nepaliDigits);
    const dd = pad(day,  nepaliDigits);
    const mm = pad(month, nepaliDigits);

    switch (format) {
      case 'dd-MMM-yyyy':  return `${dd}-${mnShort}-${y}`;
      case 'dd-MMMM-yyyy': return `${dd}-${mnLong}-${y}`;
      case 'dd/MM/yyyy':   return `${dd}/${mm}/${y}`;
      case 'MM/dd/yyyy':   return `${mm}/${dd}/${y}`;
      case 'yyyy-MM-dd':   return `${y}-${mm}-${dd}`;
      case 'MMMM dd, yyyy':return `${mnLong} ${dd}, ${y}`;
      default:             return `${dd}-${mnShort}-${y}`;
    }
  }

  // --- AD (Gregorian) ---
  const day   = d.getDate();
  const month = d.getMonth();
  const year  = d.getFullYear();
  const dd    = pad(day, false);
  const mm    = pad(month + 1, false);
  const mnLong  = AD_MONTHS_LONG[month];
  const mnShort = AD_MONTHS_SHORT[month];

  switch (format) {
    case 'dd-MMM-yyyy':  return `${dd}-${mnShort}-${year}`;
    case 'dd-MMMM-yyyy': return `${dd}-${mnLong}-${year}`;
    case 'dd/MM/yyyy':   return `${dd}/${mm}/${year}`;
    case 'MM/dd/yyyy':   return `${mm}/${dd}/${year}`;
    case 'yyyy-MM-dd':   return `${year}-${mm}-${dd}`;
    case 'MMMM dd, yyyy':return `${mnLong} ${dd}, ${year}`;
    default:             return `${dd}-${mnShort}-${year}`;
  }
}

/** Human-readable format labels with live preview */
export const FORMAT_OPTIONS = [
  { key: 'dd-MMM-yyyy',   label: 'dd-MMM-yyyy',   preview: (d,cal,np) => formatDate(d,{calendar:cal,format:'dd-MMM-yyyy',  nepaliDigits:np}) },
  { key: 'dd-MMMM-yyyy',  label: 'dd-MMMM-yyyy',  preview: (d,cal,np) => formatDate(d,{calendar:cal,format:'dd-MMMM-yyyy', nepaliDigits:np}) },
  { key: 'dd/MM/yyyy',    label: 'dd/MM/yyyy',     preview: (d,cal,np) => formatDate(d,{calendar:cal,format:'dd/MM/yyyy',   nepaliDigits:np}) },
  { key: 'MM/dd/yyyy',    label: 'MM/dd/yyyy',     preview: (d,cal,np) => formatDate(d,{calendar:cal,format:'MM/dd/yyyy',   nepaliDigits:np}) },
  { key: 'yyyy-MM-dd',    label: 'yyyy-MM-dd',     preview: (d,cal,np) => formatDate(d,{calendar:cal,format:'yyyy-MM-dd',   nepaliDigits:np}) },
  { key: 'MMMM dd, yyyy', label: 'MMMM dd, yyyy',  preview: (d,cal,np) => formatDate(d,{calendar:cal,format:'MMMM dd, yyyy',nepaliDigits:np}) },
];

/** Hook-friendly: returns a pre-bound formatter from settings */
export function makeDateFormatter(settings) {
  return (input) => formatDate(input, {
    calendar:     settings.defaultCalendar,
    format:       settings.defaultDateFormat,
    nepaliDigits: settings.nepaliDigits,
  });
}
