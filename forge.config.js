// forge.config.js  —  Electron Forge configuration for eHajiri
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
const config = {
  packagerConfig: {
    name:       'eHajiri',
    executableName: 'eHajiri',
    icon:       './electron/icon',          // .ico on Windows, .icns on Mac
    appVersion: process.env.APP_VERSION || '1.0.0',

    // ── ASAR packaging ─────────────────────────────────────────────────────
    asar: {
      // Velopack ships native .node binaries and the Update.exe helper.
      // Native binaries cannot be read from inside an ASAR archive, so we
      // unpack everything under the velopack package folder to the filesystem.
      unpack: '**/node_modules/velopack/**/*',
    },

    // Include the server directory and a bundled Node.js runtime
    extraResource: [
      './server',
      './dist',
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

      // Release artifacts — large and not needed at runtime
      /^\/releases/,
      /^\/out/,

      // Log and temp files
      /^\/.*\.log$/,
      /^\/dev_/,

      // Node module caches
      /node_modules\/\.cache/,
      /node_modules\/\.vite/,
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
