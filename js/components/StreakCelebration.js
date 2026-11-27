import { getStreakSummary } from '../services/studyActivity.js';
import { playInteractionSound } from '../services/interactionSound.js?v=18908';
import { escapeHtml } from '../utils/html.js';

const OUTER_FLAME_PATH = 'M90 154C122 154 142 132 142 103C142 78 125 60 114 44C108 35 104 27 99 20C86 32 77 48 74 62C70 55 66 48 63 43C47 58 38 80 38 103C38 132 58 154 90 154Z';
const MID_FLAME_PATH = 'M90 148C110 148 123 133 123 114C123 95 108 82 95 66C93 63 91 61 90 59C84 70 74 82 66 95C60 103 57 109 57 114C57 133 70 148 90 148Z';
const CORE_FLAME_PATH = 'M90 142C101 142 108 134 108 123C108 112 99 103 90 92C81 103 72 112 72 123C72 134 79 142 90 142Z';

function flameSvg(isMilestone = false) {
  return `<svg class="streak-flame-svg${isMilestone ? ' is-milestone' : ''}" viewBox="0 0 180 180" width="156" height="156" fill="none" aria-hidden="true">
    <defs>
      <radialGradient id="streak-aura-grad" cx="50%" cy="54%" r="50%">
        <stop offset="0%" stop-color="#FDE68A" stop-opacity="0.58"/>
        <stop offset="58%" stop-color="#F58A22" stop-opacity="0.16"/>
        <stop offset="100%" stop-color="#F58A22" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="streak-outer-grad" x1="90" y1="20" x2="90" y2="154" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#F59E0B"/>
        <stop offset="50%" stop-color="#F58A22"/>
        <stop offset="100%" stop-color="#EA580C"/>
      </linearGradient>
      <linearGradient id="streak-mid-grad" x1="90" y1="59" x2="90" y2="148" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#FEF08A"/>
        <stop offset="60%" stop-color="#FBBF24"/>
        <stop offset="100%" stop-color="#F59E0B"/>
      </linearGradient>
      <linearGradient id="streak-core-grad" x1="90" y1="92" x2="90" y2="142" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#FFFDF5"/>
        <stop offset="100%" stop-color="#FDE68A"/>
      </linearGradient>
    </defs>

    <circle class="streak-flame-aura" cx="90" cy="96" r="74" fill="url(#streak-aura-grad)"/>

    <g class="streak-sunburst" stroke-linecap="round">
      <line class="streak-ray r1" x1="90" y1="14" x2="90" y2="2" stroke="#FBBF24" stroke-width="5.5" pathLength="100"/>
      <line class="streak-ray r2" x1="140" y1="36" x2="152" y2="24" stroke="#F58A22" stroke-width="5.5" pathLength="100"/>
      <line class="streak-ray r3" x1="156" y1="92" x2="172" y2="92" stroke="#FBBF24" stroke-width="5.5" pathLength="100"/>
      <line class="streak-ray r4" x1="142" y1="142" x2="154" y2="153" stroke="#F58A22" stroke-width="5" pathLength="100"/>
      <line class="streak-ray r5" x1="38" y1="142" x2="26" y2="153" stroke="#F58A22" stroke-width="5" pathLength="100"/>
      <line class="streak-ray r6" x1="24" y1="92" x2="8" y2="92" stroke="#FBBF24" stroke-width="5.5" pathLength="100"/>
      <line class="streak-ray r7" x1="40" y1="36" x2="28" y2="24" stroke="#F58A22" stroke-width="5.5" pathLength="100"/>
    </g>

    <g class="streak-sparks">
      <circle class="streak-spark s1" cx="50" cy="26" r="4" fill="#FBBF24"/>
      <circle class="streak-spark s2" cx="132" cy="24" r="3.5" fill="#F58A22"/>
      <circle class="streak-spark s3" cx="156" cy="64" r="3.2" fill="#39BD55"/>
      <circle class="streak-spark s4" cx="24" cy="64" r="3.2" fill="#F58A22"/>
    </g>

    <g class="streak-flame-unlit">
      <path d="${OUTER_FLAME_PATH}" fill="#E1E6DF"/>
      <path d="${MID_FLAME_PATH}" fill="#F2F4EF"/>
    </g>

    <g class="streak-flame-lit">
      <g class="streak-flame-body">
        <path d="${OUTER_FLAME_PATH}" fill="url(#streak-outer-grad)"/>
        <path class="streak-flame-mid" d="${MID_FLAME_PATH}" fill="url(#streak-mid-grad)"/>
        <path class="streak-flame-core" d="${CORE_FLAME_PATH}" fill="url(#streak-core-grad)"/>
      </g>
    </g>
  </svg>`;
}

function checkIconSvg() {
  return `<svg class="streak-check-svg" viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
    <path class="streak-check-path" d="M5.5 12.7L10 17.2L18.8 7.5" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" pathLength="100"/>
  </svg>`;
}

export function streakCelebrationSubtitle(detail = {}) {
  const streak = Math.max(1, Number(detail.streak) || 1);
  if (detail.milestone) return `Amazing ${streak}-day milestone — your habit is going strong.`;
  if (detail.freezeProtected) return 'A Streak Freeze saved your spot, and today you kept the flame alive.';
  if (streak === 1) return 'You sparked day 1! Come back tomorrow to keep your streak going.';
  return 'You kept your streak alive! Come back tomorrow to keep it going.';
}

export function renderStreakCelebrationMarkup(detail = {}, settings = {}) {
  const streak = Math.max(1, Number(detail.streak) || 1);
  const previousStreak = Math.max(0, Number(detail.previousStreak ?? Math.max(0, streak - 1)));
  const summary = getStreakSummary(settings);
  const banked = Math.max(0, Number(detail.bankedFreezes ?? summary.bankedFreezes) || 0);
  const rewards = [];
  if (detail.milestone) {
    rewards.push(`<span class="streak-reward-pill is-milestone"><i class="fa-solid fa-fire" aria-hidden="true"></i> ${streak}-day milestone</span>`);
  }
  if (detail.earnedFreeze) {
    rewards.push(`<span class="streak-reward-pill is-freeze"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i> +1 Streak Freeze (${banked}/2)</span>`);
  }
  if (detail.freezeProtected) {
    rewards.push('<span class="streak-reward-pill is-freeze"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i> Protected by Freeze</span>');
  }

  const days = summary.weekWindow.map(day => {
    const isTodayLit = Boolean(day.isToday);
    const isLit = isTodayLit || day.status === 'goal';
    const isFrozen = !isTodayLit && day.status === 'frozen';
    return { ...day, isTodayLit, isLit, isFrozen, isActive: isLit || isFrozen };
  });

  const weekHtml = days.map((day, idx) => {
    const prev = days[idx - 1];
    const next = days[idx + 1];
    const connectLeft = day.isActive && prev?.isActive;
    const connectRight = day.isActive && next?.isActive;
    const leftFrozen = connectLeft && (day.isFrozen || prev.isFrozen);
    const rightFrozen = connectRight && (day.isFrozen || next.isFrozen);
    const dotInner = day.isLit
      ? checkIconSvg()
      : day.isFrozen
        ? '<i class="fa-solid fa-shield-halved" aria-hidden="true"></i>'
        : '';
    const classes = [
      'streak-celebration-day',
      day.isLit ? 'is-lit' : '',
      day.isTodayLit ? 'is-today-ignite' : '',
      day.isFrozen ? 'is-frozen' : '',
      connectLeft ? 'connect-left' : '',
      connectRight ? 'connect-right' : '',
      leftFrozen ? 'connect-left-frozen' : '',
      rightFrozen ? 'connect-right-frozen' : ''
    ].filter(Boolean).join(' ');
    return `<div class="${classes}" role="listitem" aria-label="${escapeHtml(`${day.weekdayShort}: ${day.isLit ? 'completed' : day.isFrozen ? 'frozen' : 'not completed'}`)}">
      <small>${escapeHtml(day.weekdayShort)}</small>
      <div class="streak-celebration-cell">
        ${connectLeft ? `<span class="streak-connector is-left${day.isTodayLit ? ' is-today-connector' : ''}" aria-hidden="true"></span>` : ''}
        ${connectRight ? `<span class="streak-connector is-right${next?.isTodayLit ? ' is-pre-today-connector' : ''}" aria-hidden="true"></span>` : ''}
        <span class="streak-celebration-dot">${dotInner}</span>
      </div>
    </div>`;
  }).join('');

  const srTitle = streak === 1 ? '1 day streak!' : `${streak} day streak!`;
  const showRoll = previousStreak !== streak;

  return `<div class="streak-celebration-card${detail.milestone ? ' is-milestone' : ''}" role="dialog" aria-modal="true" aria-labelledby="streak-celebration-title">
    <div class="streak-celebration-body">
      <div class="streak-celebration-stage">
        <div class="streak-flame-wrap">${flameSvg(Boolean(detail.milestone))}</div>
      </div>
      <div class="streak-counter-block">
        <div class="streak-counter-slot${showRoll ? '' : ' is-static'}" aria-hidden="true">
          ${showRoll ? `<span class="streak-counter-prev">${previousStreak}</span>` : ''}
          <span class="streak-counter-number" id="streak-celebration-count" data-from="${previousStreak}" data-to="${streak}">${streak}</span>
        </div>
        <h2 id="streak-celebration-title" class="streak-celebration-heading"><span class="sr-only">${srTitle}</span><span aria-hidden="true">day streak!</span></h2>
      </div>
      <div class="streak-week-card">
        <div class="streak-celebration-week" role="list" aria-label="Last 7 days streak progress">${weekHtml}</div>
        <div class="streak-week-divider" aria-hidden="true"></div>
        <p class="streak-celebration-subtitle">${escapeHtml(streakCelebrationSubtitle(detail))}</p>
        ${rewards.length ? `<div class="streak-celebration-rewards">${rewards.join('')}</div>` : ''}
      </div>
    </div>
    <div class="streak-celebration-footer">
      <button type="button" class="btn-green-solid streak-celebration-cta" id="btn-streak-celebration-continue">Continue</button>
    </div>
  </div>`;
}

export function showStreakCelebration(detail = {}, settings = {}, doc = globalThis.document) {
  if (!doc?.body) return null;
  const existing = doc.getElementById('streak-celebration-overlay');
  if (existing) existing.remove();

  const previouslyFocused = doc.activeElement;
  const overlay = doc.createElement('div');
  overlay.id = 'streak-celebration-overlay';
  overlay.className = 'streak-celebration-overlay';
  overlay.innerHTML = renderStreakCelebrationMarkup(detail, settings);
  doc.body.appendChild(overlay);
  doc.body.classList.add('streak-celebration-open');

  playInteractionSound('streak');

  const continueBtn = overlay.querySelector('#btn-streak-celebration-continue');
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  let igniteTimer = null;
  let weekTimer = null;
  let revealTimer = null;

  if (reducedMotion) {
    overlay.classList.add('is-ignited', 'is-week-ignited', 'is-cta-ready');
  } else {
    igniteTimer = globalThis.setTimeout(() => {
      if (!overlay.isConnected) return;
      overlay.classList.add('is-ignited');
    }, 320);
    weekTimer = globalThis.setTimeout(() => {
      if (!overlay.isConnected) return;
      overlay.classList.add('is-week-ignited');
    }, 640);
    revealTimer = globalThis.setTimeout(() => {
      if (!overlay.isConnected) return;
      overlay.classList.add('is-cta-ready');
      continueBtn?.focus?.({ preventScroll: true });
    }, 820);
  }

  if (reducedMotion) {
    revealTimer = globalThis.setTimeout(() => {
      continueBtn?.focus?.({ preventScroll: true });
    }, 20);
  }

  const close = () => {
    if (igniteTimer) globalThis.clearTimeout(igniteTimer);
    if (weekTimer) globalThis.clearTimeout(weekTimer);
    if (revealTimer) globalThis.clearTimeout(revealTimer);
    doc.removeEventListener('keydown', onKeyDown);
    overlay.classList.add('is-closing');
    doc.body.classList.remove('streak-celebration-open');
    globalThis.setTimeout(() => {
      overlay.remove();
      previouslyFocused?.focus?.({ preventScroll: true });
    }, reducedMotion ? 0 : 180);
  };

  const onKeyDown = event => {
    if (event.key === 'Escape' || event.key === 'Enter') {
      event.preventDefault();
      close();
    }
  };

  continueBtn?.addEventListener('click', close);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });
  doc.addEventListener('keydown', onKeyDown);
  return { overlay, close };
}
