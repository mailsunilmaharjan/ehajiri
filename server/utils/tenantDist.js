/* Per-tenant frontend build selection for the shared-login hub (attend.zkattendance.com/t/<slug>/).
 *
 * The hub serves the page itself from the shared ../dist and only proxies /api to the tenant, so a service-level
 * DIST_DIR (see server/index.js) never reaches a user who comes in through /t/<slug>/. TENANT_DIST_OVERRIDES lets
 * the hub serve a different build to specific tenants only, to roll a new module out to one tenant first:
 *
 *     TENANT_DIST_OVERRIDES=planet:dist-planet,otherslug:dist-other
 *
 * Unset (the default) = everyone gets ../dist, exactly as before.
 */
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_DIST = join(ROOT, 'dist');

const OVERRIDES = {};
for (const pair of String(process.env.TENANT_DIST_OVERRIDES || '').split(',')) {
  const [slug, dir] = pair.trim().split(':');
  if (/^[a-z0-9-]+$/.test(slug || '') && /^[\w.-]+$/.test(dir || '')) OVERRIDES[slug] = join(ROOT, dir);
}

/** Folder holding the index.html to serve for this tenant slug (falls back to the shared dist if missing). */
export function tenantDistFor(slug) {
  const d = OVERRIDES[slug];
  return d && fs.existsSync(join(d, 'index.html')) ? d : DEFAULT_DIST;
}

/** Extra build folders whose hashed /assets files must also be reachable (after the shared dist). */
export const extraDistDirs = () => [...new Set(Object.values(OVERRIDES))].filter((d) => fs.existsSync(d));
