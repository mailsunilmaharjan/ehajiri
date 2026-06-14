import nodemailer from 'nodemailer';
import pool from '../db.js';

async function getEmailConfig() {
  const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='emailConfig'");
  if (!rows.length) return null;
  try { return typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value; }
  catch { return null; }
}

function createTransporter(cfg) {
  return nodemailer.createTransport({
    host: cfg.smtpHost,
    port: Number(cfg.smtpPort) || 587,
    secure: cfg.secure === true || cfg.secure === 'true' || Number(cfg.smtpPort) === 465,
    auth: { user: cfg.smtpUser, pass: cfg.smtpPass },
    tls: { rejectUnauthorized: false },
  });
}

export async function sendEmail({ to, subject, html, text }) {
  const cfg = await getEmailConfig();
  if (!cfg || !cfg.enabled) return { skipped: true };
  const transporter = createTransporter(cfg);
  const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.fromEmail || cfg.smtpUser}>` : (cfg.fromEmail || cfg.smtpUser);
  const info = await transporter.sendMail({ from, to, subject, html, text });
  return { messageId: info.messageId };
}

export async function sendTestEmail(cfg, testTo) {
  const transporter = createTransporter(cfg);
  const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.fromEmail || cfg.smtpUser}>` : (cfg.fromEmail || cfg.smtpUser);
  const info = await transporter.sendMail({
    from, to: testTo,
    subject: 'eHajiri TMS — Email Setup Test',
    html: `<div style="font-family:sans-serif;padding:20px">
      <h2 style="color:#1a56db">✅ Email Setup Working!</h2>
      <p>Your SMTP configuration for <strong>eHajiri TMS</strong> is working correctly.</p>
      <p style="color:#6b7280;font-size:13px">This is a test message sent from eHajiri Settings → Email Setup.</p>
    </div>`,
  });
  return { messageId: info.messageId };
}

/* ── Template helpers ──────────────────────────────────────── */

export async function sendForgotPassword({ to, fullName, resetLink }) {
  const cfg = await getEmailConfig();
  if (!cfg?.notifications?.forgotPassword) return { skipped: true };
  return sendEmail({
    to, subject: 'eHajiri TMS — Password Reset Request',
    html: `<div style="font-family:sans-serif;padding:24px;max-width:480px">
      <h2 style="color:#1a56db">Password Reset Request</h2>
      <p>Hello <strong>${fullName}</strong>,</p>
      <p>We received a request to reset your eHajiri TMS password. Click the button below to set a new password:</p>
      <div style="text-align:center;margin:24px 0">
        <a href="${resetLink}"
           style="background:#1a56db;color:#fff;padding:12px 28px;border-radius:8px;
                  text-decoration:none;font-weight:700;font-size:14px;display:inline-block">
          Reset My Password
        </a>
      </div>
      <p style="color:#6b7280;font-size:12px">This link expires in <strong>1 hour</strong>. If you did not request a password reset, ignore this email — your password will remain unchanged.</p>
      <p style="color:#94a3b8;font-size:11px;word-break:break-all">Or paste this link in your browser:<br>${resetLink}</p>
    </div>`,
  });
}

export async function sendPasswordReset({ to, fullName, newPassword }) {
  const cfg = await getEmailConfig();
  if (!cfg?.notifications?.resetPassword) return { skipped: true };
  return sendEmail({
    to, subject: 'eHajiri TMS — Your Password Has Been Reset',
    html: `<div style="font-family:sans-serif;padding:24px;max-width:480px">
      <h2 style="color:#1a56db">Password Reset</h2>
      <p>Hello <strong>${fullName}</strong>,</p>
      <p>Your eHajiri TMS login password has been reset by an administrator.</p>
      <div style="background:#f3f4f6;padding:14px;border-radius:8px;margin:16px 0">
        <strong>New Password:</strong> <code style="font-size:16px">${newPassword}</code>
      </div>
      <p>Please log in and change your password immediately.</p>
    </div>`,
  });
}

export async function sendLeaveApplication({ to, fullName, leaveType, fromDate, toDate, days, reason }) {
  const cfg = await getEmailConfig();
  if (!cfg?.notifications?.leaveApplication) return { skipped: true };
  return sendEmail({
    to, subject: `eHajiri TMS — Leave Application: ${fullName}`,
    html: `<div style="font-family:sans-serif;padding:24px;max-width:480px">
      <h2 style="color:#1a56db">Leave Application</h2>
      <p><strong>${fullName}</strong> has submitted a leave application.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:12px">
        <tr><td style="padding:6px 0;color:#6b7280">Leave Type</td><td><strong>${leaveType}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">From</td><td><strong>${fromDate}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">To</td><td><strong>${toDate}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Days</td><td><strong>${days}</strong></td></tr>
        ${reason ? `<tr><td style="padding:6px 0;color:#6b7280">Reason</td><td>${reason}</td></tr>` : ''}
      </table>
      <p style="color:#6b7280;font-size:12px;margin-top:16px">Please log in to eHajiri TMS to approve or reject this application.</p>
    </div>`,
  });
}

export async function sendOfficeVisitApplication({ to, fullName, destination, fromDate, toDate, purpose }) {
  const cfg = await getEmailConfig();
  if (!cfg?.notifications?.officeVisitApplication) return { skipped: true };
  return sendEmail({
    to, subject: `eHajiri TMS — Office Visit Application: ${fullName}`,
    html: `<div style="font-family:sans-serif;padding:24px;max-width:480px">
      <h2 style="color:#1a56db">Office Visit Application</h2>
      <p><strong>${fullName}</strong> has submitted an office visit application.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:12px">
        <tr><td style="padding:6px 0;color:#6b7280">Destination</td><td><strong>${destination || '—'}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">From</td><td><strong>${fromDate}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">To</td><td><strong>${toDate}</strong></td></tr>
        ${purpose ? `<tr><td style="padding:6px 0;color:#6b7280">Purpose</td><td>${purpose}</td></tr>` : ''}
      </table>
      <p style="color:#6b7280;font-size:12px;margin-top:16px">Please log in to eHajiri TMS to approve or reject this application.</p>
    </div>`,
  });
}

export async function sendStaffCreated({ to, fullName, username, password, role, loginUrl }) {
  const cfg = await getEmailConfig();
  if (!cfg?.notifications?.staffCreated) return { skipped: true };
  return sendEmail({
    to, subject: 'eHajiri TMS — Your Account Has Been Created',
    html: `<div style="font-family:sans-serif;padding:24px;max-width:480px">
      <h2 style="color:#1a56db">Welcome to eHajiri TMS</h2>
      <p>Hello <strong>${fullName}</strong>,</p>
      <p>Your eHajiri TMS account has been created. Here are your login credentials:</p>
      <div style="background:#f3f4f6;padding:16px;border-radius:8px;margin:16px 0">
        <div style="margin-bottom:8px"><span style="color:#6b7280">Username:</span> <strong>${username}</strong></div>
        <div style="margin-bottom:8px"><span style="color:#6b7280">Password:</span> <strong>${password}</strong></div>
        ${loginUrl ? `<div><span style="color:#6b7280">Login URL:</span> <a href="${loginUrl}" style="color:#1a56db">${loginUrl}</a></div>` : ''}
      </div>
      <p>Please log in and change your password after first login.</p>
      <p style="color:#6b7280;font-size:12px">Role: ${role}</p>
    </div>`,
  });
}
