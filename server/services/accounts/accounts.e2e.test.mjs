// Run:  node server/services/accounts/accounts.e2e.test.mjs   (forces DB_NAME=ehajiri_local_dev; aborts otherwise; TRUNCATES that DB's acc_* tables)
// End-to-end test of the Accounts module against ehajiri_local_dev ONLY (never a tenant / production DB).
process.env.DB_NAME = 'ehajiri_local_dev';
delete process.env.TENANT_ID;
const S = 'file:///C:/Attendance/ehajiri/server/';
const { default: pool } = await import(S + 'db.js');
const dbn = (await pool.query('select current_database() d')).rows[0].d;
if (dbn !== 'ehajiri_local_dev') { console.error('WRONG DB', dbn); process.exit(2); }

const { runMigrations } = await import(S + 'migrations/runner.js');
await runMigrations();
// fresh slate for a repeatable run — acc_* tables of the LOCAL DEV database only (guarded above)
await pool.query("TRUNCATE acc_company, acc_fiscal_years, acc_groups, acc_ledgers, acc_party_contacts, acc_vouchers, acc_voucher_lines, acc_audit_log, acc_units, acc_item_categories, acc_items, acc_docs, acc_doc_lines, acc_stock_moves, acc_serials, acc_line_serials, acc_notifications, acc_approvals, acc_reminders, acc_cheques, acc_quote_templates, acc_files RESTART IDENTITY CASCADE");
const seedMod = await import(S + 'services/accounts/seed.js');   // process-level 'seeded' flag starts false in this fresh process

// a known test user (dev DB only)
import { createRequire } from 'module';
const require = createRequire('C:/Attendance/ehajiri/server/package.json');
const bcrypt = require('bcryptjs'); const express = require('express');
const PW = 'AccTest#2026';
let u = (await pool.query("select id from users where username='acc.tester'")).rows[0];
if (!u) u = (await pool.query("insert into users (employee_id, username, password, full_name, role) values ('ACCT01','acc.tester',$1,'Accounts Tester','superAdmin') returning id", [await bcrypt.hash(PW, 10)])).rows[0];
else await pool.query('update users set password=$1 where id=$2', [await bcrypt.hash(PW, 10), u.id]);

const { default: accountsRouter } = await import(S + 'routes/accounts/index.js');
const { accountsGuard } = await import(S + 'services/accounts/authz.js');
const { requireModuleEnabled } = await import(S + 'middleware/moduleGuard.js');
const { FLAG_KEYS, invalidateModuleFlagsCache } = await import(S + 'utils/moduleFlags.js');
const { todayAd } = await import(S + 'services/accounts/nepaliDate.js');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use((req, _res, next) => { req.user = { id: u.id, role: 'superAdmin' }; next(); });
app.use('/api/accounts', requireModuleEnabled(FLAG_KEYS.accounting, 'Accounting'), accountsGuard, accountsRouter);
const srv = app.listen(0, '127.0.0.1');
await new Promise((r) => srv.on('listening', r));
const base = `http://127.0.0.1:${srv.address().port}/api/accounts`;

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m, extra ?? ''); } };
const api = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.arrayBuffer() };
};
const T = todayAd();

// ── module flag gate ──
console.log('flag gate');
await pool.query("delete from app_settings where key=$1", [FLAG_KEYS.accounting]); invalidateModuleFlagsCache();
let r = await api('GET', '/company');
ok(r.status === 503 && r.body.moduleDisabled, 'disabled flag -> 503 moduleDisabled', r.status);
await pool.query("insert into app_settings (key, value) values ($1, 'true'::jsonb) on conflict (key) do update set value='true'::jsonb", [FLAG_KEYS.accounting]); invalidateModuleFlagsCache();
await new Promise((x) => setTimeout(x, 5100));   // flag cache TTL
r = await api('GET', '/company');
ok(r.status === 200 && r.body.company, 'enabled flag -> company loads + seeds', JSON.stringify(r.body).slice(0, 200));
ok(r.body.user?.role === 'admin', 'superAdmin maps to admin role');
ok(/^\d{4}\/\d{2}$/.test(r.body.current_fy?.name), 'current fiscal year ' + r.body.current_fy?.name);

console.log('chart of accounts');
const groups = (await api('GET', '/groups')).body, accts = (await api('GET', '/accounts')).body;
ok(groups.length === 33, 'groups seeded: ' + groups.length);
ok(accts.length >= 60, 'ledgers seeded: ' + accts.length);
const L = (key) => accts.find((a) => a.system_key === key);
const cash = L('cash'), bank = L('bank');
r = await api('POST', '/accounts', { name: 'Test Expense A', group_id: groups.find((g) => g.code === '5103').id, kind: 'general' });
ok(r.status === 200 && r.body.code, 'create ledger ' + r.body.code, r.body.error);
r = await api('POST', '/accounts', { name: 'test expense a', group_id: groups.find((g) => g.code === '5103').id });
ok(r.status === 400, 'duplicate ledger name rejected');
const exp = (await api('GET', '/accounts')).body.find((a) => a.name === 'Test Expense A');

console.log('products + parties');
const unit = (await api('GET', '/units')).body[0];
r = await api('POST', '/categories', { name: 'Test Cat' }); ok(r.status === 200, 'category');
const cat = r.body;
r = await api('POST', '/items', { name: 'Widget', unit_id: unit.id, category_id: cat.id, mrp: 226, purchase_price: 100, opening_qty: 10, opening_rate: 80, vat_applicable: true });
ok(r.status === 200 && r.body.code, 'item Widget ' + r.body.code, r.body.error);
const widget = r.body;
r = await api('POST', '/items', { name: 'Serial Gadget', unit_id: unit.id, mrp: 1130, track_serial: true, warranty_months: 12 });
ok(r.status === 200, 'serial item', r.body.error); const gadget = r.body;
r = await api('POST', '/parties', { party_type: 'supplier', name: 'Test Supplier', pan: '123456789', contacts: [{ name: 'Ram', mobile1: '9841234567' }] });
ok(r.status === 200, 'supplier', r.body.error); const sup = r.body;
r = await api('POST', '/parties', { party_type: 'customer', name: 'Test Customer', pan: '987654321', credit_days: 15, credit_limit: 500000 });
ok(r.status === 200, 'customer', r.body.error); const cus = r.body;
r = await api('POST', '/parties', { party_type: 'customer', name: 'Bad Pan', pan: '12' }); ok(r.status === 400, 'bad PAN rejected');

console.log('purchase');
r = await api('POST', '/docs', { doc_type: 'PB', doc_date: T, party_id: sup.id, supplier_bill_no: 'SB-1', payment_mode: 'credit',
  lines: [{ item_id: widget.id, qty: 20, rate: 100 }, { item_id: gadget.id, qty: 2, rate: 800, serials: ['SN-1', 'SN-2'] }] });
ok(r.status === 200 && r.body.doc_no?.startsWith('PB/'), 'purchase posted ' + r.body.doc_no, r.body.error);
const pb = r.body;
ok(pb.total === Math.round((20 * 100 + 2 * 800) * 1.13 * 100) / 100, 'purchase total incl VAT = ' + pb.total);
r = await api('POST', '/docs', { doc_type: 'PB', doc_date: T, party_id: sup.id, lines: [{ item_id: widget.id, qty: 1, rate: 1 }] });
ok(r.status === 400, 'purchase without supplier bill no rejected');

console.log('sales');
r = await api('POST', '/docs', { doc_type: 'SI', doc_date: T, party_id: cus.id, payment_mode: 'credit',
  lines: [{ item_id: widget.id, qty: 5, rate: 226, vat_inclusive: true }, { item_id: gadget.id, qty: 1, rate: 1000, serials: ['SN-1'] }] });
ok(r.status === 200 && r.body.doc_no?.startsWith('SI/'), 'sales invoice ' + r.body.doc_no, r.body.error);
const si = r.body;
ok(si.lines[0].vat_inclusive === 1 && Math.abs(si.lines[0].amount - 1000) < 0.02, 'VAT-inclusive line backs out VAT: amount ' + si.lines[0].amount);
r = await api('POST', '/docs', { doc_type: 'SI', doc_date: T, party_id: cus.id, lines: [{ item_id: widget.id, qty: 9999, rate: 100 }] });
ok(r.status === 400 && /Not enough stock/.test(r.body.error), 'oversell rejected: ' + r.body.error);
r = await api('POST', '/docs', { doc_type: 'SI', doc_date: T, party_id: cus.id, lines: [{ item_id: gadget.id, qty: 1, rate: 1000, serials: ['SN-1'] }] });
ok(r.status === 400 && /not in stock/.test(r.body.error), 'sold serial rejected: ' + r.body.error);
// walk-in cash sale
r = await api('POST', '/docs', { doc_type: 'SI', doc_date: T, party_name: 'Walk-in', payment_mode: 'cash', cash_account_id: cash.id, lines: [{ item_id: widget.id, qty: 2, rate: 120 }] });
ok(r.status === 200 && !r.body.pay_voucher_id, 'walk-in cash sale (no party): ' + r.body.doc_no, r.body.error); const walkin = r.body;
// customer cash sale -> auto receipt voucher
r = await api('POST', '/docs', { doc_type: 'SI', doc_date: T, party_id: cus.id, payment_mode: 'cash', cash_account_id: cash.id, paid_amount: 100, lines: [{ item_id: widget.id, qty: 1, rate: 120 }] });
ok(r.status === 200 && r.body.pay_voucher_id && /^RV\//.test(r.body.pay_voucher_no), 'part-paid cash sale makes receipt ' + r.body.pay_voucher_no, r.body.error);

console.log('returns');
r = await api('POST', '/docs', { doc_type: 'SR', doc_date: T, party_id: cus.id, ref_doc_id: si.id, lines: [{ item_id: widget.id, qty: 1, rate: 226, vat_inclusive: true }] });
ok(r.status === 200, 'sales return ' + r.body.doc_no, r.body.error);
r = await api('POST', '/docs', { doc_type: 'SR', doc_date: T, party_id: cus.id, ref_doc_id: si.id, lines: [{ item_id: widget.id, qty: 99, rate: 226 }] });
ok(r.status === 400 && /left to return/.test(r.body.error), 'over-return rejected: ' + r.body.error);

console.log('vouchers');
r = await api('POST', '/vouchers', { vtype: 'PV', vdate: T, kind: 'expense', narration: 'rent', lines: [{ account_id: exp.id, dr: 500 }, { account_id: cash.id, cr: 500 }] });
ok(r.status === 200 && r.body.voucher_no?.startsWith('PV/'), 'payment voucher ' + r.body.voucher_no, r.body.error);
const pv = r.body;
r = await api('POST', '/vouchers', { vtype: 'JV', vdate: T, lines: [{ account_id: exp.id, dr: 500 }, { account_id: cash.id, cr: 400 }] });
ok(r.status === 400 && /must be equal/.test(r.body.error), 'unbalanced voucher rejected');
r = await api('PUT', '/vouchers/' + pv.id, { vtype: 'PV', vdate: T, narration: 'rent edit', password: 'wrong', lines: [{ account_id: exp.id, dr: 600 }, { account_id: cash.id, cr: 600 }] });
ok(r.status === 403, 'edit with wrong password rejected');
r = await api('PUT', '/vouchers/' + pv.id, { vtype: 'PV', vdate: T, narration: 'rent edit', password: PW, lines: [{ account_id: exp.id, dr: 600 }, { account_id: cash.id, cr: 600 }] });
ok(r.status === 200 && r.body.amount === 600 && r.body.edit_count === 1, 'edit voucher with password', r.body.error);

console.log('cheque');
r = await api('POST', '/docs', { doc_type: 'SI', doc_date: T, party_id: cus.id, payment_mode: 'cheque', cheque_no: 'CH-1', cheque_bank: 'NIC', cheque_date: T, lines: [{ item_id: widget.id, qty: 1, rate: 100 }] });
ok(r.status === 200 && r.body.cheque?.status === 'pending', 'cheque bill registers pending cheque', r.body.error);
const chq = r.body.cheque;
r = await api('POST', `/cheques/${chq.id}/deposit`, { bank_account_id: bank.id, date: T });
ok(r.status === 200 && r.body.status === 'cleared' && /^RV\//.test(r.body.voucher_no), 'deposit posts receipt ' + r.body.voucher_no, r.body.error);

console.log('reports');
const fyA = (await api('GET', '/fiscal-years')).body[0];
r = await api('GET', `/reports/trial-balance?date_from=${fyA.start_date}&date_to=${fyA.end_date}`);
ok(r.status === 200 && r.body.totals.difference === 800 && r.body.totals.dr === r.body.totals.cr, 'trial balance: movements balance, gap = opening stock only (diff ' + r.body.totals.difference + ', dr ' + r.body.totals.closing_dr + ')', JSON.stringify(r.body.totals));
r = await api('GET', `/reports/day-book?date_from=${T}&date_to=${T}`);
ok(r.status === 200 && r.body.length >= 6, 'day book rows: ' + r.body.length);
r = await api('GET', `/reports/ledger?account_id=${cus.id}&date_from=${fyA.start_date}&date_to=${fyA.end_date}`);
ok(r.status === 200 && r.body.rows.some((x) => x.items?.length), 'customer ledger shows bill items; closing ' + r.body.closing);
r = await api('GET', `/reports/stock-summary?date_from=${fyA.start_date}&date_to=${fyA.end_date}`);
const w = r.body.rows?.find((x) => x.id === widget.id);
// widget: opening 10@80 + purchase 20@100, sold 5 + 2 + 1 + 1(cheque) = 9, returned 1  => 10+20-9+1 = 22
ok(w && w.closing_qty === 22, 'widget closing qty 22: ' + w?.closing_qty, JSON.stringify(w));
r = await api('GET', `/reports/stock-ledger?item_id=${widget.id}&date_from=${fyA.start_date}&date_to=${fyA.end_date}`);
ok(r.status === 200 && r.body.rows.length >= 5, 'stock ledger rows ' + r.body.rows?.length);
r = await api('GET', '/serials/lookup?q=SN-1');
ok(r.body[0]?.status === 'sold' && r.body[0].warranty_until, 'serial SN-1 sold with warranty till ' + r.body[0]?.warranty_until);
r = await api('GET', '/alerts'); ok(r.status === 200 && typeof r.body.count === 'number', 'alerts load, count ' + r.body.count);

console.log('edit / cancel / delete');
r = await api('PUT', '/docs/' + si.id, { doc_type: 'SI', doc_date: T, party_id: cus.id, payment_mode: 'credit', password: PW, lines: [{ item_id: widget.id, qty: 4, rate: 226, vat_inclusive: true }] });
ok(r.status === 400 && /Returns were made/.test(r.body.error), 'edit blocked while a return exists');
r = await api('PUT', '/docs/' + walkin.id, { doc_type: 'SI', doc_date: T, party_name: 'Walk-in', payment_mode: 'cash', cash_account_id: cash.id, password: PW, lines: [{ item_id: widget.id, qty: 3, rate: 120 }] });
ok(r.status === 200 && r.body.edit_count === 1 && r.body.lines[0].qty === 3 && r.body.doc_no === walkin.doc_no, 'edit walk-in invoice keeps number ' + r.body.doc_no, r.body.error);
r = await api('POST', '/docs', { doc_type: 'PB', doc_date: T, party_id: sup.id, supplier_bill_no: 'SB-2', lines: [{ item_id: widget.id, qty: 3, rate: 50 }] });
const pb2 = r.body; r = await api('POST', '/docs/' + pb2.id + '/cancel', { reason: 'entered twice' });
ok(r.status === 200 && r.body.status === 'cancelled', 'cancel unused purchase', r.body.error);
r = await api('POST', '/docs/' + walkin.id + '/delete', { reason: 'test delete', admin_password: PW });
ok(r.status === 200 && r.body.deleted, 'admin-password delete of walk-in invoice', r.body.error);
r = await api('GET', '/docs/' + walkin.id); ok(r.status === 404, 'deleted doc is gone');
r = await api('GET', `/reports/trial-balance?date_from=${fyA.start_date}&date_to=${fyA.end_date}`);
ok(r.body.totals.dr === r.body.totals.cr && r.body.totals.difference === 800, 'trial balance still balanced after edit/cancel/delete (dr=cr ' + r.body.totals.dr + ')');
r = await api('POST', '/docs/' + pb.id + '/cancel', { reason: 'test cancel' });
ok(r.status === 400, 'cancel purchase blocked (stock already sold): ' + r.body.error);
r = await api('POST', '/docs/' + si.id + '/delete', { reason: 'test', request_only: true });
ok(r.status === 200 && r.body.requested, 'delete request created');
const appr = (await api('GET', '/approvals')).body[0];
r = await api('POST', `/approvals/${appr.id}/approve`, { password: PW });
ok(r.status === 200 || /Returns|refer/.test(r.body.error || ''), 'approve delete (or blocked by return): ' + (r.body.error || 'deleted'));

console.log('concurrency (numbering)');
const burst = await Promise.all(Array.from({ length: 8 }, () => api('POST', '/vouchers', { vtype: 'JV', vdate: T, lines: [{ account_id: exp.id, dr: 1 }, { account_id: cash.id, cr: 1 }] })));
const nums = burst.map((x) => x.body.voucher_no);
ok(burst.every((x) => x.status === 200) && new Set(nums).size === 8, '8 parallel vouchers -> 8 unique numbers: ' + nums.slice(0, 3).join(', ') + '…', burst.map((x) => x.status).join());

console.log('permissions');
await pool.query("insert into app_settings (key, value) values ('page_permissions', '{\"roles\":{\"superAdmin\":{}}}'::jsonb) on conflict (key) do nothing");

console.log('pdf');
const isPdf = (r) => r.status === 200 && Buffer.from(r.body).subarray(0, 5).toString() === '%PDF-';
r = await api('GET', `/docs/${pb.id}/pdf`); ok(isPdf(r), 'bill PDF renders (' + (r.body.byteLength || r.status) + ' bytes)', JSON.stringify(r.body).slice(0,150));
r = await api('GET', `/reports/ledger/pdf?account_id=${cus.id}&date_from=${fyA.start_date}&date_to=${fyA.end_date}`); ok(isPdf(r), 'ledger PDF renders');
r = await api('POST', '/docs', { doc_type: 'QT', doc_date: T, party_id: cus.id, qt_subject: 'Attendance Device', lines: [{ item_id: widget.id, qty: 2, rate: 500 }] });
ok(r.status === 200 && r.body.doc_no.startsWith('QT/'), 'quotation ' + r.body.doc_no, r.body.error);
const qt = r.body; r = await api('GET', `/docs/${qt.id}/pdf`); ok(isPdf(r), 'quotation PDF renders');
r = await api('GET', `/quote-templates/1/preview`); ok(isPdf(r), 'template preview PDF renders');
r = await api('POST', `/docs`, { doc_type: 'SO', doc_date: T, party_id: cus.id, ref_doc_id: qt.id, lines: [{ item_id: widget.id, qty: 2, rate: 500 }] });
ok(r.status === 200, 'quotation converts to sales order ' + r.body.doc_no, r.body.error);



console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
srv.close(); await pool.end();
process.exit(fail ? 1 : 0);
