import { ensureDailyStudyPlan, getActivePracticeWords, getScheduledPracticeWords } from '../services/wordSelection.js?v=18900';
import { driveSync } from '../services/driveSync.js?v=18900';
import { buildScheduledPracticeSession, evaluateDailyStudyPlan, weaknessScore } from '../services/dailySession.js?v=18900';
import { masteryStage, normalizeMastery } from '../services/exerciseResult.js?v=18900';
import { completedExercisesToday } from '../services/learningStats.js?v=18900';
import { escapeHtml } from '../utils/html.js';
import { navigateTo as go } from '../utils/navigation.js';

const MODES = [
  ['flashcards', 'fa-clone', 'Flashcards', 'Reveal, listen, and self-rate'],
  ['spelling', 'fa-headphones', 'Listen & Spell', 'Recall from sound'],
  ['choose', 'fa-list-check', 'Choose Word', 'Recognize exact meanings'],
  ['visual', 'fa-images', 'Visual Match', 'Learn through visual concepts'],
  ['match', 'fa-stopwatch', 'Match Sprint', 'Contrast words quickly'],
  ['context', 'fa-book-open-reader', 'Context', 'Complete real situations'],
  ['useit', 'fa-pen-nib', 'Use It', 'Create your own sentence'],
  ['weak', 'fa-heart-pulse', 'Weak Words', 'Recover recent mistakes']
];

let refreshTimer;
const plural = (count, noun = 'word') => `${count} ${noun}${count === 1 ? '' : 's'}`;
const timeLabel = value => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function dashboardWorkoutState(session, plan, hasWords) {
  if (session.exercises.length) return {
    heading: plan.practicedTodayCount > 0 ? 'Keep your words growing.' : 'A little practice. Lasting words.',
    description: `${plural(session.wordCount)} ready now · about ${session.estimatedMinutes} min.${plan.waitingTodayCount ? ` ${plural(plan.waitingTodayCount)} will be ready later.` : ''}`,
    action: plan.practicedTodayCount > 0 ? 'Continue practice' : 'Start practice',
    bubble: 'Let’s make them stick.',
    state: 'ready'
  };
  if (plan.waitingTodayCount) return {
    heading: 'A little breathing room.',
    description: `${plural(plan.waitingTodayCount)} scheduled later today. ${plan.nextReadyAt ? `Next review at ${timeLabel(plan.nextReadyAt)}.` : 'They will appear at the next review.'} Spacing your practice helps it stick.`,
    action: 'Explore your library',
    bubble: 'See you in a little while.',
    state: 'waiting'
  };
  if (plan.isPlanComplete) return {
    heading: 'A good day for your vocabulary.',
    description: `You finished ${plural(plan.completedTodayCount)} in today’s plan. ${plan.reviseTomorrowCount ? `${plural(plan.reviseTomorrowCount)} scheduled for the next study day.` : 'Your next plan starts at 8:00 AM.'}`,
    action: 'Explore your library',
    bubble: 'Look at you grow!',
    state: 'complete'
  };
  return hasWords ? {
    heading: 'You’re all caught up.',
    description: 'Your words are resting. A fresh plan arrives at 8:00 AM; you can explore your library anytime.',
    action: 'Explore your library', bubble: 'Small steps add up.', state: 'resting'
  } : {
    heading: 'Every word is a fresh start.',
    description: 'Save a word you want to remember. We’ll help you learn it, then bring it back at the right time.',
    action: 'Add your first word', bubble: 'Let’s grow your vocabulary.', state: 'empty'
  };
}

export function renderDashboardView(container, onNavigate) {
  clearTimeout(refreshTimer);
  const activeWords = getActivePracticeWords(driveSync);
  const practiceWords = getScheduledPracticeWords(driveSync);
  const activeWordCount = new Set(activeWords.map(word => String(word.word || '').trim().toLowerCase())).size;
  const settings = ensureDailyStudyPlan(driveSync);
  const session = buildScheduledPracticeSession(practiceWords, settings);
  const plan = session.dailyPlan || evaluateDailyStudyPlan(practiceWords, settings);
  const notebookLabel = escapeHtml(driveSync.getActiveNotebook().replace(/ Vocabulary$/, ''));
  const weak = activeWords.filter(word => weaknessScore(word) > 0).length;
  const completedToday = completedExercisesToday(settings);
  const dailyGoal = Math.max(1, Number(settings.dailyGoal || 20));
  const progress = Math.min(100, Math.round(completedToday / dailyGoal * 100));
  const stages = activeWords.reduce((counts, word) => {
    counts[masteryStage(normalizeMastery(word))] += 1;
    return counts;
  }, { seen: 0, recognized: 0, recalled: 0, context: 0, productive: 0 });
  const auth = driveSync.getDriveStatus();
  const workout = dashboardWorkoutState(session, plan, practiceWords.length > 0);
  const mascotImage = ['complete', 'resting'].includes(workout.state)
    ? 'assets/keepvocab-sprig-celebrate.webp' : 'assets/keepvocab-sprig-thinking.webp';
  const writtenCount = session.exercises.filter(exercise => exercise.exerciseType === 'typed-recall').length;
  const visualCount = session.exercises.filter(exercise => exercise.exerciseType === 'image-recognition').length;
  const buckets = [
    ['revise', 'fa-rotate', plan.reviseTodayCount, 'Revise today', 'Bring familiar words back'],
    ['learn', 'fa-seedling', plan.learnTodayCount, 'Learn today', 'Make room for something new'],
    ['tomorrow', 'fa-calendar-check', plan.reviseTomorrowCount, 'Revise tomorrow', 'Scheduled for the next study day']
  ];

  container.innerHTML = `<section class="today-view" aria-labelledby="today-heading">
    <div class="content-title-row today-title-row"><div><span class="eyebrow"><i class="fa-solid fa-book-bookmark" aria-hidden="true"></i> ${notebookLabel}</span><h1 id="today-heading">Today</h1><p>Small steps today. Words that stay.</p></div><button class="status-pill offline today-settings-button" id="today-settings" aria-label="Settings"><i class="fa-solid fa-sliders" aria-hidden="true"></i><span>Settings</span></button></div>
    <article class="spec-card daily-workout-card is-${workout.state}" aria-labelledby="workout-heading">
      <div class="daily-workout-copy"><div class="daily-kicker-row"><span class="daily-kicker"><i class="fa-solid fa-seedling" aria-hidden="true"></i> Your daily practice</span><span class="daily-eval-badge"><i class="fa-regular fa-clock" aria-hidden="true"></i> ${escapeHtml(workout.state === 'waiting' && plan.nextReadyAt ? `Next at ${timeLabel(plan.nextReadyAt)}` : 'New plan at 8:00 AM')}</span></div><h2 id="workout-heading">${escapeHtml(workout.heading)}</h2><p class="daily-workout-meta">${escapeHtml(workout.description)}</p>
        <div class="daily-workout-actions"><button class="today-primary-cta" id="start-daily-session"><span>${escapeHtml(workout.action)}</span><i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>${session.exercises.length ? `<span class="workout-composition">${writtenCount ? `<span><i class="fa-solid fa-keyboard" aria-hidden="true"></i> ${writtenCount} recall</span>` : ''}${visualCount ? `<span><i class="fa-solid fa-images" aria-hidden="true"></i> ${visualCount} visual</span>` : ''}</span>` : ''}</div>
      </div>
      <div class="daily-workout-mascot"><div class="mascot-bubble">${escapeHtml(workout.bubble)}</div><img src="${mascotImage}" alt="" aria-hidden="true" width="640" height="640"></div>
      <div class="daily-plan-overview"><div class="daily-plan-heading"><h3>Your plan at a glance</h3><span><i class="fa-solid fa-circle-check" aria-hidden="true"></i> ${plan.completedTodayCount} of ${plan.plannedTodayCount} done</span></div><div class="daily-plan-buckets" role="group" aria-label="Daily study plan">${buckets.map(([kind, icon, count, title, copy]) => `<div class="daily-plan-bucket ${kind}"><span class="bucket-icon"><i class="fa-solid ${icon}" aria-hidden="true"></i></span><strong>${count}</strong><div><span>${title}</span><small>${copy}</small></div></div>`).join('')}</div>

      </div>
    </article>
    <div class="spec-card today-progress-card"><div class="today-progress-copy"><span>Your daily goal</span><strong id="today-progress-count">${completedToday} of ${dailyGoal} exercises</strong></div><div class="today-progress-track" id="today-progress-track" role="progressbar" aria-label="Daily progress" aria-valuemin="0" aria-valuemax="${dailyGoal}" aria-valuenow="${Math.min(completedToday, dailyGoal)}"><span style="width:${progress}%"></span></div><span class="today-streak"><i class="fa-solid fa-fire" aria-hidden="true"></i> <span id="today-streak-label">${Number(settings.dailyStreak || 0)} day streak</span></span></div>
    <div class="today-grid">
      <section class="spec-card practice-launchpad" aria-labelledby="practice-heading"><div class="card-header-bar"><div><h2 id="practice-heading">Practice your way</h2><p>A little variety keeps it interesting.</p></div><i class="fa-solid fa-dumbbell" aria-hidden="true"></i></div><div class="practice-quick-grid">${MODES.map(([view, icon, title, copy], index) => `<button class="practice-quick-card" style="--i:${index}" data-practice-view="${view}"><i class="fa-solid ${icon}" aria-hidden="true"></i><span><strong>${title}</strong><small>${copy}</small></span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>`).join('')}</div></section>
      <aside class="today-insights"><section class="spec-card today-insight-card"><div class="card-header-bar"><h2>Your vocabulary</h2><i class="fa-solid fa-book-open" aria-hidden="true"></i></div><div class="today-section-heading"><div><h3>${activeWordCount} saved ${activeWordCount === 1 ? 'word' : 'words'}</h3><small>${activeWords.length} tracked meaning${activeWords.length === 1 ? '' : 's'} in ${notebookLabel}</small></div></div><div class="mastery-mini-list"><div><span>Recognized</span><strong>${stages.recognized + stages.recalled + stages.context + stages.productive}</strong></div><div><span>Reliably recalled</span><strong>${stages.recalled + stages.context + stages.productive}</strong></div><div><span>Used in context</span><strong>${stages.context + stages.productive}</strong></div><div><span>Used productively</span><strong>${stages.productive}</strong></div></div><button class="text-action" data-practice-view="stats">See your progress <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button></section>
        <section class="spec-card today-insight-card compact"><span class="cloud-dot ${auth.isConnected ? 'connected' : auth.lastError ? 'error' : ''}"><i class="fa-solid fa-cloud" aria-hidden="true"></i></span><div><strong>${auth.isConnected ? 'Drive backup active' : auth.lastError ? 'Backup needs attention' : 'Keep your words safe'}</strong><small>${escapeHtml(auth.isConnected ? `Last sync ${auth.lastSynced ? new Date(auth.lastSynced).toLocaleDateString() : 'pending'}` : auth.lastError || 'Set up Drive backup in Settings')}</small></div><button class="icon-action" id="dashboard-drive-settings" aria-label="Open backup settings"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button></section>
        ${weak ? `<button class="today-weak-link" data-practice-view="weak"><i class="fa-solid fa-heart-pulse" aria-hidden="true"></i> Give ${plural(weak)} a little extra care <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>` : ''}
      </aside>
    </div>
  </section>`;

  container.querySelector('#start-daily-session').addEventListener('click', () => session.exercises.length ? go('review', onNavigate) : practiceWords.length ? go('library', onNavigate) : document.getElementById('btn-header-quick-add')?.click());
  container.querySelectorAll('[data-practice-view]').forEach(button => button.addEventListener('click', () => go(button.dataset.practiceView, onNavigate)));
  container.querySelector('#today-settings').addEventListener('click', () => go('settings', onNavigate));
  container.querySelector('#dashboard-drive-settings').addEventListener('click', () => go('settings', onNavigate));

  // An open Today screen becomes actionable at the exact next FSRS step or
  // study-day boundary, without requiring a route change or page reload.
  const refreshAt = Math.min(...[plan.nextReadyAt, plan.nextEvaluationAt].map(value => Date.parse(value || '')).filter(Number.isFinite));
  if (Number.isFinite(refreshAt)) {
    refreshTimer = setTimeout(() => {
      if (!container.querySelector('.today-view')) return;
      const focused = globalThis.document?.activeElement;
      const focusedId = container.contains?.(focused) ? focused.id : null;
      const focusedMode = container.contains?.(focused) ? focused.dataset?.practiceView : null;
      renderDashboardView(container, onNavigate);
      const restoreFocus = focusedId ? container.querySelector(`#${focusedId}`)
        : focusedMode ? [...container.querySelectorAll('[data-practice-view]')].find(button => button.dataset.practiceView === focusedMode)
          : null;
      restoreFocus?.focus({ preventScroll: true });
    }, Math.max(1000, Math.min(2147483647, refreshAt - Date.now() + 100)));
    refreshTimer.unref?.();
  }
}
