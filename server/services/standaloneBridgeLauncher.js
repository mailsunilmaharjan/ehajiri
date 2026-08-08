/**
 * ⚠ StandAlone SDK code — DISABLED BY DEFAULT. startStandaloneBridge() (below)
 * is only ever called from server/index.js's boot sequence and
 * routes/settings.js's module-flag toggle, both gated on
 * FLAG_KEYS.standaloneDevice (default OFF, migration 47) — so on a fresh
 * install this .exe is never spawned at all until an admin/superAdmin enables
 * the StandAlone Device module from Role Management → Module Controls.
 *
 * Spawns the standalone-bridge .exe (x86 .NET helper wrapping ZKTeco's legacy
 * Standalone SDK COM control) directly from the Node server, so it's
 * available in every run mode: `npm run dev`, `npm run dev:server`, the
 * Electron-forked server in dev, and the packaged Electron app — not just
 * when Electron's main process happens to spawn it.
 *
 * Sets process.env.STANDALONE_BRIDGE_PORT once the bridge reports its port,
 * which is what server/services/standaloneDeviceService.js reads.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // server/services

function resolveBridgeExePath() {
  if (process.platform !== 'win32') return null;

  // Packaged Electron app — published via forge.config.js's extraResource
  // (basename 'publish', see electron/main.cjs for the same path logic).
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, 'publish', 'StandaloneBridge.exe');
    if (fs.existsSync(packaged)) return packaged;
  }

  // Dev — repo-root/standalone-bridge/publish (build via `npm run build:bridge`)
  const dev = path.join(__dirname, '..', '..', 'standalone-bridge', 'publish', 'StandaloneBridge.exe');
  return fs.existsSync(dev) ? dev : null;
}

function portFilePath() {
  const base = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
  return path.join(base, 'eHajiri', 'standalone-bridge-port.json');
}

function waitForPortFile(retries = 20) {
  return new Promise((resolve) => {
    const check = (remaining) => {
      try {
        const { port } = JSON.parse(fs.readFileSync(portFilePath(), 'utf8'));
        resolve(port);
      } catch {
        if (remaining <= 0) resolve(null);
        else setTimeout(() => check(remaining - 1), 300);
      }
    };
    check(retries);
  });
}

let bridgeProcess = null;

// Windows doesn't reliably run Node's SIGTERM/exit handlers when a parent
// process is force-killed (e.g. Electron's utilityProcess.kill()), so an
// unclean shutdown can leave the previous bridge .exe orphaned. Best-effort
// clean it up before spawning a fresh one, using the PID it last reported.
function killStalePid() {
  try {
    const { pid } = JSON.parse(fs.readFileSync(portFilePath(), 'utf8'));
    if (pid) spawn('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' });
  } catch { /* no stale port-file, or it's already gone — nothing to clean up */ }
}

export async function startStandaloneBridge() {
  if (bridgeProcess && !bridgeProcess.killed) {
    return process.env.STANDALONE_BRIDGE_PORT ? Number(process.env.STANDALONE_BRIDGE_PORT) : null;
  }

  const exePath = resolveBridgeExePath();
  if (!exePath) {
    console.warn('[standalone-bridge] StandaloneBridge.exe not found — StandAlone Device support disabled');
    return null;
  }

  killStalePid();
  try { fs.unlinkSync(portFilePath()); } catch { /* fine if it doesn't exist yet */ }

  bridgeProcess = spawn(exePath, [], {
    cwd: path.dirname(exePath),
    stdio: 'pipe',
    windowsHide: true,
  });

  bridgeProcess.stdout?.on('data', (d) => console.log('[standalone-bridge]', d.toString().trim()));
  bridgeProcess.stderr?.on('data', (d) => console.error('[standalone-bridge]', d.toString().trim()));
  bridgeProcess.on('exit', (code) => {
    console.log('[standalone-bridge] exited with code', code);
    bridgeProcess = null;
  });

  const port = await waitForPortFile();
  if (port) {
    process.env.STANDALONE_BRIDGE_PORT = String(port);
    console.log(`[standalone-bridge] ready on port ${port}`);
  } else {
    console.warn('[standalone-bridge] never reported its port — StandAlone Device support disabled this session');
  }
  return port;
}

export function stopStandaloneBridge() {
  if (bridgeProcess) bridgeProcess.kill();
  bridgeProcess = null;
  delete process.env.STANDALONE_BRIDGE_PORT;
}
