/**
 * Production build script with JavaScript obfuscation.
 *
 * What it does:
 *   1. npm run build           (Vite bundles + minifies frontend)
 *   2. Obfuscates all server/*.js files using javascript-obfuscator
 *   3. Outputs to dist-server/ (installer copies this, not raw server/)
 *
 * Install once:
 *   npm install --save-dev javascript-obfuscator
 *
 * Run:
 *   node installer/scripts/obfuscate-build.js
 */

import { execSync }        from 'child_process';
import crypto              from 'crypto';
import fs                  from 'fs';
import path                from 'path';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { fileURLToPath }   from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '../../');
const SRC       = path.join(ROOT, 'server');
const OUT       = path.join(ROOT, 'dist-server');

/* ── Obfuscation options ── */
const OBF_OPTIONS = {
  compact                        : true,
  controlFlowFlattening          : true,
  controlFlowFlatteningThreshold : 0.4,
  deadCodeInjection              : true,
  deadCodeInjectionThreshold     : 0.2,
  identifierNamesGenerator       : 'hexadecimal',
  renameGlobals                  : false,       // keep export names
  selfDefending                  : true,        // resist code tampering
  stringArray                    : true,
  stringArrayEncoding            : ['rc4'],
  stringArrayThreshold           : 0.6,
  transformObjectKeys            : true,
  disableConsoleOutput           : false,       // keep console for logs
};

/* ── Files to skip (SQL, json, .env) ── */
const SKIP_DIRS  = ['node_modules', 'migrations', 'scripts']; // scripts/ runs at install time — obfuscating async installer code is unreliable
const SKIP_FILES = ['.env']; // never ship the developer's local .env — see writeProductionEnv()

/* ── Production .env written to dist-server/ instead of copying the dev .env ──
 * MUST match the credentials server/scripts/setup-db.js provisions and the
 * AppEnvironmentExtra values installer/scripts/install-service.bat injects
 * into the Windows service (the "bundled" branch), so a fresh client install
 * (no pre-existing PostgreSQL) connects on first boot without edits.
 * JWT_SECRET is regenerated on every production build so releases don't all
 * share the developer's personal signing secret. */
function writeProductionEnv(outDir) {
  const env = [
    'NODE_ENV=production',
    'PORT=5000',
    'DB_HOST=localhost',
    'DB_PORT=5432',
    'DB_NAME=ehajiriPlanetInfosys_db',
    'DB_USER=ehajiri',
    'DB_PASS=Eh@jiri2026!@Pl@nE!iNfOsYS',
    'UPDATE_SERVER_URL=https://updates.ehajiri.com',
    `JWT_SECRET=${crypto.randomBytes(32).toString('hex')}`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, '.env'), env);
}

function copyDir(src, dst) {
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.includes(entry.name)) {
        // Copy SQL/data dirs as-is (don't obfuscate)
        fs.cpSync(s, d, { recursive: true });
      } else {
        copyDir(s, d);
      }
    } else if (SKIP_FILES.includes(entry.name)) {
      // handled by writeProductionEnv() after the copy completes
    } else if (entry.name.endsWith('.js') && !SKIP_DIRS.some(sd => s.includes(sd))) {
      // Obfuscate JS files
      const code = fs.readFileSync(s, 'utf8');
      try {
        const result = JavaScriptObfuscator.obfuscate(code, OBF_OPTIONS);
        fs.writeFileSync(d, result.getObfuscatedCode());
        process.stdout.write('.');
      } catch {
        // If obfuscation fails (e.g., ESM edge case), copy as-is
        fs.copyFileSync(s, d);
        process.stdout.write('!');
      }
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

console.log('\n══════════════════════════════════════════════');
console.log('  eHajiri Production Build with Obfuscation');
console.log('══════════════════════════════════════════════\n');

// Step 1: Vite build
console.log('1/3  Building frontend with Vite…');
execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

// Step 2: Obfuscate server
console.log('\n2/3  Obfuscating server code…');
if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true });
copyDir(SRC, OUT);
writeProductionEnv(OUT);
console.log('\n  Done. Wrote production .env (fresh JWT_SECRET, ehajiri/ehajiriPlanetInfosys_db credentials).');

// Step 3: Copy non-JS files
console.log('\n3/3  Copying config files…');
['package.json'].forEach(f => {
  fs.copyFileSync(path.join(ROOT, f), path.join(ROOT, 'dist-server-pkg', f));
});

console.log('\n✅ Build complete!');
console.log('   Frontend:      dist/');
console.log('   Backend (obf): dist-server/');
console.log('\nNow run Inno Setup to create the installer.\n');
