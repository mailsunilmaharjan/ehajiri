import { useEffect, useState } from 'react';
import { useNavigate, useParams } from '../lib/router';
import { useApp } from '../context';
import { AccountSelect, Amount, BsDateInput, Kbd } from '../components/inputs';
import { useShortcuts } from '../lib/keys';
import { VoucherTypePicker } from './SimpleVoucher';
import VoucherView from '../components/VoucherView';
import { PasswordPrompt } from '../components/Guards';
import { api, fmtMoney } from '../lib/api';

const TITLES = {
  JV: ['Journal Voucher', 'Adjustments and non-cash entries: depreciation, provisions, opening capital…'],
  PV: ['Payment Voucher', 'Money going out of Cash or Bank: expenses, supplier payments.'],
  RV: ['Receipt Voucher', 'Money coming into Cash or Bank: customer receipts, other income.'],
  CV: ['Contra Voucher', 'Cash ↔ Bank only: deposits, withdrawals, bank transfers.'],
};
const empty = () => ({ account_id: null, dr: '', cr: '', note: '' });
const starter = () => [empty(), empty()];

export default function VoucherEntry() {
  const { vtype, id } = useParams();
  const editId = Number(id) || null;
  const { accounts, today, notify } = useApp();
  const [vdate, setVdate] = useState(today);
  const [reference, setReference] = useState('');
  const [narration, setNarration] = useState('');
  const [lines, setLines] = useState(starter(vtype));
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [orig, setOrig] = useState(null);
  const [askPw, setAskPw] = useState(false);

  const reset = () => { setLines(starter(vtype)); setNarration(''); setReference(''); };
  useEffect(() => {
    if (!editId) { reset(); setOrig(null); return; }
    api.get(`/vouchers/${editId}`).then((v) => {
      setOrig(v); setVdate(v.vdate); setReference(v.reference || ''); setNarration(v.narration || '');
      setLines(v.lines.map((l) => ({ account_id: l.account_id, dr: l.dr || '', cr: l.cr || '', note: l.note || '', touched: true })));
    }).catch((e) => notify(e.message, 'err'));
  }, [vtype, editId]);

  const tdr = lines.reduce((s, l) => s + Number(l.dr || 0), 0);
  const tcr = lines.reduce((s, l) => s + Number(l.cr || 0), 0);
  const diff = Math.round((tdr - tcr) * 100) / 100;

  const setLine = (i, patch) => {
    const next = lines.map((l, j) => (j === i ? { ...l, ...patch } : l));
    // the last line auto-fills the balancing amount
    const last = next.length - 1;
    if (i !== last && !next[last].touched) {
      const d = next.slice(0, last).reduce((s, l) => s + Number(l.dr || 0) - Number(l.cr || 0), 0);
      next[last] = { ...next[last], dr: d < 0 ? (-d).toFixed(2) : '', cr: d > 0 ? d.toFixed(2) : '' };
    }
    setLines(next);
  };
  const addLine = () => {
    const l = empty();
    if (diff > 0) l.cr = diff.toFixed(2); else if (diff < 0) l.dr = (-diff).toFixed(2);
    setLines([...lines, l]);
  };

  const cashBank = (a) => a.kind === 'cash' || a.kind === 'bank';
  const filterFor = vtype === 'CV' ? cashBank : undefined;

  const payload = () => ({
    vtype, vdate, reference, narration,
    lines: lines.filter((l) => l.account_id).map((l) => ({ account_id: l.account_id, dr: Number(l.dr || 0), cr: Number(l.cr || 0), note: l.note })),
  });
  const save = async () => {
    if (editId) { setAskPw(true); return; }
    setBusy(true);
    try {
      const v = await api.post('/vouchers', payload());
      setSaved(v);
      notify(`${v.voucher_no} saved`);
      reset();
    } catch (err) { notify(err.message, 'err'); }
    setBusy(false);
  };
  const saveEdit = async (password) => {
    try {
      const v = await api.put(`/vouchers/${editId}`, { ...payload(), password });
      setAskPw(false); setSaved(v); notify(`${v.voucher_no} updated`);
    } catch (err) { notify(err.message, 'err'); }
  };

  const nav = useNavigate();
  const dirty = lines.some((l) => l.account_id || l.dr || l.cr) || narration;
  useShortcuts({
    save: () => { if (!busy && diff === 0 && tdr > 0) save(); else notify('Debit and Credit must be equal before saving.', 'err'); },
    close: () => { if (!dirty || confirm('Leave without saving this voucher?')) nav('/day-book'); },
  }, !saved && !askPw);

  const [title, hint] = TITLES[vtype] || TITLES.JV;
  return (
    <>
      <header className="page-head"><h1>{editId ? `✏️ Edit ${orig?.voucher_no || ''}` : title}</h1><span className="muted">{hint}</span>
        {orig?.edit_count > 0 && <span className="tag">edited {orig.edit_count}×</span>}</header>
      {askPw && <PasswordPrompt title={`Save changes to ${orig?.voucher_no}`} onConfirm={saveEdit} onClose={() => setAskPw(false)} />}
      <section className="card entry-card">
        <VoucherTypePicker current="advanced" disabled={!!editId}>
          <span className="vtype-date"><span className="vtype-label">Date (Miti) *</span>
            <BsDateInput value={vdate} onChange={setVdate} autoFocus={!editId} /></span>
        </VoucherTypePicker>
        <div className="toolbar">
          <label>{vtype === 'PV' || vtype === 'RV' ? 'Cheque / Ref. No.' : 'Reference'}
            <input value={reference} onChange={(e) => setReference(e.target.value)} /></label>
        </div>
        <table className="grid entry">
          <thead><tr><th style={{ width: '42%' }}>Ledger</th><th className="num">Debit (Dr)</th><th className="num">Credit (Cr)</th><th>Line note</th><th /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td><AccountSelect accounts={accounts} value={l.account_id} filter={filterFor} onChange={(id) => setLine(i, { account_id: id })} /></td>
                <td><Amount className="num" type="number" step="0.01" min="0" value={l.dr}
                  onChange={(e) => setLine(i, { dr: e.target.value, cr: e.target.value ? '' : l.cr, touched: true })} /></td>
                <td><Amount className="num" type="number" step="0.01" min="0" value={l.cr}
                  onChange={(e) => setLine(i, { cr: e.target.value, dr: e.target.value ? '' : l.dr, touched: true })} /></td>
                <td><input value={l.note} onChange={(e) => setLine(i, { note: e.target.value })} /></td>
                <td>{lines.length > 2 && <button className="link" title="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td><button className="link" onClick={addLine}>+ Add line</button></td>
              <th className="num">{fmtMoney(tdr)}</th>
              <th className="num">{fmtMoney(tcr)}</th>
              <td colSpan={2}>{diff !== 0 && <span className="warn">Difference: {fmtMoney(Math.abs(diff))} {diff > 0 ? 'Dr' : 'Cr'}</span>}</td>
            </tr>
          </tfoot>
        </table>
        <label className="block">Narration (being…)
          <textarea rows={2} value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Being rent paid for Kartik 2083" />
        </label>
        <div className="actions">
          <button className="ghost" onClick={reset}>Clear</button>
          <span className="muted small">Enter = next field · Ctrl+S = save · Esc = leave</span>
          <span className="spacer" />
          <button data-save disabled={busy || diff !== 0 || tdr === 0} onClick={save}>{editId ? '🔒 Save changes' : 'Save voucher'} <Kbd>Ctrl+S</Kbd></button>
        </div>
      </section>
      {saved && <VoucherView v={saved} onClose={() => { setSaved(null); if (editId) nav('/day-book'); }} onChanged={setSaved} />}
    </>
  );
}
