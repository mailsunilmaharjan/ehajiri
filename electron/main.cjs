// electron/main.cjs  —  Electron main process for eHajiri desktop app
'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage } = require('electron');
const { VelopackApp, UpdateManager } = require('velopack');
const { spawn } = require('child_process');
const path  = require('path');
const http  = require('http');

// ─────────────────────────────────────────────────────────────────────────────
// VELOPACK HOOK — This MUST be the absolute first thing that runs.
// It must come before any other code, especially before app.on('ready').
// Velopack calls this to handle install/uninstall/update lifecycle events;
// the process may exit here during those flows, which is intentional.
// ─────────────────────────────────────────────────────────────────────────────
VelopackApp.build().run();

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────
const UPDATE_URL   = 'https://github.com/mailsunilmaharjan/ehajiri-releases';
const SERVER_PORT  = 5001;
const isDev        = !app.isPackaged;

let mainWindow   = null;
let serverProcess = null;
let tray          = null;

// ─────────────────────────────────────────────────────────────────────────────
// Spawn the bundled Express server (server/index.js)
// ─────────────────────────────────────────────────────────────────────────────
function startServer() {
  const serverScript = isDev
    ? path.join(__dirname, '..', 'server', 'index.js')
    : path.join(process.resourcesPath, 'server', 'index.js');

  const nodeBin = isDev
    ? process.execPath   // use same node in dev
    : path.join(process.resourcesPath, 'node', 'node.exe');  // bundled node

  serverProcess = spawn(nodeBin, ['--experimental-vm-modules', serverScript], {
    env: {
      ...process.env,
      PORT:      String(SERVER_PORT),
      NODE_ENV:  isDev ? 'development' : 'production',
      // DB credentials come from server/.env placed in resourcesPath
      ELECTRON:  'true',
    },
    stdio: isDev ? 'inherit' : 'pipe',
  });

  if (!isDev && serverProcess.stdout) {
    serverProcess.stdout.on('data', (d) => console.log('[server]', d.toString().trim()));
  }
  if (!isDev && serverProcess.stderr) {
    serverProcess.stderr.on('data', (d) => console.error('[server]', d.toString().trim()));
  }

  serverProcess.on('exit', (code) => {
    console.log('[server] exited with code', code);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Wait until Express is ready before showing the window
// ─────────────────────────────────────────────────────────────────────────────
function waitForServer(url, retries = 40) {
  return new Promise((resolve, reject) => {
    const check = (remaining) => {
      http.get(url, (res) => {
        if (res.statusCode < 500) resolve();
        else setTimeout(() => check(remaining - 1), 500);
      }).on('error', () => {
        if (remaining <= 0) return reject(new Error('Server never started'));
        setTimeout(() => check(remaining - 1), 500);
      });
    };
    check(retries);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Create the main browser window
// ─────────────────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 800,
    minWidth:  900,
    minHeight: 600,
    title: 'eHajiri',
    icon:  path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  Menu.setApplicationMenu(null);

  mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);

  mainWindow.on('close', (e) => {
    // Minimise to tray instead of quitting
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// System-tray icon
// ─────────────────────────────────────────────────────────────────────────────
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.ico'));
  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open eHajiri', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { label: 'Check for Updates', click: () => checkForUpdates(mainWindow) },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } },
  ]);
  tray.setToolTip('eHajiri Attendance');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
}

// ─────────────────────────────────────────────────────────────────────────────
// checkForUpdates — full implementation with progress and dialog
// ─────────────────────────────────────────────────────────────────────────────
async function checkForUpdates(win, silent = false) {
  try {
    const mgr = new UpdateManager(UPDATE_URL);

    const newRelease = await mgr.checkForUpdatesAsync();

    if (!newRelease) {
      if (!silent) {
        dialog.showMessageBoxSync(win, {
          type:    'info',
          title:   'No Updates',
          message: 'eHajiri is up to date.',
          buttons: ['OK'],
        });
      }
      return;
    }

    const newVersion = newRelease.TargetFullRelease.Version;

    const { response } = await dialog.showMessageBox(win, {
      type:    'info',
      title:   'Update Available',
      message: `eHajiri ${newVersion} is available`,
      detail:  'A new version is ready to download and install. The app will restart automatically.',
      buttons: ['Update Now', 'Remind Me Later'],
      defaultId: 0,
      cancelId:  1,
    });

    if (response !== 0) return;  // user chose "Later"

    // Show a non-interactive progress window via the renderer
    win.webContents.send('update-status', { stage: 'downloading', progress: 0 });

    await mgr.downloadUpdatesAsync(newRelease, (percent) => {
      win.webContents.send('update-status', { stage: 'downloading', progress: percent });
    });

    win.webContents.send('update-status', { stage: 'installing', progress: 100 });

    // Give the renderer a moment to show "Installing…" before restart
    await new Promise((r) => setTimeout(r, 800));

    // Apply update and restart — process will not continue past this call
    mgr.applyUpdatesAndRestart(newRelease);

  } catch (err) {
    console.error('[updater] error:', err);
    if (!silent) {
      dialog.showErrorBox('Update Error', `Could not check for updates:\n${err.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC — renderer can request an update check from the Settings page
// ─────────────────────────────────────────────────────────────────────────────
ipcMain.handle('check-for-updates', () => checkForUpdates(mainWindow, false));

// ─────────────────────────────────────────────────────────────────────────────
// App lifecycle  —  app.on('ready') comes AFTER VelopackApp.build().run()
// ─────────────────────────────────────────────────────────────────────────────
app.on('ready', async () => {
  startServer();

  try {
    await waitForServer(`http://localhost:${SERVER_PORT}/api/health`);
  } catch {
    dialog.showErrorBox('Startup Error', 'The eHajiri server failed to start. Please reinstall.');
    app.quit();
    return;
  }

  createWindow();
  createTray();

  // Silent update check 5 s after startup — don't block the window
  setTimeout(() => checkForUpdates(mainWindow, true), 5000);
});

app.on('window-all-closed', (e) => e.preventDefault());  // keep alive in tray

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
});
