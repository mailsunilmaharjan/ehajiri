import nodemailer from 'nodemailer';
import pool from '../db.js';

export async function getEmailConfig() {
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

export async function sendMissingAttendanceApplication({ to, fullName, date, checkIn, checkOut, reason }) {
  const cfg = await getEmailConfig();
  if (!cfg?.notifications?.missingAttendance) return { skipped: true };
  return sendEmail({
    to, subject: `eHajiri TMS — Missing Attendance Request: ${fullName}`,
    html: `<div style="font-family:sans-serif;padding:24px;max-width:480px">
      <h2 style="color:#1a56db">Missing Attendance Request</h2>
      <p><strong>${fullName}</strong> has submitted a request to record missing attendance.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:12px">
        <tr><td style="padding:6px 0;color:#6b7280">Date</td><td><strong>${date}</strong></td></tr>
        ${checkIn  ? `<tr><td style="padding:6px 0;color:#6b7280">Check In</td><td><strong>${checkIn}</strong></td></tr>`  : ''}
        ${checkOut ? `<tr><td style="padding:6px 0;color:#6b7280">Check Out</td><td><strong>${checkOut}</strong></td></tr>` : ''}
        <tr><td style="padding:6px 0;color:#6b7280">Reason</td><td>${reason}</td></tr>
      </table>
      <p style="color:#6b7280;font-size:12px;margin-top:16px">Please log in to eHajiri TMS to recommend or approve this request.</p>
    </div>`,
  });
}

export async function sendManualPostingApplication({ to, fullName, date, checkIn, checkOut, remark }) {
  const cfg = await getEmailConfig();
  if (!cfg?.notifications?.manualPosting) return { skipped: true };
  return sendEmail({
    to, subject: `eHajiri TMS — Manual Attendance Entry: ${fullName}`,
    html: `<div style="font-family:sans-serif;padding:24px;max-width:480px">
      <h2 style="color:#1a56db">Manual Attendance Entry</h2>
      <p>A manual attendance entry was posted for <strong>${fullName}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:12px">
        <tr><td style="padding:6px 0;color:#6b7280">Date</td><td><strong>${date}</strong></td></tr>
        ${checkIn  ? `<tr><td style="padding:6px 0;color:#6b7280">Check In</td><td><strong>${checkIn}</strong></td></tr>`  : ''}
        ${checkOut ? `<tr><td style="padding:6px 0;color:#6b7280">Check Out</td><td><strong>${checkOut}</strong></td></tr>` : ''}
        ${remark   ? `<tr><td style="padding:6px 0;color:#6b7280">Remark</td><td>${remark}</td></tr>` : ''}
      </table>
      <p style="color:#6b7280;font-size:12px;margin-top:16px">Please log in to eHajiri TMS to review this entry.</p>
    </div>`,
  });
}

/* ── Daily digest row list → HTML table rows ── */
const digestRows = (rows) => rows.map(r => `
  <tr>
    <td style="padding:5px 8px;border-bottom:1px solid #f1f5f9">${r.name}</td>
    <td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;color:#374151">${r.detail || '—'}</td>
  </tr>`).join('');

export async function sendLateInDigest({ to, fullName, isSelf, scopeLabel, date, rows }) {
  const cfg = await getEmailConfig();
  if (!cfg?.notifications?.lateEarlyNotification) return { skipped: true };
  const intro = isSelf
    ? `<p>Hello <strong>${fullName}</strong>, this is a record of your Late In on <strong>${date}</strong>:</p>`
    : `<p>The following staff in <strong>${scopeLabel}</strong> were Late In on <strong>${date}</strong>:</p>`;
  return sendEmail({
    to, subject: `eHajiri TMS — Late In Report: ${date}`,
    html: `<div style="font-family:sans-serif;padding:24px;max-width:520px">
      <h2 style="color:#d97706">⏰ Late In Report</h2>
      ${intro}
      <table style="width:100%;border-collapse:collapse;margin-top:12px">
        <tr><th style="text-align:left;padding:5px 8px;background:#fffbeb;color:#92400e">Name</th>
            <th style="text-align:left;padding:5px 8px;background:#fffbeb;color:#92400e">Detail</th></tr>
        ${digestRows(rows)}
      </table>
    </div>`,
  });
}

export async function sendEarlyOutDigest({ to, fullName, isSelf, scopeLabel, date, rows }) {
  const cfg = await getEmailConfig();
  if (!cfg?.notifications?.lateEarlyNotification) return { skipped: true };
  const intro = isSelf
    ? `<p>Hello <strong>${fullName}</strong>, this is a record of your Early Out on <strong>${date}</strong>:</p>`
    : `<p>The following staff in <strong>${scopeLabel}</strong> left Early on <strong>${date}</strong>:</p>`;
  return sendEmail({
    to, subject: `eHajiri TMS — Early Out Report: ${date}`,
    html: `<div style="font-family:sans-serif;padding:24px;max-width:520px">
      <h2 style="color:#d97706">🚪 Early Out Report</h2>
      ${intro}
      <table style="width:100%;border-collapse:collapse;margin-top:12px">
        <tr><th style="text-align:left;padding:5px 8px;background:#fffbeb;color:#92400e">Name</th>
            <th style="text-align:left;padding:5px 8px;background:#fffbeb;color:#92400e">Detail</th></tr>
        ${digestRows(rows)}
      </table>
    </div>`,
  });
}

export async function sendAbsentDigest({ to, fullName, isSelf, scopeLabel, date, rows }) {
  const cfg = await getEmailConfig();
  if (!cfg?.notifications?.absentNotification) return { skipped: true };
  const intro = isSelf
    ? `<p>Hello <strong>${fullName}</strong>, you were marked <strong>Absent</strong> on <strong>${date}</strong>. If this is incorrect, please submit a Missing Attendance request in eHajiri TMS.</p>`
    : `<p>The following staff in <strong>${scopeLabel}</strong> were <strong>Absent</strong> on <strong>${date}</strong>:</p>`;
  return sendEmail({
    to, subject: `eHajiri TMS — Absence Report: ${date}`,
    html: `<div style="font-family:sans-serif;padding:24px;max-width:520px">
      <h2 style="color:#dc2626">❌ Absence Report</h2>
      ${intro}
      ${!isSelf ? `<table style="width:100%;border-collapse:collapse;margin-top:12px">
        <tr><th style="text-align:left;padding:5px 8px;background:#fef2f2;color:#991b1b">Name</th>
            <th style="text-align:left;padding:5px 8px;background:#fef2f2;color:#991b1b">Detail</th></tr>
        ${digestRows(rows)}
      </table>` : ''}
    </div>`,
  });
}

/* rows: [{ name, detail }] — detail is the upcoming birthday date, e.g. "29-Magh" or an AD date string */
export async function sendBirthdayAlert({ to, fullName, scopeLabel, rows }) {
  const cfg = await getEmailConfig();
  if (!cfg?.notifications?.birthdayNotification) return { skipped: true };
  const intro = rows.length === 1
    ? `<p>Hello <strong>${fullName}</strong>, a heads-up — <strong>${rows[0].name}</strong>'s birthday is coming up on <strong>${rows[0].detail}</strong> (in ${cfg?.birthdayAlertDays || 2} days).</p>`
    : `<p>Hello <strong>${fullName}</strong>, a heads-up — the following staff in <strong>${scopeLabel}</strong> have birthdays coming up:</p>`;
  return sendEmail({
    to, subject: `eHajiri TMS — Upcoming Birthday${rows.length > 1 ? 's' : ''}`,
    html: `<div style="font-family:sans-serif;padding:24px;max-width:520px">
      <h2 style="color:#db2777">🎂 Upcoming Birthday${rows.length > 1 ? 's' : ''}</h2>
      ${intro}
      ${rows.length > 1 ? `<table style="width:100%;border-collapse:collapse;margin-top:12px">
        <tr><th style="text-align:left;padding:5px 8px;background:#fdf2f8;color:#9d174d">Name</th>
            <th style="text-align:left;padding:5px 8px;background:#fdf2f8;color:#9d174d">Date</th></tr>
        ${digestRows(rows)}
      </table>` : ''}
    </div>`,
  });
}

export async function sendLeaveStatusUpdate({ to, fullName, status, leaveType, fromDate, toDate, comment }) {
  const cfg = await getEmailConfig();
  if (!cfg?.notifications?.leaveStatusUpdate) return { skipped: true };
  const isApproved = status === 'approved';
  return sendEmail({
    to, subject: `eHajiri TMS — Leave Application ${isApproved ? 'Approved' : 'Rejected'}`,
    html: `<div style="font-family:sans-serif;padding:24px;max-width:480px">
      <h2 style="color:${isApproved ? '#059669' : '#dc2626'}">Leave Application ${isApproved ? 'Approved ✅' : 'Rejected ✕'}</h2>
      <p>Hello <strong>${fullName}</strong>, your leave application has been <strong>${status}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:12px">
        <tr><td style="padding:6px 0;color:#6b7280">Leave Type</td><td><strong>${leaveType}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">From</td><td><strong>${fromDate}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">To</td><td><strong>${toDate}</strong></td></tr>
        ${comment ? `<tr><td style="padding:6px 0;color:#6b7280">Comment</td><td>${comment}</td></tr>` : ''}
      </table>
    </div>`,
  });
}

export async function sendOfficeVisitStatusUpdate({ to, fullName, status, fromDate, toDate, comment }) {
  const cfg = await getEmailConfig();
  if (!cfg?.notifications?.officeVisitStatusUpdate) return { skipped: true };
  const isApproved = status === 'approved';
  return sendEmail({
    to, subject: `eHajiri TMS — Office Visit Application ${isApproved ? 'Approved' : 'Rejected'}`,
    html: `<div style="font-family:sans-serif;padding:24px;max-width:480px">
      <h2 style="color:${isApproved ? '#059669' : '#dc2626'}">Office Visit Application ${isApproved ? 'Approved ✅' : 'Rejected ✕'}</h2>
      <p>Hello <strong>${fullName}</strong>, your office visit application has been <strong>${status}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:12px">
        <tr><td style="padding:6px 0;color:#6b7280">From</td><td><strong>${fromDate}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">To</td><td><strong>${toDate}</strong></td></tr>
        ${comment ? `<tr><td style="padding:6px 0;color:#6b7280">Comment</td><td>${comment}</td></tr>` : ''}
      </table>
    </div>`,
  });
}

export async function sendTaskAssigned({ to, fullName, taskTitle, by }) {
  const cfg = await getEmailConfig();
  if (!cfg?.notifications?.taskAssignedCompleted) return { skipped: true };
  return sendEmail({
    to, subject: `eHajiri TMS — New Task Assigned: ${taskTitle}`,
    html: `<div style="font-family:sans-serif;padding:24px;max-width:480px">
      <h2 style="color:#1a56db">Task Assigned to You</h2>
      <p>Hello <strong>${fullName}</strong>,</p>
      <p><strong>${by}</strong> assigned you a task:</p>
      <div style="background:#f3f4f6;padding:14px;border-radius:8px;margin:16px 0">
        <strong>${taskTitle}</strong>
      </div>
      <p style="color:#6b7280;font-size:12px">Please log in to eHajiri TMS to view the full details.</p>
    </div>`,
  });
}

export async function sendTaskCompleted({ to, fullName, taskTitle, by }) {
  const cfg = await getEmailConfig();
  if (!cfg?.notifications?.taskAssignedCompleted) return { skipped: true };
  return sendEmail({
    to, subject: `eHajiri TMS — Task Completed: ${taskTitle}`,
    html: `<div style="font-family:sans-serif;padding:24px;max-width:480px">
      <h2 style="color:#16a34a">Task Completed</h2>
      <p>Hello <strong>${fullName}</strong>,</p>
      <p><strong>${by}</strong> marked this task as completed:</p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;padding:14px;border-radius:8px;margin:16px 0">
        <strong>${taskTitle}</strong>
      </div>
      <p style="color:#6b7280;font-size:12px">Please log in to eHajiri TMS to view the full details.</p>
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
