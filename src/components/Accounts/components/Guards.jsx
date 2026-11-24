import { useState } from 'react';
import { useApp } from '../context';
import { api } from '../lib/api';
import { useShortcuts } from '../lib/keys';
import { Kbd } from './inputs';

/** Saving an edit needs admin approval: an admin types their own password, anyone else needs an admin's username + password. */
export function PasswordPrompt({ title, onConfirm, onClose }) {
  const { user } = useApp();
  const isAdmin = user?.role === 'admin' || user?.role === 'superAdmin';
  const [pw, setPw] = useState('');
  const [adminUser, setAdminUser] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (e) => {
    e?.preventDefault();
    if (!pw || (!isAdmin && !adminUser.trim())) return;
    setBusy(true);
    try { await onConfirm(pw, isAdmin ? undefined : adminUser.trim()); } finally { setBusy(false); }
  };
  useShortcuts({ save: go, close: onClose });
  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="card form narrow" onSubmit={go}>
        <h2>🔒 {title || 'Admin approval'}</h2>
        <p className="muted small full">Editing a saved bill or voucher changes the books, so it needs admin approval. The change is recorded in the Audit Trail.</p>
        {!isAdmin && <label className="full">Admin username<input autoFocus value={adminUser} onChange={(e) => setAdminUser(e.target.value)} autoComplete="off" /></label>}
        <label className="full">{isAdmin ? 'Your (admin) password' : 'Admin password'}<input type="password" autoFocus={isAdmin} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></label>
        <div className="actions"><span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>Close <Kbd>Esc</Kbd></button>
          <button data-save disabled={busy || !pw || (!isAdmin && !adminUser.trim())}>Confirm & save</button>
        </div>
      </form>
    </div>
  );
}

/**
 * Delete needs an administrator:
 *  - an admin types their own password;
 *  - anyone else gets an admin to type username + password here, or sends a request the admin approves later.
 */
export function DeleteDialog({ what, url, onDone, onClose, allowRequest = true, note }) {
  const { user, notify } = useApp();
  const isAdmin = user.role === 'admin';
  const [f, setF] = useState({ reason: '', admin_username: isAdmin ? user.username : '', admin_password: '' });
  const [busy, setBusy] = useState(false);

  const run = async (requestOnly) => {
    if (f.reason.trim().length < 3) { notify('Give a reason for deleting.', 'err'); return; }
    setBusy(true);
    try {
      const r = await api.post(url, { ...f, request_only: requestOnly });
      notify(r.requested ? 'Delete request sent to the admin' : `${what} deleted`);
      onDone?.(r);
    } catch (err) { notify(err.message, 'err'); }
    setBusy(false);
  };
  useShortcuts({ save: () => run(false), close: onClose });

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="card form narrow" onSubmit={(e) => { e.preventDefault(); run(false); }}>
        <h2>🗑 Delete {what}?</h2>
        <div className="notice full">{note || <>This removes it completely (stock, serial numbers and accounts are reversed). A full copy is kept in the Audit Trail. To keep it on record instead, use <b>Cancel</b>.</>}</div>
        <label className="full">Reason<input autoFocus value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
        <h3>Admin approval</h3>
        {!isAdmin && <label>Admin username<input value={f.admin_username} onChange={(e) => setF({ ...f, admin_username: e.target.value })} autoComplete="off" /></label>}
        <label>{isAdmin ? 'Your password' : 'Admin password'}
          <input type="password" value={f.admin_password} onChange={(e) => setF({ ...f, admin_password: e.target.value })} autoComplete="new-password" />
        </label>
        <div className="actions">
          {!isAdmin && allowRequest && <button type="button" className="ghost" disabled={busy} onClick={() => run(true)}>Send request to admin instead</button>}
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>Close <Kbd>Esc</Kbd></button>
          <button className="danger" data-save disabled={busy || !f.admin_password}>Delete</button>
        </div>
      </form>
    </div>
  );
}
