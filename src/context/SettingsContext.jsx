import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import api from '../api/client.js';
import { useAuth } from './AuthContext.jsx';
import { useLanguage } from './LanguageContext.jsx';
import { getNepalNow, getNepalTodayISO } from '../utils/dateUtils.js';

const SettingsContext = createContext(null);

// Compute once at module load — fresh install defaults
const _today = getNepalTodayISO();
const _twoMonthsAgo = (() => {
  const d = getNepalNow();
  d.setMonth(d.getMonth() - 2);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

// Placeholder-only — every tenant now gets its real company info pushed into
// app_settings at creation (LicenseAdmin's pushCompanyInfoToTenant) and loaded
// from there once /api/settings (post-login) or /api/auth/branding
// (pre-login) resolves. These generic values are what shows only in the
// brief window before that fetch completes, or if it genuinely fails — never
// a specific other real tenant's identity, which is what used to be here.
const DEFAULT_SETTINGS = {
  companyNameNp    : 'ईहाजिरी',
  companyNameEn    : 'eHajiri',
  companyAddressNp : '',
  companyAddressEn : '',
  companyPhone     : '',
  companyEmail     : '',
  companyWebsite   : '',
  companyEmailDomain: '',
  companyLogo      : null,
  logoWidth        : null,
  logoHeight       : null,
  liveAttendanceNotifications: false, // Off by default for a fresh tenant/DB — Super Admin opts in (Company Edit modal)
  taskNotifications: false, // Off by default for a fresh tenant/DB — Super Admin opts in (Company Edit modal)
  timeOutMinGapMinutes: 0, // Company Edit modal — punches this close to the first one never count as Time Out (0 = off)
  defaultWeekends  : ['Sat'],
  weekendStartDate : _twoMonthsAgo,
  weekendHistory   : [{ id:1, weekends:['Sat'], effectiveDate:_twoMonthsAgo, changedDate:_today, changedBy:'System', reason:'Initial Setup' }],
  defaultCalendar  : 'np',
  defaultDateFormat: 'dd-MMM-yyyy',
  nepaliDigits     : false,
  defaultLanguage  : 'en', // fallback display language for a browser that has never had one explicitly chosen — see LanguageContext.jsx's applyTenantDefault
  reportDateRangeEnabled: false, // On = Monthly reports show an optional From Date -> To Date range (Settings -> Date)
  leaveBackdateEnabled: true, // Off = block picking a past From Date on Leave/Office Visit apply (Super Admin only)
  recoApprovalCompulsory: false, // On = Leave/Office Visit approve button stays disabled until the assigned recommendator has recommended first (Staff Detail → Set Recommendator & Approval)
  fiscalYears      : [
    { id:1, name:'FY 2081/082', startDate:'2024-07-17', endDate:'2025-07-15', isDefault:false, isSystem:false },
    { id:2, name:'FY 2082/083', startDate:'2025-07-16', endDate:'2026-07-15', isDefault:true,  isSystem:false },
  ],
  branches     : [],
  departments  : [{ id:1, name:'Administration', shortName:'Admin', rankingOrder:1, isDefault:true, isSystem:true }],
  posts        : [{ id:1, name:'General Manager', shortName:'GM', rankingOrder:1, isDefault:true, isSystem:true }],
  grades       : [
    { id:1, name:'Grade A', rankingOrder:1, isDefault:true,  isSystem:true },
    { id:2, name:'Grade B', rankingOrder:2, isDefault:false, isSystem:true },
    { id:3, name:'Grade C', rankingOrder:3, isDefault:false, isSystem:true },
    { id:4, name:'Grade D', rankingOrder:4, isDefault:false, isSystem:true },
  ],
  modes        : [{ id:1, name:'Permanent', isDefault:true, isSystem:true }, { id:2, name:'Temporary', isDefault:false, isSystem:false }, { id:3, name:'Contract', isDefault:false, isSystem:false }],
  religions    : [
    { id:1, name:'Hindu',     isDefault:true,  isSystem:true },
    { id:2, name:'Buddhist',  isDefault:false, isSystem:true },
    { id:3, name:'Muslim',    isDefault:false, isSystem:true },
    { id:4, name:'Kirat',     isDefault:false, isSystem:true },
    { id:5, name:'Christian', isDefault:false, isSystem:true },
    { id:6, name:'Sikh',      isDefault:false, isSystem:true },
    { id:7, name:'Jain',      isDefault:false, isSystem:true },
    { id:8, name:'Bon',       isDefault:false, isSystem:true },
  ],
  statuses     : [
    { id:1, name:'Active',              statusType:'Working',     isDefault:true,  isSystem:true },
    { id:2, name:'Resignation',         statusType:'Not Working', isDefault:false, isSystem:true },
    { id:3, name:'Termination',         statusType:'Not Working', isDefault:false, isSystem:true },
    { id:4, name:'Transfer',            statusType:'Not Working', isDefault:false, isSystem:true },
    { id:5, name:'Death',               statusType:'Not Working', isDefault:false, isSystem:true },
    { id:6, name:'Left without Inform', statusType:'Not Working', isDefault:false, isSystem:true },
  ],
  jobTimings   : [{ id:1, name:'Full Time', isDefault:true, isSystem:true }, { id:2, name:'Part Time', isDefault:false, isSystem:true }],

  /* ── Leave Type Configuration ── */
  leaveTypeConfigs: [
    { id:1, name:'Annual Leave', shortName:'AL', daysPerYear:20, reduceWeekend:false, reducePublicHoliday:false, provideOnlyOnBalance:false, genderFor:['All'], modeFor:['All'], carryForward:true, maxAccumulateDays:30, isServicePeriod:false, timesPerService:null, autoAccumulate:false },
    { id:2, name:'Sick Leave',   shortName:'SL', daysPerYear:12, reduceWeekend:false, reducePublicHoliday:false, provideOnlyOnBalance:true,  genderFor:['All'], modeFor:['All'], carryForward:false,maxAccumulateDays:null,isServicePeriod:false, timesPerService:null, autoAccumulate:false },
    { id:3, name:'Casual Leave', shortName:'CL', daysPerYear:6,  reduceWeekend:false, reducePublicHoliday:false, provideOnlyOnBalance:true,  genderFor:['All'], modeFor:['All'], carryForward:false,maxAccumulateDays:null,isServicePeriod:false, timesPerService:null, autoAccumulate:false },
  ],

  /* ── Office Visit Types ── */
  officeVisitTypes: [
    { id:1, name:'Field Visit',   shortName:'FV' },
    { id:2, name:'Client Meeting',shortName:'CM' },
  ],

  /* ── Public Holidays ── */
  publicHolidays: [],
};

// NOTE: no localStorage persistence for settings — see DataContext.jsx's
// identical note. This app is multi-tenant on one shared origin (every
// tenant differs only by a /t/<slug>/ path prefix), so a cached
// `app_settings` blob in localStorage isn't scoped per tenant: viewing
// Tenant A then Tenant B in the same browser showed Tenant B's page with
// Tenant A's company name/logo/leave types/etc. until the real fetch below
// resolved and overwrote it (and reset()/persist() writes further re-primed
// that same stale-across-tenants cache). State is always exactly whatever
// the live API for the CURRENT tenant returns, or DEFAULT_SETTINGS's
// generic placeholders in the brief window before that (or if it fails).

export const SettingsProvider = ({ children }) => {
  const { currentUser } = useAuth();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [apiOk, setApiOk] = useState(false);

  /* Re-fetches /settings and applies it to state. Used both on login below
     and on-demand (e.g. by an apply-leave/apply-office-visit modal right as
     it opens) — this app only ever fetches settings once per login, so a
     session left open across a Super Admin toggling something like
     Leave/Visit backdating would otherwise keep enforcing whatever was true
     when this tab last loaded, not the current server value, until the page
     is refreshed. */
  const refreshSettings = useCallback(async () => {
    if (!currentUser) return;
    try {
      const remoteSettings = await api.get('/settings');
      if (remoteSettings.main) {
        setSettings({ ...DEFAULT_SETTINGS, ...remoteSettings.main });
        setApiOk(true);
      }
    } catch {
      setApiOk(false);
    }
  }, [currentUser]);

  /* ── Load settings from DB on login (and on startup for an already
     logged-in session). /api/settings is authGuarded, so fetching while
     logged out 401s — which not only left the defaults showing, it left
     apiOk stuck false so persist() never wrote changes back to the DB. ── */
  useEffect(() => { refreshSettings(); }, [currentUser?.id]);

  /* ── Pre-login branding (Login page only). Matters most on the shared hub
     (attend.zkattendance.com), where every company's staff land on the same
     login page before it's known which tenant they belong to — without this,
     the page has no way to know whose name/logo to show and always fell back
     to DEFAULT_SETTINGS, which used to hardcode a specific real company. Only
     runs while logged out; the authenticated fetch above takes over on login
     and is authoritative for everything else. ── */
  useEffect(() => {
    if (currentUser) return;
    api.get('/auth/branding').then(branding => {
      if (branding && (branding.companyNameEn || branding.companyLogo)) {
        setSettings(prev => ({ ...prev, ...branding }));
      }
    }).catch(() => {});
  }, [currentUser]);

  // `updater` receives the server's CURRENT state (re-fetched right here, not
  // this tab's possibly-hours-stale React state) and returns the new value to
  // save — every save is a full-blob PUT (see server/routes/settings.js),
  // so building it from anything less than fresh data means whatever OTHER
  // field(s) changed server-side since this tab last loaded (another tab's
  // edit, a script, anything) get silently reverted by this save. This was
  // confirmed live: editing Branches from a stale tab wiped out Posts that
  // had been added directly afterward, because the stale tab's cached
  // `settings.posts` rode along in the "unchanged" fields of that save.
  const persist = useCallback(async (updater) => {
    let base = settings;
    if (apiOk) {
      try {
        const fresh = await api.get('/settings');
        if (fresh.main) base = { ...DEFAULT_SETTINGS, ...fresh.main };
      } catch { /* refetch failed — fall back to this tab's local state */ }
    }
    const next = updater(base);
    setSettings(next);
    if (apiOk) {
      await api.put('/settings', { main: next }).catch(() => {});
    }
    return next;
  }, [apiOk, settings]);

  const updateSettings = useCallback((patch) => persist(base => ({ ...base, ...patch })), [persist]);

  // `items` may be a function of the current (freshly refetched) list.
  const updateSetupList = useCallback((key, items) => persist(base => ({
    ...base, [key]: typeof items === 'function' ? items(base[key]) : items,
  })), [persist]);

  // weekend_history is a dedicated table, not part of the generic app_settings
  // blob — every attendance report resolves weekends by querying it directly
  // (WHERE effective_date <= :date ORDER BY effective_date DESC LIMIT 1), so
  // an entry that only ever lived in the blob (via persist()) was invisible
  // to every report no matter how many times it was "saved" here. These two
  // write through to /settings/weekendHistory (backed by that table) the same
  // way addLeave/updateLeave write through to their own dedicated tables.
  //
  // Unlike updateSettings/updateSetupList above, these are NOT optimistic —
  // this data drives every attendance report's Present/Absent/Weekend
  // classification, so a save that only ever lands in local React state (API
  // unreachable, a validation error, etc.) must never be allowed to look like
  // it succeeded. The caller awaits and must catch: on failure, nothing is
  // applied locally and the error propagates so the UI can tell the user the
  // save didn't happen, instead of showing a false "success" that reports
  // then silently never reflect.
  const addWeekendHistory = useCallback(async (entry) => {
    if (!apiOk) throw new Error('Not connected to the server — weekend setting was not saved.');
    const changedDate = getNepalTodayISO();
    const saved = await api.post('/settings/weekendHistory', { ...entry, changedDate });
    setSettings(prev => ({
      ...prev,
      defaultWeekends : entry.weekends,
      weekendStartDate: entry.effectiveDate,
      weekendHistory  : [...(prev.weekendHistory || []), saved],
    }));
  }, [apiOk]);

  const updateWeekendHistory = useCallback(async (id, entry) => {
    if (!apiOk) throw new Error('Not connected to the server — weekend setting was not saved.');
    // changedDate/changedBy must be resent on every edit, same as addWeekendHistory —
    // the generic PUT route overwrites every column in cfg.cols with whatever
    // the request sends (defaulting anything missing to NULL), so omitting
    // these here was silently wiping "Changed On"/"Changed By" on every edit.
    const changedDate = getNepalTodayISO();
    const saved = await api.put(`/settings/weekendHistory/${id}`, { ...entry, changedDate });
    setSettings(prev => ({
      ...prev,
      defaultWeekends : entry.weekends,
      weekendStartDate: entry.effectiveDate,
      weekendHistory  : (prev.weekendHistory || []).map(h => h.id === id ? { ...h, ...saved } : h),
    }));
  }, [apiOk]);

  const deleteWeekendHistory = useCallback(async (id) => {
    await persist(base => ({ ...base, weekendHistory: (base.weekendHistory || []).filter(h => h.id !== id) }));
    if (apiOk) {
      try { await api.delete(`/settings/weekendHistory/${id}`); }
      catch { /* API failed (e.g. local-only ID not in DB) — optimistic removal already applied */ }
    }
  }, [persist, apiOk]);

  const resetSettings = () => {
    setSettings(DEFAULT_SETTINGS);
    if (apiOk) api.put('/settings', { main: DEFAULT_SETTINGS }).catch(() => {});
  };

  const getCompanyName = (language) =>
    language === 'np' ? settings.companyNameNp : settings.companyNameEn;

  /* Propagate Company Setting's "Default Language" to anyone who hasn't
     picked their own — see LanguageContext.jsx's applyTenantDefault for why
     this only takes effect pre-choice, and only once real settings (not the
     DEFAULT_SETTINGS placeholder) have loaded for this tenant. */
  const { applyTenantDefault } = useLanguage();
  useEffect(() => {
    if (apiOk) applyTenantDefault(settings.defaultLanguage);
  }, [apiOk, settings.defaultLanguage, applyTenantDefault]);

  return (
    <SettingsContext.Provider value={{
      settings, updateSettings, addWeekendHistory, updateWeekendHistory, deleteWeekendHistory,
      updateSetupList, resetSettings, getCompanyName, apiOk, refreshSettings,
    }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
};

export default SettingsContext;
