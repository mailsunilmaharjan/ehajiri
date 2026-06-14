import React, { createContext, useContext, useState, useCallback } from 'react';

const OfficeVisitApplyContext = createContext(null);

export const OfficeVisitApplyProvider = ({ children }) => {
  const [isOpen,           setIsOpen]           = useState(false);
  const [targetEmployeeId, setTargetEmployeeId] = useState(null);

  const open  = useCallback((empId = null) => { setTargetEmployeeId(empId); setIsOpen(true);  }, []);
  const close = useCallback(()            => { setTargetEmployeeId(null);  setIsOpen(false); }, []);

  return (
    <OfficeVisitApplyContext.Provider value={{ isOpen, open, close, targetEmployeeId }}>
      {children}
    </OfficeVisitApplyContext.Provider>
  );
};

export const useOfficeVisitApply = () => {
  const ctx = useContext(OfficeVisitApplyContext);
  if (!ctx) throw new Error('useOfficeVisitApply must be used within OfficeVisitApplyProvider');
  return ctx;
};
