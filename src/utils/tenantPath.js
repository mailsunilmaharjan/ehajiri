// Shared-login hub only: a browser reaching a tenant via
// attend.zkattendance.com/t/<subdomain>/... needs the whole app (router,
// API calls, EventSource, raw fetch/window.open/href call sites) to operate
// under that path prefix instead of the site root. Direct subdomain access
// (once/if that's ever set up) has no such prefix and getTenantPrefix()
// simply returns null, matching today's behavior exactly.
// Computed once per page load — a tenant-context change is always a full
// browser navigation (see AuthContext.login()), never client-side routing,
// so this never needs to be reactive within a single page's lifetime.
const match = window.location.pathname.match(/^\/t\/([a-z0-9-]+)/);

export function getTenantPrefix() {
  return match ? `/t/${match[1]}` : '';
}
