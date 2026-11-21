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
    ['/trial-balance', 'Trial Balance', 'calculator'], ['/profit-loss', 'Profit & Loss Account', 'trendingUp'], ['/balance-sheet', 'Balance Sheet', 'briefcase'],
    ['/bill-profit', 'Bill-wise Profit & Loss', 'fileText'], ['/monthly-profit', 'Monthly Expenses & Profit', 'barChart'],
    ['/vat-purchase', 'VAT Purchase Book', 'truck'], ['/vat-sales', 'VAT Sales Book', 'fileText'], ['/vat-return', 'VAT Return (IRD)', 'calculator'],
    ['/audit', 'Audit Trail', 'shield'],
  ] },
];

// Landing pages ("Master", "Posting", "Reports") — the Accounts dropdown lists only these; each page shows every menu & sub-menu
// as cards in the Chart of Accounts look. Item = [path, label, icon, key-hint?]; an item whose label starts with "+" is an
// action (opens a New … form) and shows as a blue row in its place in the list. Rendered by pages/MenuHub.jsx at /accounts/master, /posting, /reports.
// `actions` = blue buttons on the right of the page header: [path, label].
export const ACCOUNTS_HUBS = {
  master: { title: 'Master', icon: 'database', actions: [['/accounts?new=ledger', 'New Ledger'], ['/customers?new=1', 'New Customer'], ['/suppliers?new=1', 'New Supplier']], groups: [
    { title: 'Parties', icon: 'users', cards: [
      ['/customers', 'Customers (Debtors)', 'users'], ['/customers?sub=1', '+ Create Customer Sub Ledger', 'userPlus'],
      ['/suppliers', 'Suppliers (Creditors)', 'truck'], ['/suppliers?sub=1', '+ Create Supplier Sub Ledger', 'userPlus'],
    ] },
    { title: 'Accounts Setup', icon: 'list', cards: [
      ['/accounts', 'Chart of Accounts', 'list'], ['/accounts?new=ledger', '+ New Ledger', 'edit3'],
      ['/accounts?new=bank', '+ Bank Account', 'briefcase'], ['/accounts?new=cash', '+ Cash Account', 'calculator'],
      ['/company', 'Company Setup', 'sliders'],
    ] },
    { title: 'Inventory Setup', icon: 'grid', cards: [['/products', 'Products & Categories', 'grid']] },
    { title: 'Templates', icon: 'edit3', cards: [['/quote-templates', 'Quotation Templates', 'edit3']] },
  ] },
  posting: { title: 'Posting', icon: 'edit3', actions: [['/docs/SI/new', 'Sales Invoice'], ['/docs/PB/new', 'Purchase Invoice'], ['/entry/journal', 'Journal Voucher']], groups: [
    { title: 'Purchase Posting', icon: 'truck', cards: [['/docs/PB', 'Purchase Invoice', 'fileText'], ['/docs/PO', 'Purchase Order', 'clipboard'], ['/docs/PR', 'Purchase Return', 'logOut'],
      ['/docs/PB/new', '+ New Purchase Invoice', 'fileText']] },
    { title: 'Sales Posting', icon: 'trendingUp', cards: [['/docs/QT', 'Sales Quotation', 'mail'], ['/docs/SO', 'Sales Order', 'clipboard'], ['/docs/SI', 'Sales Invoice', 'fileText'], ['/docs/SR', 'Sales Return', 'logOut'],
      ['/docs/SI/new', '+ New Sales Invoice', 'fileText'], ['/docs/QT/new', '+ New Quotation', 'mail']] },
    { title: 'Vouchers', icon: 'edit3', cards: [
      ['/entry/expense', 'Expenses Voucher', 'fileText'], ['/journals', 'Journal Voucher', 'edit3'], ['/entry/supplier_payment', 'Supplier Payment', 'fileText'],
      ['/entry/receipt', 'Payment Received', 'fileText'], ['/entry/transfer', 'Cash / Bank Transfer', 'fileText'], ['/entry/capital_loan', 'Capital / Loan Received', 'fileText'],
      ['/entry/staff_advance', 'Staff Advance / Loan', 'users'], ['/entry/asset_purchase', 'Asset Purchase', 'fileText'], ['/entry/asset_sale', 'Asset Sale', 'fileText'],
      ['/entry/journal', '+ New Journal Voucher', 'edit3'],
    ] },
  ] },
  reports: { title: 'Reports', icon: 'barChart', groups: [
    { title: 'Main Audit Reports', icon: 'shield', cards: [
      ['/ledger', 'Ledger', 'fileText', 'Ctrl+L'], ['/profit-loss', 'Profit & Loss Account', 'trendingUp'],
      ['/trial-balance', 'Trial Balance', 'calculator'], ['/balance-sheet', 'Balance Sheet', 'briefcase'],
    ] },
    { title: 'Books', icon: 'fileText', cards: [['/day-book', 'Day Book', 'calendar']] },
    { title: 'Profit Analysis', icon: 'trendingUp', cards: [['/bill-profit', 'Bill-wise Profit & Loss', 'fileText'], ['/monthly-profit', 'Monthly Expenses & Profit', 'barChart']] },
    { title: 'Inventory Reports', icon: 'grid', cards: [['/stock-summary', 'Stock Summary', 'barChart'], ['/stock-ledger', 'Stock Ledger', 'list', 'Ctrl+K'], ['/serials', 'Serial No. Search', 'key']] },
    { title: 'VAT Reports (IRD)', icon: 'calculator', cards: [['/vat-purchase', 'VAT Purchase Book', 'truck'], ['/vat-sales', 'VAT Sales Book', 'fileText'], ['/vat-return', 'VAT Return (IRD)', 'calculator']] },
    { title: 'Alerts & Audit', icon: 'bell', cards: [['/alerts', 'Alerts (due & expiry)', 'bell'], ['/audit', 'Audit Trail', 'shield']] },
  ] },
};
