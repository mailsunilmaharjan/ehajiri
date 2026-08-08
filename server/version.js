// ══════════════════════════════════════════════
//  eHajiri TMS — Version Registry
//  Bump the root package.json's "version" (and the matching $env:APP_VERSION
//  you set before `electron-forge package`, per CLAUDE.md's release steps) on
//  any release — APP_VERSION below is read from it, not hand-maintained here,
//  so the Monitor tray's displayed version can't drift out of sync with what
//  Velopack actually packaged.
//  Bump DB_VERSION every time you add a migration.
// ══════════════════════════════════════════════

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readAppVersion() {
  try {
    // Dev: server/../package.json = repo root. Packaged: resources/server/../package.json
    // = resources/package.json, which forge.config.js ships as an extraResource
    // alongside the server/ folder specifically so this same relative path works
    // unchanged in both cases.
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const APP_VERSION = readAppVersion();
export const DB_VERSION  = 87;

/** Human-readable changelog shown in the UI */
export const VERSION_HISTORY = [
  {
    appVersion : '1.0.0',
    dbVersion  : 1,
    releaseDate: '2026-05-27',
    notes      : 'Initial release — PostgreSQL backend, full CRUD, backup & restore',
  },
  {
    appVersion : '1.0.7',
    dbVersion  : 60,
    releaseDate: '2026-07-02',
    notes      : 'Accurate version/DB-schema reporting on Database Information page and tray monitor (was showing stale version numbers)',
  },
  {
    appVersion : '1.0.8',
    dbVersion  : 61,
    releaseDate: '2026-07-05',
    notes      : 'Missing Attendance Requests (employee self-service, email + in-app notify); automatic daily Late/Early/Absent email digests and Leave/Office Visit status emails; role-scoped Duty Roster and OT Approval (Dept. Head/Branch Manager/self); self-service Profile page for every role; tray updater now waits for a click before installing instead of auto-restarting.',
  },
  {
    appVersion : '1.0.9',
    dbVersion  : 63,
    releaseDate: '2026-07-06',
    notes      : 'Internal Chat (individual & group, online/offline presence, emoji, reply quoting, popup + beep alerts); Outlook-style Messages page with resizing, multi-select, and reply-in-popup; personalized Dashboard for Staff/Branch Manager/Dept Head roles — privacy-safe peer ranking, monthly attendance ledger, duty roster, latest message, pending approvals; app version now always matches the packaged build.',
  },
  {
    appVersion : '1.0.18',
    dbVersion  : 72,
    releaseDate: '2026-07-13',
    notes      : 'Officially Changes tab in User Management — schedule status/branch/post/department/mode/grade transitions with effective dates and full history; fixed staff delete failing silently for users with messages or audit records.',
  },
  {
    appVersion : '1.0.19',
    dbVersion  : 72,
    releaseDate: '2026-07-14',
    notes      : 'Clicking the eHajiri desktop logo while the app is running now opens the application dashboard in the browser instead of the Monitor popup (the Monitor still appears while the server is starting up).',
  },
  {
    appVersion : '1.0.21',
    dbVersion  : 87,
    releaseDate: '2026-08-08',
    notes      : 'Task page: Assign Task is now a multi-select staff checkbox grid (Name/Post/Department/Branch), Description is a rich-text editor, Contact Person picker uses checkboxes; new right-side Followup History panel per task (call/email/WhatsApp/SMS log, next-followup scheduling, hand-over to another staff member).',
  },
  {
    appVersion : '1.0.22',
    dbVersion  : 87,
    releaseDate: '2026-08-08',
    notes      : 'Followup History: double-click a row to edit it, delete (admin/superAdmin only), wider panel with a Task/Followup description footer. Email and WhatsApp followup buttons now open Gmail compose / a WhatsApp chat pre-filled with the linked customer\'s own contact info.',
  },
  {
    appVersion : '1.0.23',
    dbVersion  : 87,
    releaseDate: '2026-08-08',
    notes      : 'Followup History panel restyled with colored section-header cards (Followup History / Description), matching the Company detail panel look.',
  },
  {
    appVersion : '1.0.24',
    dbVersion  : 87,
    releaseDate: '2026-08-08',
    notes      : 'Followup History panel: removed the gap to the task grid, panel now stretches full height, search box moved into the Followup History card header, Description card shows values only (no redundant labels).',
  },
];
