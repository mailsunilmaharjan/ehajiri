// Path-based tenant routing for the shared-login hub (attend.zkattendance.com).
// /t/<subdomain>/... is how a browser reaches a DIFFERENT tenant's own
// isolated process without ever needing a subdomain DNS record — the
// per-tenant database/process split stays exactly as it is today, only how
// a browser reaches it changes. Only ever mounted on the one process with
// ENABLE_TENANT_RESOLVE=true (see server/index.js) — every other tenant
// process never loads this file's mount function at all.
import { createProxyMiddleware } from 'http-proxy-middleware';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getPort, refreshOne } from '../services/routingCache.js';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '../../dist');

// Public, unauthenticated path now (unlike an obscure DNS record) — worth a
// defense-in-depth format check before it ever reaches a lookup or a proxy.
const SLUG_RE = /^[a-z0-9-]+$/;

async function resolvePort(slug) {
  const cached = getPort(slug);
  if (cached) return cached;
  return refreshOne(slug); // cache miss (brand-new tenant, or the poll just hasn't run yet) — one fresh lookup before giving up
}

const apiProxy = createProxyMiddleware({
  changeOrigin: true,
  router: async (req) => {
    const port = await resolvePort(req.params.slug);
    if (!port) throw new Error(`Unknown or unreachable tenant: ${req.params.slug}`);
    return `http://localhost:${port}`;
  },
  plugins: [
    (proxyServer) => {
      proxyServer.on('error', (_err, _req, res) => {
        // A known tenant whose own process happens to be down/restarting —
        // distinct from "tenant doesn't exist" (a plain 404, below).
        if (res && !res.headersSent) res.status(502).json({ error: 'This company\'s server is temporarily unreachable' });
      });
    },
  ],
});

export function mountTenantPathProxy(app) {
  app.use('/t/:slug', async (req, res, next) => {
    const { slug } = req.params;
    if (!SLUG_RE.test(slug)) return res.status(404).end();

    const port = await resolvePort(slug);
    if (!port) return res.status(404).end();

    if (req.url.startsWith('/api')) {
      return apiProxy(req, res, next);
    }
    // Every other path under this tenant's prefix (/login, /dashboard, a
    // client-side route, etc.) — the exact same static SPA shell every
    // tenant already serves (identical dist/ build, differing only by env
    // vars), so this is a local sendFile, never a proxy.
    res.sendFile(join(DIST, 'index.html'));
  });
}
