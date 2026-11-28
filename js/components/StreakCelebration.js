import { getStreakSummary } from '../services/studyActivity.js';
import { playInteractionSound } from '../services/interactionSound.js?v=18908';
import { escapeHtml } from '../utils/html.js';
import { dismissComboCelebration } from './ComboCelebration.js?v=18917';

export function streakCelebrationSubtitle(detail = {}) {
  if (detail.freezeProtected) return 'A Streak Freeze covered a missed day. Today’s practice kept your streak going.';
  if (Number(detail.streak) <= 1 || !detail.streak) return 'You reached your daily goal. Come back tomorrow to keep it going.';
  if (detail.milestone) return 'You reached a streak milestone.';
  return 'You reached today’s goal and extended your streak.';
}

function renderWeek(week) {
  const days = week.map(day => {
    const completed = day.isToday || day.isGoalReached;
    return { ...day, completed, active: completed || day.isFrozen };
  });
  return days.map((day, index) => {
    const connectLeft = day.active && days[index - 1]?.active;
    const connectRight = day.active && days[index + 1]?.active;
    const status = day.completed ? 'is-goal' : day.isFrozen ? 'is-frozen' : day.count ? 'is-done' : '';
    const today = day.isToday ? ' is-today is-today-ignite' : '';
    const weekday = escapeHtml(day.weekdayLabel || day.weekdayShort);
    const label = day.completed ? 'Daily goal reached' : day.isFrozen ? 'Protected by Streak Freeze'
      : day.count ? 'Practiced' : 'No practice';
    return `<div class="streak-day streak-celebration-day ${status}${today}" role="listitem" aria-label="${weekday}: ${label}"${day.isToday ? ' aria-current="date"' : ''}>
      <small>${weekday}</small>
      <div class="streak-celebration-cell" aria-hidden="true">
        ${connectLeft ? `<span class="streak-connector is-left${day.isToday ? ' is-today-connector' : ''}"></span>` : ''}
        <span class="streak-day-mark"></span>
        ${connectRight ? '<span class="streak-connector is-right"></span>' : ''}
      </div>
    </div>`;
  }).join('');
}

export function renderStreakCelebrationMarkup(detail = {}, settings = {}) {
  const streak = Math.max(1, Math.floor(Number(detail.streak) || 1));
  const previousStreak = Math.max(0, Math.floor(Number(detail.previousStreak ?? streak - 1) || 0));
  const summary = getStreakSummary(settings);
  const banked = Math.max(0, Math.floor(Number(detail.bankedFreezes ?? summary.bankedFreezes) || 0));
  const reward = detail.earnedFreeze
    ? `<p class="streak-reward-pill"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i> +1 Streak Freeze (${banked}/${summary.maxFreezes})</p>`
    : '';
  const showRoll = previousStreak !== streak;
  const icon = detail.freezeProtected ? 'fa-shield-halved' : 'fa-fire';
  const title = `${streak} day streak!`;

  return `<div class="streak-celebration-card${detail.milestone ? ' is-milestone' : ''}">
    <div class="streak-celebration-heading">
      <span class="streak-celebration-stage" aria-hidden="true">
        <canvas class="streak-celebration-canvas" width="120" height="120"></canvas>
        <i class="fa-solid ${icon}"></i>
      </span>
      <div>
        <h2 id="streak-celebration-title"><span class="sr-only">${title}</span><span class="streak-celebration-title" aria-hidden="true">
          <span class="streak-counter-slot${showRoll ? '' : ' is-static'}">
            ${showRoll ? `<span class="streak-counter-prev">${previousStreak}</span>` : ''}
            <span class="streak-counter-number" data-from="${previousStreak}" data-to="${streak}">${streak}</span>
          </span>
          <span>day streak</span>
        </span></h2>
        <p id="streak-celebration-detail">${escapeHtml(streakCelebrationSubtitle({ ...detail, streak }))}</p>
      </div>
    </div>
    <div class="streak-celebration-week" role="list" aria-label="Last 7 days streak progress">${renderWeek(summary.weekWindow)}</div>
    ${reward}
    <div class="streak-celebration-footer"><button type="button" class="btn-green-solid" id="btn-streak-celebration-continue" autofocus>Continue</button></div>
  </div>`;
}

function drawAccent(canvas) {
  const context = canvas?.getContext('2d');
  if (!context) return;
  context.strokeStyle = '#c48845';
  context.lineWidth = 4;
  context.lineCap = 'round';
  context.beginPath();
  for (const [x, y, dx, dy] of [[12, 28, 9, 6], [96, 18, -7, 9], [106, 37, -10, 4]]) {
    context.moveTo(x, y);
    context.lineTo(x + dx, y + dy);
  }
  context.stroke();
}

export function showStreakCelebration(detail = {}, settings = {}, doc = globalThis.document) {
  if (!doc?.body) return null;
  dismissComboCelebration();
  const existing = doc.getElementById('streak-celebration-overlay');
  if (existing) { existing.close(); existing.remove(); }

  const overlay = doc.createElement('dialog');
  overlay.id = 'streak-celebration-overlay';
  overlay.className = 'streak-celebration-overlay';
  overlay.setAttribute('aria-labelledby', 'streak-celebration-title');
  overlay.setAttribute('aria-describedby', 'streak-celebration-detail');
  overlay.innerHTML = renderStreakCelebrationMarkup(detail, settings);
  doc.body.append(overlay);
  if (!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    drawAccent(overlay.querySelector('canvas'));
  }
  const close = () => {
    if (overlay.open) overlay.close();
  };
  overlay.addEventListener('close', () => overlay.remove(), { once: true });
  overlay.querySelector('button').addEventListener('click', close);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });
  overlay.showModal();
  playInteractionSound('streak');
  return { overlay, close };
}
