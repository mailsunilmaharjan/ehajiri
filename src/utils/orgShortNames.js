/**
 * Short names for a report row's Post / Department, from Settings →
 * Official Setting → Post / Department (shortName). Matched ignoring case
 * and extra spaces, since staff records and setup lists often differ only
 * by a trailing space ("Electrician" vs "Electrician "). Falls back to the
 * short name the server already attached (row.postShort / row.deptShort),
 * then to the full name.
 *
 *   const { postShortOf, deptShortOf } = makeOrgShortNames(settings);
 *   postShortOf(row)  // row.position  → short name
 *   deptShortOf(row)  // row.department → short name
 */
const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();

const buildMap = (list) => {
  const m = {};
  (list || []).forEach(x => {
    const sn = String(x.shortName || x.short_name || '').trim();
    if (x.name && sn) m[norm(x.name)] = sn;
  });
  return m;
};

const usable = (v) => (v && v !== '—' ? v : null);

export function makeOrgShortNames(settings) {
  const postMap = buildMap(settings?.posts);
  const deptMap = buildMap(settings?.departments);
  return {
    postShortOf: (r) => postMap[norm(r?.position)]   || usable(r?.postShort) || r?.position   || '—',
    deptShortOf: (r) => deptMap[norm(r?.department)] || usable(r?.deptShort) || r?.department || '—',
  };
}
