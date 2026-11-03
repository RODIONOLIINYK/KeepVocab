import { localDateKey } from '../utils/dates.js';
import { playInteractionSound } from '../services/interactionSound.js?v=18908';

// A small, earned reward after finishing practice.
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

// This surface is mounted by completed-session branches only. It has no global
// event listener, timer, overlay, focus trap, or navigation side effect.
export function renderStreakCelebration({ streak, activity = {}, now = new Date() }) {
  const count = Math.max(1, Math.floor(Number(streak) || 1));
  return `<aside class="completion-streak" aria-label="${count} day streak">
    <div class="completion-streak-heading"><span class="completion-streak-icon" aria-hidden="true"><i class="fa-solid fa-fire"></i></span><div><strong>${count} day streak</strong><span>${streakMessage(count)}</span></div><span class="completion-earned" aria-hidden="true">✓</span></div>
    <ol class="completion-week" aria-label="Your practice this week">${streakWeek(activity, now).map(day => `<li class="completion-day${day.done ? ' is-done' : ''}${day.today ? ' is-today' : ''}"${day.today ? ' aria-current="date"' : ''}><span>${day.label}</span><span class="completion-day-check" aria-label="${day.key}: ${day.done ? 'practiced' : 'not practiced'}">${day.done ? '✓' : '·'}</span></li>`).join('')}</ol>
  </aside>`;
}

export function mountPracticeCompletion(container, { completedCount, settings = {}, now = new Date(), host = globalThis } = {}) {
  if (!(Number(completedCount) > 0) || !container?.isConnected) return false;
  const screen = container.querySelector('.mode-completion-card, .speaking-summary-card, .daily-complete-card, .mode-complete, .useful-empty-state');
  if (!screen || screen.classList.contains('completion-feedback')) return false;
  screen.classList.add('completion-feedback');
  const mascot = screen.querySelector('img');
  const hero = screen.ownerDocument.createElement('div');
  hero.className = 'completion-hero';
  hero.setAttribute('aria-hidden', 'true');
  hero.innerHTML = '<span class="completion-star star-one">✦</span><span class="completion-star star-two">✦</span><span class="completion-star star-three">✧</span>';
  if (mascot) {
    mascot.src = 'assets/keepvocab-sprig-celebrate.webp';
    mascot.alt = 'Sprig celebrating';
    mascot.before(hero);
    hero.appendChild(mascot);
  }
  else { hero.insertAdjacentHTML('beforeend', '<img src="assets/keepvocab-sprig-celebrate.webp" alt="">'); screen.prepend(hero); }

  const key = localDateKey(now);
  const storageKey = 'keepvocab_completion_streak_date';
  let alreadyShown = shownDate === key;
  try { alreadyShown ||= host.localStorage?.getItem(storageKey) === key; } catch { /* In-memory fallback in private mode. */ }
  const actions = screen.querySelector('.inline-actions, .mode-completion-actions, .summary-actions');
  if (!alreadyShown && Number(settings.reviewActivity?.[key]) > 0 && Number(settings.dailyStreak) > 0 && actions) {
    actions.insertAdjacentHTML('beforebegin', renderStreakCelebration({ streak: settings.dailyStreak, activity: settings.reviewActivity, now }));
    shownDate = key;
    try { host.localStorage?.setItem(storageKey, key); } catch { /* Saving practice never depends on this marker. */ }
    try { playInteractionSound('streak'); } catch { /* Sound is optional. */ }
  } else {
    try { playInteractionSound('success'); } catch { /* Sound is optional. */ }
  }
  return true;
}

let shownDate = '';
