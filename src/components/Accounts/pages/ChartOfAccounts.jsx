import AuthImg from '../components/AuthImg';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from '../lib/router';
import { useApp } from '../context';
import ContextMenu from '../components/ContextMenu';
import { DeleteDialog } from '../components/Guards';
import { api, fmtBal } from '../lib/api';
import { useShortcuts } from '../lib/keys';
import { Amount, Kbd, LastSaved } from '../components/inputs';
import CoaStatement from './CoaStatement';

const NATURE = { A: 'Dr', X: 'Dr', L: 'Cr', E: 'Cr', I: 'Cr' };
const NATURES = [['A', 'Assets'], ['L', 'Liabilities'], ['E', 'Equity'], ['I', 'Income'], ['X', 'Expenses']];
const KINDS = [['general', 'General'], ['cash', 'Cash'], ['bank', 'Bank'], ['party', 'Customer / Supplier'], ['tax', 'Tax']];
const KIND_LABEL = { cash: 'Cash', bank: 'Bank', party: 'Party', tax: 'Tax' };

const Chevron = ({ open }) => (
  <svg className={`coa2-chev ${open ? 'open' : ''}`} viewBox="0 0 20 20" width="14" height="14" fill="currentColor">
    <path d="M7.2 4.8a.9.9 0 0 1 1.3 0l4.6 4.6a.9.9 0 0 1 0 1.2l-4.6 4.6a.9.9 0 1 1-1.3-1.2L11.2 10 7.2 6a.9.9 0 0 1 0-1.2z" />
  </svg>
);
const Lock = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
);

export default function ChartOfAccounts() {
  const { reload, notify, canEdit } = useApp();
  const nav = useNavigate();
  const [groups, setGroups] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [q, setQ] = useState('');
  const [nature, setNature] = useState('');            // filter: '' = all
  const [collapsed, setCollapsed] = useState(new Set());
  const [edit, setEdit] = useState(null);              // ledger form
  const [newGroup, setNewGroup] = useState(null);
  const [delLedger, setDelLedger] = useState(null);    // system ledger waiting for admin password
  // 'statement' = Balance-Sheet style blocks (default); 'tree' = the classic grid with the sub-group tools
  const [view, setView] = useState(() => { try { return localStorage.getItem('acc.coa.view') || 'statement'; } catch { return 'statement'; } });
  const pickView = (v) => { setView(v); try { localStorage.setItem('acc.coa.view', v); } catch { /* private mode */ } };

  const firstLoad = useRef(true);
  const load = async () => {
    const [g, a] = await Promise.all([api.get('/groups'), api.get('/accounts', { include_inactive: true })]);
    setGroups(g); setAccounts(a);
    if (firstLoad.current) {            // open folded: only Assets / Liabilities / Equity / Income / Expenses show
      firstLoad.current = false;
      setCollapsed(new Set(g.map((x) => x.id)));
    }
  };
  useEffect(() => { load(); }, []);
  // ?new=bank | cash | ledger (from the Master page) opens that New form as soon as the chart has loaded
  const [sp, setSp] = useSearchParams();
  useEffect(() => {
    const n = sp.get('new');
    if (!n || !groups.length) return;
    const cg = groups.find((g) => g.code === '1203');
    if (canEdit) {
      if (n === 'bank' && cg) openLedger(null, cg.id, 'bank', 'bank');
      else if (n === 'cash' && cg) openLedger(null, cg.id, 'cash', 'cash');
      else if (n === 'ledger') openLedger(null, null);
    }
    setSp({}, { replace: true });
  }, [sp, groups]);

  const byParent = useMemo(() => {
    const m = {};
    groups.forEach((g) => (m[g.parent_id ?? 0] ||= []).push(g));
    return m;
  }, [groups]);
  const byGroup = useMemo(() => {
    const s = q.trim().toLowerCase();
    const m = {};
    accounts.filter((a) => !s || `${a.name} ${a.code} ${a.name_np || ''} ${a.bank_account_no || ''}`.toLowerCase().includes(s))
      .forEach((a) => (m[a.group_id] ||= []).push(a));
    return m;
  }, [accounts, q]);
  const countIn = (g) => (byGroup[g.id]?.length || 0) + (byParent[g.id] || []).reduce((s, c) => s + countIn(c), 0);
  const openingDiff = accounts.reduce((s, a) => s + Number(a.opening_balance), 0);
  const natureCount = (n) => accounts.filter((a) => a.nature === n).length;

  const toggle = (id) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.id));
  const collapseAll = () => setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.id)));

  const saveLedger = async (e) => {
    e?.preventDefault();
    if (!edit) return;
    const amt = Number(edit.amount || 0);
    const { lock: _lock, ...rest } = edit;
    const body = { ...rest, opening_balance: edit.side === 'Cr' ? -amt : amt, group_id: Number(edit.group_id) };
    try {
      const row = edit.id ? await api.put(`/accounts/${edit.id}`, body) : await api.post('/accounts', body);
      await load(); await reload();
      if (!edit.id && row.kind === 'bank') {   // keep it open so the QR can be uploaded straight away
        setEdit({ ...edit, ...row, amount: edit.amount, side: edit.side, active: !!row.active });
        notify('Bank account saved — you can upload its QR now');
      } else { setEdit(null); notify('Ledger saved'); }
    } catch (err) { notify(err.message, 'err'); }
  };
  /** Ledgers holding any value are refused by the server; system ledgers also need an admin password. */
  const removeLedger = async (a = edit) => {
    if (a.system_key) { setDelLedger(a); return; }
    if (!confirm(`Delete ledger "${a.name}"?`)) return;
    try { await api.post(`/accounts/${a.id}/delete`, {}); setEdit(null); await load(); await reload(); notify('Ledger deleted'); }
    catch (err) { notify(err.message, 'err'); }
  };
  const removeGroup = async (g) => {
    if (!confirm(`Delete group "${g.name}"?`)) return;
    try { await api.del(`/groups/${g.id}`); await load(); notify('Group deleted'); }
    catch (err) { notify(err.message, 'err'); }
  };
  const holdsValue = (a) => a.used || Math.abs(Number(a.opening_balance)) > 0.005;

  // ── bank QR image ──
  const qrFile = useRef(null);
  const [qrV, setQrV] = useState(0);
  const [qrBroken, setQrBroken] = useState(false);
  const uploadQr = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { notify('QR image is larger than 2 MB.', 'err'); return; }
    const data_url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
    try {
      await api.post(`/accounts/${edit.id}/qr`, { data_url });
      setEdit((x) => ({ ...x, qr_image: 'set' })); setQrBroken(false); setQrV((v) => v + 1); notify('QR saved'); load();
    } catch (err) { notify(err.message, 'err'); }
  };
  const removeQr = async () => {
    if (!confirm('Remove the QR image?')) return;
    try { await api.del(`/accounts/${edit.id}/qr`); setEdit((x) => ({ ...x, qr_image: null })); notify('QR removed'); load(); }
    catch (err) { notify(err.message, 'err'); }
  };

  // ── right-click / ⋯ menus ──
  const [menu, setMenu] = useState(null);
  const groupMenu = (e, g, depth) => {
    e.preventDefault(); e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, title: g.name, items: [
      depth > 0 && { icon: '➕', label: 'Add Ledger here', onClick: () => openLedger(null, g.id) },
      depth > 0 && g.nature === 'A' && { icon: '🏦', label: 'Add Bank Account here', onClick: () => openLedger(null, g.id, 'bank') },
      { icon: '📁', label: 'Add Sub Ledger Group', onClick: () => setNewGroup({ parent_id: g.id, name: '', name_np: '' }) },
      'divider',
      { icon: '✏️', label: g.is_bank_group ? 'Edit bank details' : 'Edit group', disabled: !!g.is_system, hint: g.is_system ? 'Standard NFRS group' : '', onClick: () => editGroup(g) },
      { icon: '🗑', label: 'Delete group', danger: true, disabled: !!g.is_system, hint: g.is_system ? 'Standard NFRS group' : '', onClick: () => removeGroup(g) },
    ] });
  };
  const ledgerMenu = (e, a) => {
    e.preventDefault(); e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, title: a.name, items: [
      { icon: '✏️', label: 'Edit ledger', onClick: () => openLedger(a) },
      { icon: '📄', label: 'Open ledger statement', onClick: () => nav(`/ledger?account=${a.id}`) },
      'divider',
      { icon: '➕', label: 'Add Ledger (same group)', onClick: () => openLedger(null, a.group_id) },
      { icon: '📁', label: 'Add Sub Ledger Group', onClick: () => setNewGroup({ parent_id: a.group_id, name: '', name_np: '' }) },
      'divider',
      { icon: '🗑', label: a.system_key ? 'Delete system ledger (admin)' : 'Delete ledger', danger: true, disabled: holdsValue(a),
        hint: a.used ? 'Has entries — untick Active instead' : holdsValue(a) ? 'Set the opening balance to 0 first' : '', onClick: () => removeLedger(a) },
    ] });
  };
  useShortcuts({ save: () => saveLedger(), close: () => setEdit(null), del: () => edit?.id && !holdsValue(edit) && removeLedger() }, !!edit && !delLedger);
  useShortcuts({ save: () => saveGroup(), close: () => setNewGroup(null) }, !!newGroup);
  /** A user sub-group anywhere under Cash and Cash Equivalents (1203) is a bank sub-ledger: it gets bank details + QR. */
  const isBankParent = (pid) => {
    for (let p = groups.find((x) => x.id === Number(pid)), i = 0; p && i < 20; p = groups.find((x) => x.id === p.parent_id), i += 1) {
      if (p.code === '1203') return true;
    }
    return false;
  };
  const groupIsBank = newGroup && (newGroup.id ? !!newGroup.is_bank_group : isBankParent(newGroup.parent_id));
  const editGroup = (g) => { setGQrBroken(false); setNewGroup({ ...g, name_np: g.name_np || '' }); };

  const saveGroup = async (e) => {
    e?.preventDefault();
    if (!newGroup) return;
    try {
      const row = newGroup.id ? await api.put(`/groups/${newGroup.id}`, newGroup) : await api.post('/groups', newGroup);
      await load();
      if (!newGroup.id && groupIsBank) {     // keep it open so the QR can be uploaded straight away
        setNewGroup({ ...newGroup, ...row, is_bank_group: true });
        notify('Bank saved — you can upload its QR now');
      } else { setNewGroup(null); notify(newGroup.id ? 'Group saved' : 'Group added'); }
    }
    catch (err) { notify(err.message, 'err'); }
  };

  // QR on a bank sub-group
  const gQrFile = useRef(null);
  const [gQrV, setGQrV] = useState(0);
  const [gQrBroken, setGQrBroken] = useState(false);
  const uploadGroupQr = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { notify('QR image is larger than 2 MB.', 'err'); return; }
    const data_url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
    try {
      await api.post(`/groups/${newGroup.id}/qr`, { data_url });
      setNewGroup((x) => ({ ...x, qr_image: 'set' })); setGQrBroken(false); setGQrV((v) => v + 1); notify('QR saved'); load();
    } catch (err) { notify(err.message, 'err'); }
  };
  const removeGroupQr = async () => {
    if (!confirm('Remove the QR image?')) return;
    try { await api.del(`/groups/${newGroup.id}/qr`); setNewGroup((x) => ({ ...x, qr_image: null })); notify('QR removed'); load(); }
    catch (err) { notify(err.message, 'err'); }
  };

  /** lock = 'bank' | 'cash': a New Bank / Cash Account form — group fixed to Cash and Cash Equivalents, type fixed. */
  const openLedger = (a, groupId, kind = 'general', lock = null) => {
    setQrBroken(false);
    if (a) {
      const ob = Number(a.opening_balance);
      setEdit({ ...a, amount: Math.abs(ob) || '', side: ob < 0 ? 'Cr' : ob > 0 ? 'Dr' : NATURE[a.nature], active: !!a.active });
    } else {
      const g = groups.find((x) => x.id === groupId) || groups.find((x) => x.parent_id);
      setEdit({ name: '', name_np: '', group_id: g?.id, kind, amount: '', side: NATURE[g?.nature] || 'Dr', active: true, lock });
    }
  };

  // ── classic grid with tree lines ──
  // Each group lists its ledgers first, then its sub-groups; branch lines (├ └ │) are drawn from the
  // sibling order, so a sub-group like "Kumari Bank" hangs off the same branch as "Bank Account - Current".
  const searching = !!q.trim();
  const isOpen = (g) => searching || !collapsed.has(g.id);
  const roots = (byParent[0] || []).filter((g) => !nature || g.nature === nature);
  const allByGroup = useMemo(() => {
    const m = {};
    accounts.forEach((a) => (m[a.group_id] ||= []).push(a));
    return m;
  }, [accounts]);
  // search also matches groups / sub-groups (name, code, Nepali name, bank A/c no.); a matching group shows all it contains
  const countAll = (g) => (allByGroup[g.id]?.length || 0) + (byParent[g.id] || []).reduce((s, c) => s + countAll(c), 0);
  const sText = q.trim().toLowerCase();
  const gMatch = (g) => `${g.name} ${g.code} ${g.name_np || ''} ${g.bank_account_no || ''} ${g.bank_branch || ''}`.toLowerCase().includes(sText);
  const visible = (g) => !searching || gMatch(g) || (byGroup[g.id] || []).length > 0 || (byParent[g.id] || []).some(visible);
  const rows = useMemo(() => {
    const out = [];
    const walk = (g, depth, guides, showAll) => {
      const kids = [
        ...((showAll ? allByGroup[g.id] : byGroup[g.id]) || []).map((a) => ({ a })),
        ...(byParent[g.id] || []).filter((c) => showAll || visible(c)).map((c) => ({ g: c })),
      ];
      kids.forEach((k, i) => {
        const last = i === kids.length - 1;
        if (k.a) out.push({ key: `a${k.a.id}`, a: k.a, depth, guides, last });
        else {
          out.push({ key: `g${k.g.id}`, g: k.g, depth, guides, last });
          if (isOpen(k.g)) walk(k.g, depth + 1, [...guides, !last], showAll || (searching && gMatch(k.g)));
        }
      });
    };
    roots.forEach((r) => {
      if (!visible(r)) return;
      out.push({ key: `r${r.id}`, g: r, root: true });
      if (isOpen(r)) walk(r, 0, [], searching && gMatch(r));
    });
    return out;
  }, [roots, byGroup, allByGroup, byParent, collapsed, searching, sText]);

  const Tree = ({ r }) => (
    <>
      {r.guides.map((v, i) => <span key={i} className={`tg ${v ? 'v' : ''}`} />)}
      <span className={`tg ${r.last ? 'l' : 't'}`} />
    </>
  );

  return (
    <>
      <header className="page-head">
        <h1>Chart of Accounts</h1>
        <span className="muted">NFRS for SMEs · {accounts.length} ledgers</span>
        <span className="spacer" />
        <input className="coa2-search" data-find title="Ctrl+F" placeholder="🔍 Search ledger, code, A/c no…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="view-toggle coa-viewtg">
          <button type="button" className={view === 'statement' ? 'on' : 'ghost'} onClick={() => pickView('statement')}>Statement view</button>
          <button type="button" className={view === 'tree' ? 'on' : 'ghost'} onClick={() => pickView('tree')}>Tree view</button>
        </span>
        {view === 'tree' && <button className="ghost" onClick={collapseAll}>{allCollapsed ? 'Expand all' : 'Collapse all'}</button>}
        {canEdit && <button data-new title="Alt+N" onClick={() => openLedger(null, null)}>＋ New Ledger</button>}
      </header>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}

      {view === 'statement' && (
        <CoaStatement groups={groups} accounts={accounts} q={q} canEdit={canEdit} openingDiff={openingDiff}
          openLedger={openLedger} nav={nav} onMenu={(e, a) => canEdit && ledgerMenu(e, a)} />
      )}
      {view === 'tree' && <>
      <div className="coa2-summary">
        <button className={`coa2-pill ${!nature ? 'on' : ''}`} onClick={() => setNature('')}>All <b>{accounts.length}</b></button>
        {NATURES.map(([k, l]) => (
          <button key={k} className={`coa2-pill n-${k} ${nature === k ? 'on' : ''}`} onClick={() => setNature(nature === k ? '' : k)}>
            <span className="coa2-ndot" />{l} <b>{natureCount(k)}</b>
          </button>
        ))}
        <span className="spacer" />
        <span className={`coa2-diff ${Math.abs(openingDiff) > 0.005 ? 'bad' : 'ok'}`}
          title="Total of all opening balances. It should be 0 (debits = credits).">
          {Math.abs(openingDiff) > 0.005 ? `Opening difference ${fmtBal(openingDiff)}` : '✓ Opening balances agree'}
        </span>
      </div>

      <section className="card dg">
        <div className="dg-scroll coa3-scroll">
          <table className="grid coa3">
            <thead><tr>
              <th style={{ width: 120 }}>Code</th><th>Account Name</th>
              <th style={{ width: 150 }}>Type</th><th className="num" style={{ width: 150 }}>Opening Balance</th>
              {canEdit && <th style={{ width: 92 }}>Action</th>}
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={5} className="muted">No match.</td></tr>}
              {rows.map((r) => {
                if (r.root) {
                  const g = r.g;
                  return (
                    <tr key={r.key} className={`coa3-root n-${g.nature}`} onClick={() => toggle(g.id)} onContextMenu={(e) => canEdit && groupMenu(e, g, 0)}>
                      <td>{g.code}</td>
                      <td><span className="coa3-name"><Chevron open={isOpen(g)} /><b>{g.name}</b></span></td>
                      <td>{countAll(g)} ledgers</td><td />
                      {canEdit && <td onClick={(e) => e.stopPropagation()}><button className="coa3-btn" title="More" onClick={(e) => groupMenu(e, g, 0)}>⋯</button></td>}
                    </tr>
                  );
                }
                if (r.g) {
                  const g = r.g;
                  return (
                    <tr key={r.key} className={`coa3-group ${g.is_system ? '' : 'custom'}`} onClick={() => toggle(g.id)}
                      onDoubleClick={() => canEdit && !g.is_system && editGroup(g)} onContextMenu={(e) => canEdit && groupMenu(e, g, r.depth + 1)}>
                      <td>{g.code}</td>
                      <td className="coa3-tree">
                        <span className="coa3-name"><Tree r={r} /><Chevron open={isOpen(g)} /><b>{g.name}</b>
                          <span className="coa3-count">{countAll(g)}</span>
                          {g.is_bank_group && g.bank_account_no && <span className="coa3-sub">A/c {g.bank_account_no}{g.bank_branch ? ` · ${g.bank_branch}` : ''}</span>}
                        </span>
                      </td>
                      <td>{g.is_bank_group ? <><span className="coa2-chip k-bank">Bank</span>{g.qr_image && <span className="coa2-chip">QR</span>}</> : <span className="coa3-sub">Group</span>}</td>
                      <td />
                      {canEdit && (
                        <td className="nowrap" onClick={(e) => e.stopPropagation()}>
                          {!g.is_system && <button className="coa3-btn" title="Edit" onClick={() => editGroup(g)}>✎</button>}
                          <button className="coa3-btn" title="Add ledger here" onClick={() => openLedger(null, g.id)}>＋</button>
                          <button className="coa3-btn" title="More" onClick={(e) => groupMenu(e, g, r.depth + 1)}>⋯</button>
                        </td>
                      )}
                    </tr>
                  );
                }
                const a = r.a;
                return (
                  <tr key={r.key} className={`coa3-ledger ${a.active ? '' : 'inactive-row'}`} onClick={() => openLedger(a)} onContextMenu={(e) => canEdit && ledgerMenu(e, a)}>
                    <td>{a.code}</td>
                    <td className="coa3-tree">
                      <span className="coa3-name"><Tree r={r} /><span className={`coa2-dot k-${a.kind}`} />{a.name}
                        {a.kind === 'bank' && a.bank_account_no && <span className="coa3-sub">A/c {a.bank_account_no}{a.bank_branch ? ` · ${a.bank_branch}` : ''}</span>}
                      </span>
                    </td>
                    <td className="nowrap">
                      {KIND_LABEL[a.kind] ? <span className={`coa2-chip k-${a.kind}`}>{KIND_LABEL[a.kind]}</span> : <span className="coa3-sub">Ledger</span>}
                      {a.kind === 'bank' && a.qr_image && <span className="coa2-chip">QR</span>}
                      {a.bank_group_id && <span className="coa2-chip" title="Main ledger of this bank — select it in vouchers">Main A/c</span>}
                      {a.system_key && <span className="coa2-chip sys" title="System ledger — used by automatic posting"><Lock /></span>}
                      {!a.active && <span className="coa2-chip off">Inactive</span>}
                    </td>
                    <td className="num">{Number(a.opening_balance) ? fmtBal(a.opening_balance) : ''}</td>
                    {canEdit && (
                      <td className="nowrap" onClick={(e) => e.stopPropagation()}>
                        <button className="coa3-btn" title="Edit" onClick={() => openLedger(a)}>✎</button>
                        <button className="coa3-btn" title="More" onClick={(e) => ledgerMenu(e, a)}>⋯</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      </>}
      {edit && (
        <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && setEdit(null)}>
          <form className="card form acc-cardform" onSubmit={saveLedger}>
            <h2 className="acc-head"><span className="acc-head-ic">{edit.id ? '✏️' : '＋'}</span><span className="acc-head-txt">{edit.id ? 'Edit Ledger' : edit.lock === 'bank' ? 'New Bank Account' : edit.lock === 'cash' ? 'New Cash Account' : 'New Ledger'}{edit.system_key && <span className="tag"> system</span>}<small>{edit.id ? 'Update this ledger account' : 'Create a ledger account in the chart of accounts'}</small></span></h2>
            <div className="acc-card">
            <div className="acc-step"><i>1</i>Ledger details</div>
            <label>Name<input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required /></label>
            <label>Name in Nepali<input value={edit.name_np || ''} onChange={(e) => setEdit({ ...edit, name_np: e.target.value })} /></label>
            {edit.lock ? (
              <label>Under<input readOnly tabIndex={-1} value={`${groups.find((g) => g.id === Number(edit.group_id))?.name || ''} · ${edit.lock === 'bank' ? 'Bank' : 'Cash'} ledger`} /></label>
            ) : <>
            <label>Group
              <select value={edit.group_id || ''} onChange={(e) => setEdit({ ...edit, group_id: e.target.value })}>
                {groups.filter((g) => g.parent_id).map((g) => <option key={g.id} value={g.id}>{g.code} — {g.name}</option>)}
              </select>
            </label>
            <label>Type
              <select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>
                {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            </>}
            <label>Opening balance
              <span className="inline">
                <Amount type="number" step="0.01" min="0" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} />
                <select value={edit.side} onChange={(e) => setEdit({ ...edit, side: e.target.value })}><option>Dr</option><option>Cr</option></select>
              </span>
            </label>
            </div>
            {edit.kind === 'bank' && (
              <div className="acc-card">
                <div className="acc-step"><i>2</i>Bank account details</div>
                <label>Bank Account Name<input value={edit.bank_account_name || ''} onChange={(e) => setEdit({ ...edit, bank_account_name: e.target.value })} placeholder="Name the account is held in" /></label>
                <label>Bank Account No.<input data-nocap value={edit.bank_account_no || ''} onChange={(e) => setEdit({ ...edit, bank_account_no: e.target.value })} placeholder="e.g. 0120-1234567-001" /></label>
                <label>Bank Branch<input value={edit.bank_branch || ''} onChange={(e) => setEdit({ ...edit, bank_branch: e.target.value })} placeholder="e.g. Lalitpur" /></label>
                <label>Address<input value={edit.address || ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></label>
                <label>Phone No.<input value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} placeholder="01-5xxxxxx" /></label>
                <label>Contact Person Name<input value={edit.contact_person || ''} onChange={(e) => setEdit({ ...edit, contact_person: e.target.value })} /></label>
                <label>Contact Mobile No.<input value={edit.contact_mobile || ''} onChange={(e) => setEdit({ ...edit, contact_mobile: e.target.value })} placeholder="98XXXXXXXX" /></label>
                <div className="full qr-box">
                  <div className="qr-img" onClick={() => edit.id && qrFile.current?.click()} title={edit.id ? 'Click to upload the QR image' : ''}>
                    {edit.qr_image && !qrBroken
                      ? <AuthImg src={`/accounts/${edit.id}/qr?v=${qrV}${edit.updated_at || ''}`} alt="QR" onError={() => setQrBroken(true)} />
                      : <span className="muted small">{edit.id ? '📷 Click to upload QR' : 'Save first, then upload the QR'}</span>}
                  </div>
                  <div>
                    <b>QR code image</b>
                    <p className="muted small">Bank / Fonepay QR for customers to scan and pay. JPG, PNG or WEBP, up to 2 MB.</p>
                    {edit.id && (
                      <span className="inline">
                        <button type="button" className="ghost btn-sm" tabIndex={-1} onClick={() => qrFile.current?.click()}>⬆ Upload QR</button>
                        {edit.qr_image && <button type="button" className="ghost btn-sm" tabIndex={-1} onClick={removeQr}>Remove</button>}
                      </span>
                    )}
                    <input ref={qrFile} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={uploadQr} />
                  </div>
                </div>
              </div>
            )}
            {edit.kind !== 'bank' && (edit.kind === 'party' || edit.pan) && (
              <div className="acc-card">
                <div className="acc-step"><i>2</i>Contact details</div>
                <label>PAN / VAT No.<input value={edit.pan || ''} maxLength={9} onChange={(e) => setEdit({ ...edit, pan: e.target.value })} /></label>
                <label>Phone<input value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></label>
                <label>Address<input value={edit.address || ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></label>
              </div>
            )}
            {edit.id && !edit.system_key && (
              <label className="check"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
            )}
            {edit.id && holdsValue(edit) && (
              <p className="muted small full">This ledger {edit.used ? 'has entries' : 'has an opening balance'}, so it can't be deleted{edit.used ? ' — untick Active to hide it' : ' until the balance is 0'}.</p>
            )}
            <LastSaved row={edit} />
            <div className="actions">
              {edit.id && !holdsValue(edit) && (
                <button type="button" className="danger edit-only" onClick={() => removeLedger()}>
                  {edit.system_key ? '🔒 Delete (admin)' : 'Delete'} <kbd className="kbd">Ctrl+Del</kbd>
                </button>
              )}
              <span className="spacer" />
              <button type="button" className="ghost" onClick={() => setEdit(null)}>Close <Kbd>Esc</Kbd></button>
              <button data-save>Save <Kbd>Ctrl+S</Kbd></button>
            </div>
          </form>
        </div>
      )}

      {delLedger && (
        <DeleteDialog what={`system ledger “${delLedger.name}”`} url={`/accounts/${delLedger.id}/delete`} allowRequest={false}
          note={<>“{delLedger.name}” is a <b>system ledger</b> used by automatic posting. It holds no value, so it can be deleted with an admin password. If a bill needs it later, it is re-created automatically.</>}
          onClose={() => setDelLedger(null)}
          onDone={async () => { setDelLedger(null); setEdit(null); await load(); await reload(); }} />
      )}

      {newGroup && (
        <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && setNewGroup(null)}>
          <form className="card form" onSubmit={saveGroup}>
            <h2 className="acc-head"><span className="acc-head-ic">{groupIsBank ? '🏦' : newGroup.id ? '✏️' : '＋'}</span><span className="acc-head-txt">{newGroup.id ? (groupIsBank ? newGroup.name : 'Edit Group') : `New ${groupIsBank ? 'Bank Sub Ledger' : 'Sub Ledger Group'}`}<small>{newGroup.id ? 'Update this group' : `Under “${groups.find((g) => g.id === newGroup.parent_id)?.name}”`}</small></span></h2>
            <label>{groupIsBank ? 'Bank name' : 'Name'}<input autoFocus value={newGroup.name} onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })} required placeholder={groupIsBank ? 'e.g. Kumari Bank' : ''} /></label>
            <label>Name in Nepali<input value={newGroup.name_np} onChange={(e) => setNewGroup({ ...newGroup, name_np: e.target.value })} /></label>
            {groupIsBank && (
              <>
                <h3>Bank account details</h3>
                <label>Bank Account Name<input value={newGroup.bank_account_name || ''} onChange={(e) => setNewGroup({ ...newGroup, bank_account_name: e.target.value })} placeholder="Name the account is held in" /></label>
                <label>Bank Account No.<input data-nocap value={newGroup.bank_account_no || ''} onChange={(e) => setNewGroup({ ...newGroup, bank_account_no: e.target.value })} placeholder="e.g. 0120-1234567-001" /></label>
                <label>Bank Branch<input value={newGroup.bank_branch || ''} onChange={(e) => setNewGroup({ ...newGroup, bank_branch: e.target.value })} placeholder="e.g. New Road" /></label>
                <label>Address<input value={newGroup.address || ''} onChange={(e) => setNewGroup({ ...newGroup, address: e.target.value })} /></label>
                <label>Phone No.<input value={newGroup.phone || ''} onChange={(e) => setNewGroup({ ...newGroup, phone: e.target.value })} placeholder="01-4xxxxxx" /></label>
                <label>Contact Person Name<input value={newGroup.contact_person || ''} onChange={(e) => setNewGroup({ ...newGroup, contact_person: e.target.value })} /></label>
                <label>Contact Mobile No.<input value={newGroup.contact_mobile || ''} onChange={(e) => setNewGroup({ ...newGroup, contact_mobile: e.target.value })} placeholder="98XXXXXXXX" /></label>
                <div className="full qr-box">
                  <div className="qr-img" onClick={() => newGroup.id && gQrFile.current?.click()} title={newGroup.id ? 'Click to upload the QR image' : ''}>
                    {newGroup.qr_image && !gQrBroken
                      ? <AuthImg src={`/groups/${newGroup.id}/qr?v=${gQrV}${newGroup.updated_at || ''}`} alt="QR" onError={() => setGQrBroken(true)} />
                      : <span className="muted small">{newGroup.id ? '📷 Click to upload QR' : 'Save first, then upload the QR'}</span>}
                  </div>
                  <div>
                    <b>QR code image</b>
                    <p className="muted small">Bank / Fonepay QR for customers to scan and pay. JPG, PNG or WEBP, up to 2 MB.</p>
                    {newGroup.id && (
                      <span className="inline">
                        <button type="button" className="ghost btn-sm" tabIndex={-1} onClick={() => gQrFile.current?.click()}>⬆ Upload QR</button>
                        {newGroup.qr_image && <button type="button" className="ghost btn-sm" tabIndex={-1} onClick={removeGroupQr}>Remove</button>}
                      </span>
                    )}
                    <input ref={gQrFile} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={uploadGroupQr} />
                  </div>
                </div>
              </>
            )}
            <div className="actions"><span className="spacer" />
              <button type="button" className="ghost" onClick={() => setNewGroup(null)}>Close <Kbd>Esc</Kbd></button><button data-save>{newGroup.id ? 'Save' : 'Add'} <Kbd>Ctrl+S</Kbd></button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
