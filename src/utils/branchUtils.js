/**
 * Returns the display short-name for a branch value:
 *   - Company HQ name  → "HQ"
 *   - Known branch     → shortName from settings.branches
 *   - Unknown          → auto-abbreviation (initials or first 4 uppercase)
 */
/**
 * The branch value staff at the company's HQ carry — Settings → Company
 * Information "Short Name", "Head Office" when unset (never the company's
 * full name; migration v152 moved staff saved under it). A staff member with
 * no branch at all is treated as being at HQ too — see isHQBranch.
 */
export const HQ_DEFAULT_NAME = 'Head Office';
export const hqBranchName = (settings) =>
  (settings?.companyShortName || '').trim() || HQ_DEFAULT_NAME;

/** True for the HQ branch value, a blank branch, or the legacy company-name value. */
export const isHQBranch = (branch, settings) => {
  const b = String(branch || '').trim().toLowerCase();
  if (!b) return true;
  return [hqBranchName(settings), settings?.companyNameEn, settings?.companyNameNp]
    .some(n => n && String(n).trim().toLowerCase() === b);
};

/**
 * Company HQ / Branch dropdown options: "Head Office (HQ)" first, then every
 * Settings → Branch entry except one that shares the HQ name (a tenant that
 * had created its own "Head Office" branch would otherwise see it twice).
 */
export const branchSelectOptions = (settings) => {
  const hq = hqBranchName(settings);
  return [
    { value: hq, label: `${hq} (HQ)` },
    ...(settings?.branches || [])
      .filter(b => String(b.name || '').trim().toLowerCase() !== hq.toLowerCase())
      .map(b => ({ value: b.name, label: b.name })),
  ];
};

export const branchAbbr = (name, settings) => {
  if (!name || name === '—') return '—';
  const en = (settings?.companyNameEn || '').trim();
  const np = (settings?.companyNameNp || '').trim();
  const hq = hqBranchName(settings);
  if ((en && name === en) || (np && name === np) || (hq && name === hq)) return 'HQ';
  const found = (settings?.branches || []).find(b => b.name === name);
  if (found?.shortName) return found.shortName;
  const words = name.trim().split(/\s+/);
  if (words.length > 1) return words.map(w => w[0].toUpperCase()).join('');
  return name.slice(0, 4).toUpperCase();
};

/** A branch's own Ranking Order (Settings → Branch), or undefined if unset/unknown. */
export const branchRankOf = (branchName, settings) =>
  (settings?.branches || []).find(b => b.name === branchName)?.rankingOrder;

/**
 * Sorts staff by branch Ranking Order first, then by their own Ranking Order
 * within that branch, then alphabetically as a final tiebreak. Unranked
 * branches/staff (0, null, undefined) always sort last.
 */
export const staffRankCompare = (a, b, settings) => {
  const br = (branchName) => { const r = branchRankOf(branchName, settings); return r > 0 ? r : Infinity; };
  const sr = (rankingOrder) => (rankingOrder > 0 ? rankingOrder : Infinity);
  const brA = br(a.branch), brB = br(b.branch);
  if (brA !== brB) return brA - brB;
  const srA = sr(a.rankingOrder), srB = sr(b.rankingOrder);
  if (srA !== srB) return srA - srB;
  return (a.fullName || '').localeCompare(b.fullName || '');
};

/** Composite "branchRank.staffRank" display label, e.g. "1.1". "—" for either half that's unset. */
export const staffRankLabel = (emp, settings) => {
  const br = branchRankOf(emp.branch, settings);
  if (br == null && !(emp.rankingOrder > 0)) return '—';
  return `${br ?? '—'}.${emp.rankingOrder > 0 ? emp.rankingOrder : '—'}`;
};
