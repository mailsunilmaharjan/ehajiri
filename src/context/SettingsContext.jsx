import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import api from '../api/client.js';

const SettingsContext = createContext(null);

// Compute once at module load — fresh install defaults
const _today = new Date().toISOString().split('T')[0];
const _twoMonthsAgo = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 2);
  return d.toISOString().split('T')[0];
})();

const DEFAULT_SETTINGS = {
  companyNameNp    : 'प्लानेट इन्फोसिस प्रा.लि.',
  companyNameEn    : 'Planet Infosys Pvt. Ltd.',
  companyAddressNp : 'चाकुपाथ, ललितपुर',
  companyAddressEn : 'Chakupath, Lalitpur',
  companyPhone     : '015269837',
  companyEmail     : 'info.planetinfosys@gmail.com',
  companyWebsite   : 'www.planetinfosys.com.np',
  companyLogo      : null,
  logoWidth        : null,
  logoHeight       : null,
  defaultWeekends  : ['Sat'],
  weekendStartDate : _twoMonthsAgo,
  weekendHistory   : [{ id:1, weekends:['Sat'], effectiveDate:_twoMonthsAgo, changedDate:_today, changedBy:'System', reason:'Initial Setup' }],
  defaultCalendar  : 'np',
  defaultDateFormat: 'dd-MMM-yyyy',
  nepaliDigits     : false,
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
    { id:1, name:'Annual Leave', shortName:'AL', daysPerYear:20, reduceWeekend:false, reducePublicHoliday:false, provideOnlyOnBalance:false, genderFor:['All'], modeFor:['All'], carryForward:true, maxAccumulateDays:30, isServicePeriod:false, timesPerService:null, autoAccumulate:true },
    { id:2, name:'Sick Leave',   shortName:'SL', daysPerYear:12, reduceWeekend:false, reducePublicHoliday:false, provideOnlyOnBalance:true,  genderFor:['All'], modeFor:['All'], carryForward:false,maxAccumulateDays:null,isServicePeriod:false, timesPerService:null, autoAccumulate:true },
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

const load = () => {
  try { const s = localStorage.getItem('app_settings'); return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : DEFAULT_SETTINGS; }
  catch { return DEFAULT_SETTINGS; }
};

export const SettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState(load);
  const [apiOk, setApiOk] = useState(false);

  /* ── Load settings from DB on mount ── */
  useEffect(() => {
    api.get('/settings').then(remoteSettings => {
      if (remoteSettings.main) {
        const merged = { ...DEFAULT_SETTINGS, ...remoteSettings.main };
        setSettings(merged);
        localStorage.setItem('app_settings', JSON.stringify(merged));
        setApiOk(true);
      }
    }).catch(() => {
      // Fall back to localStorage already loaded in useState
      setApiOk(false);
    });
  }, []);

  const persist = useCallback((next) => {
    localStorage.setItem('app_settings', JSON.stringify(next));
    if (apiOk) {
      api.put('/settings', { main: next }).catch(() => {});
    }
  }, [apiOk]);

  const updateSettings = useCallback((patch) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      persist(next);
      return next;
    });
  }, [persist]);

  const updateSetupList = useCallback((key, items) => {
    setSettings(prev => {
      const next = { ...prev, [key]: items };
      persist(next);
      return next;
    });
  }, [persist]);

  const addWeekendHistory = useCallback((entry) => {
    setSettings(prev => {
      const newEntry = { id: Date.now(), ...entry, changedDate: new Date().toISOString().split('T')[0] };
      const next = {
        ...prev,
        defaultWeekends : entry.weekends,
        weekendStartDate: entry.effectiveDate,
        weekendHistory  : [...(prev.weekendHistory || []), newEntry],
      };
      persist(next);
      return next;
    });
  }, [persist]);

  const resetSettings = () => {
    setSettings(DEFAULT_SETTINGS);
    localStorage.removeItem('app_settings');
    if (apiOk) api.put('/settings', { main: DEFAULT_SETTINGS }).catch(() => {});
  };

  const getCompanyName = (language) =>
    language === 'np' ? settings.companyNameNp : settings.companyNameEn;

  return (
    <SettingsContext.Provider value={{
      settings, updateSettings, addWeekendHistory, updateSetupList, resetSettings, getCompanyName, apiOk,
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
