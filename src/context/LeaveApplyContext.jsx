import React, { createContext, useContext, useState, useCallback } from 'react';

const LeaveApplyContext = createContext(null);

export const LeaveApplyProvider = ({ children }) => {
  const [isOpen,           setIsOpen]           = useState(false);
  const [targetEmployeeId, setTargetEmployeeId] = useState(null);

  const open  = useCallback((empId = null) => { setTargetEmployeeId(empId); setIsOpen(true);  }, []);
  const close = useCallback(()            => { setTargetEmployeeId(null);  setIsOpen(false); }, []);

  return (
    <LeaveApplyContext.Provider value={{ isOpen, open, close, targetEmployeeId }}>
      {children}
    </LeaveApplyContext.Provider>
  );
};

export const useLeaveApply = () => {
  const ctx = useContext(LeaveApplyContext);
  if (!ctx) throw new Error('useLeaveApply must be used within LeaveApplyProvider');
  return ctx;
};
