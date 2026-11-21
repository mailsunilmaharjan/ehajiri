/* Nepal Accounts (accounting + inventory) — one router, mounted at /api/accounts behind
 * licenseGuard + authGuard + requireModuleEnabled(FLAG_KEYS.accounting) + accountsGuard
 * (see server/index.js). Nothing here is reachable on a tenant until a Super Admin turns the
 * module on for that tenant. */
import { Router } from 'express';
import company from './company.js';
import accounts from './accounts.js';
import vouchers from './vouchers.js';
import reports from './reports.js';
import parties from './parties.js';
import items from './items.js';
import docs from './docs.js';
import stockReports from './stockReports.js';
import alerts from './alerts.js';
import approvals from './approvals.js';
import cheques from './cheques.js';
import quotes from './quotes.js';
import profitReports from './profitReports.js';
import vatReports from './vatReports.js';

const router = Router();
for (const r of [company, accounts, vouchers, reports, parties, items, docs, stockReports, alerts, approvals, cheques, quotes, profitReports, vatReports]) router.use(r);

// Unknown path under /api/accounts -> JSON 404 (never fall through to the SPA)
router.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

export default router;
