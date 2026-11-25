import { getStreakSummary } from '../services/studyActivity.js';
import { playInteractionSound } from '../services/interactionSound.js?v=18908';
import { escapeHtml } from '../utils/html.js';

const CONFETTI_COLORS = ['#fb923c', '#facc15', '#4ade80', '#38bdf8', '#c084fc', '#f472b6'];

function confettiPiecesHtml(count = 24) {
  return Array.from({ length: count }, (_, idx) => {
    const angle = (idx / count) * 360;
    const distance = 95 + (idx % 4) * 34;
    const rad = (angle * Math.PI) / 180;
    const tx = Math.round(Math.cos(rad) * distance);
    const ty = Math.round(Math.sin(rad) * distance - 18);
    const rot = ((idx * 47) % 360) - 180;
    const delay = (idx % 6) * 45;
    const color = CONFETTI_COLORS[idx % CONFETTI_COLORS.length];
    return `<i class="streak-confetti-piece" style="--tx:${tx}px;--ty:${ty}px;--rot:${rot}deg;--delay:${delay}ms;--color:${color}"></i>`;
  }).join('');
}

function flameSvg() {
  return `<svg class="streak-flame-svg" viewBox="0 0 140 140" width="136" height="136" fill="none" aria-hidden="true">
    <defs>
      <radialGradient id="streak-halo-grad" cx="50%" cy="55%" r="50%">
        <stop offset="0%" stop-color="#fde047" stop-opacity="0.72"/>
        <stop offset="60%" stop-color="#fb923c" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="#fb923c" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="streak-flame-outer" x1="70" y1="16" x2="70" y2="124" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#fde047"/>
        <stop offset="38%" stop-color="#fb923c"/>
        <stop offset="100%" stop-color="#ea580c"/>
      </linearGradient>
      <linearGradient id="streak-flame-inner" x1="70" y1="54" x2="70" y2="120" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#fef9c3"/>
        <stop offset="60%" stop-color="#fde047"/>
        <stop offset="100%" stop-color="#f97316"/>
      </linearGradient>
    </defs>
    <circle class="streak-flame-halo" cx="70" cy="76" r="58" fill="url(#streak-halo-grad)"/>
    <g class="streak-flame-body">
      <path d="M74 16c4 20-12 31-18 42-4 7-3 15-3 15s11-7 16-17c17 15 29 33 29 51 0 19-16 32-34 32-20 0-35-15-35-35 0-21 15-38 27-53 8-10 14-21 18-35z" fill="url(#streak-flame-outer)"/>
      <path class="streak-flame-core" d="M68 62c11 10 17 20 17 31 0 11-8 20-19 20-11 0-19-9-19-20 0-11 8-20 21-31z" fill="url(#streak-flame-inner)"/>
      <ellipse cx="66" cy="96" rx="7" ry="10" fill="#fffbeb" opacity="0.88"/>
    </g>
    <circle class="streak-spark s1" cx="34" cy="48" r="3.5" fill="#fde047"/>
    <circle class="streak-spark s2" cx="107" cy="44" r="3" fill="#fb923c"/>
    <circle class="streak-spark s3" cx="99" cy="24" r="2.5" fill="#fef08a"/>
    <circle class="streak-spark s4" cx="44" cy="28" r="2.2" fill="#fdba74"/>
  </svg>`;
}

export function streakCelebrationSubtitle(detail = {}) {
  const streak = Math.max(1, Number(detail.streak) || 1);
  if (detail.milestone) return `Incredible ${streak}-day milestone — your habit is locked in.`;
  if (detail.freezeProtected) return 'A Streak Freeze carried you here, and today you kept the flame burning.';
  if (streak === 1) return 'You sparked day 1. Show up tomorrow and watch this flame grow.';
  return 'Daily goal complete — your vocabulary habit stays alive today.';
}

export function renderStreakCelebrationMarkup(detail = {}, settings = {}) {
  const streak = Math.max(1, Number(detail.streak) || 1);
  const previousStreak = Math.max(0, Number(detail.previousStreak ?? Math.max(0, streak - 1)));
  const summary = getStreakSummary(settings);
  const xpBonus = Math.max(0, Number(detail.xpBonus) || (detail.milestone ? 50 : 25));
  const banked = Math.max(0, Number(detail.bankedFreezes ?? summary.bankedFreezes) || 0);
  const rewards = [];
  if (xpBonus > 0) {
    rewards.push(`<span class="streak-reward-pill is-xp"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> +${xpBonus} XP</span>`);
  }
  if (detail.milestone) {
    rewards.push(`<span class="streak-reward-pill is-milestone"><i class="fa-solid fa-fire" aria-hidden="true"></i> ${streak}-day milestone</span>`);
  }
  if (detail.earnedFreeze) {
    rewards.push(`<span class="streak-reward-pill is-freeze"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i> +1 Streak Freeze (${banked}/2)</span>`);
  }
  if (detail.freezeProtected) {
    rewards.push('<span class="streak-reward-pill is-freeze"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i> Protected by Freeze</span>');
  }
  if (detail.leveledUp && detail.nextLevel) {
    rewards.push(`<span class="streak-reward-pill is-level"><i class="fa-solid fa-seedling" aria-hidden="true"></i> Level ${Number(detail.nextLevel)} unlocked!</span>`);
  }

  const weekHtml = summary.weekWindow.map(day => {
    const isTodayLit = day.isToday;
    const isLit = isTodayLit || day.status === 'goal';
    const isFrozen = !isTodayLit && day.status === 'frozen';
    const icon = isLit ? 'fa-check' : isFrozen ? 'fa-shield-halved' : '';
    return `<div class="streak-celebration-day${isLit ? ' is-lit' : ''}${isTodayLit ? ' is-today-ignite' : ''}${isFrozen ? ' is-frozen' : ''}" role="listitem" aria-label="${escapeHtml(`${day.weekdayShort}: ${isLit ? 'completed' : isFrozen ? 'frozen' : 'not completed'}`)}">
      <span class="streak-celebration-dot">${icon ? `<i class="fa-solid ${icon}" aria-hidden="true"></i>` : ''}</span>
      <small>${escapeHtml(day.weekdayShort)}</small>
    </div>`;
  }).join('');

  return `<div class="streak-celebration-card${detail.milestone ? ' is-milestone' : ''}" role="dialog" aria-modal="true" aria-labelledby="streak-celebration-title">
    <div class="streak-celebration-stage">
      <div class="streak-confetti-burst" aria-hidden="true">${confettiPiecesHtml(24)}</div>
      <div class="streak-shockwave" aria-hidden="true"></div>
      <div class="streak-flame-wrap">${flameSvg()}</div>
      <div class="streak-counter-wrap">
        <span class="streak-counter-number" id="streak-celebration-count" data-from="${previousStreak}" data-to="${streak}">${previousStreak}</span>
      </div>
    </div>
    <h2 id="streak-celebration-title">${streak === 1 ? '1 day streak!' : `${streak} day streak!`}</h2>
    <p class="streak-celebration-subtitle">${escapeHtml(streakCelebrationSubtitle(detail))}</p>
    <div class="streak-celebration-week" role="list" aria-label="Last 7 days streak progress">${weekHtml}</div>
    ${rewards.length ? `<div class="streak-celebration-rewards">${rewards.join('')}</div>` : ''}
    <div class="streak-celebration-sprig">
      <img src="assets/keepvocab-sprig-celebrate.webp" alt="" aria-hidden="true" width="64" height="64">
      <span>${escapeHtml(detail.milestone ? 'Sprig is cheering for your milestone!' : 'Keep the momentum going tomorrow!')}</span>
    </div>
    <button type="button" class="btn-green-solid streak-celebration-cta" id="btn-streak-celebration-continue">Continue</button>
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

  const countEl = overlay.querySelector('#streak-celebration-count');
  const continueBtn = overlay.querySelector('#btn-streak-celebration-continue');
  const streak = Math.max(1, Number(detail.streak) || 1);
  const previous = Math.max(0, Number(detail.previousStreak ?? Math.max(0, streak - 1)));
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  let tickTimer = null;
  let revealTimer = null;
  if (reducedMotion || previous === streak) {
    if (countEl) countEl.textContent = String(streak);
    overlay.classList.add('is-ignited');
  } else {
    tickTimer = globalThis.setTimeout(() => {
      if (!overlay.isConnected || !countEl) return;
      countEl.textContent = String(streak);
      countEl.classList.add('is-ticked');
      overlay.classList.add('is-ignited');
    }, 460);
  }

  revealTimer = globalThis.setTimeout(() => {
    continueBtn?.focus?.({ preventScroll: true });
  }, reducedMotion ? 20 : 620);

  const close = () => {
    if (tickTimer) globalThis.clearTimeout(tickTimer);
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
