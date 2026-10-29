import { localDateKey } from '../utils/dates.js';
import { playInteractionSound } from '../services/interactionSound.js?v=18900';

// Duolingo-style "streak extended" moment. It appears once per local day,
// after the first completed exercise, and never blocks saving that exercise.
const PRACTICE_DELAY_MS = 1100;
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function streakWeek(activity = {}, now = new Date()) {
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return WEEKDAYS.map((label, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    const key = localDateKey(day);
    const todayKey = localDateKey(today);
    return { label, key, today: key === todayKey, future: key > todayKey, done: Number(activity?.[key]) > 0 };
  });
}

export function streakMessage(streak) {
  if (streak <= 1) return 'You started a new streak. Come back tomorrow to keep it burning!';
  if (streak < 7) return `${7 - streak} more day${7 - streak === 1 ? '' : 's'} to a full week. Keep it going!`;
  if (streak % 7 === 0) return `${streak / 7} week${streak === 7 ? '' : 's'} of daily practice. Incredible consistency!`;
  return 'Practice every day to keep your streak growing.';
}

function digitsMarkup(previous, next) {
  const from = String(Math.max(0, previous));
  const to = String(Math.max(0, next));
  const width = Math.max(from.length, to.length);
  const a = from.padStart(width, ' '), b = to.padStart(width, ' ');
  return [...b].map((digit, index) => {
    const old = a[index];
    if (old === digit) return `<span class="streak-digit"><span>${digit.trim() || '&nbsp;'}</span></span>`;
    return `<span class="streak-digit is-rolling" style="--d:${index}"><span class="streak-digit-roll"><span>${old.trim() || '&nbsp;'}</span><span>${digit}</span></span></span>`;
  }).join('');
}

const FLAME_SVG = `<svg class="streak-flame-svg" viewBox="0 0 120 150" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="streakFlameOuter" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff7a00"/><stop offset="1" stop-color="#ffb800"/></linearGradient>
    <linearGradient id="streakFlameInner" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ffd23f"/><stop offset="1" stop-color="#fff2a8"/></linearGradient>
  </defs>
  <path class="streak-flame-outer" fill="url(#streakFlameOuter)" d="M60 4c6 22 30 36 38 62 9 30-6 70-38 78C28 136 12 108 16 80c3-20 15-30 20-48 6 12 6 22 14 30 2-22 2-38 10-58z"/>
  <path class="streak-flame-inner" fill="url(#streakFlameInner)" d="M60 62c4 14 20 22 22 42 2 20-10 34-22 36-14-2-24-14-22-32 1-12 9-18 12-28 4 6 5 10 8 14 0-12 0-20 2-32z"/>
</svg>`;

export function renderStreakCelebration({ streak, previousStreak = streak - 1, activity = {}, now = new Date() }) {
  const week = streakWeek(activity, now);
  const sparks = Array.from({ length: 12 }, (_, index) => `<i class="streak-spark" style="--a:${index * 30}deg;--s:${index % 3}"></i>`).join('');
  return `<div class="streak-celebration-card" role="document">
    <div class="streak-flame-stage">${sparks}<div class="streak-flame">${FLAME_SVG}</div></div>
    <div class="streak-count" aria-hidden="true">${digitsMarkup(previousStreak, streak)}</div>
    <h2 id="streak-celebration-title" class="streak-title">day streak!</h2>
    <p class="streak-copy">${streakMessage(streak)}</p>
    <ol class="streak-week" aria-label="This week">${week.map((day, index) => `<li class="streak-day${day.done ? ' is-done' : ''}${day.today ? ' is-today' : ''}${day.future ? ' is-future' : ''}" style="--i:${index}"><span class="streak-day-label">${day.label}</span><span class="streak-day-dot">${day.done ? '<i class="fa-solid fa-check" aria-hidden="true"></i>' : ''}</span></li>`).join('')}</ol>
    <button type="button" class="btn-green-solid streak-continue" data-streak-continue>Continue</button>
  </div>`;
}

export function setupStreakCelebration({ getSettings, isPracticeView = () => false, host = globalThis } = {}) {
  const document = host.document;
  if (!document || typeof host.addEventListener !== 'function') return () => {};
  let shownFor = '';
  let overlay = null;
  let pendingTimer = null;
  let restoreFocus = null;

  const close = () => {
    if (!overlay) return;
    const current = overlay;
    overlay = null;
    document.removeEventListener('keydown', onKeydown, true);
    current.classList.add('is-leaving');
    const remove = () => current.remove();
    current.addEventListener('animationend', remove, { once: true });
    host.setTimeout(remove, 400);
    if (restoreFocus?.isConnected) restoreFocus.focus?.({ preventScroll: true });
  };
  function onKeydown(event) {
    if (!overlay) return;
    if (event.key === 'Escape' || event.key === 'Enter') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    else if (event.key === 'Tab') { event.preventDefault(); overlay.querySelector('[data-streak-continue]')?.focus(); }
  }
  const show = detail => {
    pendingTimer = null;
    if (overlay) overlay.remove();
    const settings = getSettings?.() || {};
    restoreFocus = document.activeElement;
    overlay = document.createElement('div');
    overlay.className = 'streak-celebration';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `${detail.streak} day streak`);
    overlay.innerHTML = renderStreakCelebration({ streak: detail.streak, previousStreak: detail.previousStreak, activity: settings.reviewActivity || {} });
    overlay.addEventListener('click', event => {
      if (event.target === overlay || event.target.closest('[data-streak-continue]')) close();
    });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKeydown, true);
    host.requestAnimationFrame?.(() => overlay?.classList.add('is-visible'));
    overlay.querySelector('[data-streak-continue]')?.focus({ preventScroll: true });
    try { playInteractionSound('streak'); } catch { /* Sound is optional. */ }
  };

  const onStreak = event => {
    const detail = event?.detail || {};
    const streak = Number(detail.streak);
    if (!Number.isFinite(streak) || streak < 1 || shownFor === detail.date) return;
    shownFor = detail.date;
    if (pendingTimer) host.clearTimeout(pendingTimer);
    // Let the answer feedback register before celebrating.
    pendingTimer = host.setTimeout(() => show({ streak, previousStreak: Math.max(0, Number(detail.previousStreak) || 0) }), isPracticeView() ? PRACTICE_DELAY_MS : 150);
  };
  host.addEventListener('keepvocab:streak-extended', onStreak);
  return () => {
    host.removeEventListener('keepvocab:streak-extended', onStreak);
    if (pendingTimer) host.clearTimeout(pendingTimer);
    close();
  };
}
