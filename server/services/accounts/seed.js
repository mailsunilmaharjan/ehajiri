/* First-use seed for the Accounts module: NFRS chart of accounts, units, company row, the current
 * Nepali fiscal year and the default quotation template. Idempotent — safe to call on every request
 * (it short-circuits after the first success per process). Only ever runs for a tenant that has the
 * module enabled, because it is invoked from inside the module's own guard.
 *
 * Port of the GROUPS / LEDGERS / seed code in NepalAccounts/server/app/migrations.py.
 */
import { tx, one } from './accDb.js';
import { ensureFiscalYear } from './common.js';
import { todayAd } from './nepaliDate.js';

// (code, name, name_np, nature, parent_code)
export const GROUPS = [
  ['1', 'Assets', 'सम्पत्ति', 'A', null],
  ['11', 'Non-Current Assets', 'गैर-चालु सम्पत्ति', 'A', '1'],
  ['1101', 'Property, Plant and Equipment', 'जग्गा, भवन तथा उपकरण', 'A', '11'],
  ['1102', 'Intangible Assets', 'अमूर्त सम्पत्ति', 'A', '11'],
  ['1103', 'Long-term Investments', 'दीर्घकालीन लगानी', 'A', '11'],
  ['12', 'Current Assets', 'चालु सम्पत्ति', 'A', '1'],
  ['1201', 'Inventories', 'मौज्दात', 'A', '12'],
  ['1202', 'Trade Receivables (Sundry Debtors)', 'आसामी', 'A', '12'],
  ['1203', 'Cash and Cash Equivalents', 'नगद तथा बैंक', 'A', '12'],
  ['1204', 'Advances, Deposits and Prepayments', 'पेस्की तथा धरौटी', 'A', '12'],
  ['1205', 'Tax Assets', 'कर सम्पत्ति', 'A', '12'],
  ['2', 'Liabilities', 'दायित्व', 'L', null],
  ['21', 'Non-Current Liabilities', 'गैर-चालु दायित्व', 'L', '2'],
  ['2101', 'Long-term Borrowings', 'दीर्घकालीन ऋण', 'L', '21'],
  ['22', 'Current Liabilities', 'चालु दायित्व', 'L', '2'],
  ['2201', 'Trade Payables (Sundry Creditors)', 'साहु', 'L', '22'],
  ['2202', 'Short-term Borrowings', 'अल्पकालीन ऋण', 'L', '22'],
  ['2203', 'Duties and Taxes', 'कर तथा शुल्क', 'L', '22'],
  ['2204', 'Provisions and Other Payables', 'व्यवस्था तथा अन्य भुक्तानी', 'L', '22'],
  ['3', 'Equity', 'पुँजी', 'E', null],
  ['3101', "Share Capital / Proprietor's Capital", 'शेयर/मालिक पुँजी', 'E', '3'],
  ['3102', 'Reserves and Retained Earnings', 'जगेडा तथा सञ्चित नाफा', 'E', '3'],
  ['4', 'Income', 'आम्दानी', 'I', null],
  ['4101', 'Revenue from Operations', 'सञ्चालन आम्दानी', 'I', '4'],
  ['4102', 'Other Income', 'अन्य आम्दानी', 'I', '4'],
  ['5', 'Expenses', 'खर्च', 'X', null],
  ['5101', 'Cost of Sales', 'बिक्री लागत', 'X', '5'],
  ['5102', 'Employee Benefit Expenses', 'कर्मचारी खर्च', 'X', '5'],
  ['5103', 'Administrative Expenses', 'प्रशासनिक खर्च', 'X', '5'],
  ['5104', 'Selling and Distribution Expenses', 'बिक्री तथा वितरण खर्च', 'X', '5'],
  ['5105', 'Finance Costs', 'वित्तीय खर्च', 'X', '5'],
  ['5106', 'Depreciation and Amortisation', 'ह्रास कट्टी', 'X', '5'],
  ['5107', 'Income Tax Expense', 'आयकर खर्च', 'X', '5'],
];

// (group_code, name, name_np, kind, system_key)
export const LEDGERS = [
  ['1101', 'Land and Building', 'जग्गा तथा भवन', 'general', null],
  ['1101', 'Furniture and Fixtures', 'फर्निचर', 'general', null],
  ['1101', 'Office Equipment', 'कार्यालय उपकरण', 'general', null],
  ['1101', 'Computer and Accessories', 'कम्प्युटर', 'general', null],
  ['1101', 'Vehicles', 'सवारी साधन', 'general', null],
  ['1101', 'Accumulated Depreciation', 'सञ्चित ह्रास', 'general', 'acc_dep'],
  ['1201', 'Stock in Hand', 'मौज्दात', 'general', 'stock'],
  ['1203', 'Cash in Hand', 'नगद', 'cash', 'cash'],
  ['1203', 'Petty Cash', 'खुद्रा नगद', 'cash', null],
  ['1203', 'Bank Account - Current', 'बैंक खाता', 'bank', 'bank'],
  ['1204', 'Advance to Suppliers', 'आपूर्तिकर्तालाई पेस्की', 'general', null],
  ['1204', 'Prepaid Expenses', 'अग्रिम भुक्तानी खर्च', 'general', null],
  ['1204', 'Security Deposits', 'धरौटी', 'general', null],
  ['1204', 'Advance Salary to Staff', 'कर्मचारी तलब पेस्की', 'general', null],
  ['1205', 'Input VAT (13%)', 'खरिद भ्याट', 'tax', 'input_vat'],
  ['1205', 'Advance Income Tax (TDS Receivable)', 'अग्रिम आयकर', 'tax', 'tds_receivable'],
  ['2101', 'Long-term Bank Loan', 'दीर्घकालीन बैंक ऋण', 'general', null],
  ['2101', 'Director Loan', 'सञ्चालक ऋण', 'general', null],
  ['2202', 'Bank Overdraft', 'बैंक ओभरड्राफ्ट', 'bank', null],
  ['2203', 'Output VAT (13%)', 'बिक्री भ्याट', 'tax', 'output_vat'],
  ['2203', 'TDS Payable', 'अग्रिम कर कट्टी भुक्तानी', 'tax', 'tds_payable'],
  ['2203', 'SSF Payable', 'सामाजिक सुरक्षा कोष भुक्तानी', 'tax', 'ssf_payable'],
  ['2203', 'Income Tax Payable', 'आयकर भुक्तानी', 'tax', 'income_tax_payable'],
  ['2204', 'Salary Payable', 'तलब भुक्तानी', 'general', 'salary_payable'],
  ['2204', 'Audit Fee Payable', 'लेखापरीक्षण शुल्क भुक्तानी', 'general', null],
  ['3101', 'Capital Account', 'पुँजी खाता', 'general', 'capital'],
  ['3101', 'Drawings', 'निजी खर्च', 'general', 'drawings'],
  ['3102', 'Retained Earnings', 'सञ्चित नाफा', 'general', 'retained_earnings'],
  ['4101', 'Sales', 'बिक्री', 'general', 'sales'],
  ['4101', 'Sales Return', 'बिक्री फिर्ता', 'general', 'sales_return'],
  ['4101', 'Service Income', 'सेवा आम्दानी', 'general', null],
  ['4102', 'Interest Income', 'ब्याज आम्दानी', 'general', null],
  ['4102', 'Discount Received', 'छुट प्राप्त', 'general', 'discount_received'],
  ['4102', 'Miscellaneous Income', 'विविध आम्दानी', 'general', null],
  ['4102', 'Gain on Sale of Assets', 'सम्पत्ति बिक्रीमा नाफा', 'general', 'asset_sale_gain'],
  ['5101', 'Purchase', 'खरिद', 'general', 'purchase'],
  ['5101', 'Purchase Return', 'खरिद फिर्ता', 'general', 'purchase_return'],
  ['5101', 'Freight Inward', 'ढुवानी (खरिद)', 'general', null],
  ['5101', 'Customs Duty', 'भन्सार महसुल', 'general', null],
  ['5102', 'Salary and Wages', 'तलब तथा ज्याला', 'general', 'salary'],
  ['5102', 'SSF Contribution (Employer)', 'सामाजिक सुरक्षा कोष योगदान', 'general', null],
  ['5102', 'Festival Allowance', 'चाडपर्व भत्ता', 'general', null],
  ['5102', 'Staff Welfare', 'कर्मचारी कल्याण', 'general', null],
  ['5103', 'Rent', 'घर भाडा', 'general', null],
  ['5103', 'Electricity', 'बिजुली', 'general', null],
  ['5103', 'Telephone and Internet', 'टेलिफोन तथा इन्टरनेट', 'general', null],
  ['5103', 'Printing and Stationery', 'छपाई तथा मसलन्द', 'general', null],
  ['5103', 'Office Expenses', 'कार्यालय खर्च', 'general', null],
  ['5103', 'Repair and Maintenance', 'मर्मत सम्भार', 'general', null],
  ['5103', 'Fuel and Transportation', 'इन्धन तथा यातायात', 'general', null],
  ['5103', 'Insurance', 'बीमा', 'general', null],
  ['5103', 'Audit Fee', 'लेखापरीक्षण शुल्क', 'general', null],
  ['5103', 'Taxes, Fees and Renewals', 'कर, दस्तुर तथा नवीकरण', 'general', null],
  ['5103', 'Loss on Sale of Assets', 'सम्पत्ति बिक्रीमा नोक्सानी', 'general', 'asset_sale_loss'],
  ['5104', 'Advertisement', 'विज्ञापन', 'general', null],
  ['5104', 'Discount Allowed', 'छुट दिएको', 'general', 'discount_allowed'],
  ['5104', 'Carriage Outward', 'ढुवानी (बिक्री)', 'general', null],
  ['5105', 'Bank Charges', 'बैंक शुल्क', 'general', null],
  ['5105', 'Interest Expense', 'ब्याज खर्च', 'general', null],
  ['5106', 'Depreciation', 'ह्रास खर्च', 'general', 'depreciation'],
  ['5107', 'Income Tax Expense', 'आयकर खर्च', 'general', null],
];

const UNITS = ['Pcs', 'Box', 'Pkt', 'Dozen', 'Set', 'Kg', 'Gm', 'Ltr', 'Ml', 'Mtr', 'Roll', 'Bottle', 'Carton'];

const DEFAULT_TERMS = [
  ['Warranty', 'One year warranty'],
  ['Quotation Validity', '2 weeks from the date of quotation.'],
  ['Licensing Details', 'NA'],
  ['Service Support', 'Service support for one year within warranty and subscription.'],
  ['Payment Terms', 'Online or Cheque'],
  ['Delivery & Installation', 'After confirmation email or purchase order. Installation charge not included.'],
];

let seeded = false;
let inflight = null;

export async function ensureSeeded() {
  if (seeded) return;
  if (!inflight) {
    inflight = doSeed().then(() => { seeded = true; }).finally(() => { inflight = null; });
  }
  await inflight;
}

async function doSeed() {
  const has = await one('SELECT 1 AS x FROM acc_groups LIMIT 1');
  if (has) { await ensureFiscalYear(todayAd()); return; }

  await tx(async (t) => {
    // Serialise first-time seeding across the (rare) concurrent first requests.
    await t.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['acc:seed']);
    if (await t.one('SELECT 1 AS x FROM acc_groups LIMIT 1')) return;

    await t.query('INSERT INTO acc_company (id) VALUES (1) ON CONFLICT (id) DO NOTHING');

    const ids = {};
    for (let sort = 0; sort < GROUPS.length; sort++) {
      const [code, name, np, nature, parent] = GROUPS[sort];
      const r = await t.one(
        'INSERT INTO acc_groups (code, name, name_np, nature, parent_id, is_system, sort) VALUES (%s,%s,%s,%s,%s,1,%s) RETURNING id',
        [code, name, np, nature, parent ? ids[parent] : null, sort]);
      ids[code] = r.id;
    }
    const counters = {};
    for (const [gcode, name, np, kind, key] of LEDGERS) {
      counters[gcode] = (counters[gcode] || 0) + 1;
      await t.query(
        'INSERT INTO acc_ledgers (code, name, name_np, group_id, kind, system_key, created_by) VALUES (%s,%s,%s,%s,%s,%s,%s)',
        [`${gcode}-${String(counters[gcode]).padStart(3, '0')}`, name, np, ids[gcode], kind, key, 'system']);
    }
    for (const u of UNITS) await t.query('INSERT INTO acc_units (name) VALUES (%s) ON CONFLICT (name) DO NOTHING', [u]);
    await t.query(
      "INSERT INTO acc_quote_templates (name, is_default, validity, terms, notes, created_by) VALUES ('Standard Quotation', 1, %s, %s, %s, 'system') ON CONFLICT (name) DO NOTHING",
      ['15 days from date of issue', JSON.stringify(DEFAULT_TERMS),
        'Electric wire and CAT 6 cables are not included; they are charged as used on site.']);
    await ensureFiscalYear(todayAd(), t);
  });
}
