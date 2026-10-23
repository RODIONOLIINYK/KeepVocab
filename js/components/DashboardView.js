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
  ['speaking', 'fa-microphone-lines', 'AI Speaking', 'Activate words with Mira'],
  ['weak', 'fa-heart-pulse', 'Weak Words', 'Recover recent mistakes']
];

export function renderDashboardView(container, onNavigate) {
  const activeWords = getActivePracticeWords(driveSync);
  const practiceWords = getScheduledPracticeWords(driveSync);
  const activeWordCount = new Set(activeWords.map(word => String(word.word || '').trim().toLowerCase())).size;
  const settings = ensureDailyStudyPlan(driveSync);
  const session = buildScheduledPracticeSession(practiceWords, settings);
  const plan = session.dailyPlan || evaluateDailyStudyPlan(practiceWords, settings);
  const notebookLabel = escapeHtml(driveSync.getActiveNotebook().replace(/ Vocabulary$/, ''));
  const weak = activeWords.filter(word => weaknessScore(word) > 0).length;
  const recent = activeWords.filter(word => Date.now() - Date.parse(word.createdAt || 0) <= 14 * 24 * 60 * 60 * 1000).length;
  const completedToday = completedExercisesToday(settings);
  const dailyGoal = Math.max(1, Number(settings.dailyGoal || 20));
  const progress = Math.min(100, Math.round(completedToday / dailyGoal * 100));
  const stages = activeWords.reduce((counts, word) => {
    const stage = masteryStage(normalizeMastery(word));
    counts[stage] += 1;
    return counts;
  }, { seen: 0, recognized: 0, recalled: 0, context: 0, productive: 0 });
  const auth = driveSync.getDriveStatus();
  const workoutHeading = session.exercises.length
    ? (plan.completedTodayCount > 0 ? 'Continue today’s plan' : 'Start today’s plan')
    : plan.isPlanComplete
      ? 'Today’s plan complete'
      : practiceWords.length
        ? 'All caught up for today'
        : 'Add your first vocabulary';
  const workoutMeta = session.exercises.length
    ? `${session.exercises.length} exercise${session.exercises.length === 1 ? '' : 's'} remaining today · ~${session.estimatedMinutes} min${plan.completedTodayCount ? ` · ${plan.completedTodayCount} completed` : ''}`
    : plan.isPlanComplete
      ? `You finished all ${plan.plannedTodayCount} word${plan.plannedTodayCount === 1 ? '' : 's'} in today’s 8:00 AM plan.${plan.reviseTomorrowCount ? ` ${plan.reviseTomorrowCount} word${plan.reviseTomorrowCount === 1 ? '' : 's'} queued for tomorrow.` : ''}`
      : practiceWords.length
        ? `Evaluated daily at 8:00 AM.${plan.reviseTomorrowCount ? ` ${plan.reviseTomorrowCount} word${plan.reviseTomorrowCount === 1 ? '' : 's'} scheduled for tomorrow.` : ' Your next review will appear when due.'}`
        : 'Start with a word you want to remember.';
  const mascotImage = !session.exercises.length && (plan.isPlanComplete || practiceWords.length)
    ? 'assets/keepvocab-sprig-celebrate.webp'
    : 'assets/keepvocab-sprig-thinking.webp';
  const mascotBubble = session.exercises.length
    ? `${session.wordCount} word${session.wordCount === 1 ? '' : 's'} left today`
    : plan.isPlanComplete
      ? `${plan.completedTodayCount} done today!`
      : practiceWords.length
        ? 'Nice work today'
        : 'Ready when you are';

  container.innerHTML = `<section class="today-view" aria-labelledby="today-heading">
    <div class="content-title-row today-title-row"><div><span class="eyebrow"><i class="fa-solid fa-book-bookmark" aria-hidden="true"></i> ${notebookLabel}</span><h1 id="today-heading">Today</h1><p>Your plan is refreshed every morning at 8:00 AM.</p></div><button class="status-pill offline today-settings-button" id="today-settings" aria-label="Settings"><i class="fa-solid fa-gear" aria-hidden="true"></i><span>Settings</span></button></div>
    <article class="spec-card daily-workout-card ${session.exercises.length ? '' : 'is-empty'} ${plan.isPlanComplete ? 'is-complete' : ''}">
      <div class="daily-workout-copy"><div class="daily-kicker-row"><span class="daily-kicker"><i class="fa-solid fa-sparkles"></i> Today’s Workout</span><span class="daily-eval-badge"><i class="fa-regular fa-clock"></i> 8:00 AM plan</span></div><h2>${workoutHeading}</h2><p class="daily-workout-meta">${workoutMeta}</p>
        ${practiceWords.length ? `<div class="daily-plan-buckets" role="group" aria-label="8:00 AM daily study plan">
          <div class="daily-plan-bucket revise"><span class="bucket-icon"><i class="fa-solid fa-rotate"></i></span><div><strong>${plan.reviseTodayCount}</strong><span>Revise today</span></div></div>
          <div class="daily-plan-bucket learn"><span class="bucket-icon"><i class="fa-solid fa-seedling"></i></span><div><strong>${plan.learnTodayCount}</strong><span>Learn today</span></div></div>
          <div class="daily-plan-bucket tomorrow"><span class="bucket-icon"><i class="fa-regular fa-calendar-check"></i></span><div><strong>${plan.reviseTomorrowCount}</strong><span>Revise tomorrow</span></div></div>
        </div>` : ''}
        ${session.exercises.length ? `<div class="workout-composition"><span><i class="fa-solid fa-keyboard"></i> ${session.exercises.filter(exercise => exercise.exerciseType === 'typed-recall').length} write the word</span>${session.exercises.some(exercise => exercise.exerciseType === 'image-recognition') ? `<span><i class="fa-solid fa-images"></i> ${session.exercises.filter(exercise => exercise.exerciseType === 'image-recognition').length} visual match</span>` : ''}</div>` : ''}
        <button class="today-primary-cta" id="start-daily-session"><span>${session.exercises.length ? (plan.completedTodayCount > 0 ? 'Continue workout' : 'Start workout') : practiceWords.length ? 'Open library' : 'Add a word'}</span><i class="fa-solid fa-arrow-right"></i></button>
      </div><div class="daily-workout-mascot"><div class="mascot-bubble">${mascotBubble}</div><img src="${mascotImage}" alt="" aria-hidden="true"></div>
    </article>
    <div class="spec-card today-progress-card"><div class="today-progress-copy"><span>Daily progress</span><strong id="today-progress-count">${completedToday} of ${dailyGoal} exercises</strong></div><div class="today-progress-track" id="today-progress-track" role="progressbar" aria-label="Daily progress" aria-valuemin="0" aria-valuemax="${dailyGoal}" aria-valuenow="${Math.min(completedToday, dailyGoal)}"><span style="width:${progress}%"></span></div><span class="today-streak"><i class="fa-solid fa-fire"></i> <span id="today-streak-label">${Number(settings.dailyStreak || 0)} day streak</span></span></div>
    <div class="today-grid">
      <section class="spec-card practice-launchpad" aria-labelledby="practice-heading"><div class="card-header-bar"><div class="card-tag" id="practice-heading"><i class="fa-solid fa-dumbbell" aria-hidden="true"></i> Practice your way</div></div><div class="practice-quick-grid">${MODES.map(([view, icon, title, copy], index) => `<button class="practice-quick-card" style="--i:${index}" data-practice-view="${view}"><i class="fa-solid ${icon}"></i><span><strong>${title}</strong><small>${copy}</small></span><i class="fa-solid fa-chevron-right"></i></button>`).join('')}</div></section>
      <aside class="today-insights"><section class="spec-card today-insight-card"><div class="card-header-bar"><div class="card-tag"><i class="fa-solid fa-heart-pulse" aria-hidden="true"></i> Vocabulary health</div></div><div class="today-section-heading"><div><h2>${activeWordCount} saved this month</h2><small>${activeWords.length} tracked meaning${activeWords.length === 1 ? '' : 's'}</small></div></div><div class="mastery-mini-list"><div><span>Recognized</span><strong>${stages.recognized + stages.recalled + stages.context + stages.productive}</strong></div><div><span>Reliably recalled</span><strong>${stages.recalled + stages.context + stages.productive}</strong></div><div><span>Used in context</span><strong>${stages.context + stages.productive}</strong></div><div><span>Used productively</span><strong>${stages.productive}</strong></div></div><button class="text-action" data-practice-view="stats">See progress <i class="fa-solid fa-arrow-right"></i></button></section>
        <section class="spec-card today-insight-card compact"><span class="cloud-dot ${auth.isConnected ? 'connected' : auth.lastError ? 'error' : ''}"><i class="fa-solid fa-cloud"></i></span><div><strong>${auth.isConnected ? 'Drive backup active' : auth.lastError ? 'Backup needs attention' : 'Backup is off'}</strong><small>${auth.isConnected ? `Last sync ${auth.lastSynced ? new Date(auth.lastSynced).toLocaleDateString() : 'pending'}` : auth.lastError || 'Set up Drive in Settings'}</small></div><button class="icon-action" id="dashboard-drive-settings" aria-label="Open backup settings"><i class="fa-solid fa-chevron-right"></i></button></section>
        <section class="spec-card today-insight-card compact"><span class="cloud-dot"><i class="fa-solid fa-bookmark"></i></span><div><strong>${weak} weak · ${recent} recent</strong><small>${weak ? 'Review timing adapts to your answers' : 'No recurring mistakes yet'}</small></div></section>
      </aside>
    </div>
  </section>`;

  container.querySelector('#start-daily-session').addEventListener('click', () => session.exercises.length ? go('review', onNavigate) : practiceWords.length ? go('library', onNavigate) : document.getElementById('btn-header-quick-add')?.click());
  container.querySelectorAll('[data-practice-view]').forEach(button => button.addEventListener('click', () => go(button.dataset.practiceView, onNavigate)));
  container.querySelector('#today-settings').addEventListener('click', () => go('settings', onNavigate));
  container.querySelector('#dashboard-drive-settings').addEventListener('click', () => go('settings', onNavigate));
}
