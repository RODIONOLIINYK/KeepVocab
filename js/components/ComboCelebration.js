import { playInteractionSound } from '../services/interactionSound.js?v=18908';
import { escapeHtml } from '../utils/html.js';

const COMBO_STEP = 5;

const SPARKLES = [
  { x: -206, y: -56, rot: -28, delay: 40, size: 13, color: '#FFD900', shape: 'star' },
  { x: 208, y: -52, rot: 32, delay: 75, size: 14, color: '#FF9600', shape: 'star' },
  { x: -222, y: 12, rot: -45, delay: 110, size: 10, color: '#58CC02', shape: 'pill' },
  { x: 224, y: 10, rot: 40, delay: 95, size: 10, color: '#38BDF8', shape: 'pill' },
  { x: -136, y: -74, rot: -18, delay: 130, size: 9, color: '#FF4B4B', shape: 'dot' },
  { x: 142, y: -72, rot: 22, delay: 150, size: 9, color: '#A855F7', shape: 'dot' },
  { x: -190, y: 58, rot: -35, delay: 140, size: 11, color: '#FFC800', shape: 'star' },
  { x: 194, y: 56, rot: 28, delay: 165, size: 10, color: '#FF9600', shape: 'pill' },
  { x: 0, y: -76, rot: 0, delay: 60, size: 12, color: '#FFD900', shape: 'star' },
  { x: -64, y: -72, rot: -14, delay: 100, size: 8, color: '#38BDF8', shape: 'dot' },
  { x: 66, y: -72, rot: 16, delay: 120, size: 8, color: '#58CC02', shape: 'dot' },
  { x: 0, y: 74, rot: 24, delay: 175, size: 9, color: '#FFD900', shape: 'star' }
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
      kicker: 'LEGENDARY STREAK',
      headline: `${count} in a row!`,
      subtitle: 'Pure fluency mode — nothing can stop you!',
      sound: 'combo10'
    };
  }
  if (count >= 10) {
    return {
      count,
      tier: 'super',
      kicker: 'UNSTOPPABLE',
      headline: `${count} in a row!`,
      subtitle: 'Flawless run — your memory is locked in!',
      sound: 'combo10'
    };
  }
  return {
    count,
    tier: 'blaze',
    kicker: 'ON FIRE',
    headline: `${count} in a row!`,
    subtitle: 'Not a single mistake — keep it rolling!',
    sound: 'combo5'
  };
}

function burstSvg(tier) {
  const primary = tier === 'legend' ? '#C084FC' : tier === 'super' ? '#FF4B4B' : '#FF9600';
  const accent = tier === 'legend' ? '#FFD900' : tier === 'super' ? '#FFD900' : '#FFC800';
  return `<svg class="combo-burst-svg" viewBox="0 0 140 140" width="108" height="108" fill="none" aria-hidden="true">
    <defs>
      <radialGradient id="combo-glow-${tier}" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="${accent}" stop-opacity="0.55"/>
        <stop offset="65%" stop-color="${primary}" stop-opacity="0.16"/>
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
