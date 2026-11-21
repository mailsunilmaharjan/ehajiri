import React, { createContext, useContext, useState, useCallback } from 'react';

const MissingAttendanceApplyContext = createContext(null);

export const MissingAttendanceApplyProvider = ({ children }) => {
  const [isOpen,           setIsOpen]           = useState(false);
  const [targetEmployeeId, setTargetEmployeeId] = useState(null);
  const [targetDate,       setTargetDate]       = useState(null);
  const [targetCheckIn,    setTargetCheckIn]    = useState(''); // existing punch-in (HH:MM) — shown locked in the form

  const open  = useCallback((empId = null, date = null, checkIn = '') => {
    setTargetEmployeeId(empId);
    setTargetDate(date);
    setTargetCheckIn(checkIn || '');
    setIsOpen(true);
  }, []);
  const close = useCallback(() => {
    setTargetEmployeeId(null);
    setTargetDate(null);
    setTargetCheckIn('');
    setIsOpen(false);
  }, []);

  return (
    <MissingAttendanceApplyContext.Provider value={{ isOpen, open, close, targetEmployeeId, targetDate, targetCheckIn }}>
      {children}
    </MissingAttendanceApplyContext.Provider>
  );
};

export const useMissingAttendanceApply = () => {
  const ctx = useContext(MissingAttendanceApplyContext);
  if (!ctx) throw new Error('useMissingAttendanceApply must be used within MissingAttendanceApplyProvider');
  return ctx;
};
