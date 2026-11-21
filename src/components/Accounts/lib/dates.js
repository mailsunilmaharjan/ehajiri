// AD <-> BS conversion — same table as eHajiri Lite (web/src/lib/dates.js).
export const BS_DATA = {
  2076: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2077: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2078: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
  2079: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2080: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2081: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2082: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2083: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2084: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30],
  2085: [31, 32, 31, 32, 30, 31, 30, 30, 29, 30, 30, 30],
  2086: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
};
export const BS_MONTHS = ['Baisakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'];
export const BS_MIN = 2076;
export const BS_MAX = 2086;
const AD_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const dayNum = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY;
};
const isoOf = (n) => {
  const d = new Date(n * DAY);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
export const addDays = (iso, n) => isoOf(dayNum(iso) + n);

const REF_YEAR = 2081; // BS 2081-01-01 = AD 2024-04-13
const YEAR_START = (() => {
  const s = { [REF_YEAR]: dayNum('2024-04-13') };
  const sum = (y) => BS_DATA[y].reduce((a, b) => a + b, 0);
  for (let y = REF_YEAR + 1; y <= BS_MAX; y++) s[y] = s[y - 1] + sum(y - 1);
  for (let y = REF_YEAR - 1; y >= BS_MIN; y--) s[y] = s[y + 1] - sum(y);
  return s;
})();

export function adToBs(iso) {
  if (!iso) return null;
  const n = dayNum(iso.slice(0, 10));
  for (let y = BS_MIN; y <= BS_MAX; y++) {
    let off = n - YEAR_START[y];
    const months = BS_DATA[y];
    if (off < 0 || off >= months.reduce((a, b) => a + b, 0)) continue;
    let m = 0;
    while (off >= months[m]) { off -= months[m]; m++; }
    return { year: y, month: m + 1, day: off + 1 };
  }
  return null;
}

export function bsToAd(year, month, day) {
  const months = BS_DATA[year];
  if (!months) return null;
  let off = day - 1;
  for (let m = 0; m < month - 1; m++) off += months[m];
  return isoOf(YEAR_START[year] + off);
}

export const fmtBs = (iso) => {
  const b = adToBs(iso);
  return b ? `${pad(b.day)}-${BS_MONTHS[b.month - 1]}-${b.year}` : '';
};
/** Short Nepali month for grid cells: 01-Bai-2083 (Ashadh = Asa, Ashwin = Asw so the two stay distinct). */
export const BS_SHORT = ['Bai', 'Jes', 'Asa', 'Shr', 'Bha', 'Asw', 'Kar', 'Man', 'Pou', 'Mag', 'Fal', 'Cha'];
export const fmtBsShort = (iso) => {
  const b = adToBs(iso);
  return b ? `${pad(b.day)}-${BS_SHORT[b.month - 1]}-${b.year}` : '';
};
export const fmtAd = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${pad(d)}-${AD_SHORT[m - 1]}-${y}`;
};

let display = 'BS';
export const setDateDisplay = (d) => { display = d || 'BS'; };
/** One date only, in the default calendar (BS unless the company chose AD). The other is shown on hover — see altDate(). */
export const fmtDate = (iso) => {
  if (!iso) return '';
  if (display === 'AD') return fmtAd(iso);
  return fmtBs(iso) || fmtAd(iso);
};
/** Same as fmtDate but with the short Nepali month (01-Bai-2083) — used in grid cells only; headers / prints keep the full month. */
export const fmtDateShort = (iso) => {
  if (!iso) return '';
  if (display === 'AD') return fmtAd(iso);
  return fmtBsShort(iso) || fmtAd(iso);
};
/** The other calendar, for the mouse-over tooltip. */
export const altDate = (iso) => {
  if (!iso) return '';
  return display === 'AD' ? `${fmtBs(iso)} BS` : `${fmtAd(iso)} AD`;
};

/** "2026-11-11 08:15:00" (UTC, as saved) -> "25-Kartik-2083 2:00 PM" in local time, in the company's calendar. */
export function fmtSaved(s) {
  if (!s) return '';
  const d = new Date(`${String(s).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return s;
  return `${fmtDate(d.toLocaleDateString('en-CA'))} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}