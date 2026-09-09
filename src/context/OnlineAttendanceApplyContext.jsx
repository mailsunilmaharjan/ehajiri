import React, { createContext, useContext, useState, useCallback } from 'react';

const OnlineAttendanceApplyContext = createContext(null);

export const OnlineAttendanceApplyProvider = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);

  const open  = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return (
    <OnlineAttendanceApplyContext.Provider value={{ isOpen, open, close }}>
      {children}
    </OnlineAttendanceApplyContext.Provider>
  );
};

export const useOnlineAttendanceApply = () => {
  const ctx = useContext(OnlineAttendanceApplyContext);
  if (!ctx) throw new Error('useOnlineAttendanceApply must be used within OnlineAttendanceApplyProvider');
  return ctx;
};
