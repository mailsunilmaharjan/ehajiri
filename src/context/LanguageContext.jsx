import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import baseTranslations from '../translations/translations.js';

const LanguageContext = createContext(null);

export const LanguageProvider = ({ children }) => {
  const [language, setLanguage] = useState(
    () => localStorage.getItem('app_language') || 'en'
  );
  const [autoTranslate, setAutoTranslate] = useState(
    () => localStorage.getItem('auto_translate') !== 'false'
  );

  /* ── Custom (user-edited) translation overrides, stored in localStorage ── */
  const [customTranslations, setCustomTranslations] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ls_translations_custom') || '{}'); }
    catch { return {}; }
  });

  /* Merged: custom overrides win over the base dictionary */
  const mergedTranslations = useMemo(
    () => ({ ...baseTranslations, ...customTranslations }),
    [customTranslations]
  );

  const t = useCallback((text) => {
    if (!text) return '';
    if (language === 'en') return text;
    if (!autoTranslate) return text;
    return mergedTranslations[text] || text;
  }, [language, autoTranslate, mergedTranslations]);

  const changeLanguage = (lang) => {
    setLanguage(lang);
    localStorage.setItem('app_language', lang);
  };

  const toggleAutoTranslate = (val) => {
    setAutoTranslate(val);
    localStorage.setItem('auto_translate', val);
  };

  /* ── Translation management (used by Language Settings page) ── */

  /** Save / update a single translation override */
  const updateTranslation = (english, nepali) => {
    setCustomTranslations(prev => {
      const next = { ...prev, [english]: nepali };
      localStorage.setItem('ls_translations_custom', JSON.stringify(next));
      return next;
    });
  };

  /** Add a brand-new key (same as update) */
  const addTranslation = (english, nepali) => updateTranslation(english, nepali);

  /** Delete a custom override (reverts key to base-dictionary value) */
  const deleteCustomTranslation = (english) => {
    setCustomTranslations(prev => {
      const next = { ...prev };
      delete next[english];
      localStorage.setItem('ls_translations_custom', JSON.stringify(next));
      return next;
    });
  };

  /** Full merged dictionary — consumed by the Language Settings table */
  const getAllTranslations = () => mergedTranslations;

  /** Raw base dictionary — used to check if an entry is "auto" or "custom" */
  const getBaseTranslations = () => baseTranslations;

  /** Only user-edited overrides */
  const getCustomTranslations = () => customTranslations;

  return (
    <LanguageContext.Provider value={{
      language, t, changeLanguage,
      autoTranslate, toggleAutoTranslate,
      updateTranslation, addTranslation, deleteCustomTranslation,
      getAllTranslations, getBaseTranslations, getCustomTranslations,
    }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
};

export default LanguageContext;
