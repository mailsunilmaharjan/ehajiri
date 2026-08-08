import React, { createContext, useContext, useState, useCallback } from 'react';

const ManualPostingApplyContext = createContext(null);

export const ManualPostingApplyProvider = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [prefillDate, setPrefillDate] = useState(null);

  // date: optional single date string — e.g. from selecting a day on My
  // Monthly Calendar, so the form opens with it pre-filled instead of blank.
  const open  = useCallback((date = null) => { setPrefillDate(date); setIsOpen(true); }, []);
  const close = useCallback(() => { setPrefillDate(null); setIsOpen(false); }, []);

  return (
    <ManualPostingApplyContext.Provider value={{ isOpen, open, close, prefillDate }}>
      {children}
    </ManualPostingApplyContext.Provider>
  );
};

export const useManualPostingApply = () => {
  const ctx = useContext(ManualPostingApplyContext);
  if (!ctx) throw new Error('useManualPostingApply must be used within ManualPostingApplyProvider');
  return ctx;
};
