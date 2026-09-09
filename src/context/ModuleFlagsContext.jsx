import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/client.js';
import { useAuth } from './AuthContext.jsx';

// Every module-flag consumer up to now (EventVisitorRegistration.jsx,
// RoleManagement.jsx, Settings.jsx, GlobalFAB.jsx) does its own independent
// GET /module-flags fetch. This is the first SHARED one — needed so
// Protected (App.jsx) can gate a whole route tree (Duty Roster) on a module
// flag without every one of its 4 page components duplicating that fetch and
// its own "module disabled" empty state.
const ModuleFlagsContext = createContext({ flags: {}, loading: true });

export const ModuleFlagsProvider = ({ children }) => {
  const { currentUser } = useAuth();
  const [flags, setFlags] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) { setFlags({}); setLoading(false); return; }
    api.get('/module-flags')
      .then(setFlags)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ModuleFlagsContext.Provider value={{ flags, loading }}>
      {children}
    </ModuleFlagsContext.Provider>
  );
};

export const useModuleFlags = () => useContext(ModuleFlagsContext);
