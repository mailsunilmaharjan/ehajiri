// Minimal request-body validation (dependency-free; zod is not installed on the
// production boxes). Declarative: { field: { type, required, max, min, enum } }.
// Rejects wrong types / oversized strings with a 400 BEFORE the handler runs, so
// handlers can rely on e.g. req.body.username being a string and never see an
// object/array where they call .trim() (which used to surface as a 500 with an
// internal error message). Unknown fields are left alone.
// Applied once to every /api request: blocks prototype-pollution keys and
// absurdly deep/large JSON before any route's own parsing sees it. Strings and
// array lengths are NOT capped here (photos, bulk imports are legitimately large).
const POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export function bodySanity(req, res, next) {
  const body = req.body;
  if (body && typeof body === 'object') {
    let nodes = 0;
    const walk = (v, depth) => {
      if (depth > 24) return 'too deeply nested';
      if (v && typeof v === 'object') {
        if (++nodes > 2_000_000) return 'too large';
        if (Array.isArray(v)) { for (const x of v) { const r = walk(x, depth + 1); if (r) return r; } return null; }
        for (const k of Object.keys(v)) {
          if (POLLUTION_KEYS.has(k)) return 'invalid field name';
          const r = walk(v[k], depth + 1); if (r) return r;
        }
      }
      return null;
    };
    const bad = walk(body, 0);
    if (bad) return res.status(400).json({ error: `Request body rejected: ${bad}` });
  }
  next();
}

export function validateBody(schema) {
  return (req, res, next) => {
    const body = req.body;
    if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Invalid request body' });
    }
    for (const [field, rule] of Object.entries(schema)) {
      const v = body[field];
      if (v === undefined || v === null || v === '') {
        if (rule.required) return res.status(400).json({ error: `${field} is required` });
        continue;
      }
      const type = rule.type || 'string';
      if (type === 'string') {
        if (typeof v !== 'string') return res.status(400).json({ error: `${field} must be a string` });
        if (rule.max && v.length > rule.max) return res.status(400).json({ error: `${field} is too long` });
        if (rule.min && v.length < rule.min) return res.status(400).json({ error: `${field} is too short` });
        if (rule.pattern && !rule.pattern.test(v)) return res.status(400).json({ error: `${field} is invalid` });
      } else if (type === 'scalar') {
        // ids / dates / flags: a string, number or boolean — never an object/array
        if (typeof v === 'object') return res.status(400).json({ error: `${field} is invalid` });
        if (typeof v === 'string' && rule.max && v.length > rule.max) return res.status(400).json({ error: `${field} is too long` });
      } else if (type === 'number') {
        const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
        if (!Number.isFinite(n)) return res.status(400).json({ error: `${field} must be a number` });
        if (rule.min !== undefined && n < rule.min) return res.status(400).json({ error: `${field} is out of range` });
        if (rule.max !== undefined && n > rule.max) return res.status(400).json({ error: `${field} is out of range` });
      } else if (type === 'boolean') {
        if (typeof v !== 'boolean') return res.status(400).json({ error: `${field} must be true or false` });
      } else if (type === 'array') {
        if (!Array.isArray(v)) return res.status(400).json({ error: `${field} must be a list` });
        if (rule.max && v.length > rule.max) return res.status(400).json({ error: `${field} has too many items` });
      }
      if (rule.enum && !rule.enum.includes(v)) return res.status(400).json({ error: `${field} is invalid` });
    }
    next();
  };
}
