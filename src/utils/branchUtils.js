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
