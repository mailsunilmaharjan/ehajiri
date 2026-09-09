// SMS via a phone-as-gateway setup — no cloud SMS provider involved. Talks
// to the "SMS Gateway for Android" app's Local Server API (POST /message,
// HTTP Basic Auth) running on a phone reachable on the same local network as
// this server. See https://github.com/capcom6/android-sms-gateway.
import pool from '../db.js';

export async function getSmsConfig() {
  const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='smsConfig'");
  if (!rows.length) return null;
  try { return typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value; }
  catch { return null; }
}

async function postToGateway(cfg, text, phoneNumbers) {
  const port = Number(cfg.gatewayPort) || 8080;
  const url = `http://${cfg.gatewayHost}:${port}/message`;
  const auth = Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
      body: JSON.stringify({ textMessage: { text }, phoneNumbers }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    throw new Error(`Could not reach the phone gateway at ${cfg.gatewayHost}:${port} — is the phone on the same network and the SMS Gateway app running? (${e.message})`);
  }
  const bodyText = await res.text();
  let body; try { body = JSON.parse(bodyText); } catch { body = bodyText; }
  if (!res.ok) {
    const detail = typeof body === 'string' ? body.slice(0, 200) : (body?.message || JSON.stringify(body).slice(0, 200));
    throw new Error(`Gateway responded ${res.status}: ${detail}`);
  }
  return body;
}

/** Real send — used everywhere in the app that needs to actually deliver an SMS. */
export async function sendSms({ to, text }) {
  const cfg = await getSmsConfig();
  if (!cfg || !cfg.enabled) return { skipped: true };
  if (!cfg.gatewayHost || !cfg.username || !cfg.password) return { skipped: true };
  return postToGateway(cfg, text, [to]);
}

/** Settings → SMS Gateway "Send Test" button — uses whatever config is passed in
 *  (possibly unsaved edits), not necessarily what's already in the DB. */
export async function sendTestSms(cfg, testTo) {
  return postToGateway(cfg, 'eHajiri TMS — SMS Gateway test message. If you received this, your setup is working.', [testTo]);
}
