import { adToBS, bsToAD, BS_DATA } from './dateUtils.js';

const pad = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/* Bulk-paste date parser: "2083/12/07", "2083-12-7", "2083.12.07" → ISO AD date
   string (YYYY-MM-DD), or null when it isn't a real date.
   `calendar` is the app's Default Calendar ('np' = BS). A year above 2060 can
   only be BS, so it's treated as BS whatever the setting. BS dates are checked
   against the real month length first (bsToAD never returns for a day that
   doesn't exist in that month — it walks day-by-day looking for an exact match,
   which would freeze the tab on every keystroke of a paste) and round-trip
   verified, and only for years the calendar table covers. */
export const toAdISO = (raw, calendar) => {
  // Devanagari digits (२०८३/०१/१७) and stray invisible characters from an Excel/web copy
  const clean = String(raw ?? '').replace(/[​-‍﻿]/g, '').replace(/[०-९]/g, d => '०१२३४५६७८९'.indexOf(d)).trim();
  const m = clean.match(/^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 32) return null;
  if (calendar === 'np' || y > 2060) {
    const monthDays = BS_DATA[y]?.[mo - 1];
    if (!monthDays || d > monthDays) return null;
    const ad = bsToAD(y, mo, d);
    if (!ad || isNaN(ad)) return null;
    const back = adToBS(ad);
    if (!back || back.year !== y || back.month !== mo || back.day !== d) return null;
    return isoOf(ad);
  }
  const ad = new Date(y, mo - 1, d);
  if (isNaN(ad) || ad.getMonth() !== mo - 1) return null;
  return isoOf(ad);
};
