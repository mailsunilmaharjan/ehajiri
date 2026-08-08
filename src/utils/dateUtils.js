// ============================================================
//  Date Utility — AD ↔ BS conversion + global format engine
// ============================================================

// BS month days per year (Baisakh=1 … Chaitra=12)
// Verified against ashesh.com.np/nepali-calendar (2083 parsed month-by-month)
// and cross-checked with the nepali-datetime + nepali-date-converter datasets.
export const BS_DATA = {
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

/** Drop-in replacement for `new Date().toISOString().split('T')[0]` — today's Nepal calendar date as YYYY-MM-DD. */
export function getNepalTodayISO() {
  const d = new Date(Date.now() + NEPAL_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
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

  const diffMs   = d - REF_AD;
  const diffDays = Math.round(diffMs / 86400000);

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
