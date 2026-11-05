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

/** Plays `count` short tones back to back, `gapSec` apart — the shared
 * building block both alert cadences below are made of (a "beep-beep" is
 * just playBeeps(2)). */
function playBeeps(count, gapSec = 0.18) {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  for (let i = 0; i < count; i++) {
    const delay = i * gapSec;
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
  }
}

/** Phones only start playing sound after a first touch — create + resume the audio engine on the first tap anywhere. */
let unlockBound = false;
export function unlockAudioOnFirstTouch() {
  if (unlockBound || typeof window === 'undefined') return;
  unlockBound = true;
  const go = () => { const c = getCtx(); if (c && c.state === 'suspended') c.resume().catch(() => {}); };
  ['touchstart', 'pointerdown', 'click', 'keydown'].forEach(ev => window.addEventListener(ev, go, { passive: true }));
}

/** One short, friendly "ding" (live attendance popups). */
export function playDing() {
  const ctx = getCtx(); if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  [[988, 0], [1319, 0.13]].forEach(([f, d]) => {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, ctx.currentTime + d); g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + d + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + d + 0.35);
    o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + 0.36);
  });
}

/** Two-tone "beep-beep" — synthesized so no audio asset needs to ship with the app. */
function playBeep() { playBeeps(2); }

/**
 * Repeats a beep-beep alert every `intervalMs` while `active` is true, and
 * plays one immediately on the transition from inactive → active. Stops the
 * instant `active` becomes false (e.g. the user opens the inbox/chat and it's
 * marked read) — this is what gives the "keeps beeping until seen" behavior.
 * Used for Message notifications — Task notifications use
 * useTaskAssignedBeepAlert below instead, a deliberately less naggy cadence.
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

const TASK_ALERT_REMINDER_MS = 5 * 60 * 1000;

/**
 * Task-assignment/new-followup alert cadence: 5 beeps the moment a new one
 * arrives and is still unseen, then a quiet 2-beep reminder every 5 minutes
 * for as long as it stays unseen — not the same continuous every-few-seconds
 * cadence useBeepAlert gives Message notifications, since a task assignment
 * deserves a noticeable initial alert but not a constant nag. Stops the
 * instant `active` goes false (the task is opened — see clearTaskAlert in
 * AttendanceToasts.jsx).
 */
export function useTaskAssignedBeepAlert(active) {
  const timerRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    playBeeps(5);
    timerRef.current = setInterval(() => playBeeps(2), TASK_ALERT_REMINDER_MS);
    return () => clearInterval(timerRef.current);
  }, [active]);
}

/**
 * "Keep telling me until I've looked": 3 beeps the moment the unseen count goes up (or on first load with something
 * waiting), then a 2-beep reminder every `repeatMs` for as long as anything is still unseen. Goes quiet the instant the
 * count reaches 0 (the user opened it). Used on the phone for notices, approvals, leave / visit / OT / online / late-early.
 */
export function useUnseenAlert(count, repeatMs = 60000) {
  const prev = useRef(0);
  useEffect(() => {
    if (count > prev.current) playBeeps(3);
    prev.current = count;
  }, [count]);
  useEffect(() => {
    if (!(count > 0)) return undefined;
    const t = setInterval(() => playBeeps(2), repeatMs);
    return () => clearInterval(t);
  }, [count > 0, repeatMs]); // eslint-disable-line react-hooks/exhaustive-deps
}
