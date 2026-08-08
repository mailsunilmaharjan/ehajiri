// Best-effort push to LicenseAdmin's cross-tenant email -> tenant directory
// (server/routes/tenantDirectory.js's /sync-email over there), so the shared
// login at attend.zkattendance.com can resolve a user's email to their own
// company. Fire-and-forget by design: a staff create/edit/delete must never
// fail or slow down because LicenseAdmin happens to be unreachable — this is
// a side-channel sync, not a dependency of normal HR operations.
const DIRECTORY_URL = process.env.LICENSE_ADMIN_URL;
const DIRECTORY_KEY = process.env.DIRECTORY_API_KEY;
const TENANT_ID      = process.env.TENANT_ID;

export function syncEmailDirectory({ action, oldEmail, newEmail }) {
  if (!DIRECTORY_URL || !DIRECTORY_KEY || !TENANT_ID) return; // not provisioned for this yet — no-op
  const email = (v) => (v || '').trim().toLowerCase() || null;
  fetch(`${DIRECTORY_URL}/api/tenant-companies/sync-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-directory-key': DIRECTORY_KEY },
    body: JSON.stringify({ tenant_id: TENANT_ID, action, old_email: email(oldEmail), new_email: email(newEmail) }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {}); // never awaited by the caller — genuinely fire-and-forget
}
