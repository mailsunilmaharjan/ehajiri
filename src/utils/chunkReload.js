/**
 * After a new frontend build the old hashed chunk files are gone, so a tab that
 * was opened before the deploy fails the next time it lazy-loads a page
 * ("Failed to fetch dynamically imported module"). Reloading fetches the new
 * index + chunk names and fixes it, so do that automatically — but only once
 * per minute so a genuinely missing file can never cause a reload loop.
 */
const KEY = 'ehajiri_chunk_reload_at';
const WINDOW_MS = 60_000;

export const isChunkLoadError = (err) => {
  const msg = String(err?.message || err || '');
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(msg);
};

/** Returns true if a reload was triggered (caller should stop what it's doing). */
export const reloadOnceForChunkError = () => {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* storage blocked — fall through and reload once anyway */ }
  window.location.reload();
  return true;
};
