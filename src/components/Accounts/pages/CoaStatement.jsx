import { useMemo } from 'react';
import { fmtBal } from '../lib/api';

/* Chart of Accounts — statement view: the chart laid out like the Balance Sheet / P&L, with "＋ New ledger" on
 * every group. Top row: Bank Accounts and Cash Accounts (each opens a New Bank / Cash Account form fixed to
 * Cash and Cash Equivalents) and Parties (customers / suppliers are their own sub-ledgers, made on the party screens). */
export default function CoaStatement({ groups, accounts, q, canEdit, openingDiff, openLedger, nav, onMenu }) {
  const s = q.trim().toLowerCase();
  const match = (a) => !s || `${a.name} ${a.code} ${a.name_np || ''} ${a.bank_account_no || ''}`.toLowerCase().includes(s);
  const kids = useMemo(() => {
    const m = {};
    groups.forEach((g) => (m[g.parent_id ?? 0] ||= []).push(g));
    Object.values(m).forEach((l) => l.sort((x, y) => (x.sort - y.sort) || String(x.code).localeCompare(String(y.code))));
    return m;
  }, [groups]);
  const ledgersOf = useMemo(() => {
    const m = {};
    accounts.forEach((a) => (m[a.group_id] ||= []).push(a));
    return m;
  }, [accounts]);
  const cashGroup = groups.find((g) => g.code === '1203');
  const banks = accounts.filter((a) => a.kind === 'bank' && match(a));
  const cash = accounts.filter((a) => a.kind === 'cash' && match(a));
  const nCus = accounts.filter((a) => a.party_type === 'customer').length;
  const nSup = accounts.filter((a) => a.party_type === 'supplier').length;
  const root = (n) => (kids[0] || []).filter((g) => g.nature === n);

  const Row = ({ a }) => (
    <div className={`coa-st-led ${a.active ? '' : 'off'}`} onClick={() => openLedger(a)} onContextMenu={(e) => onMenu(e, a)} title="Click to edit">
      <span className={`coa2-dot k-${a.kind}`} />
      <span className="nm">{a.name}{a.kind === 'bank' && a.bank_account_no && <small> · A/c {a.bank_account_no}</small>}</span>
      {!a.active && <span className="coa2-chip off">Inactive</span>}
      <span className="amt">{Number(a.opening_balance) ? fmtBal(a.opening_balance) : ''}</span>
    </div>
  );

  const hasMatch = (g) => !s || (ledgersOf[g.id] || []).some(match) || (kids[g.id] || []).some(hasMatch);
  const Group = ({ g, depth }) => {
    if (!hasMatch(g)) return null;
    const all = ledgersOf[g.id] || [];
    const parties = all.filter((a) => a.party_type);
    const plain = all.filter((a) => !a.party_type && match(a));
    const isCus = parties.some((a) => a.party_type === 'customer');
    return (
      <div className={`coa-st-grp d${Math.min(depth, 3)}`}>
        <div className="coa-st-gh">
          <span className="nm">{g.name}</span>
          {canEdit && depth > 0 && !parties.length && (
            <button type="button" className="link coa-st-add" onClick={() => openLedger(null, g.id)}>＋ New ledger</button>
          )}
        </div>
        {parties.length > 0 && (
          <div className="coa-st-led party" onClick={() => nav(isCus ? '/customers' : '/suppliers')}>
            <span className="coa2-dot k-party" />
            <span className="nm">{parties.length} {isCus ? 'customer' : 'supplier'} ledger{parties.length === 1 ? '' : 's'} →</span>
          </div>
        )}
        {plain.map((a) => <Row key={a.id} a={a} />)}
        {(kids[g.id] || []).map((c) => <Group key={c.id} g={c} depth={depth + 1} />)}
      </div>
    );
  };
  const Side = ({ title, natures }) => (
    <section className="coa-st-side">
      <h2>{title}</h2>
      {natures.flatMap((n) => root(n)).map((g) => <Group key={g.id} g={g} depth={0} />)}
    </section>
  );
  const diffBad = Math.abs(openingDiff) > 0.005;

  return (
    <div className="coa-st">
      <div className="coa-st-quick">
        <section className="coa-st-card">
          <h3>🏦 Bank Accounts <b>{banks.length}</b></h3>
          <div className="coa-st-list">{banks.length ? banks.map((a) => <Row key={a.id} a={a} />) : <p className="muted small">No bank account yet.</p>}</div>
          {canEdit && cashGroup && <button type="button" onClick={() => openLedger(null, cashGroup.id, 'bank', 'bank')}>＋ New Bank Account</button>}
        </section>
        <section className="coa-st-card">
          <h3>💵 Cash Accounts <b>{cash.length}</b></h3>
          <div className="coa-st-list">{cash.length ? cash.map((a) => <Row key={a.id} a={a} />) : <p className="muted small">No cash account yet.</p>}</div>
          {canEdit && cashGroup && <button type="button" onClick={() => openLedger(null, cashGroup.id, 'cash', 'cash')}>＋ New Cash Account</button>}
        </section>
        <section className="coa-st-card">
          <h3>👥 Parties</h3>
          <div className="coa-st-list">
            <div className="coa-st-party">
              <span><b>Customers</b><small>Sundry Debtors · {nCus} ledger{nCus === 1 ? '' : 's'}</small></span>
              <button type="button" className="ghost btn-sm" onClick={() => nav('/customers')}>View</button>
              {canEdit && <button type="button" className="btn-sm" onClick={() => nav('/customers?new=1')}>＋ New Customer</button>}
            </div>
            <div className="coa-st-party">
              <span><b>Suppliers</b><small>Sundry Creditors · {nSup} ledger{nSup === 1 ? '' : 's'}</small></span>
              <button type="button" className="ghost btn-sm" onClick={() => nav('/suppliers')}>View</button>
              {canEdit && <button type="button" className="btn-sm" onClick={() => nav('/suppliers?new=1')}>＋ New Supplier</button>}
            </div>
          </div>
          <p className={`coa-st-diff ${diffBad ? 'bad' : 'ok'}`} title="Total of all opening balances. It should be 0 (debits = credits).">
            {diffBad ? `Opening difference ${fmtBal(openingDiff)}` : '✓ Opening balances agree'}
          </p>
        </section>
      </div>
      <div className="coa-st-cols">
        <Side title="Assets" natures={['A']} />
        <Side title="Equity and Liabilities" natures={['E', 'L']} />
        <Side title="Income" natures={['I']} />
        <Side title="Expenses" natures={['X']} />
      </div>
    </div>
  );
}
