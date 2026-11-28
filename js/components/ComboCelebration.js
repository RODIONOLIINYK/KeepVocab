import { playInteractionSound } from '../services/interactionSound.js?v=18908';
import { escapeHtml } from '../utils/html.js';

const COMBO_STEP = 5;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function easeOutCubic(x) {
  return 1 - Math.pow(1 - clamp(x, 0, 1), 3);
}

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
      sound: 'combo10'
    };
  }
  if (count >= 10) {
    return {
      count,
      tier: 'super',
      kicker: 'UNSTOPPABLE',
      headline: `${count} in a row!`,
      sound: 'combo10'
    };
  }
  return {
    count,
    tier: 'blaze',
    kicker: 'ON A ROLL',
    headline: `${count} in a row!`,
    sound: 'combo5'
  };
}

function burst(canvas, tier) {
  const ctx = canvas?.getContext('2d');
  if (!ctx || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return () => {};
  const colors = ['#e1bc4c', '#478a50', '#f3db8b', '#a6c884'];
  const count = tier === 'blaze' ? 12 : 24;
  const particles = Array.from({ length: count }, (_, i) => ({
    angle: i * 2.39996,
    radius: 42 + i % 6 * 14,
    color: colors[i % colors.length],
    size: 2.5 + i % 3 * 1.1
  }));
  const started = performance.now();
  let frame;
  function draw(now) {
    const progress = clamp((now - started) / 830, 0, 1);
    const travel = easeOutCubic(progress);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = Math.min(1, progress * 8, (1 - progress) * 3);
    for (const { angle, radius, color, size } of particles) {
      ctx.save();
      ctx.translate(canvas.width / 2 + Math.cos(angle) * radius * travel,
        canvas.height / 2 + Math.sin(angle) * radius * travel + 20 * progress ** 2);
      ctx.rotate(angle + travel * 3);
      ctx.fillStyle = color;
      ctx.fillRect(-size, -size / 2, size * 2, size);
      ctx.restore();
    }
    if (progress < 1) frame = requestAnimationFrame(draw);
  }
  frame = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(frame);
}

export function renderComboCelebrationMarkup(combo) {
  const config = comboCelebrationConfig(combo);
  const icon = config.tier === 'legend' ? 'fa-wand-magic-sparkles' : 'fa-fire';
  return `<canvas class="combo-celebration-canvas" width="248" height="210" aria-hidden="true"></canvas>
  <div class="combo-celebration-shell is-${config.tier}" data-combo="${config.count}">
    <img class="combo-mascot-img" src="assets/keepvocab-sprig-celebrate.webp" alt="" width="64" height="64">
    <div class="combo-copy" role="status" aria-live="polite">
      <span class="combo-kicker"><i class="fa-solid ${icon}" aria-hidden="true"></i> ${escapeHtml(config.kicker)}</span>
      <strong class="combo-headline">${escapeHtml(config.headline)}</strong>
    </div>
    <button type="button" class="combo-continue-cta" id="btn-combo-celebration-continue" aria-label="Dismiss combo celebration">
      <i class="fa-solid fa-xmark" aria-hidden="true"></i>
    </button>
  </div>`;
}

let activeCloseCombo;

export function dismissComboCelebration() {
  activeCloseCombo?.(true);
}

export function showComboCelebration(combo, doc = globalThis.document) {
  if (!isComboMilestone(combo)) return null;
  const config = comboCelebrationConfig(combo);
  playInteractionSound(config.sound);
  if (!doc?.body) return { combo: config.count, tier: config.tier, close: () => {} };
  dismissComboCelebration();

  const layer = doc.createElement('div');
  layer.id = 'combo-celebration-layer';
  layer.className = 'combo-celebration-layer';
  layer.innerHTML = renderComboCelebrationMarkup(config.count);
  doc.body.appendChild(layer);
  const stopBurst = burst(layer.querySelector('canvas'), config.tier);
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const dismiss = layer.querySelector('button');
  let closed = false;
  const close = (immediate = false) => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    stopBurst();
    if (activeCloseCombo === close) activeCloseCombo = null;
    if (immediate || reducedMotion) layer.remove();
    else {
      layer.classList.add('is-leaving');
      setTimeout(() => layer.remove(), 220);
    }
  };
  let timer = setTimeout(close, 2000);
  dismiss.addEventListener('click', () => close());
  dismiss.addEventListener('focus', () => clearTimeout(timer));
  dismiss.addEventListener('blur', () => { if (!closed) timer = setTimeout(close, 400); });
  activeCloseCombo = close;
  return { combo: config.count, tier: config.tier, layer, close };
}
