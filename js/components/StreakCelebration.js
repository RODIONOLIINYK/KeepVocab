import { getStreakSummary } from '../services/studyActivity.js';
import { playInteractionSound } from '../services/interactionSound.js?v=18908';
import { escapeHtml } from '../utils/html.js';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function easeOutCubic(x) {
  return 1 - Math.pow(1 - clamp(x, 0, 1), 3);
}

function easeOutBack(x, s = 1.7) {
  const t = clamp(x, 0, 1) - 1;
  return 1 + (s + 1) * Math.pow(t, 3) + s * Math.pow(t, 2);
}

function easeSpring(x, damping = 5.4, freq = 9.6) {
  const t = clamp(x, 0, 1);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.exp(-damping * t) * Math.cos(freq * t);
}

/* ============================================================================
   Rive-style procedural Bezier flame engine (60fps Canvas 2D).
   Progressive bottom-up liquid fire emergence on KeepVocab's sunlit hearth:
     1. Dormant warm-stone flame silhouette + falling golden spark bead
     2. Expanding warm golden ripple rings & sunlit radial dawn bloom
     3. Molten base pool swells -> central ember spire whips upward with an
        S-wave curl -> left & right secondary flame tongues peel out in stages
     4. Sunlit gold mid-flame & cream-white heart bloom out-of-phase
     5. Diagonal glossy highlight sheen sweeps across + curved teardrop embers
        arc upward off the shoulders and continue rising softly while idle.
   ============================================================================ */
function traceOrganicFlamePath(ctx, cx, baseY, w, h, bend, leftTongue, rightLobe, tipWhip) {
  const rW = w * 0.5;
  const topY = baseY - h;
  const tipX = cx + bend * w * 0.22 + tipWhip * w * 0.14;
  const lt = clamp(leftTongue, 0, 1.25);

  ctx.beginPath();
  ctx.moveTo(cx, baseY);

  // Right plush rounded hearth bowl climbing smoothly to right flank
  ctx.bezierCurveTo(
    cx + rW * 0.68, baseY,
    cx + rW * 1.04, baseY - h * 0.22,
    cx + rW * (0.94 + rightLobe * 0.09), baseY - h * 0.45
  );

  // Right flank curving smoothly up into the curling flame crest
  ctx.bezierCurveTo(
    cx + rW * (0.82 + rightLobe * 0.12), baseY - h * 0.68,
    cx + rW * 0.42 + bend * w * 0.18, baseY - h * 0.82,
    tipX, topY
  );

  // Smooth S-curve descending into the valley before the left secondary tongue
  const valleyX = cx - rW * (0.28 + lt * 0.10) + bend * w * 0.08;
  const valleyY = baseY - h * (0.56 - lt * 0.05);
  ctx.bezierCurveTo(
    cx - rW * 0.14 + bend * w * 0.16, baseY - h * 0.84,
    cx - rW * 0.30 + bend * w * 0.08, baseY - h * 0.68,
    valleyX, valleyY
  );

  // Sculpted rounded-organic left secondary flame tongue peeling upward
  const lobeH = 0.54 + lt * 0.14;
  const lobeTipX = cx - rW * (0.54 + lt * 0.22) + bend * w * 0.04;
  const lobeTipY = baseY - h * lobeH;
  ctx.bezierCurveTo(
    cx - rW * (0.36 + lt * 0.14), baseY - h * (lobeH - 0.03),
    cx - rW * (0.46 + lt * 0.22), baseY - h * (lobeH + 0.03),
    lobeTipX, lobeTipY
  );

  // Lush rounded outer left flank sweeping seamlessly back into the base bowl
  ctx.bezierCurveTo(
    cx - rW * (0.98 + lt * 0.08), baseY - h * 0.46,
    cx - rW * 1.04, baseY - h * 0.15,
    cx, baseY
  );
  ctx.closePath();
}

function traceInnerFlamePath(ctx, cx, baseY, w, h, sway) {
  const rW = w * 0.5;
  const topY = baseY - h;
  const tipX = cx + sway * w * 0.22;
  ctx.beginPath();
  ctx.moveTo(cx, baseY);
  ctx.bezierCurveTo(
    cx + rW * 0.74, baseY,
    cx + rW * 1.04, baseY - h * 0.30,
    cx + rW * 0.70 + sway * w * 0.10, baseY - h * 0.62
  );
  ctx.bezierCurveTo(
    cx + rW * 0.44 + sway * w * 0.16, baseY - h * 0.82,
    cx + rW * 0.14 + sway * w * 0.20, baseY - h * 0.92,
    tipX, topY
  );
  ctx.bezierCurveTo(
    cx - rW * 0.18 + sway * w * 0.14, baseY - h * 0.84,
    cx - rW * 0.54 + sway * w * 0.06, baseY - h * 0.64,
    cx - rW * 0.78, baseY - h * 0.42
  );
  ctx.bezierCurveTo(
    cx - rW * 1.02, baseY - h * 0.22,
    cx - rW * 0.72, baseY,
    cx, baseY
  );
  ctx.closePath();
}

function drawTeardropEmber(ctx, x, y, r, angle, color, alpha) {
  if (alpha <= 0.01 || r <= 0.4) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.85);
  ctx.bezierCurveTo(r * 0.95, -r * 0.4, r * 0.9, r * 0.85, 0, r);
  ctx.bezierCurveTo(-r * 0.9, r * 0.85, -r * 0.95, -r * 0.4, 0, -r * 1.85);
  ctx.closePath();
  ctx.fill();
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

function startStreakFlameEngine(canvas, overlay, { isMilestone = false, reducedMotion = false } = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') return () => {};
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  let rafId = null;
  let stopped = false;
  let startTs = null;

  const bgMotes = Array.from({ length: 18 }, (_, i) => ({
    x: (i + 0.5) / 18 + Math.sin(i * 19.3) * 0.03,
    y: ((i * 0.37) % 1),
    r: 1.8 + (i % 4) * 0.85,
    speed: 0.032 + (i % 5) * 0.011,
    phase: i * 1.7,
    color: i % 3 === 0 ? '#f59e0b' : i % 3 === 1 ? '#fb923c' : '#39bd55'
  }));

  const burstEmbers = Array.from({ length: isMilestone ? 20 : 16 }, (_, i) => {
    const side = i % 2 === 0 ? 1 : -1;
    const spread = 0.24 + ((i * 37) % 100) / 100;
    return {
      delay: 0.28 + (i % 6) * 0.042,
      life: 0.8 + (i % 4) * 0.14,
      vx: side * (28 + spread * 68),
      vy: -(74 + ((i * 53) % 76)),
      curl: side * (14 + (i % 3) * 8),
      size: 3.1 + (i % 4) * 1.15,
      isStar: i % 4 === 0,
      color: i % 3 === 0 ? '#f59e0b' : i % 3 === 1 ? '#ea580c' : '#39bd55'
    };
  });

  const idleEmbers = [];
  let nextIdleSpawn = 1.05;

  function resize() {
    const rect = overlay.getBoundingClientRect();
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

    const slot = overlay.querySelector('.streak-celebration-stage');
    const hostRect = overlay.getBoundingClientRect();
    const slotRect = slot
      ? slot.getBoundingClientRect()
      : { left: hostRect.left, top: hostRect.top + 32, width: w, height: 158 };
    const cx = (slotRect.left - hostRect.left) + slotRect.width / 2;
    const slotH = Math.max(110, slotRect.height);
    const scale = clamp(slotH / 138, 0.82, 1.32);
    const baseY = (slotRect.top - hostRect.top) + slotH * 0.88;

    // 1. Dedicated full-screen warm sunlit hearth bloom as the flame ignites
    const glowP = easeOutCubic((t - 0.22) / 0.65);
    const breathe = 1 + Math.sin(t * 2.2) * 0.04;
    if (glowP > 0.001) {
      const glowR = Math.max(w, h) * 0.58 * (0.55 + 0.45 * glowP) * breathe;
      const bgGlow = ctx.createRadialGradient(cx, baseY - 46 * scale, 10, cx, baseY - 30 * scale, glowR);
      bgGlow.addColorStop(0, `rgba(251, 191, 36, ${0.34 * glowP})`);
      bgGlow.addColorStop(0.26, `rgba(245, 138, 34, ${0.15 * glowP})`);
      bgGlow.addColorStop(0.56, `rgba(255, 237, 213, ${0.22 * glowP})`);
      bgGlow.addColorStop(1, 'rgba(255, 251, 242, 0)');
      ctx.fillStyle = bgGlow;
      ctx.fillRect(0, 0, w, h);
    }

    // Soft rotating sunlit rays on milestone days (subtle warm gold on ivory)
    if (isMilestone && glowP > 0.05) {
      ctx.save();
      ctx.translate(cx, baseY - 48 * scale);
      ctx.rotate(t * 0.14);
      const rays = 10;
      const rayR = Math.max(w, h) * 0.62;
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2;
        ctx.fillStyle = `rgba(245, 158, 11, ${0.055 * glowP})`;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, rayR, a, a + (Math.PI / rays) * 0.56);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // Gentle rising warm amber & sage motes across the sunlit backdrop
    if (!reducedMotion && glowP > 0.1) {
      for (const m of bgMotes) {
        const my = ((m.y - t * m.speed) % 1 + 1) % 1;
        const mx = m.x * w + Math.sin(t * 1.4 + m.phase) * 14;
        const edgeFade = Math.sin(my * Math.PI);
        ctx.save();
        ctx.globalAlpha = 0.24 * glowP * edgeFade;
        ctx.fillStyle = m.color;
        ctx.beginPath();
        ctx.arc(mx, my * h, m.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // 2. Stage 0: Dormant warm-stone unlit flame silhouette (anticipation)
    const unlitAlpha = t < 0.24
      ? easeOutCubic(t / 0.18)
      : 1 - easeOutCubic((t - 0.28) / 0.18);
    if (unlitAlpha > 0.01) {
      const squish = t > 0.19 && t < 0.30
        ? 1 - Math.sin(clamp((t - 0.19) / 0.11, 0, 1) * Math.PI) * 0.08
        : 1;
      ctx.save();
      ctx.globalAlpha = unlitAlpha;
      traceOrganicFlamePath(ctx, cx, baseY, 78 * scale / squish, 98 * scale * squish, 0, 0, 0, 0);
      ctx.fillStyle = '#e5dfd2';
      ctx.fill();
      traceInnerFlamePath(ctx, cx, baseY - 5 * scale, 44 * scale / squish, 54 * scale * squish, 0);
      ctx.fillStyle = '#f2ede2';
      ctx.fill();
      ctx.restore();
    }

    // 3. Stage 0.5: Golden ignition spark bead dropping into the hearth
    if (!reducedMotion && t >= 0.10 && t <= 0.31) {
      const sp = easeOutCubic((t - 0.10) / 0.17);
      const sy = (baseY - 96 * scale) + sp * (84 * scale);
      const sr = (3.8 + Math.sin(sp * Math.PI) * 4.5) * scale;
      const sAlpha = t > 0.26 ? 1 - (t - 0.26) / 0.05 : Math.min(1, sp * 2.5);
      drawTeardropEmber(ctx, cx, sy, sr, Math.PI, '#f59e0b', sAlpha);
    }

    // 4. Stage 1: Clean expanding golden ripple rings (organic, zero harsh spikes)
    if (!reducedMotion && t >= 0.25 && t <= 1.05) {
      for (let ring = 0; ring < 2; ring++) {
        const rp = clamp((t - (0.25 + ring * 0.09)) / 0.56, 0, 1);
        if (rp > 0 && rp < 1) {
          const e = easeOutCubic(rp);
          const rad = (16 + e * (92 + ring * 24)) * scale;
          ctx.save();
          ctx.globalAlpha = (1 - e) * (ring === 0 ? 0.52 : 0.3);
          ctx.strokeStyle = ring === 0 ? '#f58a22' : '#fbbf24';
          ctx.lineWidth = (4.5 - e * 3.4) * scale;
          ctx.beginPath();
          ctx.arc(cx, baseY - 44 * scale, rad, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // 5. Stage 2+: Progressive bottom-up liquid Bezier fire emergence
    if (t >= 0.24) {
      const et = t - 0.24;
      const poolW = reducedMotion ? 1 : easeOutCubic(et / 0.28);
      const spireRise = reducedMotion ? 1 : easeSpring((et - 0.05) / 0.66, 5.2, 9.4);
      const growMid = reducedMotion ? 1 : easeSpring((et - 0.16) / 0.62, 5.6, 10.0);
      const growCore = reducedMotion ? 1 : easeSpring((et - 0.25) / 0.56, 6.2, 10.4);

      const dartPhase = reducedMotion ? 0 : Math.exp(-et * 4.2);
      const widthStretch = 0.78 + 0.22 * poolW - 0.18 * dartPhase * Math.cos(et * 9.5);
      const heightStretch = 1 + 0.18 * dartPhase * Math.sin(et * 10.2);

      const emergeWhip = reducedMotion ? 0 : Math.exp(-et * 3.0) * Math.sin(et * 12.2) * 1.15;
      const idleSway = reducedMotion ? 0 : Math.sin(t * 3.0) * 0.22 + Math.sin(t * 5.1) * 0.08;
      const bend = emergeWhip + idleSway;
      const tipWhip = reducedMotion ? 0 : Math.exp(-et * 2.8) * Math.cos(et * 13.0) * 0.85 + Math.sin(t * 4.4 - 0.8) * 0.28;
      const leftLobe = reducedMotion ? 0.9 : easeOutBack((et - 0.18) / 0.44, 2.0) * (0.86 + 0.14 * Math.sin(t * 3.8 + 1.1));
      const rightLobe = reducedMotion ? 0.9 : easeOutBack((et - 0.22) / 0.44, 1.8) * (0.86 + 0.14 * Math.cos(t * 4.1 + 0.4));

      const outerW = Math.max(8, 86 * scale * clamp(poolW, 0.15, 1.08) * widthStretch);
      const outerH = Math.max(10, 108 * scale * clamp(spireRise, 0.08, 1.22) * heightStretch);

      // Soft warm saucer shadow beneath the base + luminous radial halo behind the fire
      const haloAlpha = clamp(spireRise, 0, 1);
      ctx.save();
      ctx.fillStyle = `rgba(234, 88, 12, ${0.12 * haloAlpha})`;
      ctx.beginPath();
      ctx.ellipse(cx, baseY + 5 * scale, outerW * 0.34, 5.5 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const haloGrad = ctx.createRadialGradient(cx, baseY - outerH * 0.44, 6, cx, baseY - outerH * 0.44, 76 * scale);
      haloGrad.addColorStop(0, `rgba(251, 191, 36, ${0.42 * haloAlpha})`);
      haloGrad.addColorStop(0.52, `rgba(245, 138, 34, ${0.14 * haloAlpha})`);
      haloGrad.addColorStop(1, 'rgba(245, 138, 34, 0)');
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(cx, baseY - outerH * 0.44, 76 * scale, 0, Math.PI * 2);
      ctx.fill();

      // Outer Ember-to-Tangerine Flame Body
      ctx.save();
      traceOrganicFlamePath(ctx, cx, baseY, outerW, outerH, bend, leftLobe, rightLobe, tipWhip);
      const outerGrad = ctx.createLinearGradient(cx, baseY - outerH, cx, baseY);
      outerGrad.addColorStop(0, '#f59e0b');
      outerGrad.addColorStop(0.36, '#f58a22');
      outerGrad.addColorStop(0.78, '#ea580c');
      outerGrad.addColorStop(1, '#d9480f');
      ctx.fillStyle = outerGrad;
      ctx.fill();

      // Clipped glossy Rive-style diagonal sheen sweep right after emergence peaks
      const sheenP = reducedMotion ? 1 : clamp((t - 0.68) / 0.44, 0, 1);
      if (sheenP > 0 && sheenP < 1) {
        ctx.save();
        ctx.clip();
        const sx = (cx - 94 * scale) + easeOutCubic(sheenP) * (188 * scale);
        ctx.translate(sx, baseY - outerH * 0.5);
        ctx.rotate(0.42);
        const sg = ctx.createLinearGradient(-18 * scale, 0, 18 * scale, 0);
        sg.addColorStop(0, 'rgba(255, 255, 255, 0)');
        sg.addColorStop(0.5, 'rgba(255, 251, 235, 0.46)');
        sg.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = sg;
        ctx.fillRect(-18 * scale, -outerH, 36 * scale, outerH * 2);
        ctx.restore();
      }
      ctx.restore();

      // Mid Sunlit Amber-Gold Inner Flame (dances independently out-of-phase)
      if (growMid > 0.02) {
        const midSway = reducedMotion ? 0 : -emergeWhip * 0.55 + Math.sin(t * 4.4 + 1.3) * 0.32;
        const midW = 52 * scale * clamp(growMid, 0, 1.14) * (1 + (reducedMotion ? 0 : Math.sin(t * 3.8) * 0.03));
        const midH = 70 * scale * clamp(growMid, 0, 1.18) * (1 - (reducedMotion ? 0 : Math.sin(t * 3.8) * 0.035));
        traceInnerFlamePath(ctx, cx + bend * 2.5 * scale, baseY - 3 * scale, midW, midH, midSway);
        const midGrad = ctx.createLinearGradient(cx, baseY - midH, cx, baseY);
        midGrad.addColorStop(0, '#fef08a');
        midGrad.addColorStop(0.48, '#fbbf24');
        midGrad.addColorStop(1, '#f59e0b');
        ctx.fillStyle = midGrad;
        ctx.fill();
      }

      // Inner Cream-Gold Heart Core
      if (growCore > 0.02) {
        const corePulse = reducedMotion ? 1 : 1 + Math.sin(t * 5.2) * 0.055;
        const coreSway = reducedMotion ? 0 : Math.sin(t * 5.1 + 2.1) * 0.24;
        const coreW = 28 * scale * clamp(growCore, 0, 1.12) * corePulse;
        const coreH = 38 * scale * clamp(growCore, 0, 1.14) * corePulse;
        traceInnerFlamePath(ctx, cx, baseY - 5 * scale, coreW, coreH, coreSway);
        const coreGrad = ctx.createLinearGradient(cx, baseY - coreH, cx, baseY);
        coreGrad.addColorStop(0, '#ffffff');
        coreGrad.addColorStop(0.62, '#fef3c7');
        coreGrad.addColorStop(1, '#fde68a');
        ctx.fillStyle = coreGrad;
        ctx.fill();
      }
    }

    // 6. Burst Teardrop Embers & Botanical Sparks (curved buoyant paths)
    if (!reducedMotion) {
      for (const e of burstEmbers) {
        const lt = (t - e.delay) / e.life;
        if (lt <= 0 || lt >= 1) continue;
        const p = easeOutCubic(lt);
        const x = cx + e.vx * p * scale + Math.sin(lt * Math.PI * 1.4) * e.curl * scale;
        const y = (baseY - 40 * scale) + e.vy * p * scale - Math.pow(lt, 2) * 18 * scale;
        const alpha = lt < 0.16 ? lt / 0.16 : 1 - easeOutCubic((lt - 0.16) / 0.84);
        const r = e.size * scale * (1 - lt * 0.65);
        if (e.isStar) {
          drawSparkStar(ctx, x, y, r * 1.35, lt * 2.4, e.color, alpha);
        } else {
          const angle = Math.atan2(e.vx * (1 - p), -e.vy) * 0.45;
          drawTeardropEmber(ctx, x, y, r, angle, e.color, alpha);
        }
      }

      // 7. Continuous gentle rising wisps detaching from the living flame
      if (t >= nextIdleSpawn) {
        nextIdleSpawn = t + 0.30 + Math.random() * 0.16;
        idleEmbers.push({
          born: t,
          life: 0.95 + Math.random() * 0.45,
          x0: cx + (Math.random() - 0.5) * 32 * scale,
          y0: baseY - (78 + Math.random() * 24) * scale,
          drift: (Math.random() - 0.5) * 28 * scale,
          rise: (46 + Math.random() * 34) * scale,
          r: (2.3 + Math.random() * 1.8) * scale,
          color: Math.random() > 0.35 ? '#f59e0b' : '#ea580c'
        });
      }
      for (let i = idleEmbers.length - 1; i >= 0; i--) {
        const em = idleEmbers[i];
        const lt = (t - em.born) / em.life;
        if (lt >= 1) {
          idleEmbers.splice(i, 1);
          continue;
        }
        const x = em.x0 + Math.sin(lt * Math.PI * 2) * em.drift * 0.45 + em.drift * lt;
        const y = em.y0 - easeOutCubic(lt) * em.rise;
        const alpha = lt < 0.2 ? lt / 0.2 : 1 - (lt - 0.2) / 0.8;
        drawTeardropEmber(ctx, x, y, em.r * (1 - lt * 0.65), Math.sin(lt * 5) * 0.35, em.color, alpha * 0.88);
      }
    }
  }

  if (reducedMotion || typeof globalThis.requestAnimationFrame !== 'function') {
    drawFrame(1.4);
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

  return `<canvas class="streak-celebration-canvas" aria-hidden="true"></canvas>
  <div class="streak-celebration-card${detail.milestone ? ' is-milestone' : ''}" role="dialog" aria-modal="true" aria-labelledby="streak-celebration-title">
    <div class="streak-celebration-body">
      <div class="streak-celebration-stage" aria-hidden="true"></div>
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
  // Avoid stacking a mid-lesson combo screen underneath a full-screen streak celebration.
  const activeCombo = doc.getElementById('combo-celebration-layer');
  if (activeCombo) activeCombo.remove();

  const previouslyFocused = doc.activeElement;
  const overlay = doc.createElement('div');
  overlay.id = 'streak-celebration-overlay';
  overlay.className = `streak-celebration-overlay${detail.milestone ? ' is-milestone' : ''}`;
  overlay.innerHTML = renderStreakCelebrationMarkup(detail, settings);
  doc.body.appendChild(overlay);
  doc.body.classList.add('streak-celebration-open');

  playInteractionSound('streak');

  const continueBtn = overlay.querySelector('#btn-streak-celebration-continue');
  const canvas = overlay.querySelector('.streak-celebration-canvas');
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  const stopCanvas = startStreakFlameEngine(canvas, overlay, {
    isMilestone: Boolean(detail.milestone),
    reducedMotion
  });

  let cardTimer = null;
  let igniteTimer = null;
  let weekTimer = null;
  let revealTimer = null;

  if (reducedMotion) {
    overlay.classList.add('is-card-in', 'is-ignited', 'is-week-ignited', 'is-cta-ready');
    revealTimer = globalThis.setTimeout(() => {
      continueBtn?.focus?.({ preventScroll: true });
    }, 20);
  } else {
    cardTimer = globalThis.setTimeout(() => {
      if (!overlay.isConnected) return;
      overlay.classList.add('is-card-in');
    }, 120);
    igniteTimer = globalThis.setTimeout(() => {
      if (!overlay.isConnected) return;
      overlay.classList.add('is-ignited');
    }, 380);
    weekTimer = globalThis.setTimeout(() => {
      if (!overlay.isConnected) return;
      overlay.classList.add('is-week-ignited');
    }, 720);
    revealTimer = globalThis.setTimeout(() => {
      if (!overlay.isConnected) return;
      overlay.classList.add('is-cta-ready');
      continueBtn?.focus?.({ preventScroll: true });
    }, 920);
  }

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (cardTimer) globalThis.clearTimeout(cardTimer);
    if (igniteTimer) globalThis.clearTimeout(igniteTimer);
    if (weekTimer) globalThis.clearTimeout(weekTimer);
    if (revealTimer) globalThis.clearTimeout(revealTimer);
    stopCanvas();
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
