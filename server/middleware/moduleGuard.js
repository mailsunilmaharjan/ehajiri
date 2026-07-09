import { isModuleEnabled } from '../utils/moduleFlags.js';

/** Blocks a route tree with 503 unless the given app_settings flag is true. */
export function requireModuleEnabled(flagKey, label) {
  return async (req, res, next) => {
    try {
      if (await isModuleEnabled(flagKey)) return next();
      res.status(503).json({
        error: `${label || 'This module'} is currently disabled — ask an admin/superAdmin to enable it in Settings.`,
        moduleDisabled: true,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}
