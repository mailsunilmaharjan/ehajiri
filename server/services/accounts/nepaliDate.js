/* AD <-> BS (Bikram Sambat) conversion — port of NepalAccounts/server/app/nepali_date.py
 * (same verified table as the frontend lib; BS 2081-01-01 = AD 2024-04-13).
 *
 * The table only covers BS 2076–2086 (to about April 2030). Dates outside it return null /
 * throw a clear error rather than guessing — extend BS_DATA with VERIFIED calendar data
 * before relying on fiscal years beyond 2085/86.
 *
 * All dates are 'YYYY-MM-DD' strings; arithmetic is done in whole UTC days so no timezone
 * can shift a date.
 */
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
export const BS_MIN = 2076;
export const BS_MAX = 2086;
export const BS_MONTHS = ['Baishakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'];

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const dayNum = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };
const isoOf = (n) => { const d = new Date(n * DAY); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const sum = (a) => a.reduce((x, y) => x + y, 0);

export const addDays = (iso, n) => isoOf(dayNum(iso) + n);
/** Whole days from b to a (a − b). */
export const diffDays = (a, b) => dayNum(a) - dayNum(b);
export const todayAd = () => {
  // "today" in Nepal (UTC+5:45), not the server's own timezone
  const t = new Date(Date.now() + (5 * 60 + 45) * 60000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};
export const isIsoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && isoOf(dayNum(s)) === s;

const REF_YEAR = 2081;
const YEAR_START = (() => {
  const s = { [REF_YEAR]: dayNum('2024-04-13') };
  for (let y = REF_YEAR + 1; y <= BS_MAX; y++) s[y] = s[y - 1] + sum(BS_DATA[y - 1]);
  for (let y = REF_YEAR - 1; y >= BS_MIN; y--) s[y] = s[y + 1] - sum(BS_DATA[y]);
  return s;
})();

/** [year, month, day] or null when outside the supported range. */
export function adToBs(iso) {
  const n = dayNum(iso);
  for (let y = BS_MIN; y <= BS_MAX; y++) {
    let off = n - YEAR_START[y];
    const months = BS_DATA[y];
    if (off < 0 || off >= sum(months)) continue;
    let m = 0;
    while (off >= months[m]) { off -= months[m]; m++; }
    return [y, m + 1, off + 1];
  }
  return null;
}

export function bsToAd(y, m, d) {
  if (!BS_DATA[y]) throw new Error(`BS year ${y} is outside the supported calendar (${BS_MIN}–${BS_MAX}).`);
  return isoOf(YEAR_START[y] + sum(BS_DATA[y].slice(0, m - 1)) + d - 1);
}

export function bsStr(iso) {
  if (!iso) return '';
  const b = adToBs(String(iso).slice(0, 10));
  return b ? `${b[0]}-${pad(b[1])}-${pad(b[2])}` : '';
}

/** '04-Mangsir-2083' — the way dates are shown on screen. */
export function bsLong(iso) {
  if (!iso) return '';
  const b = adToBs(String(iso).slice(0, 10));
  return b ? `${pad(b[2])}-${BS_MONTHS[b[1] - 1]}-${b[0]}` : '';
}

/** Nepal fiscal year: 1 Shrawan (BS month 4) to the last day of Ashadh next year. */
export function fiscalYearOf(iso) {
  const b = adToBs(iso);
  if (!b) throw Object.assign(new Error(`The date ${iso} is outside the supported Nepali calendar (${BS_MIN}–${BS_MAX}). Contact support to extend it.`), { status: 400 });
  const startY = b[1] >= 4 ? b[0] : b[0] - 1;
  if (!BS_DATA[startY + 1] && startY + 1 > BS_MAX) {
    throw Object.assign(new Error(`Fiscal year ${startY}/${String(startY + 1).slice(-2)} is outside the supported Nepali calendar. Contact support to extend it.`), { status: 400 });
  }
  const start = bsToAd(startY, 4, 1);
  const end = addDays(bsToAd(startY + 1, 4, 1), -1);
  return { name: `${startY}/${String(startY + 1).slice(-2)}`, start, end };
}
