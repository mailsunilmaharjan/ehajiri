import { useState } from 'react';
import { useLocation } from '../lib/router';
import DayBook from './DayBook';
import Cheques from './Cheques';

/** "Journal Voucher Entries" — one menu entry; the journal vouchers are listed here and "Post-dated Cheques" is a tab beside them. */
export default function JournalHub() {
  const { pathname } = useLocation();
  const [tab, setTab] = useState(pathname.startsWith('/cheques') ? 'cheques' : 'journals');
  return (
    <>
      <div className="tabs">
        <button type="button" className={`tab-btn${tab === 'journals' ? ' active' : ''}`} onClick={() => setTab('journals')}><span style={{ marginRight: 5 }}>📒</span>Journal Vouchers</button>
        <button type="button" className={`tab-btn${tab === 'cheques' ? ' active' : ''}`} onClick={() => setTab('cheques')}><span style={{ marginRight: 5 }}>🧾</span>Post-dated Cheques</button>
      </div>
      {tab === 'journals'
        ? <DayBook fixedType="JV" title="Journal Vouchers" newTo="/entry/journal" />
        : <Cheques />}
    </>
  );
}
