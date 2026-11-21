import { useEffect, useState } from 'react';
import { Link } from '../lib/router';
import { useApp } from '../context';
import { api, fmtBal, fmtMoney } from '../lib/api';
import { fmtDate } from '../lib/dates';

export default function Dashboard() {
  const { fy, today, accounts, company } = useApp();
  const [tb, setTb] = useState(null);
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    api.get('/reports/trial-balance', { date_from: fy.start_date, date_to: today, hide_zero: false }).then(setTb);
    api.get('/reports/day-book', { date_from: fy.start_date, date_to: today }).then((v) => setRecent(v.slice(-8).reverse()));
  }, [fy, today]);

  const kinds = Object.fromEntries(accounts.map((a) => [a.id, a.kind]));
  const rows = tb?.rows || [];
  const sumWhere = (f) => rows.filter(f).reduce((s, r) => s + r.closing, 0);
  const cash = sumWhere((r) => kinds[r.id] === 'cash');
  const bank = sumWhere((r) => kinds[r.id] === 'bank');
  const income = -sumWhere((r) => r.nature === 'I');
  const expense = sumWhere((r) => r.nature === 'X');

  return (
    <>
      <header className="page-head">
        <h1>Dashboard</h1>
        <span className="muted">FY {fy.name} · up to {fmtDate(today)}</span>
      </header>
      {!company.pan && (
        <div className="notice">Set your company name and PAN/VAT number in <Link to="/company">Company Setup</Link> first.</div>
      )}
      <div className="tiles">
        <div className="tile"><small>Cash in hand</small><b>{fmtBal(cash)}</b></div>
        <div className="tile"><small>Bank balance</small><b>{fmtBal(bank)}</b></div>
        <div className="tile"><small>Income (FY)</small><b>{fmtMoney(income)}</b></div>
        <div className="tile"><small>Expenses (FY)</small><b>{fmtMoney(expense)}</b></div>
        <div className="tile"><small>Net profit (FY)</small><b className={income - expense < 0 ? 'neg' : 'pos'}>{fmtMoney(income - expense)}</b></div>
      </div>
      <section className="card">
        <div className="card-head"><h2>Recent vouchers</h2><Link to="/day-book">Day Book →</Link></div>
        {recent.length === 0 ? (
          <p className="muted">No vouchers yet. Start with a <Link to="/voucher/JV">Journal</Link> — e.g. capital introduced in cash.</p>
        ) : (
          <table className="grid">
            <thead><tr><th className="sn">SN</th><th>Miti</th><th>Voucher No.</th><th>Narration</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {recent.map((v, idx) => (
                <tr key={v.id} className={v.status === 'cancelled' ? 'cancelled' : ''}>
                  <td className="sn">{idx + 1}</td>
                  <td>{fmtDate(v.vdate)}</td><td>{v.voucher_no}</td><td>{v.narration}</td><td className="num">{fmtMoney(v.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
