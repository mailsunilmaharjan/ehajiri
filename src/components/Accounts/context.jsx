import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, installFileLinks } from './lib/api';
import { setDateDisplay } from './lib/dates';
import { installKeys } from './lib/keys';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

/** Accounts has no sign-in of its own: eHajiri has already authenticated the user (and Protected checked the
 *  `accounts` page permission). The server maps the eHajiri role to admin | accountant | viewer for the screens. */
export function AppProvider({ children }) {
  const [state, setState] = useState('loading');   // loading | error | ready
  const [err, setErr] = useState('');
  const [info, setInfo] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [toast, setToast] = useState(null);

  const notify = useCallback((msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), kind === 'err' ? 5000 : 3000);
  }, []);

  const reload = useCallback(async () => {
    try {
      const [i, a] = await Promise.all([api.get('/company'), api.get('/accounts')]);
      setDateDisplay(i.company.date_display);
      setInfo(i);
      setAccounts(a.filter((x) => !x.hide_in_entry));   // pickers don't offer a bank's spare main ledger
      setState('ready');
    } catch (e) { setErr(e.message); setState('error'); }
  }, []);

  useEffect(() => {
    const offKeys = installKeys();
    const offLinks = installFileLinks((msg) => notify(msg, 'err'));
    reload();
    return () => { offKeys(); offLinks(); };
  }, [reload, notify]);

  const role = info?.user?.role;
  const cls = `acc-app${role === 'viewer' ? ' role-viewer' : ''}`;
  const toastEl = toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>;
  if (state === 'loading') return <div className={cls}><div className="loading">Loading…</div></div>;
  if (state === 'error') {
    return (
      <div className={cls}>
        <div className="loading" style={{ color: '#991b1b' }}>
          {err}<br /><button className="ghost" style={{ marginTop: 12 }} onClick={() => { setState('loading'); reload(); }}>Try again</button>
        </div>
      </div>
    );
  }
  return (
    <Ctx.Provider value={{ ...info, fy: info.current_fy, accounts, reload, notify, logout: () => {},
      role, isAdmin: role === 'admin', isSuper: !!info?.user?.is_super, canEdit: role !== 'viewer' }}>
      <div className={cls}>{children}{toastEl}</div>
    </Ctx.Provider>
  );
}
