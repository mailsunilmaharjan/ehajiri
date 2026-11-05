# eHajiri — Google Play submission drafts

App id: `com.zkattendance.ehajiri` · version 1.1.0 (code 2) · permissions: INTERNET, FINE/COARSE LOCATION, POST_NOTIFICATIONS
Plugins: biometric auth + secure storage, geolocation, push notifications.

Replace `[COMPANY NAME]`, `[SUPPORT EMAIL]`, `[POLICY URL]` before use. Host the privacy policy on a public web page and paste its URL in Play Console.

---

## Store listing

**App name:** eHajiri

**Short description (80 chars):**
Staff attendance, leave and office visit requests from your phone.

**Full description:**
eHajiri is the mobile companion to your organization's eHajiri attendance system.

• Check in and check out with GPS-verified Online Attendance
• Apply for leave, office visits (field / काज भ्रमण) and late / early requests
• Track the status of your requests (pending, recommended, approved)
• Approvers can recommend or approve requests in one place
• View your monthly attendance, in/out times, late and early days, overtime and duty roster
• Staff directory, contacts, tasks and notices
• Push notifications for approvals and announcements
• Sign in with fingerprint or face
• Available in English and Nepali (नेपाली)

An account created by your organization is required. Contact your administrator to get your login.

---

## Privacy policy (draft)

**eHajiri Privacy Policy** — last updated [DATE]

[Planet Infosys Pvt.Ltd.] ("we") provides the eHajiri app for organizations to manage staff attendance. This policy explains what the app collects and why.

**Who controls the data.** Your employer (the organization that gave you an account) controls the attendance data entered about you. We process it on its behalf. Questions about your records should go to your organization's administrator.

**What we collect**
- *Account information:* name, username or email, employee details your organization enters (department, designation, photo, phone).
- *Attendance data:* check-in and check-out times, leave, office visit and late/early requests, tasks, messages and notes you submit.
- *Location:* precise location is read only when you use Online Attendance (check in / check out) or a field-visit journey, to confirm where the punch happened. It is not collected when you are not using these features. [Edit if journey tracking runs in the background.]
- *Device and notification data:* a push notification token so we can send you approval and announcement alerts.
- *Biometrics:* fingerprint / face sign-in is handled by your phone's operating system. We never receive or store your fingerprint or face data. If you enable it, your password is stored encrypted on your phone only.

**How we use it.** To record and report attendance, process requests and approvals, send notifications, and keep your account secure. We do not sell your data and do not use it for advertising.

**Sharing.** Data is visible to your organization's authorized users (for example your supervisor and administrators) according to their role. Notifications are delivered through Google Firebase Cloud Messaging. We do not share data with other third parties except as required by law.

**Security.** Data is sent over HTTPS and stored on servers we control. Access is limited by login and role.

**Retention and deletion.** Data is kept while your organization uses eHajiri. To request access, correction or deletion, contact your organization's administrator or [SUPPORT EMAIL]. Account deletion requests are handled with your organization, since attendance records may be required for its legal or payroll purposes.

**Children.** The app is for employees and is not directed at children.

**Changes.** We will update this page and its date if the policy changes.

**Contact:** [SUPPORT EMAIL]

---

## Data safety form answers

| Question | Answer |
|---|---|
| Does the app collect or share user data? | Collects: Yes. Shares with third parties: No (Firebase push is a service provider processing for us — declare it as such if the form asks) |
| Is data encrypted in transit? | Yes (HTTPS) |
| Can users request data deletion? | Yes — via organization admin / [SUPPORT EMAIL]. Provide the same URL in the "delete account" field |

Data types to declare (all: collected, **not** sold, required for app function; purposes: App functionality, Account management):

| Category | Types | Optional? |
|---|---|---|
| Personal info | Name, Email address, Phone number, User IDs | Required |
| Location | Approximate location, Precise location | Required for Online Attendance feature |
| Photos and videos | Photos (profile / request attachments, only if the app lets users upload them) | Optional |
| Messages | Other in-app messages | Optional |
| App activity | Other user-generated content (requests, tasks, notes) | Required |
| Device or other IDs | Device ID / push token | Required for notifications |

Not collected: financial info, health, contacts list, audio, browsing history, calendar.

---

## Other console declarations

- **Location permission declaration:** "Location is used only when the user taps Check In / Check Out in Online Attendance (and during an active field-visit journey) to verify the punch is at an allowed place. Foreground use only." [If journeys track in the background, Google requires a video and extra justification — confirm before submitting.]
- **Content rating:** questionnaire → no violence/sexual/gambling content → expect "Everyone".
- **Target audience:** 18+.
- **Ads:** No ads.
- **App access (reviewer login):** give a demo tenant username/password with all four request types available. Without it Google will reject for "can't sign in".
- **Review note:** "Native Android app with GPS check-in, push notifications and biometric sign-in; it connects to the customer's eHajiri server for staff attendance."
