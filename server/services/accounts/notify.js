/* Email (SMTP) and WhatsApp (any HTTP gateway) for bills, orders and reminders.
 * Port of NepalAccounts/server/app/notify.py.
 *
 * Email uses eHajiri's central Email Setup (Settings › Email Setup, app_settings.emailConfig) — one SMTP
 * configuration for the whole app. The old per-company acc_company.smtp_* columns are no longer used.
 *
 * WhatsApp gateway URL is a template, e.g.
 *   https://api.yourgateway.com/send?token=XXXX&to={phone}&text={message}
 * {phone} and {message} are filled in (URL-encoded). With method POST, the same placeholders are filled
 * and a JSON body {"phone": ..., "message": ...} is sent.
 */
import nodemailer from 'nodemailer';
import pool from '../../db.js';
import { q, one } from './accDb.js';
import { bad, nepMoney } from './common.js';
import { bsStr } from './nepaliDate.js';

const DOC_NAMES = { QT: 'Quotation', PO: 'Purchase Order', PB: 'Purchase', PR: 'Debit Note', SO: 'Sales Order', SI: 'Tax Invoice', SR: 'Credit Note' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const company = () => one('SELECT * FROM acc_company WHERE id = 1');

export function phoneE164(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('9')) d = `977${d}`;   // Nepal mobile
  return d.length >= 10 ? d : null;
}

/** True when eHajiri Settings › Email Setup has a usable, enabled SMTP config. */
export async function emailReady() { return !!(await smtpConfig()); }

async function smtpConfig() {
  const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='emailConfig'");
  let cfg = rows[0]?.value;
  if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch { cfg = null; } }
  if (!cfg || !cfg.enabled || !cfg.smtpHost) return null;
  return {
    host: cfg.smtpHost, port: Number(cfg.smtpPort) || 587, secure: cfg.secure === true || cfg.secure === 'true' || Number(cfg.smtpPort) === 465,
    auth: { user: cfg.smtpUser, pass: cfg.smtpPass },
    from: cfg.fromName ? `"${cfg.fromName}" <${cfg.fromEmail || cfg.smtpUser}>` : (cfg.fromEmail || cfg.smtpUser),
  };
}

/** attachments: [{ filename, content: Buffer, contentType }] */
export async function sendEmail(to, subject, html, attachments = []) {
  const cfg = await smtpConfig();
  if (!cfg) bad("Email isn't set up or is disabled. Ask a Super Admin to configure it in Settings › Email Setup.");
  if (!to || !String(to).includes('@')) bad('No valid email address.');
  const { from, ...transport } = cfg;
  try {
    const tr = nodemailer.createTransport({
      ...transport, connectionTimeout: 20000, socketTimeout: 30000,
      tls: { rejectUnauthorized: process.env.SMTP_ALLOW_INSECURE_TLS !== 'true' },
    });
    await tr.sendMail({ from, to, subject, html, text: html.replace(/<[^>]+>/g, ' '), attachments });
  } catch (e) { bad(`Email failed: ${e.message}`); }
}

export async function sendWhatsapp(phone, text) {
  const c = await company();
  if (!c.wa_gateway_url) bad("WhatsApp gateway isn't set up. Use the 'Share on WhatsApp' button instead.");
  const ph = phoneE164(phone);
  if (!ph) bad('No valid mobile number.');
  const url = c.wa_gateway_url.replace('{phone}', encodeURIComponent(ph)).replace('{message}', encodeURIComponent(text));
  if (!/^https?:\/\//.test(url)) bad('WhatsApp gateway URL must start with https://');
  try {
    const r = await fetch(url, c.wa_method === 'POST'
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: ph, message: text }), signal: AbortSignal.timeout(20000) }
      : { signal: AbortSignal.timeout(20000) });
    if (r.status >= 400) bad(`WhatsApp gateway answered ${r.status}.`);
  } catch (e) { if (e.status) throw e; bad(`WhatsApp failed: ${e.message}`); }
}

function quoteText(d, c) {
  return [
    `Namaste ${d.party_name},${d.qt_attn ? `\nAttn: ${d.qt_attn}` : ''}`,
    `Please find attached our quotation for ${d.qt_subject || 'your requirement'}.`,
    `Quotation No.: ${d.doc_no}  ·  Date: ${bsStr(d.doc_date)}`,
    `Grand Total: Rs ${nepMoney(d.total)} (incl. VAT)`,
    d.qt_validity && `Validity: ${d.qt_validity}`,
    'We look forward to your confirmation.', `— ${c.name}`,
  ].filter(Boolean).join('\n');
}

function docText(d, c) {
  if (d.doc_type === 'QT') return quoteText(d, c);
  const lines = [`Namaste ${d.party_name},`, `${c.name} — ${DOC_NAMES[d.doc_type]} ${d.doc_no}`, `Miti: ${bsStr(d.doc_date)}  Amount: Rs ${nepMoney(d.total)}`];
  if (d.due_date && d.payment_mode === 'credit' && ['SI', 'PB'].includes(d.doc_type)) lines.push(`Due by: ${bsStr(d.due_date)}`);
  for (const l of d.lines.filter((x) => x.service_to)) lines.push(`${l.item}: service valid till ${bsStr(l.service_to)}`);
  lines.push(['SI', 'SO'].includes(d.doc_type) ? 'Thank you.' : 'Please confirm.');
  return lines.join('\n');
}

function docHtml(d, c) {
  const rows = d.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.item)}`
    + (l.serials?.length ? `<br><small>S/N: ${esc(l.serials.join(', '))}</small>` : '')
    + (l.service_to ? `<br><small>Service ${bsStr(l.service_from)} to ${bsStr(l.service_to)}</small>` : '')
    + `</td><td align=right>${l.qty} ${esc(l.unit)}</td><td align=right>${nepMoney(l.rate_excl)}</td><td align=right>${nepMoney(l.amount)}</td></tr>`).join('');
  const due = d.due_date && d.payment_mode === 'credit' && ['SI', 'PB'].includes(d.doc_type) ? `<p>Due by <b>${bsStr(d.due_date)}</b></p>` : '';
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#111">
<h2 style="margin:0">${esc(c.name)}</h2><div>${esc(c.address || '')} · PAN ${esc(c.pan || '')}</div>
<h3>${DOC_NAMES[d.doc_type]} ${esc(d.doc_no)}</h3>
<p>To: <b>${esc(d.party_name)}</b> (PAN ${esc(d.party_pan || '—')})<br>Miti: ${bsStr(d.doc_date)} (${d.doc_date})</p>
<table cellpadding=6 cellspacing=0 border=1 style="border-collapse:collapse;border-color:#ddd">
<tr style="background:#efefef"><th>S.N.</th><th>Particulars</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>${rows}
<tr><td colspan=4 align=right>Taxable</td><td align=right>${nepMoney(d.taxable)}</td></tr>
<tr><td colspan=4 align=right>Non-taxable</td><td align=right>${nepMoney(d.exempt)}</td></tr>
<tr><td colspan=4 align=right>VAT ${c.vat_rate}%</td><td align=right>${nepMoney(d.vat)}</td></tr>
<tr><td colspan=4 align=right><b>Total</b></td><td align=right><b>Rs ${nepMoney(d.total)}</b></td></tr></table>${due}
<p style="color:#666">Sent by eHajiri Accounts.</p></div>`;
}

/** "Pay to our bank account" for the mail body: one box per bank, QR shown inline (cid attachment). */
async function bankEmail(d) {
  const { bankAccountsFor } = await import('../../routes/accounts/accounts.js');
  const { getFile } = await import('./files.js');
  const banks = (await bankAccountsFor(d.cash_account_id)).slice(0, 3);
  if (!banks.length) return { block: '', files: [] };
  const files = [];
  const cells = [];
  for (const [i, b] of banks.entries()) {
    const f = b.qr_image ? await getFile('bank-qr', b.qr_image).catch(() => null) : null;
    let qr = '';
    if (f?.data) {
      const cid = `bankqr${i}@ehajiri`, ext = (String(f.mime || '').split('/')[1] || 'png').replace('jpeg', 'jpg');
      files.push({ filename: `QR-${String(b.name).replace(/[^\w]+/g, '_')}.${ext}`, content: f.data, contentType: f.mime || 'image/png', cid });
      qr = `<td style="padding:6px;vertical-align:top"><img src="cid:${cid}" alt="QR" style="display:block;height:170px;width:auto;max-width:170px"><div style="font-size:11px;color:#555;text-align:center">Scan to pay</div></td>`;
    }
    const row = (k, v) => (v ? `<div style="font-size:11px;color:#555;margin-top:4px">${k}</div><div style="font-size:13px;font-weight:600">${esc(v)}</div>` : '');
    cells.push(`<td style="padding:4px;vertical-align:top"><table cellpadding=0 cellspacing=0 style="border:1px solid #9ca3af;border-radius:6px"><tr>${qr}`
      + `<td style="padding:8px 10px;vertical-align:top"><div style="font-size:14px;font-weight:700">${esc(b.name)}</div>`
      + `${row('A/c Name', b.account_name)}${row('A/c No.', b.account_no)}${row('Branch', b.branch)}</td></tr></table></td>`);
  }
  return { block: `<h4 style="margin:16px 0 4px;color:#0f2a3d">Pay to our bank account</h4><table cellpadding=0 cellspacing=0><tr>${cells.join('')}</tr></table>`, files };
}

export async function log(channel, docId, partyId, recipient, subject, status, error, user) {
  await q('INSERT INTO acc_notifications (channel, doc_id, party_id, recipient, subject, status, error, created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)',
    [channel, docId, partyId, recipient, subject, status, error, user]);
}

/** Send one document by email or WhatsApp to its party and log the result (throws on failure).
 *  Quotations go by email with the quotation PDF attached. `to` overrides the party's saved email / mobile. */
export async function sendDoc(d, channel, user, text = null, to = null) {
  const c = await company();
  const party = d.party_id ? await one('SELECT * FROM acc_ledgers WHERE id = %s', [d.party_id]) : null;
  let subject = `${DOC_NAMES[d.doc_type]} ${d.doc_no} — ${c.name}`;
  if (d.doc_type === 'QT' && d.qt_subject) subject = `Quotation: ${d.qt_subject} — ${c.name}`;
  let target = String(to || '').trim() || (channel === 'email' ? party?.email : (party?.whatsapp || party?.phone));
  try {
    if (!target) bad(`${d.party_name} has no ${channel === 'email' ? 'email' : 'mobile number'} saved.`);
    if (channel === 'email' && d.doc_type === 'QT') {
      const { docPdfBytes, pdfName } = await import('../../routes/accounts/docs.js');
      const body = esc(text || quoteText(d, c)).replace(/\n/g, '<br>');
      await sendEmail(target, subject, `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px">${body}</div>`,
        [{ filename: pdfName(d), content: await docPdfBytes(d, user), contentType: 'application/pdf' }]);
    } else if (channel === 'email' && ['SO', 'SI'].includes(d.doc_type)) {
      // sales order / invoice: bill + bank account(s) with QR in the mail body, and the bill PDF (bank + QR printed on it) attached
      const { docPdfBytes, pdfName } = await import('../../routes/accounts/docs.js');
      const { block, files } = await bankEmail(d);
      const html = (text ? `<p>${esc(text).replace(/\n/g, '<br>')}</p>` : '') + docHtml(d, c).replace('<p style="color:#666">Sent by', `${block}<p style="color:#666">Sent by`);
      await sendEmail(target, subject, html,
        [{ filename: pdfName(d), content: await docPdfBytes(d, user), contentType: 'application/pdf' }, ...files]);
    } else if (channel === 'email') {
      await sendEmail(target, subject, text ? `<p>${esc(text).replace(/\n/g, '<br>')}</p>${docHtml(d, c)}` : docHtml(d, c));
    } else {
      await sendWhatsapp(target, text || docText(d, c));
    }
    await log(channel, d.id, d.party_id, target, subject, 'sent', null, user);
  } catch (e) {
    await log(channel, d.id, d.party_id, target, subject, 'failed', e.message, user).catch(() => {});
    throw e;
  }
}

/** Email a Payment / Receipt voucher (receipt-style HTML). `to` overrides the party ledger's saved email. Logged in acc_notifications. */
export async function sendVoucher(v, user, to = null, text = null) {
  const c = await company();
  const isRv = v.vtype === 'RV';
  const title = isRv ? 'Receipt' : 'Payment Voucher';
  const subject = `${title} ${v.voucher_no} — ${c.name}`;
  const target = String(to || '').trim() || v.party_email;
  try {
    if (!target) bad(`${v.party_name || 'This party'} has no email saved. Type an address, or add it to the ledger.`);
    const rows = v.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.account)}${l.note ? `<br><small>${esc(l.note)}</small>` : ''}</td>`
      + `<td align=right>${Number(l.dr) ? nepMoney(l.dr) : ''}</td><td align=right>${Number(l.cr) ? nepMoney(l.cr) : ''}</td></tr>`).join('');
    const lead = text ? `<p>${esc(text).replace(/\n/g, '<br>')}</p>` : `<p>Namaste ${esc(v.party_name || '')},<br>${isRv
      ? `We acknowledge with thanks the receipt of <b>Rs ${nepMoney(v.amount)}</b>.`
      : `We have made a payment of <b>Rs ${nepMoney(v.amount)}</b> to you.`}</p>`;
    const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#111">
<h2 style="margin:0">${esc(c.name)}</h2><div>${esc(c.address || '')}${c.pan ? ` · PAN ${esc(c.pan)}` : ''}</div>${lead}
<h3>${title} ${esc(v.voucher_no)}</h3>
<p>Miti: ${bsStr(v.vdate)} (${String(v.vdate).slice(0, 10)})${v.reference ? `<br>Ref: ${esc(v.reference)}` : ''}</p>
<table cellpadding=6 cellspacing=0 border=1 style="border-collapse:collapse;border-color:#ddd">
<tr style="background:#efefef"><th>S.N.</th><th>Particulars</th><th>Debit</th><th>Credit</th></tr>${rows}
<tr><td colspan=2 align=right><b>Total</b></td><td align=right><b>${nepMoney(v.amount)}</b></td><td align=right><b>${nepMoney(v.amount)}</b></td></tr></table>
${v.narration ? `<p><i>Narration:</i> ${esc(v.narration)}</p>` : ''}<p style="color:#666">Sent by eHajiri Accounts.</p></div>`;
    await sendEmail(target, subject, html);
    await log('email', null, v.party_id, target, subject, 'sent', null, user);
  } catch (e) {
    await log('email', null, v.party_id, target, subject, 'failed', e.message, user).catch(() => {});
    throw e;
  }
}

/** After saving a sales invoice / purchase bill: send in the background if turned on. */
export function autoSend(d, user) {
  (async () => {
    const c = await company();
    const key = { SI: 'si', PB: 'pb' }[d.doc_type];
    if (!key || !d.party_id) return;
    const jobs = [['email', c[`auto_email_${key}`]], ['whatsapp', c[`auto_wa_${key}`]]].filter(([, on]) => on).map(([ch]) => ch);
    for (const ch of jobs) { try { await sendDoc(d, ch, user); } catch { /* logged in acc_notifications */ } }
  })().catch(() => {});
}
