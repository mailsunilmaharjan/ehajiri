import React from 'react';

/* Public privacy policy page (no login) — URL given to Google Play. Keep in step with mobile/PLAY_STORE_LISTING.md. */
const H = { fontSize: 18, margin: '22px 0 6px', color: '#111827' };
const P = { margin: '6px 0', lineHeight: 1.6, color: '#374151' };

export default function PrivacyPolicy() {
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '28px 18px 60px', fontFamily: 'system-ui, Segoe UI, sans-serif' }}>
      <h1 style={{ fontSize: 26, margin: 0 }}>eHajiri Privacy Policy</h1>
      <p style={{ ...P, color: '#6b7280' }}>Last updated: 5 November 2026</p>
      <p style={P}>Planet Infosys Pvt. Ltd. ("we") provides the eHajiri app for organizations to manage staff attendance. This policy explains what the app collects and why.</p>

      <h2 style={H}>Who controls the data</h2>
      <p style={P}>Your employer (the organization that gave you an account) controls the attendance data entered about you. We process it on its behalf. Questions about your records should go to your organization's administrator.</p>

      <h2 style={H}>What we collect</h2>
      <ul style={P}>
        <li><b>Account information:</b> name, username or email, and employee details your organization enters (department, designation, photo, phone).</li>
        <li><b>Attendance data:</b> check-in and check-out times, leave, office visit and late/early requests, tasks, messages and notes you submit.</li>
        <li><b>Location:</b> precise location is read only when you use Online Attendance (check in / check out) or a field-visit journey, to confirm where the punch happened. During a field-visit journey the app also records your route (a location point roughly every 20 to 60 seconds) from the moment you check out of the office until you check in at the office again, to calculate travel time and distance; route points are visible to your organisation's authorised managers and are deleted after 90 days. It is not collected when you are not on a field-visit journey or using these features.</li>
        <li><b>Device and notification data:</b> a push notification token so we can send you approval and announcement alerts.</li>
        <li><b>Biometrics:</b> fingerprint / face sign-in is handled by your phone's operating system. We never receive or store your fingerprint or face data. If you enable it, your password is stored encrypted on your phone only.</li>
      </ul>

      <h2 style={H}>How we use it</h2>
      <p style={P}>To record and report attendance, process requests and approvals, send notifications, and keep your account secure. We do not sell your data and do not use it for advertising.</p>

      <h2 style={H}>Sharing</h2>
      <p style={P}>Data is visible to your organization's authorized users (for example your supervisor and administrators) according to their role. Notifications are delivered through Google Firebase Cloud Messaging. We do not share data with other third parties except as required by law.</p>

      <h2 style={H}>Security</h2>
      <p style={P}>Data is sent over HTTPS and stored on servers we control. Access is limited by login and role.</p>

      <h2 style={H}>Retention and deletion</h2>
      <p style={P}>Data is kept while your organization uses eHajiri. To request access, correction or deletion, contact your organization's administrator or mail.sunilmaharjan@gmail.com. Deletion requests are handled with your organization, since attendance records may be required for its legal or payroll purposes.</p>

      <h2 style={H}>Children</h2>
      <p style={P}>The app is for employees and is not directed at children.</p>

      <h2 style={H}>Changes</h2>
      <p style={P}>We will update this page and its date if the policy changes.</p>

      <h2 style={H}>Contact</h2>
      <p style={P}>Planet Infosys Pvt. Ltd. — mail.sunilmaharjan@gmail.com</p>
    </div>
  );
}
