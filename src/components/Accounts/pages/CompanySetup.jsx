import { useState } from 'react';
import { useApp } from '../context';
import { Kbd, LastSaved } from '../components/inputs';
import { api } from '../lib/api';
import { useShortcuts } from '../lib/keys';

export default function CompanySetup() {
  const { company, fy, reload, notify, isAdmin } = useApp();
  const [f, setF] = useState({ ...company });
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState({ email: '', whatsapp: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const save = async (e) => {
    e?.preventDefault();
    if (!isAdmin) { notify('Only an admin can change company settings.', 'err'); return; }
    setBusy(true);
    try {
      await api.put('/company', { ...f, vat_rate: Number(f.vat_rate), alert_days: Number(f.alert_days || 0) });
      await reload();
      notify('Company saved');
    } catch (err) { notify(err.message, 'err'); }
    setBusy(false);
  };
  useShortcuts({ save });

  const test = async (channel) => {
    try { await api.post('/notify/test', { channel, to: testTo[channel] }); notify(`Test ${channel} sent`); }
    catch (err) { notify(err.message, 'err'); }
  };

  return (
    <>
      <header className="page-head"><h1>Company Setup</h1>{!isAdmin && <span className="tag">read-only — admin only</span>}</header>
      <form className="card form acc-cardform acc-pageform" onSubmit={save}>
        <div className="acc-card">
          <div className="acc-step"><i>1</i>Company</div>
          <label>Company name<input value={f.name || ''} onChange={set('name')} required /></label>
          <label>Name in Nepali<input value={f.name_np || ''} onChange={set('name_np')} placeholder="कम्पनीको नाम" /></label>
          <label>Address<input value={f.address || ''} onChange={set('address')} /></label>
          <label>Phone<input value={f.phone || ''} onChange={set('phone')} /></label>
          <label>Email<input data-nocap value={f.email || ''} onChange={set('email')} /></label>
          <label>PAN / VAT No.<input value={f.pan || ''} onChange={set('pan')} maxLength={9} inputMode="numeric" placeholder="9 digits" /></label>
          <label className="check"><input type="checkbox" checked={!!f.vat_registered} onChange={set('vat_registered')} /> VAT registered</label>
          <label>VAT rate %<input type="number" step="0.01" value={f.vat_rate} onChange={set('vat_rate')} disabled={!f.vat_registered} /></label>
          <label>Show dates in
            <select value={f.date_display} onChange={set('date_display')}>
              <option value="BS">Nepali (BS)</option><option value="AD">English (AD)</option><option value="Both">Both</option>
            </select>
          </label>
          <div className="info full">Fiscal year <b>{fy.name}</b>: 1 Shrawan to end of Ashadh. New fiscal years are created automatically.</div>
        </div>

        <div className="acc-card">
          <div className="acc-step"><i>2</i>Alerts</div>
          <label>Warn this many days before due / expiry
            <input type="number" min="0" max="90" value={f.alert_days} onChange={set('alert_days')} />
            <small>Bills due (from customer / supplier credit days) and services expiring show in the 🔔 Alerts.</small>
          </label>
        </div>

        <div className="acc-card">
          <div className="acc-step"><i>3</i>Send bills automatically</div>
          <label className="check"><input type="checkbox" checked={!!f.auto_email_si} onChange={set('auto_email_si')} /> Email each Sales Invoice to the customer</label>
          <label className="check"><input type="checkbox" checked={!!f.auto_email_pb} onChange={set('auto_email_pb')} /> Email each Purchase bill to the supplier</label>
          <label className="check"><input type="checkbox" checked={!!f.auto_wa_si} onChange={set('auto_wa_si')} disabled={!f.wa_gateway_url} /> WhatsApp each Sales Invoice</label>
          <label className="check"><input type="checkbox" checked={!!f.auto_wa_pb} onChange={set('auto_wa_pb')} disabled={!f.wa_gateway_url} /> WhatsApp each Purchase bill</label>
        </div>

        {isAdmin && (
          <>
            <div className="acc-card">
              <div className="acc-step"><i>4</i>Email</div>
              <div className="info full">
                Accounts email (quotations, purchase &amp; sales documents, ledger statements) uses the common
                SMTP settings in <b>Settings › 📧 Email Setup</b> — there is no separate Accounts email setup.
                {company.email_ready ? ' ✅ Email is configured.' : ' ⚠ Email is not configured or is disabled — ask a Super Admin to set it up there.'}
              </div>
              <label>Send a test email to
                <span className="inline"><input value={testTo.email} onChange={(e) => setTestTo({ ...testTo, email: e.target.value })} />
                  <button type="button" className="ghost" onClick={() => test('email')}>Test</button></span>
              </label>
            </div>

            <div className="acc-card">
              <div className="acc-step"><i>5</i>WhatsApp gateway</div>
              <label className="full">Gateway URL
                <input data-nocap value={f.wa_gateway_url || ''} onChange={set('wa_gateway_url')} placeholder="https://api.gateway.com/send?token=XXXX&to={phone}&text={message}" />
                <small>Any WhatsApp API provider. {'{phone}'} and {'{message}'} are filled in. Without a gateway, bills still have a “Share on WhatsApp” button.</small>
              </label>
              <label>Method
                <select value={f.wa_method || 'GET'} onChange={set('wa_method')}><option>GET</option><option>POST</option></select>
              </label>
              <label>Send a test message to
                <span className="inline"><input value={testTo.whatsapp} placeholder="98XXXXXXXX" onChange={(e) => setTestTo({ ...testTo, whatsapp: e.target.value })} />
                  <button type="button" className="ghost" onClick={() => test('whatsapp')}>Test</button></span>
              </label>
            </div>

            <div className="acc-card">
              <div className="acc-step"><i>6</i>Data safety</div>
              <div className="info full">
                Accounts data lives in your eHajiri database, so it is covered by Settings › Database Backup.
                Every change and print is in the Audit Trail.
              </div>
            </div>
          </>
        )}
        <LastSaved row={company} />
        <div className="actions"><span className="spacer" />{isAdmin && <button data-save disabled={busy}>Save <Kbd>Ctrl+S</Kbd></button>}</div>
      </form>
    </>
  );
}
