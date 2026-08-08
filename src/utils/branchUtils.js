/**
 * Returns the display short-name for a branch value:
 *   - Company HQ name  → "HQ"
 *   - Known branch     → shortName from settings.branches
 *   - Unknown          → auto-abbreviation (initials or first 4 uppercase)
 */
export const branchAbbr = (name, settings) => {
  if (!name || name === '—') return '—';
  const en = (settings?.companyNameEn || '').trim();
  const np = (settings?.companyNameNp || '').trim();
  if ((en && name === en) || (np && name === np)) return 'HQ';
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
