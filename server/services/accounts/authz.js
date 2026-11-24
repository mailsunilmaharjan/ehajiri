/* Who may use the Accounts module, and the password re-checks the demo asks for before sensitive
 * changes. The module has NO login of its own: it uses eHajiri's signed-in user (authGuard sets
 * req.user) and eHajiri's Role & Permission settings under the page key `accounts`.
 *
 *   superAdmin           -> everything
 *   admin                -> everything, unless a Super Admin restricted the `accounts` page for admins
 *   anyone else          -> only if Role & Permission Management granted them `accounts`
 *
 * view  = may open the module / read     edit = may create & change     delete = may request deletes
 * Mirrors getPagePerm() in src/context/AuthContext.jsx so server and screen agree.
 */
import bcrypt from 'bcryptjs';
import pool from '../../db.js';
import { accCtx, bad, ah } from './common.js';
import { ensureSeeded } from './seed.js';

export const PAGE_KEY = 'accounts';
const isBcrypt = (s) => typeof s === 'string' && /^\$2[aby]\$/.test(s);

let permCache = null, permAt = 0;
async function pagePerms() {
  if (permCache && Date.now() - permAt < 15000) return permCache;
  try {
    const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='page_permissions'");
    let v = rows[0]?.value ?? null;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
    permCache = v && typeof v === 'object' ? v : {};
  } catch { permCache = permCache || {}; }
  permAt = Date.now();
  return permCache;
}

function resolvePerm(user, perms) {
  const full = { view: true, edit: true, delete: true };
  if (user.role === 'superAdmin') return full;
  const sp = perms?.staff?.[String(user.id)]?.[PAGE_KEY];
  if (user.role === 'admin') {
    if (sp !== undefined) return sp;
    const rp = perms?.roles?.admin?.[PAGE_KEY];
    return rp !== undefined ? rp : full;
  }
  if (sp !== undefined) return sp;
  const rp = perms?.roles?.[user.role || 'employee']?.[PAGE_KEY];
  return rp !== undefined ? rp : { view: false, edit: false, delete: false };
}

const userCache = new Map();
async function loadUser(id) {
  const hit = userCache.get(id);
  if (hit && Date.now() - hit.at < 15000) return hit.row;
  const { rows } = await pool.query('SELECT id, username, full_name, role, active FROM users WHERE id = $1', [id]);
  const row = rows[0] || null;
  userCache.set(id, { at: Date.now(), row });
  if (userCache.size > 2000) userCache.clear();
  return row;
}

/** A person's name for printing: their full name, never an e-mail address (falls back to the part before '@'). */
export async function displayName(username) {
  const u = String(username || '').trim();
  if (!u || u === 'system') return u;
  const { rows } = await pool.query('SELECT full_name FROM users WHERE username = $1 OR LOWER(email) = LOWER($1) LIMIT 1', [u]).catch(() => ({ rows: [] }));
  const name = String(rows[0]?.full_name || '').trim();
  return name && !name.includes('@') ? name : u.split('@')[0];
}

/** Mount after authGuard + requireModuleEnabled. Sets req.accUser, seeds on first use, opens the audit context. */
export const accountsGuard = ah(async (req, res, next) => {
  const u = req.user && (await loadUser(req.user.id));
  if (!u || u.active === false) return bad('Please sign in again.', 401, { authError: true });
  const perm = resolvePerm({ id: u.id, role: req.user.role || u.role }, await pagePerms());
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (!perm.view) return bad('You do not have permission to open Accounts. Ask your administrator.', 403);
  if (write && !perm.edit) return bad('You can view Accounts but not change anything.', 403);
  const role = req.user.role || u.role;
  req.accUser = {
    id: u.id, username: u.username, fullName: u.full_name || u.username,
    role, isAdmin: role === 'admin' || role === 'superAdmin', perm,
  };
  await ensureSeeded();
  accCtx.run({ ip: req.ip }, next);
});

export const requireAdmin = (req) => {
  if (!req.accUser?.isAdmin) bad('Only an admin can do this.', 403);
};

async function checkPassword(plain, stored) {
  if (!plain || !stored) return false;
  return isBcrypt(stored) ? bcrypt.compare(String(plain), stored) : String(stored) === String(plain);
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Re-check the signed-in user's own password before a sensitive change (editing a bill / voucher). */
export async function confirmPassword(req, password) {
  const { rows } = await pool.query('SELECT password FROM users WHERE id = $1', [req.accUser.id]);
  if (!(await checkPassword(password, rows[0]?.password))) { await delay(400); bad('Password is wrong.', 403); }
}

/** Deleting needs an admin: the signed-in admin's own password, or another admin's username + password. */
export async function adminApproval(req, adminUsername, adminPassword) {
  const name = String(adminUsername || (req.accUser.isAdmin ? req.accUser.username : '')).trim();
  let u = null;
  if (name) {
    const { rows } = await pool.query(
      "SELECT username, password FROM users WHERE LOWER(username) = LOWER($1) AND role IN ('admin','superAdmin') AND COALESCE(active, TRUE) = TRUE", [name]);
    u = rows[0] || null;
  }
  if (!u || !(await checkPassword(adminPassword, u.password))) { await delay(400); bad('Admin approval failed: wrong admin username or password.', 403); }
  return u.username;
}
