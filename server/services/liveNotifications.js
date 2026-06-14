/**
 * Live Attendance Notification Service
 * Uses Server-Sent Events (SSE) to push real-time punch notifications to connected clients.
 */

const clients = new Set();

/** Register an SSE client. Returns a cleanup function. */
export function registerClient(res) {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const client = { res, id: Date.now() };
  clients.add(client);

  // Heartbeat every 25 s to keep the connection alive
  const hb = setInterval(() => {
    try { res.write('data: {"type":"ping"}\n\n'); } catch (_) {}
  }, 25000);

  return () => {
    clearInterval(hb);
    clients.delete(client);
  };
}

/** Broadcast a notification object to all connected SSE clients. */
export function broadcastNotification(payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients) {
    try { c.res.write(msg); } catch (_) { clients.delete(c); }
  }
}
