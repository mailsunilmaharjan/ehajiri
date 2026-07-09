import { useEffect, useRef } from 'react';

let sharedCtx = null;
function getCtx() {
  if (!sharedCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    sharedCtx = new AudioCtx();
  }
  return sharedCtx;
}

/** Two-tone "beep-beep" — synthesized so no audio asset needs to ship with the app. */
function playBeep() {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  [0, 0.18].forEach((delay) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + delay + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + 0.16);
  });
}

/**
 * Repeats a beep-beep alert every `intervalMs` while `active` is true, and
 * plays one immediately on the transition from inactive → active. Stops the
 * instant `active` becomes false (e.g. the user opens the inbox/chat and it's
 * marked read) — this is what gives the "keeps beeping until seen" behavior.
 */
export function useBeepAlert(active, intervalMs = 4000) {
  const timerRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    playBeep();
    timerRef.current = setInterval(playBeep, intervalMs);
    return () => clearInterval(timerRef.current);
  }, [active, intervalMs]);
}
