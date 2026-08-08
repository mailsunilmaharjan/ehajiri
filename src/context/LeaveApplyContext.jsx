import React, { createContext, useContext, useState, useCallback } from 'react';

const LeaveApplyContext = createContext(null);

export const LeaveApplyProvider = ({ children }) => {
  const [isOpen,           setIsOpen]           = useState(false);
  const [targetEmployeeId, setTargetEmployeeId] = useState(null);
  const [prefillDates,     setPrefillDates]     = useState(null); // { fromDate, toDate } | null

  // dates: optional { fromDate, toDate } — e.g. from selecting day(s) on
  // My Monthly Calendar, so the form opens with those pre-filled instead of today.
  const open  = useCallback((empId = null, dates = null) => { setTargetEmployeeId(empId); setPrefillDates(dates); setIsOpen(true);  }, []);
  const close = useCallback(()            => { setTargetEmployeeId(null);  setPrefillDates(null); setIsOpen(false); }, []);

  return (
    <LeaveApplyContext.Provider value={{ isOpen, open, close, targetEmployeeId, prefillDates }}>
      {children}
    </LeaveApplyContext.Provider>
  );
};

export const useLeaveApply = () => {
  const ctx = useContext(LeaveApplyContext);
  if (!ctx) throw new Error('useLeaveApply must be used within LeaveApplyProvider');
  return ctx;
};
