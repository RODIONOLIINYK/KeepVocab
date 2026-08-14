import { driveSync } from '../services/driveSync.js?v=63';
import { getDueWords } from '../services/srsEngine.js?v=63';
import { buildDailySession, weaknessScore } from '../services/dailySession.js?v=63';
import { masteryStage, normalizeMastery } from '../services/exerciseResult.js?v=63';
import { normalizeLearningStats } from '../services/learningStats.js?v=63';
import { escapeHtml } from '../utils/html.js';

function go(view, onNavigate) {
  if (window.location.hash === `#${view}`) onNavigate(view); else window.location.hash = view;
}

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
  const allWords = driveSync.getWords();
  const activeNotebook = driveSync.getActiveNotebook();
  const activeWords = allWords.filter(word => word.notebook === activeNotebook);
  const session = buildDailySession(allWords);
  const due = getDueWords(allWords).length;
  const weak = allWords.filter(word => weaknessScore(word) > 0).length;
  const recent = allWords.filter(word => Date.now() - Date.parse(word.createdAt || 0) <= 14 * 24 * 60 * 60 * 1000).length;
  const settings = driveSync.getSettings();
  const learningStats = normalizeLearningStats(settings);
  const todayKey = new Date().toLocaleDateString('en-CA');
  const completedToday = learningStats.sessionHistory.filter(item => String(item.completedAt || '').slice(0, 10) === todayKey).reduce((sum, item) => sum + Number(item.exercises || 0), 0);
  const dailyGoal = Math.max(1, Number(settings.dailyGoal || 20));
  const progress = Math.min(100, Math.round(completedToday / dailyGoal * 100));
  const stages = activeWords.reduce((counts, word) => {
    const stage = masteryStage(normalizeMastery(word));
    counts[stage] += 1;
    return counts;
  }, { seen: 0, recognized: 0, recalled: 0, context: 0, productive: 0 });
  const auth = driveSync.getDriveStatus();

  container.innerHTML = `<section class="today-view" aria-labelledby="today-heading">
    <div class="today-heading-row"><div><span class="eyebrow">Your learning plan</span><h1 id="today-heading">What should I do now?</h1><p>KeepVocab has chosen the next best mix from your real learning needs.</p></div><button class="today-settings-button" id="today-settings"><i class="fa-solid fa-gear"></i><span>Settings</span></button></div>
    <article class="daily-workout-card ${session.exercises.length ? '' : 'is-empty'}">
      <div class="daily-workout-copy"><span class="daily-kicker"><i class="fa-solid fa-sparkles"></i> Today’s Workout</span><h2>${session.exercises.length ? 'Continue learning' : 'Add your first vocabulary'}</h2><p class="daily-workout-meta">${session.exercises.length ? `${session.exercises.length} exercises · ~${session.estimatedMinutes} min` : 'KeepVocab will build your first session automatically.'}</p>
        ${session.exercises.length ? `<div class="workout-composition"><span><i class="fa-solid fa-calendar-check"></i> ${session.composition.due} due</span><span><i class="fa-solid fa-heart-pulse"></i> ${session.composition.weak} weak</span><span><i class="fa-solid fa-seedling"></i> ${session.composition.growth} growth</span></div>` : ''}
        <button class="today-primary-cta" id="start-daily-session"><span>${session.exercises.length ? 'Start workout' : 'Add a word'}</span><i class="fa-solid fa-arrow-right"></i></button>
      </div><div class="daily-workout-mascot"><div class="mascot-bubble">${due ? `${due} due today` : weak ? 'Let’s strengthen a few words' : 'Ready when you are'}</div><img src="assets/keepvocab-sprig-thinking.webp" alt="Sprig thinking about your learning plan"></div>
    </article>
    <div class="today-progress-card"><div class="today-progress-copy"><span>Daily progress</span><strong>${completedToday} of ${dailyGoal} exercises</strong></div><div class="today-progress-track" role="progressbar" aria-label="Daily progress" aria-valuemin="0" aria-valuemax="${dailyGoal}" aria-valuenow="${Math.min(completedToday, dailyGoal)}"><span style="width:${progress}%"></span></div><span class="today-streak"><i class="fa-solid fa-fire"></i> ${Number(settings.dailyStreak || 0)} day streak</span></div>
    <div class="today-grid">
      <section class="practice-launchpad" aria-labelledby="practice-heading"><div class="today-section-heading"><div><span class="eyebrow">Choose a skill</span><h2 id="practice-heading">Manual practice</h2></div><span>Optional</span></div><div class="practice-quick-grid">${MODES.map(([view, icon, title, copy]) => `<button class="practice-quick-card" data-practice-view="${view}"><i class="fa-solid ${icon}"></i><span><strong>${title}</strong><small>${copy}</small></span><i class="fa-solid fa-chevron-right"></i></button>`).join('')}</div></section>
      <aside class="today-insights"><section class="today-insight-card"><div class="today-section-heading"><div><span class="eyebrow">Vocabulary health</span><h2>${activeWords.length} saved this month</h2></div></div><div class="mastery-mini-list"><div><span>Recognized</span><strong>${stages.recognized + stages.recalled + stages.context + stages.productive}</strong></div><div><span>Reliably recalled</span><strong>${stages.recalled + stages.context + stages.productive}</strong></div><div><span>Used in context</span><strong>${stages.context + stages.productive}</strong></div><div><span>Used productively</span><strong>${stages.productive}</strong></div></div><button class="text-action" data-practice-view="stats">See progress <i class="fa-solid fa-arrow-right"></i></button></section>
        <section class="today-insight-card compact"><span class="cloud-dot ${auth.isConnected ? 'connected' : auth.lastError ? 'error' : ''}"><i class="fa-solid fa-cloud"></i></span><div><strong>${auth.isConnected ? 'Drive backup active' : auth.lastError ? 'Backup needs attention' : 'Backup is off'}</strong><small>${auth.isConnected ? `Last sync ${auth.lastSynced ? new Date(auth.lastSynced).toLocaleDateString() : 'pending'}` : auth.lastError || 'Set up Drive in Settings'}</small></div><button class="icon-action" id="dashboard-drive-settings" aria-label="Open backup settings"><i class="fa-solid fa-chevron-right"></i></button></section>
        <section class="today-insight-card compact"><span class="cloud-dot"><i class="fa-solid fa-bookmark"></i></span><div><strong>${weak} weak · ${recent} recent</strong><small>${weak ? 'Already included without taking over your workout' : 'No recurring mistakes yet'}</small></div></section>
      </aside>
    </div>
  </section>`;

  container.querySelector('#start-daily-session').addEventListener('click', () => session.exercises.length ? go('daily', onNavigate) : document.getElementById('btn-header-quick-add')?.click());
  container.querySelectorAll('[data-practice-view]').forEach(button => button.addEventListener('click', () => go(button.dataset.practiceView, onNavigate)));
  container.querySelector('#today-settings').addEventListener('click', () => go('settings', onNavigate));
  container.querySelector('#dashboard-drive-settings').addEventListener('click', () => go('settings', onNavigate));
}
