import { driveSync } from '../services/driveSync.js?v=1602';
import { PATH_STAGES, LITHUANIAN_UNITS, LITHUANIAN_SESSIONS } from '../data/lithuanianCurriculum.js?v=1602';
import { currentSessionId, isSessionUnlocked } from '../services/lessonEngine.js?v=1602';
import { escapeHtml } from '../utils/html.js';

const lessonPurposes = ['Learn each phrase while answering with help.', 'Build useful phrases with the new forms.', 'Connect familiar words to their sounds.', 'Use what you know in a short exchange.', 'Retrieve and apply the language again.', 'Check this module and revisit earlier learning.'];

export function renderLearningPathView(container, navigate) {
  if (driveSync.getActiveCourseId() !== 'lithuanian') {
    container.innerHTML = `<section class="learn-empty-course"><img src="assets/keepvocab-sprout-mascot.webp" alt="Sprig with a book"><h1>Your Lithuanian course</h1><p>Start with greetings and sounds. Build up to everyday conversations, one short lesson at a time.</p><button class="btn-green-solid" data-switch-course>Start Lithuanian</button></section>`;
    container.querySelector('[data-switch-course]').onclick = () => {
      driveSync.setActiveCourseId('lithuanian');
      window.dispatchEvent(new CustomEvent('keepvocab:course-changed'));
      renderLearningPathView(container, navigate);
    };
    return;
  }
  const profile = driveSync.getCourseProfile('lithuanian');
  const complete = new Set(profile.completedNodeIds || []);
  const totalComplete = LITHUANIAN_SESSIONS.filter(item => complete.has(item.id)).length;
  const finished = totalComplete === LITHUANIAN_SESSIONS.length;
  const next = LITHUANIAN_SESSIONS.find(item => item.id === currentSessionId(profile));
  const currentUnit = LITHUANIAN_UNITS.find(unit => unit.id === next.unitId);
  const currentStage = PATH_STAGES.find(stage => currentUnit.unitNumber >= stage.unitStart && currentUnit.unitNumber <= stage.unitEnd);
  const resume = profile.lessonAttempts?.[next.id]?.status === 'in-progress';
  const percent = Math.round(totalComplete / LITHUANIAN_SESSIONS.length * 100);
  container.innerHTML = `<main class="curriculum-shell">
    <header class="curriculum-heading"><div><span class="learning-kicker">YOUR LANGUAGE, ONE DAY AT A TIME</span><h1>Learn Lithuanian</h1><p>A clear route from first words to everyday conversations.</p></div><span class="status-pill connected">A1 foundations → A2 practice</span></header>
    <section class="curriculum-next content-card"><div><span class="learning-kicker">${finished ? 'COURSE COMPLETE' : resume ? 'PICK UP WHERE YOU LEFT OFF' : 'YOUR NEXT STEP'} · MODULE ${currentUnit.unitNumber}</span><h2>${escapeHtml(currentUnit.title)}</h2><p>${escapeHtml(currentUnit.outcome)}</p><div class="curriculum-next-meta"><span><i class="fa-regular fa-clock"></i> ${next.durationMinutes} min</span><span>Lesson ${next.sessionNumber} of 6</span><span>${escapeHtml(currentUnit.cefr)}</span></div><button class="btn-green-solid" data-session-id="${next.id}"><i class="fa-solid fa-play"></i> ${finished ? 'Revisit the course' : resume ? 'Resume lesson' : totalComplete ? 'Continue learning' : 'Start your first lesson'}</button></div><img src="assets/keepvocab-sprout-mascot.webp" alt="Sprig reading a book"></section>
    <div class="curriculum-progress"><span>${totalComplete} of ${LITHUANIAN_SESSIONS.length} lessons completed</span><progress max="100" value="${percent}" aria-label="Course progress">${percent}%</progress><strong>${percent}%</strong></div>
    <div class="curriculum-body"><section><div class="curriculum-section-title"><h2>Your course</h2><label>Section<select data-course-section>${PATH_STAGES.map(stage => `<option value="${stage.number}" ${stage.id === currentStage.id ? 'selected' : ''}>${stage.number}. ${escapeHtml(stage.title)}</option>`).join('')}</select></label></div><div data-course-units></div></section>
    <aside class="curriculum-guide content-card"><span class="learning-kicker">A ROUTINE THAT WORKS</span><h2>Small steps. Lasting progress.</h2><ol><li><strong>Understand</strong><span>Meet each phrase as you answer, with help beside the question.</span></li><li><strong>Practise</strong><span>Recognise, listen, speak, and build your own answers.</span></li><li><strong>Remember</strong><span>Revisit earlier material in each checkpoint and your Library reviews.</span></li></ol><button class="status-pill offline" data-review-library>Review my vocabulary</button><p>One completed exercise keeps your streak alive. Aim for your daily goal when you have time.</p><details><summary>About this curriculum</summary><p>Inspired by CEFR can-do outcomes and Lithuanian university beginner syllabuses. Checkpoints need at least two thirds correct. This is guided practice, not a CEFR qualification.</p><a href="https://www.vdu.lt/erasmus-studies/lithuanian-as-a-foreign-language-a1-2/" target="_blank" rel="noopener noreferrer">VDU beginner syllabus ↗</a></details></aside></div>
  </main>`;
  const start = id => {
    if (!isSessionUnlocked(id, profile)) return;
    driveSync.updateCourseProfile('lithuanian', { activeLessonId: id });
    navigate('lesson');
  };
  const renderSection = number => {
    const stage = PATH_STAGES.find(item => item.number === Number(number));
    const units = LITHUANIAN_UNITS.filter(unit => unit.unitNumber >= stage.unitStart && unit.unitNumber <= stage.unitEnd);
    container.querySelector('[data-course-units]').innerHTML = `<p class="curriculum-section-description">${escapeHtml(stage.subtitle)}</p>${units.map(unit => {
      const count = unit.sessions.filter(item => complete.has(item.id)).length;
      return `<details class="curriculum-unit" ${unit.id === currentUnit.id ? 'open' : ''}><summary><span class="curriculum-unit-index">${count === 6 ? '<i class="fa-solid fa-check"></i>' : unit.unitNumber}</span><span><small>${escapeHtml(unit.cefr)} · MODULE ${unit.unitNumber}</small><strong>${escapeHtml(unit.title)}</strong></span><span class="curriculum-unit-count">${count}/6<i class="fa-solid fa-chevron-down"></i></span></summary><div class="curriculum-unit-content"><p>${escapeHtml(unit.outcome)}</p><ol class="curriculum-lessons">${unit.sessions.map((session, index) => {
        const unlocked = isSessionUnlocked(session.id, profile);
        const done = complete.has(session.id);
        const current = session.id === next.id && !finished;
        return `<li><button class="curriculum-lesson ${current ? 'current' : ''}" data-session-id="${session.id}" ${unlocked ? '' : 'disabled'} ${current ? 'aria-current="step"' : ''}><span class="curriculum-lesson-icon"><i class="fa-solid ${done ? 'fa-check' : unlocked ? session.icon : 'fa-lock'}"></i></span><span><strong>${escapeHtml(session.title)}</strong><small>${lessonPurposes[index]}</small></span><span class="curriculum-lesson-time">${done ? 'Review' : `${session.durationMinutes} min`}</span></button></li>`;
      }).join('')}</ol></div></details>`;
    }).join('')}`;
    container.querySelectorAll('[data-course-units] [data-session-id]').forEach(button => button.onclick = () => start(button.dataset.sessionId));
  };
  renderSection(currentStage.number);
  container.querySelector('[data-course-section]').onchange = event => renderSection(event.target.value);
  container.querySelector('.curriculum-next [data-session-id]').onclick = () => start(next.id);
  container.querySelector('[data-review-library]').onclick = () => navigate('review');
}
