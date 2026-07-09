// forge.config.js  —  Electron Forge configuration for eHajiri
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import fs from 'fs';
import path from 'path';

// Optional: place the official Microsoft VC_redist.x64.exe (from
// https://aka.ms/vs/17/release/vc_redist.x64.exe) at installer/deps/ before
// packaging to have it bundled and silently installed on first launch (see
// ensureVCRedist() in electron/main.cjs) — a fresh/locked-down Windows
// machine may be missing the runtime the bundled Postgres binaries need.
// Skipped entirely if the file isn't present.
const VC_REDIST_SRC = 'installer/deps/VC_redist.x64.exe';
const vcRedistBundled = fs.existsSync(path.resolve(process.cwd(), VC_REDIST_SRC));

// Optional: place a real pg_dump.exe (from a PostgreSQL 18.x Windows install,
// e.g. C:\Program Files\PostgreSQL\18\bin\pg_dump.exe) at installer/deps/ to
// have it bundled for the native SQL backup export (see
// server/routes/backup.js's /sql route and resolvePgDumpPath() in
// electron/main.cjs). @embedded-postgres/windows-x64 only ships the server
// binaries (postgres.exe/pg_ctl.exe/initdb.exe) — no client tools — so
// pg_dump.exe has to be sourced separately. It's copied (via afterCopy below)
// into that same package's native/bin/ folder so it resolves its DLL
// dependencies (libpq.dll etc.) from the binaries already bundled there.
// Skipped entirely if the file isn't present — JSON backup still works either way.
const PG_DUMP_SRC = 'installer/deps/pg_dump.exe';
const pgDumpBundled = fs.existsSync(path.resolve(process.cwd(), PG_DUMP_SRC));

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
const config = {
  packagerConfig: {
    name:       'eHajiri',
    executableName: 'eHajiri',
    icon:       './electron/icon',          // .ico on Windows, .icns on Mac
    appVersion: process.env.APP_VERSION || '1.0.0',

    // ── ASAR packaging ─────────────────────────────────────────────────────
    asar: {
      // Velopack and embedded-postgres ship native binaries / executables that
      // cannot be launched from inside an ASAR archive — unpack both to disk.
      unpack: '**/node_modules/{velopack,@embedded-postgres,embedded-postgres}/**/*',
    },

    // Include the server directory and a bundled Node.js runtime
    extraResource: [
      './server',
      './dist',
      './standalone-bridge/publish',
      // Root package.json — server/version.js reads its "version" field as the
      // single source of truth for APP_VERSION; ships alongside server/ so the
      // same `../package.json` relative path resolves in both dev and packaged.
      './package.json',
      // Only added when the file has actually been placed there — see above.
      ...(vcRedistBundled ? [`./${VC_REDIST_SRC}`] : []),
    ],

    // Ignore files we don't need in the packaged app
    ignore: [
      // Source / dev files
      /^\/src/,
      /^\/\.github/,
      /^\/installer/,
      /^\/\.git/,
      /^\/\.vscode/,
      /^\/\.claude/,

      // Credentials & secrets — NEVER ship these
      /^\/\.env/,
      /^\/\.env\.deploy/,

      // Build outputs that go via extraResource instead
      /^\/dist/,
      /^\/dist-server/,
      /^\/server/,
      /^\/standalone-bridge/,

      // Release artifacts — large and not needed at runtime
      /^\/releases/,
      /^\/\.releases/,
      /^\/out/,
      /^\/dist-server-pkg/,
      /^\/dist-installer/,

      // Unrelated stray scaffold — not part of eHajiri
      /^\/my-claude-app/,

      // Log and temp files
      /^\/.*\.log$/,
      /^\/dev_/,

      // Node module caches
      /node_modules\/\.cache/,
      /node_modules\/\.vite/,
    ],

    // Copy pg_dump.exe (if bundled) into @embedded-postgres/windows-x64's own
    // native/bin/ folder, before the ASAR is built, so asar.unpack's existing
    // "@embedded-postgres/**/*" glob picks it up automatically and it lands
    // right next to postgres.exe in app.asar.unpacked — see PG_DUMP_SRC above.
    afterCopy: [
      (buildPath, _electronVersion, _platform, _arch, callback) => {
        if (!pgDumpBundled) return callback();
        const destDir = path.join(buildPath, 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin');
        if (!fs.existsSync(destDir)) return callback();
        fs.copyFileSync(path.resolve(process.cwd(), PG_DUMP_SRC), path.join(destDir, 'pg_dump.exe'));
        callback();
      },
    ],

    // Strip unused Chromium locale files (~39MB across 55 languages) — these
    // only affect native OS chrome (context menus, spellcheck), not the
    // app's own React UI text, so keeping just en-US is a no-op visually.
    // Must be afterComplete (not afterCopy): afterCopy's buildPath is only
    // the ASAR source staging dir (resources/app) before extraResource files
    // and top-level Electron assets (locales/) are assembled — afterComplete
    // is the only hook that receives the true final packaged directory.
    afterComplete: [
      (buildPath, _electronVersion, _platform, _arch, callback) => {
        const localesDir = path.join(buildPath, 'locales');
        if (fs.existsSync(localesDir)) {
          for (const file of fs.readdirSync(localesDir)) {
            if (file !== 'en-US.pak') {
              fs.unlinkSync(path.join(localesDir, file));
            }
          }
        }

        // The mobile APK is hosted externally (see server/index.js) — never
        // ship a locally-placed copy of it, in case one is left over from
        // testing the download endpoint.
        const downloadsDir = path.join(buildPath, 'resources', 'server', 'downloads');
        if (fs.existsSync(downloadsDir)) {
          fs.rmSync(downloadsDir, { recursive: true, force: true });
        }

        callback();
      },
    ],
  },

  rebuildConfig: {},

  makers: [
    {
      // Squirrel is used because Velopack builds on top of Squirrel's layout
      name: '@electron-forge/maker-squirrel',
      config: {
        name:                 'eHajiri',
        setupExe:             'eHajiri-Setup.exe',
        setupIcon:            './electron/icon.ico',
        // Velopack replaces the Squirrel auto-updater, but we still use
        // the Squirrel maker to produce the RELEASES + nupkg that vpk expects
        noMsi:                true,
      },
    },
    // Optional: produce a portable ZIP as well
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
    },
  ],

  plugins: [
    // Security: harden the built app with Electron Fuses
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]:                          false,
      [FuseV1Options.EnableCookieEncryption]:             true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]:      false,
    }),
  ],
};

export default config;
