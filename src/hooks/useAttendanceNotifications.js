import { useEffect, useRef } from 'react';
import { apiUrl } from '../api/client.js';

/**
 * Connects to the SSE stream at /api/attendance/live and shows
 * browser notifications whenever a ZKTeco punch is received.
 */
export function useAttendanceNotifications() {
  const esRef = useRef(null);

  useEffect(() => {
    // Request permission once
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    const connect = () => {
      const es = new EventSource(apiUrl('/attendance/live'));
      esRef.current = es;

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type !== 'attendance') return;
          showNotification(data);
        } catch (_) {}
      };

      es.onerror = () => {
        es.close();
        // Reconnect after 5 s
        setTimeout(connect, 5000);
      };
    };

    connect();
    return () => { esRef.current?.close(); };
  }, []);
}

function showNotification(data) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const title = data.staffName;
  const lines = [
    data.postShort  ? `Post: ${data.postShort}`     : null,
    data.branchShort? `Branch: ${data.branchShort}` : null,
    `Time IN: ${data.timeIn}`,
    data.remarks    ? data.remarks                   : null,
  ].filter(Boolean);

  const n = new Notification(title, {
    body: lines.join('\n'),
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: `att-${data.employeeId}`,   // replaces previous notification for same employee
    requireInteraction: false,
    silent: false,
  });

  // Auto-close after 8 s
  setTimeout(() => n.close(), 8000);
}
