/**
 * eHajiri TMS — Express API Server
 * Port: 3001 (proxied from Vite on /api)
 */
import express from 'express';
import cors    from 'cors';
import dotenv  from 'dotenv';
dotenv.config();

import { testConnection }  from './db.js';
import { runMigrations }   from './migrator.js';

import employeesRouter   from './routes/employees.js';
import shiftsRouter      from './routes/shifts.js';
import leavesRouter      from './routes/leaves.js';
import visitsRouter      from './routes/officeVisits.js';
import settingsRouter    from './routes/settings.js';
import backupRouter      from './routes/backup.js';
import appInfoRouter     from './routes/appInfo.js';

const app  = express();
const PORT = parseInt(process.env.PORT || '3001');

// ── Middleware ──────────────────────────────────────────────
app.use(cors({ origin: ['http://localhost:4000', 'http://localhost:3000'] }));
app.use(express.json({ limit: '50mb' }));    // large for backup/restore
app.use(express.urlencoded({ extended: true }));

// ── Health ──────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  const db = await testConnection();
  res.json({ status: db ? 'ok' : 'db_error', db, ts: new Date().toISOString() });
});

// ── Routes ──────────────────────────────────────────────────
app.use('/api/employees',    employeesRouter);
app.use('/api/shifts',       shiftsRouter);
app.use('/api/leaves',       leavesRouter);
app.use('/api/office-visits',visitsRouter);
app.use('/api/settings',     settingsRouter);
app.use('/api/backup',       backupRouter);
app.use('/api/app-info',     appInfoRouter);

// ── 404 ─────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Startup ─────────────────────────────────────────────────
(async () => {
  console.log('');
  console.log('🚀 eHajiri TMS — API Server');
  console.log('═══════════════════════════════');

  const dbOk = await testConnection();
  if (!dbOk) {
    console.error('❌ Cannot connect to PostgreSQL. Check .env / DB credentials.');
    console.error('   Continuing in degraded mode (API will return 500 errors).');
  } else {
    console.log('✅ PostgreSQL connected.');
    try {
      await runMigrations();
    } catch (err) {
      console.error('❌ Migration error:', err.message);
      process.exit(1);
    }
  }

  app.listen(PORT, () => {
    console.log(`✅ Server running  → http://localhost:${PORT}`);
    console.log(`   Health check   → http://localhost:${PORT}/api/health`);
    console.log('');
  });
})();
