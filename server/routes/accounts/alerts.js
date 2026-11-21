/* Alerts: overdue / due-soon bills (from credit days), expiring services, low stock, credit limits.
 * Port of routers/alerts.py.
 *
 * Bill-wise outstanding is worked out FIFO: a party's balance is assumed to belong to their most recent
 * credit bills (payments clear the oldest bills first), so no manual matching is needed. */
import { Router } from 'express';
import { q, one, tx } from '../../services/accounts/accDb.js';
import { ah, bad, audit, money, userOf } from '../../services/accounts/common.js';
import { bsStr, todayAd, addDays, diffDays } from '../../services/accounts/nepaliDate.js';
import { getDoc } from './docs.js';
import * as notify from '../../services/accounts/notify.js';
import { completeLinkedTask } from '../../services/accounts/docTasks.js';

const router = Router();

export async function outstanding(partyType) {
  const [docType, sign] = partyType === 'customer' ? ['SI', 1] : ['PB', -1];
  const parties = (await q(
    'SELECT a.id, a.name, COALESCE(a.whatsapp, a.phone) AS phone, a.email, a.credit_days, a.credit_limit,'
    + ' a.opening_balance + COALESCE((SELECT SUM(l.dr - l.cr) FROM acc_voucher_lines l JOIN acc_vouchers v ON v.id = l.voucher_id'
    + "   WHERE l.account_id = a.id AND v.status = 'posted'), 0) AS balance"
    + ' FROM acc_ledgers a WHERE a.party_type = %s', [partyType])).rows;
  const fyStart = (await one('SELECT MIN(start_date) AS d FROM acc_fiscal_years')).d;
  const today = todayAd();
  const out = [];
  for (const p of parties) {
    let remaining = money(p.balance * sign);
    if (remaining <= 0.005) continue;
    const bills = (await q(
      "SELECT id, doc_no, doc_date, due_date, total FROM acc_docs WHERE party_id = %s AND doc_type = %s AND status = 'posted' AND payment_mode IN ('credit','cheque') ORDER BY doc_date DESC, id DESC",
      [p.id, docType])).rows;
    for (const bl of bills) {
      if (remaining <= 0.005) break;
      const amt = money(Math.min(bl.total, remaining));
      remaining = money(remaining - amt);
      out.push({ ...bl, outstanding: amt, party_id: p.id, party: p.name, phone: p.phone, email: p.email });
    }
    if (remaining > 0.005) {
      out.push({ id: null, doc_no: 'Opening balance', doc_date: fyStart, due_date: fyStart, total: remaining, outstanding: remaining, party_id: p.id, party: p.name, phone: p.phone, email: p.email });
    }
  }
  for (const r of out) {
    const due = r.due_date || r.doc_date;
    r.days_overdue = diffDays(today, due);
    r.due_date_bs = bsStr(due);
    r.doc_date_bs = bsStr(r.doc_date);
  }
  return out.sort((a, b) => b.days_overdue - a.days_overdue);
}

router.get('/alerts', ah(async (req, res) => {
  const me = req.accUser;
  const days = (await one('SELECT alert_days FROM acc_company WHERE id = 1')).alert_days;
  const today = todayAd();
  const soon = addDays(today, days);
  const recv = await outstanding('customer'), pay = await outstanding('supplier');
  const services = (await q(
    'SELECT l.id, l.service_from, l.service_to, i.name AS item, d.id AS doc_id, d.doc_no, d.doc_type, d.party_id,'
    + ' d.party_name AS party, COALESCE(p.whatsapp, p.phone) AS phone, p.email FROM acc_doc_lines l JOIN acc_docs d ON d.id = l.doc_id'
    + ' JOIN acc_items i ON i.id = l.item_id LEFT JOIN acc_ledgers p ON p.id = d.party_id'
    + " WHERE d.doc_type IN ('SI','PB') AND d.status = 'posted' AND l.service_to IS NOT NULL AND l.service_to <= %s AND l.service_to >= %s ORDER BY l.service_to",
    [soon, addDays(today, -30)])).rows;
  for (const s of services) { s.days_left = diffDays(s.service_to, today); s.service_to_bs = bsStr(s.service_to); }
  const low = (await q(
    'SELECT i.id, i.name, i.reorder_level, u.name AS unit,'
    + ' COALESCE((SELECT SUM(qty_in - qty_out) FROM acc_stock_moves m WHERE m.item_id = i.id), 0) AS stock'
    + " FROM acc_items i JOIN acc_units u ON u.id = i.unit_id WHERE i.active = 1 AND i.item_type = 'goods' AND i.reorder_level > 0")).rows
    .filter((r) => r.stock <= r.reorder_level);
  const over = (await q(
    'SELECT * FROM (SELECT a.id, a.name, a.credit_limit,'
    + ' a.opening_balance + COALESCE((SELECT SUM(l.dr - l.cr) FROM acc_voucher_lines l JOIN acc_vouchers v ON v.id = l.voucher_id'
    + "   WHERE l.account_id = a.id AND v.status = 'posted'), 0) AS balance"
    + " FROM acc_ledgers a WHERE a.party_type = 'customer' AND a.credit_limit > 0) x WHERE balance > credit_limit")).rows;
  let rem = (await q(
    "SELECT r.*, d.doc_no, d.doc_type, d.party_id, d.party_name AS party FROM acc_reminders r JOIN acc_docs d ON d.id = r.doc_id WHERE r.status = 'open' AND r.remind_on <= %s AND NOT EXISTS (SELECT 1 FROM tasks tk WHERE tk.id = r.task_id AND tk.status IN ('completed','cancelled')) ORDER BY r.remind_on, r.id",
    [today])).rows;
  if (!me.isAdmin) rem = rem.filter((r) => r.kind !== 'followup' || !r.assigned_to || r.assigned_to === me.username);   // follow-up tasks: only your own
  for (const r of rem) r.days = diffDays(r.remind_on, today);
  const result = {
    alert_days: days,
    reminders: rem,
    receivable_overdue: recv.filter((r) => r.days_overdue > 0),
    receivable_due_soon: recv.filter((r) => r.days_overdue >= -days && r.days_overdue <= 0),
    payable_overdue: pay.filter((r) => r.days_overdue > 0),
    payable_due_soon: pay.filter((r) => r.days_overdue >= -days && r.days_overdue <= 0),
    services_sales: services.filter((s) => s.doc_type === 'SI'),
    services_purchase: services.filter((s) => s.doc_type === 'PB'),
    low_stock: low,
    over_limit: over,
    approvals: me.isAdmin ? (await q("SELECT * FROM acc_approvals WHERE status = 'pending' ORDER BY id")).rows : [],
  };
  result.count = Object.values(result).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
  res.json(result);
}));

router.post('/reminders/:rid/done', ah(async (req, res) => {
  const rid = +req.params.rid, u = req.accUser;
  const r = await one('SELECT * FROM acc_reminders WHERE id = %s', [rid]) || bad('Reminder not found.', 404);
  if (r.kind === 'followup' && r.assigned_to && r.assigned_to !== u.username && !u.isAdmin) bad(`This task is assigned to ${r.assigned_to}.`);
  await tx(async (t) => {
    await t.query("UPDATE acc_reminders SET status = 'done', done_by = %s, done_at = NOW() WHERE id = %s", [u.username, rid]);
    await audit(t, u.username, 'reminder_done', 'doc', r.doc_id, { reminder: r.title });
  });
  await completeLinkedTask(r.task_id);     // ticking it off in Alerts also completes the Task-module task
  res.json({ ok: true });
}));

const serviceItems = (d) => d.lines.filter((l) => l.service_to).map((l) => `${l.item} (till ${bsStr(l.service_to)})`).join(', ');

router.post('/alerts/remind', ah(async (req, res) => {
  const b = req.body || {};
  const d = await getDoc(+b.doc_id);
  const c = await one('SELECT * FROM acc_company WHERE id = 1');
  let text;
  if (b.kind === 'service') {
    text = `Namaste ${d.party_name},\nYour service with ${c.name} is expiring: ${serviceItems(d)}.\nPlease contact us to renew. Thank you.`;
  } else {
    const row = (await outstanding('customer')).find((r) => r.id === d.id);
    if (!row) bad('Nothing is outstanding on this bill.');
    text = `Namaste ${d.party_name},\nReminder from ${c.name}: Rs ${row.outstanding.toLocaleString('en-IN', { minimumFractionDigits: 2 })} is due on bill ${d.doc_no} (due ${row.due_date_bs}). Please arrange payment. Thank you.`;
  }
  await notify.sendDoc(d, b.channel, userOf(req), text);
  await tx((t) => audit(t, userOf(req), `remind_${b.channel}`, 'doc', d.id, { kind: b.kind }));
  res.json({ ok: true, text });
}));

/** Text for the manual 'Share on WhatsApp' link. */
router.get('/alerts/remind-text', ah(async (req, res) => {
  const d = await getDoc(+req.query.doc_id);
  const c = await one('SELECT * FROM acc_company WHERE id = 1');
  if (req.query.kind === 'service') {
    return res.json({ text: `Namaste ${d.party_name},\nYour service with ${c.name} is expiring: ${serviceItems(d)}.\nPlease contact us to renew.`, phone: d.party_phone });
  }
  const row = (await outstanding('customer')).find((r) => r.id === d.id);
  const amt = row ? row.outstanding : d.total;
  const due = row ? row.due_date_bs : bsStr(d.due_date || d.doc_date);
  res.json({ text: `Namaste ${d.party_name},\nReminder from ${c.name}: Rs ${Number(amt).toLocaleString('en-IN', { minimumFractionDigits: 2 })} is due on bill ${d.doc_no} (due ${due}).`, phone: d.party_phone });
}));

export default router;
