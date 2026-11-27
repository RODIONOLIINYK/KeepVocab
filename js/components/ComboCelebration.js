import { playInteractionSound } from '../services/interactionSound.js?v=18908';
import { escapeHtml } from '../utils/html.js';

const COMBO_STEP = 5;

const SPARKLES = [
  { x: -204, y: -50, rot: -28, delay: 40, size: 12, color: '#39BD55', shape: 'star' },
  { x: 206, y: -48, rot: 32, delay: 75, size: 12, color: '#F59E0B', shape: 'star' },
  { x: -218, y: 10, rot: -42, delay: 110, size: 9, color: '#86EFAC', shape: 'pill' },
  { x: 220, y: 8, rot: 38, delay: 95, size: 9, color: '#39BD55', shape: 'pill' },
  { x: -134, y: -70, rot: -18, delay: 130, size: 8, color: '#F58A22', shape: 'dot' },
  { x: 138, y: -68, rot: 22, delay: 150, size: 8, color: '#4F8299', shape: 'dot' },
  { x: -188, y: 54, rot: -32, delay: 140, size: 10, color: '#FBBF24', shape: 'star' },
  { x: 192, y: 52, rot: 26, delay: 165, size: 9, color: '#86EFAC', shape: 'pill' },
  { x: 0, y: -72, rot: 0, delay: 60, size: 11, color: '#FBBF24', shape: 'star' },
  { x: -64, y: -68, rot: -14, delay: 100, size: 7, color: '#86EFAC', shape: 'dot' },
  { x: 66, y: -68, rot: 16, delay: 120, size: 7, color: '#F59E0B', shape: 'dot' },
  { x: 0, y: 70, rot: 24, delay: 175, size: 8, color: '#39BD55', shape: 'star' }
];

export function isComboMilestone(combo) {
  const count = Math.floor(Number(combo) || 0);
  return count >= COMBO_STEP && count % COMBO_STEP === 0;
}

export function comboCelebrationConfig(combo) {
  const count = Math.max(COMBO_STEP, Math.floor(Number(combo) || COMBO_STEP));
  if (count >= 15) {
    return {
      count,
      tier: 'legend',
      kicker: 'FLOW STATE',
      headline: `${count} in a row!`,
      subtitle: 'Pure fluency mode — nothing can stop you.',
      sound: 'combo10'
    };
  }
  if (count >= 10) {
    return {
      count,
      tier: 'super',
      kicker: 'UNSTOPPABLE',
      headline: `${count} in a row!`,
      subtitle: 'Flawless run — your memory is locked in.',
      sound: 'combo10'
    };
  }
  return {
    count,
    tier: 'blaze',
    kicker: 'ON A ROLL',
    headline: `${count} in a row!`,
    subtitle: 'Not a single mistake — keep it going.',
    sound: 'combo5'
  };
}

function burstSvg(tier) {
  const primary = tier === 'super' ? '#F58A22' : '#39BD55';
  const accent = tier === 'legend' ? '#F59E0B' : tier === 'super' ? '#FBBF24' : '#86EFAC';
  return `<svg class="combo-burst-svg" viewBox="0 0 140 140" width="108" height="108" fill="none" aria-hidden="true">
    <defs>
      <radialGradient id="combo-glow-${tier}" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="${accent}" stop-opacity="0.45"/>
        <stop offset="65%" stop-color="${primary}" stop-opacity="0.12"/>
        <stop offset="100%" stop-color="${primary}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle class="combo-glow-ring" cx="70" cy="70" r="52" fill="url(#combo-glow-${tier})"/>
    <g class="combo-rays" stroke-linecap="round">
      <line class="combo-ray" x1="70" y1="18" x2="70" y2="6" stroke="${accent}" stroke-width="5" pathLength="100"/>
      <line class="combo-ray" x1="104" y1="34" x2="114" y2="24" stroke="${primary}" stroke-width="5" pathLength="100"/>
      <line class="combo-ray" x1="120" y1="70" x2="130" y2="70" stroke="${accent}" stroke-width="5" pathLength="100"/>
      <line class="combo-ray" x1="104" y1="106" x2="114" y2="116" stroke="${primary}" stroke-width="4.5" pathLength="100"/>
      <line class="combo-ray" x1="36" y1="106" x2="26" y2="116" stroke="${primary}" stroke-width="4.5" pathLength="100"/>
      <line class="combo-ray" x1="20" y1="70" x2="10" y2="70" stroke="${accent}" stroke-width="5" pathLength="100"/>
      <line class="combo-ray" x1="36" y1="34" x2="26" y2="24" stroke="${primary}" stroke-width="5" pathLength="100"/>
    </g>
  </svg>`;
}

function sparklesHtml() {
  return SPARKLES.map(item => `<i class="combo-spark is-${item.shape}" style="--sx:${item.x}px;--sy:${item.y}px;--srot:${item.rot}deg;--sdelay:${item.delay}ms;--ssize:${item.size}px;--scolor:${item.color}"></i>`).join('');
}

export function renderComboCelebrationMarkup(combo) {
  const config = comboCelebrationConfig(combo);
  const icon = config.tier === 'legend' ? 'fa-wand-magic-sparkles' : 'fa-fire';
  return `<div class="combo-celebration-shell">
    <div class="combo-sparkles" aria-hidden="true">${sparklesHtml()}</div>
    <div class="combo-celebration-card is-${config.tier}" role="status" aria-live="polite" data-combo="${config.count}">
      <div class="combo-hero-visual" aria-hidden="true">
        ${burstSvg(config.tier)}
        <img class="combo-mascot-img" src="assets/keepvocab-sprig-celebrate.webp" alt="" width="84" height="84">
        <span class="combo-count-pill">${config.count}×</span>
      </div>
      <div class="combo-copy">
        <span class="combo-kicker"><i class="fa-solid ${icon}" aria-hidden="true"></i> ${escapeHtml(config.kicker)}</span>
        <strong class="combo-headline">${escapeHtml(config.headline)}</strong>
        <span class="combo-subtitle">${escapeHtml(config.subtitle)}</span>
      </div>
    </div>
  </div>`;
}

let activeDismissTimer = null;

export function showComboCelebration(combo, doc = globalThis.document) {
  if (!isComboMilestone(combo)) return null;
  const config = comboCelebrationConfig(combo);
  playInteractionSound(config.sound);
  if (!doc?.body) return { combo: config.count, tier: config.tier, close: () => {} };

  if (activeDismissTimer) {
    globalThis.clearTimeout(activeDismissTimer);
    activeDismissTimer = null;
  }
  const existing = doc.getElementById('combo-celebration-layer');
  if (existing) existing.remove();

  const layer = doc.createElement('div');
  layer.id = 'combo-celebration-layer';
  layer.className = `combo-celebration-layer is-${config.tier}`;
  layer.innerHTML = renderComboCelebrationMarkup(config.count);
  doc.body.appendChild(layer);

  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (activeDismissTimer) {
      globalThis.clearTimeout(activeDismissTimer);
      activeDismissTimer = null;
    }
    layer.classList.add('is-leaving');
    globalThis.setTimeout(() => layer.remove(), reducedMotion ? 0 : 240);
  };

  layer.querySelector('.combo-celebration-card')?.addEventListener('click', close);
  activeDismissTimer = globalThis.setTimeout(close, reducedMotion ? 1400 : 2050);
  return { combo: config.count, tier: config.tier, layer, close };
}
