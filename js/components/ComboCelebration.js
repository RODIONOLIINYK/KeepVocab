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
      subtitle: 'Pure fluency mode — nothing can slow you down.',
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
    subtitle: 'Not a single mistake — keep your rhythm going.',
    sound: 'combo5'
  };
}

function drawLeafShape(ctx, x, y, size, rot, color, alpha) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.bezierCurveTo(size * 0.85, -size * 0.55, size * 0.85, size * 0.55, 0, size);
  ctx.bezierCurveTo(-size * 0.85, size * 0.55, -size * 0.85, -size * 0.55, 0, -size);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawCurvedRibbon(ctx, x, y, len, thick, rot, color, alpha) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = thick;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-len * 0.5, 0);
  ctx.quadraticCurveTo(0, -len * 0.42, len * 0.5, len * 0.08);
  ctx.stroke();
  ctx.restore();
}

function drawSparkStar(ctx, x, y, r, rot, color, alpha) {
  if (alpha <= 0.01 || r <= 0.5) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const rad = i % 2 === 0 ? r : r * 0.34;
    const a = (i * Math.PI) / 4;
    if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
    else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function startComboStageCanvas(canvas, layer, tier, reducedMotion = false) {
  if (!canvas || typeof canvas.getContext !== 'function') return () => {};
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  let rafId = null;
  let stopped = false;
  let startTs = null;

  const palettes = {
    blaze: ['#ffffff', '#d6f3d2', '#fde047', '#fb923c', '#86efac'],
    super: ['#ffffff', '#fef08a', '#fde68a', '#fed7aa', '#86efac'],
    legend: ['#86efac', '#fde68a', '#fbbf24', '#ffffff', '#39bd55']
  };
  const colors = palettes[tier] || palettes.blaze;

  // Fan burst particles across upper arc & left/right flanks so center copy stays crisp and unobstructed.
  const particles = Array.from({ length: 28 }, (_, i) => {
    const frac = i / 27;
    const angle = (-Math.PI * 1.14) + frac * (Math.PI * 1.28) + Math.sin(i * 11) * 0.08;
    return {
      angle,
      speed: 145 + (i % 5) * 48,
      delay: 0.08 + (i % 6) * 0.024,
      life: 1.5 + (i % 4) * 0.32,
      size: 5.5 + (i % 4) * 2.2,
      spin: (i % 2 === 0 ? 1 : -1) * (1.8 + (i % 3) * 0.9),
      rot0: i * 0.7,
      kind: i % 3 === 0 ? 'ribbon' : i % 3 === 1 ? 'leaf' : 'star',
      color: colors[i % colors.length]
    };
  });

  const floaters = Array.from({ length: 16 }, (_, i) => ({
    x: (i + 0.5) / 16,
    y: (i * 0.37) % 1,
    r: 3.5 + (i % 4) * 1.9,
    speed: 0.052 + (i % 4) * 0.017,
    phase: i * 1.4,
    kind: i % 2 === 0 ? 'leaf' : 'dot',
    color: colors[(i + 1) % colors.length]
  }));

  function resize() {
    const rect = layer.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    return { w, h };
  }

  function drawFrame(t) {
    const { w, h } = resize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const hero = layer.querySelector('.combo-hero-visual');
    const hostRect = layer.getBoundingClientRect();
    const heroRect = hero ? hero.getBoundingClientRect() : null;
    const cx = heroRect ? (heroRect.left - hostRect.left) + heroRect.width / 2 : w * 0.5;
    const cy = heroRect ? (heroRect.top - hostRect.top) + heroRect.height / 2 : h * 0.38;
    const maxR = Math.hypot(w, h) * 0.56;

    // 1. Expanding concentric botanical ripples
    if (!reducedMotion) {
      for (let i = 0; i < 3; i++) {
        const rp = clamp((t - i * 0.14) / 1.15, 0, 1);
        if (rp > 0 && rp < 1) {
          const e = easeOutCubic(rp);
          ctx.save();
          ctx.globalAlpha = (1 - e) * 0.24;
          ctx.strokeStyle = tier === 'legend' && i === 1 ? '#fde68a' : '#ffffff';
          ctx.lineWidth = 3.5 - e * 2.2;
          ctx.beginPath();
          ctx.arc(cx, cy, 40 + e * maxR * 0.78, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // 2. Soft rotating sunlit rays on 10x and 15x full-screen stages
    if (tier === 'super' || tier === 'legend') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(reducedMotion ? 0 : t * (tier === 'legend' ? 0.2 : 0.15));
      const rays = 10;
      const beamAlpha = (reducedMotion ? 1 : easeOutCubic(t / 0.45)) * (tier === 'legend' ? 0.085 : 0.11);
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2;
        ctx.fillStyle = tier === 'legend'
          ? (i % 2 === 0 ? `rgba(134, 239, 172, ${beamAlpha})` : `rgba(253, 230, 138, ${beamAlpha})`)
          : `rgba(255, 251, 235, ${beamAlpha})`;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, maxR, a, a + (Math.PI / rays) * 0.58);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // 3. Ambient rising leaves & sunlit dots
    const ambIn = reducedMotion ? 1 : easeOutCubic((t - 0.14) / 0.45);
    for (const f of floaters) {
      const fy = ((f.y - (reducedMotion ? 0 : t * f.speed)) % 1 + 1) % 1;
      const fx = f.x * w + (reducedMotion ? 0 : Math.sin(t * 1.8 + f.phase) * 16);
      const fade = Math.sin(fy * Math.PI) * ambIn;
      if (f.kind === 'leaf') {
        drawLeafShape(ctx, fx, fy * h, f.r * 1.4, reducedMotion ? f.phase : Math.sin(t * 1.6 + f.phase) * 0.7, f.color, fade * 0.22);
      } else {
        ctx.save();
        ctx.globalAlpha = fade * 0.25;
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.arc(fx, fy * h, f.r * 0.72, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // 4. Fountain of Sprig's curved confetti ribbons, leaves & stars
    if (!reducedMotion) {
      const distScale = w < 440 ? 0.72 : 1.05;
      for (const p of particles) {
        const lt = (t - p.delay) / p.life;
        if (lt <= 0 || lt >= 1) continue;
        const e = easeOutCubic(lt);
        const dist = p.speed * e * distScale;
        const x = cx + Math.cos(p.angle) * dist;
        const y = cy + Math.sin(p.angle) * dist * 0.86 + Math.pow(lt, 2) * 48;
        const alpha = lt < 0.12 ? lt / 0.12 : 1 - easeOutCubic((lt - 0.55) / 0.45);
        const rot = p.rot0 + lt * p.spin * 2.2;
        if (p.kind === 'ribbon') {
          drawCurvedRibbon(ctx, x, y, p.size * 2.05, 4.4, rot, p.color, alpha * 0.92);
        } else if (p.kind === 'leaf') {
          drawLeafShape(ctx, x, y, p.size * 0.95, rot, p.color, alpha * 0.88);
        } else {
          drawSparkStar(ctx, x, y, p.size * 0.95, rot, p.color, alpha * 0.92);
        }
      }
    }
  }

  if (reducedMotion || typeof globalThis.requestAnimationFrame !== 'function') {
    drawFrame(0.6);
    return () => {};
  }

  const loop = ts => {
    if (stopped || !canvas.isConnected) return;
    if (startTs === null) startTs = ts;
    drawFrame((ts - startTs) / 1000);
    rafId = globalThis.requestAnimationFrame(loop);
  };
  rafId = globalThis.requestAnimationFrame(loop);

  return () => {
    stopped = true;
    if (rafId !== null && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(rafId);
    }
  };
}

export function renderComboCelebrationMarkup(combo) {
  const config = comboCelebrationConfig(combo);
  const icon = config.tier === 'legend' ? 'fa-wand-magic-sparkles' : 'fa-fire';
  return `<canvas class="combo-celebration-canvas" aria-hidden="true"></canvas>
  <div class="combo-celebration-shell is-${config.tier}" role="status" aria-live="polite" data-combo="${config.count}">
    <div class="combo-celebration-body">
      <div class="combo-hero-visual" aria-hidden="true">
        <span class="combo-hero-halo"></span>
        <img class="combo-mascot-img" src="assets/keepvocab-sprig-celebrate.webp" alt="" width="144" height="144">
        <span class="combo-count-pill">${config.count}×</span>
      </div>
      <div class="combo-copy">
        <span class="combo-kicker"><i class="fa-solid ${icon}" aria-hidden="true"></i> ${escapeHtml(config.kicker)}</span>
        <strong class="combo-headline">${escapeHtml(config.headline)}</strong>
        <span class="combo-subtitle">${escapeHtml(config.subtitle)}</span>
      </div>
    </div>
    <div class="combo-celebration-footer">
      <button type="button" class="combo-continue-cta" id="btn-combo-celebration-continue">
        <span>Continue</span>
        <span class="combo-auto-bar" aria-hidden="true"></span>
      </button>
    </div>
  </div>`;
}

let activeCloseCombo = null;

export function showComboCelebration(combo, doc = globalThis.document) {
  if (!isComboMilestone(combo)) return null;
  const config = comboCelebrationConfig(combo);
  playInteractionSound(config.sound);
  if (!doc?.body) return { combo: config.count, tier: config.tier, close: () => {} };

  if (activeCloseCombo) {
    activeCloseCombo({ immediate: true });
    activeCloseCombo = null;
  }
  const existing = doc.getElementById('combo-celebration-layer');
  if (existing) existing.remove();

  const layer = doc.createElement('div');
  layer.id = 'combo-celebration-layer';
  layer.className = `combo-celebration-layer is-${config.tier}`;
  layer.innerHTML = renderComboCelebrationMarkup(config.count);
  doc.body.appendChild(layer);
  doc.body.classList.add('combo-celebration-open');

  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const canvas = layer.querySelector('.combo-celebration-canvas');
  const stopCanvas = startComboStageCanvas(canvas, layer, config.tier, reducedMotion);

  let dismissTimer = null;
  let closed = false;

  const onKeyDown = event => {
    if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      close();
    }
  };

  const close = ({ immediate = false } = {}) => {
    if (closed) return;
    closed = true;
    if (dismissTimer) {
      globalThis.clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    if (activeCloseCombo === close) activeCloseCombo = null;
    stopCanvas();
    doc.removeEventListener('keydown', onKeyDown);
    doc.body.classList.remove('combo-celebration-open');
    if (immediate || reducedMotion) {
      layer.remove();
      return;
    }
    layer.classList.add('is-leaving');
    globalThis.setTimeout(() => layer.remove(), 220);
  };

  activeCloseCombo = close;
  layer.addEventListener('click', () => close());
  doc.addEventListener('keydown', onKeyDown);
  dismissTimer = globalThis.setTimeout(() => close(), reducedMotion ? 1600 : 2300);
  return { combo: config.count, tier: config.tier, layer, close };
}
