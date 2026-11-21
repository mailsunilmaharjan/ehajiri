import { useEffect } from 'react';
import { Route, Routes, useLocation, useNavigate } from './lib/router';
import { AppProvider } from './context';
import { FileViewerHost } from './components/FileViewer';
import Dashboard from './pages/Dashboard';
import CompanySetup from './pages/CompanySetup';
import ChartOfAccounts from './pages/ChartOfAccounts';
import VoucherEntry from './pages/VoucherEntry';
import DayBook from './pages/DayBook';
import Ledger from './pages/Ledger';
import TrialBalance from './pages/TrialBalance';
import AuditLog from './pages/AuditLog';
import Parties from './pages/Parties';
import Products from './pages/Products';
import DocList from './pages/DocList';
import DocEntry from './pages/DocEntry';
import ProfitLoss from './pages/ProfitLoss';
import BillProfit from './pages/BillProfit';
import MonthlyProfit from './pages/MonthlyProfit';
import StockSummary from './pages/StockSummary';
import StockLedger from './pages/StockLedger';
import Alerts from './pages/Alerts';
import SerialSearch from './pages/SerialSearch';
import SimpleVoucher from './pages/SimpleVoucher';
import JournalHub from './pages/JournalHub';
import QuoteTemplates from './pages/QuoteTemplates';
import '../DataGrid/DataGrid.css';   // the grid look (variables + Accounts grid rules) lives in ONE place
import './accounts.css';
import './accounts.embed.css';

/** Ctrl+L → Ledger, Ctrl+K → Stock Ledger (not while a pop-up form is open, so nothing unsaved is lost). */
function Shortcuts() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const to = { l: '/ledger', k: '/stock-ledger' }[e.key.toLowerCase()];
      if (!to) return;
      e.preventDefault();
      const modalOpen = [...document.querySelectorAll('.acc-app .modal')].some((m) => m.offsetParent !== null);
      if (!modalOpen && pathname !== to) nav(to);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [nav, pathname]);
  return null;
}

function Shell() {
  return (
    <>
      <Shortcuts />
      <FileViewerHost />
      <main className="main-layout page-container">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/company" element={<CompanySetup />} />
          <Route path="/accounts" element={<ChartOfAccounts />} />
          <Route path="/voucher/:vtype" element={<VoucherEntry />} />
          <Route path="/day-book" element={<DayBook />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/trial-balance" element={<TrialBalance />} />
          <Route path="/profit-loss" element={<ProfitLoss />} />
          <Route path="/bill-profit" element={<BillProfit />} />
          <Route path="/monthly-profit" element={<MonthlyProfit />} />
          <Route path="/audit" element={<AuditLog />} />
          <Route path="/customers" element={<Parties type="customer" />} />
          <Route path="/suppliers" element={<Parties type="supplier" />} />
          <Route path="/products" element={<Products />} />
          <Route path="/docs/:type" element={<DocList />} />
          <Route path="/docs/:type/new" element={<DocEntry />} />
          <Route path="/docs/:type/:id/edit" element={<DocEntry />} />
          <Route path="/voucher/:vtype/:id/edit" element={<VoucherEntry />} />
          <Route path="/entry/:kind" element={<SimpleVoucher />} />
          <Route path="/entry/:kind/:id/edit" element={<SimpleVoucher />} />
          <Route path="/stock-summary" element={<StockSummary />} />
          <Route path="/stock-ledger" element={<StockLedger />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/journals" element={<JournalHub />} />
          <Route path="/cheques" element={<JournalHub />} />
          <Route path="/serials" element={<SerialSearch />} />
          <Route path="/quote-templates" element={<QuoteTemplates />} />
        </Routes>
      </main>
    </>
  );
}

/** Nepal Accounts (accounting + inventory). Mounted by eHajiri at /accounts/*; the screens below are nested
 *  routes of that mount point (see lib/router.jsx for how the demo's absolute paths map onto it). */
export default function AccountsApp() {
  return (
    <AppProvider><Shell /></AppProvider>
  );
}
