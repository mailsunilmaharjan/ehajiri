import React, { createContext, useContext, useState, useCallback } from 'react';

const MissingAttendanceApplyContext = createContext(null);

export const MissingAttendanceApplyProvider = ({ children }) => {
  const [isOpen,           setIsOpen]           = useState(false);
  const [targetEmployeeId, setTargetEmployeeId] = useState(null);
  const [targetDate,       setTargetDate]       = useState(null);

  const open  = useCallback((empId = null, date = null) => {
    setTargetEmployeeId(empId);
    setTargetDate(date);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => {
    setTargetEmployeeId(null);
    setTargetDate(null);
    setIsOpen(false);
  }, []);

  return (
    <MissingAttendanceApplyContext.Provider value={{ isOpen, open, close, targetEmployeeId, targetDate }}>
      {children}
    </MissingAttendanceApplyContext.Provider>
  );
};

export const useMissingAttendanceApply = () => {
  const ctx = useContext(MissingAttendanceApplyContext);
  if (!ctx) throw new Error('useMissingAttendanceApply must be used within MissingAttendanceApplyProvider');
  return ctx;
};
