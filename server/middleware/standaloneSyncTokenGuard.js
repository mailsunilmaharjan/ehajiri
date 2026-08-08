import pool from '../db.js';

/**
 * Authenticates the remote standalone-sync agent (a Windows exe running
 * unattended at a site with no logged-in user) via a per-device bearer
 * token instead of a JWT user session — see standalone-bridge's
 * RemoteSyncAgent.cs, the client that sends this header, and
 * routes/standaloneDevices.js's POST /devices/:id/sync-token, which mints it.
 * On success attaches the device row as req.standaloneDevice.
 */
export async function standaloneSyncTokenGuard(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ authError: true, error: 'Device sync token required' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT * FROM standalone_devices WHERE sync_token = $1', [token]
    );
    if (!rows[0]) {
      return res.status(401).json({ authError: true, error: 'Invalid or revoked device sync token' });
    }
    req.standaloneDevice = rows[0];
    next();
  } catch {
    return res.status(500).json({ error: 'Device authentication failed' });
  }
}
