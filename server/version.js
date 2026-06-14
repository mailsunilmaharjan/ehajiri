// ══════════════════════════════════════════════
//  eHajiri TMS — Version Registry
//  Bump APP_VERSION on any release.
//  Bump DB_VERSION every time you add a migration.
// ══════════════════════════════════════════════

export const APP_VERSION = '1.0.0';
export const DB_VERSION  = 43;

/** Human-readable changelog shown in the UI */
export const VERSION_HISTORY = [
  {
    appVersion : '1.0.0',
    dbVersion  : 1,
    releaseDate: '2026-05-27',
    notes      : 'Initial release — PostgreSQL backend, full CRUD, backup & restore',
  },
];
