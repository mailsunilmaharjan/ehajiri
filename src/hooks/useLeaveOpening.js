import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/client.js';

// Live source of truth for "Leave Calculation" opening figures (Current Year
// Leave Opening / Previous Year Opening tabs). Used to live only in browser
// localStorage (ls_leaveOpening) — saved on one PC, invisible everywhere
// else, including an employee's own Apply for Leave balance check on a
// different login. Now backed by the leave_openings table; shaped as
// { [fyKey]: { [employeeId]: { [leaveTypeShort]: days } } } to match what
// every consumer already expects.
export default function useLeaveOpening() {
  const [opening, setOpeningState] = useState({});
  const [loaded, setLoaded] = useState(false);
  const openingRef = useRef({});

  const refresh = useCallback(() => {
    return api.get('/leaves/openings').then(data => {
      openingRef.current = data || {};
      setOpeningState(data || {});
    }).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Applies `next` locally (optimistic) and pushes only the cells that
  // actually changed within `touchedFyKeys` (defaults to every key in
  // `next`) to the server — a cell present in the old state but missing from
  // the new one is sent as an explicit delete, not just silently dropped.
  const saveOpening = useCallback((next, touchedFyKeys) => {
    const prev = openingRef.current;
    const entries = [];
    (touchedFyKeys || Object.keys(next)).forEach(fyKey => {
      const oldFy = prev[fyKey] || {};
      const newFy = next[fyKey] || {};
      const empIds = new Set([...Object.keys(oldFy), ...Object.keys(newFy)]);
      empIds.forEach(empId => {
        const oldEmp = oldFy[empId] || {};
        const newEmp = newFy[empId] || {};
        const ltKeys = new Set([...Object.keys(oldEmp), ...Object.keys(newEmp)]);
        ltKeys.forEach(lt => {
          const oldV = oldEmp[lt];
          const newV = newEmp[lt];
          if (oldV !== newV) {
            entries.push({ fyKey, employeeId: Number(empId), leaveTypeShort: lt, days: newV === undefined ? null : newV });
          }
        });
      });
    });
    openingRef.current = next;
    setOpeningState(next);
    if (!entries.length) return Promise.resolve();
    // Roll back the optimistic update if the server rejects it, so the grid
    // never shows figures that were never actually saved.
    return api.put('/leaves/openings', { entries }).catch(err => {
      openingRef.current = prev;
      setOpeningState(prev);
      throw err;
    });
  }, []);

  return { opening, loaded, refresh, saveOpening };
}
