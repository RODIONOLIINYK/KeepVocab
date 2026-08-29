import { driveSync } from '../services/driveSync.js?v=93';
import { PATH_STAGES, LITHUANIAN_UNITS, LITHUANIAN_SESSIONS } from '../data/lithuanianCurriculum.js?v=111';
import { currentSessionId, isSessionUnlocked, selfPacedPathStatus } from '../services/lessonEngine.js?v=111';
import { escapeHtml } from '../utils/html.js';

const nodeOffsets = [-48, 34, 72, 20, -42, -76];
const routePointY = 35;
const routeRowStep = 96;

function routeLine(count) {
  const points = nodeOffsets.slice(0, count).map((offset, index) => ({ x: 160 + offset, y: routePointY + index * routeRowStep }));
  const path = points.slice(1).reduce((value, point, index) => {
    const previous = points[index];
    const middle = (previous.y + point.y) / 2;
    return `${value} C ${previous.x} ${middle}, ${point.x} ${middle}, ${point.x} ${point.y}`;
  }, `M ${points[0].x} ${points[0].y}`);
  const height = routePointY * 2 + Math.max(0, count - 1) * routeRowStep;
  return `<svg class="path-route-line" style="height:${height}px" viewBox="0 0 320 ${height}" aria-hidden="true" preserveAspectRatio="xMidYMid meet"><path d="${path}" /></svg>`;
}

function renderUnit(unit, profile, activeId) {
  const completed = new Set(profile.completedNodeIds || []);
  const nodes = unit.sessions.map((session, index) => {
    const unlocked = isSessionUnlocked(session.id, profile);
    const isCurrent = session.id === activeId;
    const isComplete = completed.has(session.id);
    const shortLabel = session.kind === 'dialogue' ? 'Dialogue' : session.kind === 'mission' ? 'Mission' : session.sessionNumber === 1 ? 'Lesson' : session.title;
    return `
      <div class="path-node-wrap ${isCurrent ? 'current' : ''} ${nodeOffsets[index] > 0 ? 'path-right' : 'path-left'}" style="--path-x:${nodeOffsets[index]}px;--node-order:${index}" data-module="${unit.unitNumber}">
        <button class="path-node ${isComplete ? 'complete' : unlocked ? 'unlocked' : 'locked'} ${session.kind}" data-session-id="${session.id}" ${unlocked ? '' : 'disabled'} aria-label="${escapeHtml(session.title)} · Module ${unit.unitNumber}${isComplete ? ' · complete' : isCurrent ? ' · current lesson' : ''}">
          <span class="path-node-face"><i class="fa-solid ${isComplete ? 'fa-check' : unlocked ? session.icon : 'fa-lock'}" aria-hidden="true"></i></span>
        </button>
        <span class="path-node-label">${escapeHtml(shortLabel)}</span>
        ${isCurrent ? `<img class="path-mascot-guide" src="assets/keepvocab-sprout-mascot.webp" alt="" aria-hidden="true"><div class="current-lesson-popover"><small>UP NEXT · MODULE ${unit.unitNumber}</small><strong>${escapeHtml(session.title)}</strong><span>Start · ${session.durationMinutes} min</span></div>` : ''}
      </div>`;
  }).join('');
  const unitCompleted = unit.sessions.filter(session => completed.has(session.id)).length;
  return `
    <section class="path-unit-block" id="${unit.id}">
      <header class="path-unit-banner">
        <div class="path-unit-number">${unit.unitNumber}</div>
        <div><span>MODULE ${unit.unitNumber} · ${unit.cefr}</span><h2>${escapeHtml(unit.title)}</h2><p>${escapeHtml(unit.outcome)}</p></div>
        <div class="path-unit-score" aria-label="${unitCompleted} of ${unit.sessions.length} lessons complete"><strong>${unitCompleted}</strong><span>/ ${unit.sessions.length}</span></div>
      </header>
      <div class="path-route" aria-label="Module ${unit.unitNumber} lesson path">${routeLine(unit.sessions.length)}${nodes}</div>
    </section>`;
}

function renderStage(stage, profile, activeId) {
  const units = LITHUANIAN_UNITS.filter(unit => unit.unitNumber >= stage.unitStart && unit.unitNumber <= stage.unitEnd);
  return `
    <section class="path-stage path-stage-${stage.color}" id="${stage.id}" data-section="${stage.number}">
      <header class="path-month-banner">
        <div><span>SECTION ${stage.number} · 4 MODULES</span><h2>${escapeHtml(stage.title)}</h2><p>${escapeHtml(stage.subtitle)}</p></div>
        <i class="fa-solid fa-map-location-dot" aria-hidden="true"></i>
      </header>
      <div class="path-unit-stack">${units.map(unit => renderUnit(unit, profile, activeId)).join('')}</div>
    </section>`;
}

export function renderLearningPathView(container, navigate) {
  const courseId = driveSync.getActiveCourseId();
  if (courseId !== 'lithuanian') {
    container.innerHTML = `
      <section class="learn-empty-course">
        <img src="assets/keepvocab-sprout-mascot.webp" alt="Sprig holding an open book">
        <span class="learning-kicker">GUIDED COURSE</span>
        <h1>Your Lithuanian path is ready</h1>
        <p>Switch to Lithuanian to begin 36 self-paced modules from first hellos to strong A2, with an optional B1 bridge.</p>
        <button class="btn-green-solid" id="learn-switch-lithuanian"><i class="fa-solid fa-language"></i> Switch to Lithuanian</button>
      </section>`;
    container.querySelector('#learn-switch-lithuanian')?.addEventListener('click', () => {
      driveSync.setActiveCourseId('lithuanian');
      window.dispatchEvent(new CustomEvent('keepvocab:course-changed'));
      renderLearningPathView(container, navigate);
    });
    return;
  }

  const profile = driveSync.getCourseProfile('lithuanian') || {};
  const activeId = currentSessionId(profile);
  const status = selfPacedPathStatus(profile);
  const currentSession = LITHUANIAN_SESSIONS.find(item => item.id === activeId);
  const currentUnit = LITHUANIAN_UNITS.find(unit => unit.id === currentSession?.unitId) || LITHUANIAN_UNITS[0];
  const currentStage = PATH_STAGES.find(stage => currentUnit.unitNumber >= stage.unitStart && currentUnit.unitNumber <= stage.unitEnd) || PATH_STAGES[0];
  const totalComplete = (profile.completedNodeIds || []).length;
  const progressMessage = status.remainingUnits
    ? `${status.remainingUnits} module${status.remainingUnits === 1 ? '' : 's'} remain. Your pace is entirely self-directed.`
    : 'Course path complete. Revisit any lesson whenever you want.';

  container.innerHTML = `
    <main class="learning-path-shell">
      <div class="learning-path-main">
        <header class="learning-path-heading">
          <div><span class="learning-kicker">LITHUANIAN · A1 → A2</span><h1>Your Lithuanian path</h1><p>Six varied lessons per module. Follow the path at your own pace.</p></div>
          <div class="path-overall-progress status-pill connected" aria-label="${totalComplete} of ${LITHUANIAN_SESSIONS.length} lessons complete"><strong>${totalComplete}</strong><span>of ${LITHUANIAN_SESSIONS.length}<br>lessons</span></div>
        </header>
        <nav class="path-section-tabs" aria-label="Course sections">
          ${PATH_STAGES.map(stage => `<a href="#${stage.id}" data-stage-link="${stage.id}" aria-label="Section ${stage.number}" ${stage.id === currentStage.id ? 'aria-current="step"' : ''}><span>${stage.number}</span><small>${escapeHtml(stage.title)}</small></a>`).join('')}
        </nav>
        <div class="learning-stage-stack">${PATH_STAGES.map(stage => renderStage(stage, profile, activeId)).join('')}</div>
        <section class="b1-bridge-note"><i class="fa-solid fa-bridge"></i><div><strong>B1 bridge stays optional</strong><p>Finish the A2 checkpoint first, then unlock the final module of connected storytelling and opinions.</p></div></section>
      </div>
      <aside class="path-week-rail content-card">
        <span>CURRENT MODULE</span>
        <strong>Module ${currentUnit.unitNumber}</strong>
        <p>${escapeHtml(currentUnit.title)}</p>
        <div class="exercise-progress path-module-progress"><i><b style="width:${Math.round((currentUnit.sessions.filter(session => (profile.completedNodeIds || []).includes(session.id)).length / currentUnit.sessions.length) * 100)}%"></b></i><span>${currentUnit.sessions.filter(session => (profile.completedNodeIds || []).includes(session.id)).length} of ${currentUnit.sessions.length} lessons</span></div>
        <small>${escapeHtml(progressMessage)}</small>
        <button class="btn-green-solid" data-start-current><i class="fa-solid fa-play"></i> Continue</button>
      </aside>
    </main>`;

  const start = sessionId => {
    driveSync.updateCourseProfile('lithuanian', { activeLessonId: sessionId });
    navigate('lesson');
  };
  container.querySelectorAll('.path-node.unlocked, .path-node.complete').forEach(button => button.addEventListener('click', () => start(button.dataset.sessionId)));
  container.querySelector('[data-start-current]')?.addEventListener('click', () => start(activeId));
  container.querySelectorAll('[data-stage-link]').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    document.getElementById(link.dataset.stageLink)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  container.classList.add('path-motion-ready');
  const unitObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('path-unit-visible');
      unitObserver.unobserve(entry.target);
    });
  }, { rootMargin: '80px 0px', threshold: 0.08 }) : null;
  container.querySelectorAll('.path-unit-block').forEach(unit => {
    if (unitObserver) unitObserver.observe(unit);
    else unit.classList.add('path-unit-visible');
  });
  const sectionObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    container.querySelectorAll('[data-stage-link]').forEach(link => {
      if (link.dataset.stageLink === visible.target.id) link.setAttribute('aria-current', 'step');
      else link.removeAttribute('aria-current');
    });
  }, { rootMargin: '-18% 0px -62%', threshold: [0.05, 0.25, 0.5] }) : null;
  if (sectionObserver) container.querySelectorAll('.path-stage').forEach(stage => sectionObserver.observe(stage));
  if (totalComplete > 8) requestAnimationFrame(() => container.querySelector('.path-node-wrap.current')?.scrollIntoView({ block: 'center', behavior: 'auto' }));
}
