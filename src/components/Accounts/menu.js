// Menu of the Accounts module — shown by eHajiri's own top menu ("Accounts" dropdown). Paths are relative to /accounts.
// Data only (no React) so eHajiri's main header can import it without loading the module.
// `icon` names are eHajiri's own menu icons (MIcon in Layout/TopMenu.jsx), so the dropdown looks like Attendance's.
// Item = [path, label, icon, keyboard hint?]; a section with `to` instead of `items` is a single menu entry (no sub-menu)
export const ACCOUNTS_MENU = [
  { title: 'Masters', icon: 'database', items: [
    ['/customers', 'Customers (Debtors)', 'users'], ['/suppliers', 'Suppliers (Creditors)', 'truck'],
    ['/products', 'Products & Categories', 'grid'], ['/accounts', 'Chart of Accounts', 'list'], ['/company', 'Company Setup', 'sliders'],
  ] },
  { title: 'Purchase', icon: 'truck', items: [
    ['/docs/PO', 'Purchase Order', 'clipboard'], ['/docs/PB', 'Purchase', 'fileText'], ['/docs/PR', 'Purchase Return', 'logOut'],
  ] },
  { title: 'Sales', icon: 'trendingUp', items: [
    ['/docs/QT', 'Sales Quotation', 'mail'], ['/docs/SO', 'Sales Order', 'clipboard'], ['/docs/SI', 'Sales Invoice', 'fileText'],
    ['/docs/SR', 'Sales Return', 'logOut'], ['/quote-templates', 'Quotation Templates', 'edit3'],
  ] },
  // single item (no sub-menu): opens the journal list, with "Post-dated Cheques" as a tab on that page
  { title: 'Journal Voucher Entries', icon: 'edit3', to: '/journals' },
  { title: 'Reports', icon: 'barChart', items: [
    ['/alerts', 'Alerts (due & expiry)', 'bell'], ['/stock-summary', 'Stock Summary', 'barChart'], ['/stock-ledger', 'Stock Ledger', 'list', 'Ctrl+K'],
    ['/serials', 'Serial No. Search', 'key'], ['/day-book', 'Day Book', 'calendar'], ['/ledger', 'Ledger', 'fileText', 'Ctrl+L'],
    ['/trial-balance', 'Trial Balance', 'calculator'], ['/audit', 'Audit Trail', 'shield'],
  ] },
];
