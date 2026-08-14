// Native application controller with monthly Google Drive backup.

import { driveSync, getCurrentMonthNotebookTitle, usesNativeGoogleAuthorization } from './services/driveSync.js?v=63';
import { fetchWordDetails } from './services/dictionaryApi.js?v=63';
import { speakWord } from './services/speechService.js?v=63';
import { getDueWords, getRatingPreviews } from './services/srsEngine.js?v=63';
import { recordExerciseResult } from './services/exerciseResult.js?v=63';
import { DRIVE_SYNC_MIN_INTERVAL_MS, backgroundSyncDelay } from './services/syncPolicy.js?v=63';
import { hasExampleSenseConflict, sanitizeExistingExamples } from './services/exampleSearch.js?v=63';
import { findRelevantImages } from './services/imageSearch.js?v=63';
import { BULK_LOOKUP_DELAY_MS, MAX_BULK_WORDS, parseBulkWordList, lookupBulkWords, retryMissingBulkWords, bulkResultToWord, dedupeBulkResults, attachImagesSequentially } from './services/bulkWords.js?v=63';
import { playInteractionSound, setInteractionSoundEnabledProvider, setupButtonSounds } from './services/interactionSound.js?v=63';
import { appendStudyMoment, buildSmartReminderPlan, cancelDailyReminder, formatReminderTime, normalizeReminderTime, scheduleDailyReminder, setupReminderNavigation } from './services/reminderService.js?v=63';

import { renderReviewView } from './components/ReviewView.js?v=63';
import { renderLibraryView } from './components/LibraryView.js?v=63';
import { renderStatsView } from './components/StatsView.js?v=63';
import { renderSpellingMode, renderChooseWordMode } from './components/PracticeModes.js?v=63';
import { renderVisualMatchMode } from './components/VisualMatchMode.js?v=63';
import { renderMatchSprintMode } from './components/MatchSprintMode.js?v=63';
import { renderSpeakingMode, teardownSpeakingMode } from './components/SpeakingMode.js?v=63';
import { renderDashboardView } from './components/DashboardView.js?v=63';
import { renderDailySessionMode } from './components/DailySessionMode.js?v=63';
import { renderFlashcardsMode } from './components/FlashcardsMode.js?v=63';
import { renderContextQuizMode } from './components/ContextQuizMode.js?v=63';
import { renderUseItMode } from './components/UseItMode.js?v=63';
import { renderSettingsView } from './components/SettingsView.js?v=63';

function localDateKey(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function buildStudyQueue() {
  const activeNotebook = driveSync.getActiveNotebook();
  return driveSync.getWords().filter(item => item.notebook === activeNotebook).map(item => {
    const example = item.example || `Use “${item.word}” in a sentence.`;
    return {
      ...item,
      phonetic: item.phonetic || '',
      partOfSpeech: item.partOfSpeech || 'unknown',
      example
    };
  });
}

function repairContradictoryExamples() {
  for (const word of driveSync.getWords()) {
    if (!hasExampleSenseConflict(word.word, word, word.example)) continue;
    const [repaired] = sanitizeExistingExamples(word.word, [word]);
    driveSync.updateWord(word.id, {
      example: repaired.example,
      exampleSourceUrl: repaired.exampleSourceUrl,
      exampleAttribution: repaired.exampleAttribution,
      exampleLicense: repaired.exampleLicense
    });
  }
}

repairContradictoryExamples();
let wordsQueue = buildStudyQueue();

let currentIndex = 0;
const reminderDefaults = driveSync.getSettings();
if (typeof reminderDefaults.smartReminderEnabled !== 'boolean' || !Array.isArray(reminderDefaults.reviewStartMoments)) {
  driveSync.updateSettings({
    smartReminderEnabled: typeof reminderDefaults.smartReminderEnabled === 'boolean' ? reminderDefaults.smartReminderEnabled : true,
    reviewStartMoments: Array.isArray(reminderDefaults.reviewStartMoments) ? reminderDefaults.reviewStartMoments : []
  }, { silent: true });
}
const initialSettings = driveSync.getSettings();
let goalCount = initialSettings.reviewsDate === localDateKey() ? Number(initialSettings.reviewsToday || 0) : 0;
if (initialSettings.reviewsDate !== localDateKey()) {
  driveSync.updateSettings({ reviewsDate: localDateKey(), reviewsToday: 0 });
}
let currentView = 'dashboard';
let speechSpeed = 1.0;
let dashboardOriginalHTML = '';
let currentFetchedData = null;
let viewEnterTimer = null;
let reminderRefreshTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('view-container');
  if (container) {
    dashboardOriginalHTML = container.innerHTML;
  }
  initApp();
});

function initApp() {
  setInteractionSoundEnabledProvider(() => driveSync.getSettings().soundEnabled !== false);
  setupButtonSounds();
  setupNavigation();
  setupDriveBackupModal();
  setupQuickAddModal();
  setupEngagementSystem();
  setupReminderNavigation().catch(error => console.warn('Reminder navigation setup failed.', error));
  setupFlashcardControls();
  setupMonthDropdown();
  setupKeyboardShortcuts();
  setupLearningModeButtons();
  setupAutomaticDriveBackup();
  resumeRememberedDriveConnection();

  window.addEventListener('keepvocab:progress', () => {
    rememberStudyStart();
    const settings = driveSync.getSettings();
    goalCount = settings.reviewsDate === localDateKey() ? Number(settings.reviewsToday || 0) : 0;
    updateGoalDisplay();
    updateEngagementCard();
    queueSmartReminderRefresh();
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Offline support registration failed.', error));
  }

  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '') || 'dashboard';
    navigateTo(hash);
  });

  const hash = window.location.hash.replace('#', '') || 'dashboard';
  navigateTo(hash);
  renderConnectionState();
  updateDashboardDerivedState();
}

function showToast(msg, type = 'success') {
  const old = document.getElementById('app-toast');
  if (old) old.remove();

  const toast = document.createElement('div');
  toast.id = 'app-toast';
  toast.className = `app-toast ${type === 'success' ? 'success' : 'error'}`;
  const icon = document.createElement('i');
  icon.className = `fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}`;
  const label = document.createElement('span');
  label.textContent = String(msg);
  toast.append(icon, label);
  document.body.appendChild(toast);
  playInteractionSound(type === 'success' ? 'success' : 'error');

  setTimeout(() => toast.remove(), 4000);
}

function updateGoalDisplay() {
  const dailyGoal = Math.max(1, Number(driveSync.getSettings().dailyGoal || 20));
  const display = `${Math.min(goalCount, dailyGoal)} / ${dailyGoal}`;
  const hdrGoal = document.getElementById('hdr-goal-count');
  const goalEl = document.getElementById('goal-number-el');
  if (hdrGoal) hdrGoal.textContent = display;
  if (goalEl) goalEl.textContent = display;
}

function updateDashboardDerivedState() {
  updateGoalDisplay();
  const settings = driveSync.getSettings();
  const allWords = driveSync.getWords();
  const boxCounts = [1, 2, 3, 4, 5].map(box => allWords.filter(word => Number(word.box || 1) === box).length);
  boxCounts.forEach((count, index) => {
    const element = document.getElementById(`b${index + 1}-count`);
    if (element) element.textContent = String(count);
  });
  const currentWords = allWords.filter(word => word.notebook === driveSync.getActiveNotebook()).length;
  const added = document.getElementById('stat-words-added');
  if (added) added.textContent = String(currentWords);
  const due = document.getElementById('stat-synced-today');
  if (due) due.textContent = String(getDueWords().filter(word => word.notebook === driveSync.getActiveNotebook()).length);
  const learning = document.getElementById('stat-keep-updates');
  if (learning) learning.textContent = String(allWords.filter(word => word.notebook === driveSync.getActiveNotebook() && !word.mastered).length);
  const streak = Number(settings.dailyStreak || 0);
  for (const id of ['hdr-streak-count', 'streak-num']) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(streak);
  }
  const ring = document.querySelector('.radial-svg circle:nth-of-type(2)');
  const dailyGoal = Math.max(1, Number(settings.dailyGoal || 20));
  if (ring) ring.setAttribute('stroke-dashoffset', String(238.76 * (1 - Math.min(goalCount, dailyGoal) / dailyGoal)));
  const activity = settings.reviewActivity || {};
  const today = new Date();
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  document.querySelectorAll('.day-circle').forEach((element, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    element.classList.toggle('checked', Number(activity[key] || 0) > 0);
  });
  updateEngagementCard();
  renderConnectionState();
}

function currentSmartReminderPlan(settingsOverride = {}, now = new Date()) {
  const settings = { ...driveSync.getSettings(), ...settingsOverride };
  const reviewsToday = settings.reviewsDate === localDateKey(now) ? Number(settings.reviewsToday || 0) : 0;
  const dueCount = getDueWords().filter(word => word.notebook === driveSync.getActiveNotebook()).length;
  return buildSmartReminderPlan({
    preferredTime: settings.reminderTime || '19:00',
    smartTiming: settings.smartReminderEnabled !== false,
    reviewMoments: settings.reviewStartMoments || [],
    dueCount,
    reviewsToday,
    dailyGoal: settings.dailyGoal || 20,
    streak: settings.dailyStreak || 0,
    now
  });
}

function rememberStudyStart(now = new Date()) {
  const settings = driveSync.getSettings();
  const previous = Array.isArray(settings.reviewStartMoments) ? settings.reviewStartMoments : [];
  const next = appendStudyMoment(previous, now);
  if (next.join('|') !== previous.join('|')) driveSync.updateSettings({ reviewStartMoments: next }, { silent: true });
}

async function refreshSmartReminder({ requestPermission = false, settingsOverride = {} } = {}) {
  const settings = { ...driveSync.getSettings(), ...settingsOverride };
  if (!settings.reminderEnabled) {
    await cancelDailyReminder();
    return { status: 'disabled', plan: null };
  }
  const plan = currentSmartReminderPlan(settingsOverride);
  const result = await scheduleDailyReminder({ ...plan, requestPermission });
  return { ...result, plan };
}

function queueSmartReminderRefresh() {
  globalThis.clearTimeout(reminderRefreshTimer);
  if (!driveSync.getSettings().reminderEnabled) return;
  reminderRefreshTimer = globalThis.setTimeout(() => {
    refreshSmartReminder().catch(error => console.warn('Smart reminder refresh failed.', error));
  }, 400);
}

function updateEngagementCard() {
  const title = document.getElementById('coach-title');
  const copy = document.getElementById('coach-copy');
  const status = document.getElementById('coach-reminder-status');
  const weeklyStatus = document.getElementById('coach-weekly-status');
  const mascot = document.getElementById('coach-mascot-image');
  if (!title || !copy || !status || !weeklyStatus || !mascot) return;

  const settings = driveSync.getSettings();
  const dailyGoal = Math.max(1, Number(settings.dailyGoal || 20));
  const reviewsToday = settings.reviewsDate === localDateKey() ? Number(settings.reviewsToday || 0) : 0;
  const dueCount = getDueWords().filter(word => word.notebook === driveSync.getActiveNotebook()).length;
  const streak = Number(settings.dailyStreak || 0);
  const activity = settings.reviewActivity || {};
  const today = new Date();
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  const activeDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return Number(activity[localDateKey(date)] || 0) > 0;
  }).filter(Boolean).length;
  const isStreakMilestone = reviewsToday > 0 && [3, 7, 14, 30, 50, 100, 365].includes(streak);

  if (isStreakMilestone) {
    title.textContent = `${streak}-day streak!`;
    copy.textContent = 'Sprig is celebrating the routine you built one short session at a time.';
  } else if (reviewsToday >= dailyGoal) {
    title.textContent = 'Daily goal complete!';
    copy.textContent = 'Nice work. Sprig will keep tomorrow’s practice short and focused.';
  } else if (dueCount > 0) {
    title.textContent = `${dueCount} word${dueCount === 1 ? '' : 's'} ready for review`;
    copy.textContent = `A five-minute session moves you ${Math.min(dueCount, dailyGoal - reviewsToday)} step${Math.min(dueCount, dailyGoal - reviewsToday) === 1 ? '' : 's'} closer to today’s goal.`;
  } else {
    title.textContent = 'Your memory garden is growing';
    copy.textContent = 'Add a new word or practice a learning mode to keep your routine alive.';
  }

  mascot.src = isStreakMilestone || reviewsToday >= dailyGoal
    ? 'assets/keepvocab-sprig-celebrate.webp'
    : dueCount > 0
      ? 'assets/keepvocab-sprig-thinking.webp'
      : 'assets/keepvocab-sprout-mascot.webp';
  weeklyStatus.innerHTML = `<i class="fa-solid fa-chart-line"></i> ${activeDays} / 5 active days`;

  const reminderPlan = currentSmartReminderPlan();
  status.innerHTML = settings.reminderEnabled
    ? `<i class="fa-solid fa-bell"></i> ${settings.smartReminderEnabled !== false ? 'Smart reminder' : 'Daily reminder'} at ${formatReminderTime(reminderPlan.time)} · ${reminderPlan.summary}`
    : '<i class="fa-regular fa-bell"></i> Daily reminder is off';
}

function setupEngagementSystem() {
  const modal = document.getElementById('engagement-settings-modal');
  const reminderEnabled = document.getElementById('reminder-enabled');
  const smartReminderEnabled = document.getElementById('smart-reminder-enabled');
  const reminderTime = document.getElementById('reminder-time');
  const soundEnabled = document.getElementById('sound-enabled');
  const helper = document.getElementById('reminder-helper');
  const save = document.getElementById('btn-save-engagement-settings');
  if (!modal || !reminderEnabled || !smartReminderEnabled || !reminderTime || !soundEnabled || !helper || !save) return;

  const updateHelper = () => {
    if (!reminderEnabled.checked) {
      helper.textContent = 'Reminders are off. Your progress and app sounds still work normally.';
      return;
    }
    const plan = currentSmartReminderPlan({
      reminderTime: normalizeReminderTime(reminderTime.value),
      smartReminderEnabled: smartReminderEnabled.checked
    });
    const learnedTime = smartReminderEnabled.checked && plan.time !== normalizeReminderTime(reminderTime.value);
    const timingCopy = !smartReminderEnabled.checked
      ? 'Fixed timing is active.'
      : learnedTime
        ? 'Timing learned from your recent study days.'
        : 'Smart timing will learn after three study days; your preferred time is used for now.';
    helper.textContent = `Next plan: ${formatReminderTime(plan.time)} · ${plan.title}. ${timingCopy}`;
  };

  const updateTimeState = () => {
    reminderTime.disabled = !reminderEnabled.checked;
    smartReminderEnabled.disabled = !reminderEnabled.checked;
    updateHelper();
  };

  const openSettings = () => {
    const settings = driveSync.getSettings();
    reminderEnabled.checked = Boolean(settings.reminderEnabled);
    smartReminderEnabled.checked = settings.smartReminderEnabled !== false;
    reminderTime.value = normalizeReminderTime(settings.reminderTime || '19:00');
    soundEnabled.checked = settings.soundEnabled !== false;
    updateTimeState();
    modal.classList.add('active');
  };

  const closeSettings = () => modal.classList.remove('active');

  reminderEnabled.addEventListener('change', updateTimeState);
  smartReminderEnabled.addEventListener('change', updateHelper);
  reminderTime.addEventListener('input', updateHelper);
  document.addEventListener('click', event => {
    const control = event.target.closest('button, a');
    if (!control) return;
    if (control.id === 'btn-open-engagement-settings' || control.id === 'settings-routine') openSettings();
    if (control.id === 'btn-coach-review') window.location.hash = 'review';
    if (control.id === 'btn-close-engagement-settings' || control.id === 'btn-cancel-engagement-settings') closeSettings();
  });

  save.addEventListener('click', async () => {
    const enabled = reminderEnabled.checked;
    const time = normalizeReminderTime(reminderTime.value);
    const smartTiming = smartReminderEnabled.checked;
    save.disabled = true;
    save.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
    helper.textContent = enabled ? 'Requesting notification access and scheduling your reminder…' : 'Turning the daily reminder off…';
    try {
      driveSync.updateSettings({
        reminderEnabled: enabled,
        smartReminderEnabled: smartTiming,
        reminderTime: time,
        soundEnabled: soundEnabled.checked
      });
      const result = enabled
        ? await refreshSmartReminder({ requestPermission: true })
        : (await cancelDailyReminder(), { status: 'disabled' });
      updateEngagementCard();
      closeSettings();
      const message = result.status === 'scheduled'
        ? `${smartTiming ? 'Smart' : 'Daily'} reminder set for ${formatReminderTime(result.plan?.time || time)}.`
        : result.status === 'permission-required'
          ? 'Reminder saved. Enable notification permission for alerts outside the app.'
          : enabled
            ? 'In-app reminder saved.'
            : 'Daily reminder turned off.';
      showToast(message);
    } catch (error) {
      helper.textContent = error.message || 'The reminder could not be scheduled on this device.';
      showToast(helper.textContent, 'error');
    } finally {
      save.disabled = false;
      save.innerHTML = '<i class="fa-solid fa-check"></i> Save routine';
    }
  });

  const settings = driveSync.getSettings();
  if (settings.reminderEnabled) {
    refreshSmartReminder().catch(error => console.warn('Smart reminder restore failed.', error));
  }
}

function navigateTo(viewName) {
  if (viewName === 'challenge') viewName = 'choose';
  if (!['dashboard', 'daily', 'weak', 'review', 'library', 'stats', 'spelling', 'choose', 'visual', 'match', 'flashcards', 'context', 'useit', 'speaking', 'settings'].includes(viewName)) viewName = 'dashboard';
  if (currentView === 'speaking' && viewName !== 'speaking') teardownSpeakingMode();
  currentView = viewName;
  document.body.classList.toggle('speaking-view', viewName === 'speaking');
  document.body.classList.toggle('dashboard-view', viewName === 'dashboard');
  document.body.classList.toggle('immersive-view', ['daily', 'weak', 'review', 'spelling', 'choose', 'visual', 'match', 'flashcards', 'context', 'useit', 'library', 'stats', 'settings'].includes(viewName));
  const activeMonthLabel = document.getElementById('active-month-label');
  if (activeMonthLabel) activeMonthLabel.textContent = driveSync.getActiveNotebook().replace(/ Vocabulary$/, '');

  document.querySelectorAll('.nav-link-item').forEach(link => {
    link.classList.toggle('active', link.getAttribute('data-view') === viewName);
  });

  const container = document.getElementById('view-container');
  if (!container) return;

  if (viewName === 'daily') {
    renderDailySessionMode(container, navigateTo);
  } else if (viewName === 'weak') {
    renderDailySessionMode(container, navigateTo, { kind: 'weak' });
  } else if (viewName === 'review') {
    renderReviewView(container, navigateTo);
  } else if (viewName === 'library') {
    renderLibraryView(container, navigateTo);
  } else if (viewName === 'stats') {
    renderStatsView(container, navigateTo);
  } else if (viewName === 'spelling') {
    renderSpellingMode(container, navigateTo);
  } else if (viewName === 'choose') {
    renderChooseWordMode(container, navigateTo);
  } else if (viewName === 'visual') {
    renderVisualMatchMode(container, navigateTo);
  } else if (viewName === 'match') {
    renderMatchSprintMode(container, navigateTo);
  } else if (viewName === 'flashcards') {
    renderFlashcardsMode(container, navigateTo);
  } else if (viewName === 'context') {
    renderContextQuizMode(container, navigateTo);
  } else if (viewName === 'useit') {
    renderUseItMode(container, navigateTo);
  } else if (viewName === 'speaking') {
    renderSpeakingMode(container, navigateTo);
  } else if (viewName === 'settings') {
    renderSettingsView(container, navigateTo);
  } else {
    renderDashboardView(container, navigateTo);
    updateDashboardDerivedState();
  }
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  container.classList.remove('view-enter');
  if (viewEnterTimer) window.clearTimeout(viewEnterTimer);
  requestAnimationFrame(() => {
    container.classList.add('view-enter');
    viewEnterTimer = window.setTimeout(() => container.classList.remove('view-enter'), 380);
  });
}

function setupLearningModeButtons() {
  document.getElementById('btn-mode-spelling')?.addEventListener('click', () => { window.location.hash = 'spelling'; });
  document.getElementById('btn-mode-choose')?.addEventListener('click', () => { window.location.hash = 'choose'; });
  document.getElementById('btn-mode-visual')?.addEventListener('click', () => { window.location.hash = 'visual'; });
  document.getElementById('btn-mode-match')?.addEventListener('click', () => { window.location.hash = 'match'; });
  document.getElementById('btn-mode-speaking')?.addEventListener('click', () => { window.location.hash = 'speaking'; });
}

function setupNavigation() {
  document.querySelectorAll('.nav-link-item').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const view = link.getAttribute('data-view');
      if (location.hash === `#${view}`) navigateTo(view);
      else location.hash = view;
    });
  });
}

function setupQuickAddModal() {
  const modal = document.getElementById('add-word-modal');
  const lookupForm = document.getElementById('add-word-lookup-form');
  const btnOpen = document.getElementById('btn-header-quick-add');
  const btnClose = document.getElementById('btn-close-add-modal');
  const btnCancel = document.getElementById('btn-cancel-add-modal');
  const btnFetch = document.getElementById('btn-auto-fetch-word');
  const btnSave = document.getElementById('btn-save-new-word');
  const input = document.getElementById('add-word-input');
  const preview = document.getElementById('add-word-preview');
  const senseList = document.getElementById('add-word-sense-list');
  const posInput = document.getElementById('add-word-pos');
  const phoneticInput = document.getElementById('add-word-phonetic');
  const definitionInput = document.getElementById('add-word-definition');
  const exampleInput = document.getElementById('add-word-example');
  const formStatus = document.getElementById('add-word-form-status');
  const editorTitle = document.getElementById('meaning-editor-title');
  const editorSubtitle = document.getElementById('meaning-editor-subtitle');
  const singleTab = document.getElementById('single-add-tab');
  const bulkTab = document.getElementById('bulk-add-tab');
  const singlePanel = document.getElementById('single-add-panel');
  const bulkPanel = document.getElementById('bulk-add-panel');
  const bulkInput = document.getElementById('bulk-word-input');
  const bulkCount = document.getElementById('bulk-word-count');
  const bulkPrepare = document.getElementById('prepare-bulk-words');
  const bulkResultsList = document.getElementById('bulk-word-results');
  const bulkStatus = document.getElementById('bulk-word-status');
  const bulkSave = document.getElementById('btn-save-bulk-words');
  const bulkRetryMissing = document.getElementById('retry-bulk-missing');
  const bulkProgress = document.getElementById('bulk-import-progress');
  const bulkProgressPhase = document.getElementById('bulk-progress-phase');
  const bulkProgressEta = document.getElementById('bulk-progress-eta');
  const bulkProgressTrack = document.getElementById('bulk-progress-track');
  const bulkProgressFill = document.getElementById('bulk-progress-fill');
  const bulkProgressCount = document.getElementById('bulk-progress-count');
  let senseDrafts = new Map();
  let selectedSenseIds = new Set();
  let focusedSenseId = null;
  let bulkResults = [];

  if (!btnOpen) return;

  const updateBulkProgress = ({ completed, total, phase, startedAt, finished = false }) => {
    const safeTotal = Math.max(1, Number(total) || 1);
    const safeCompleted = Math.max(0, Math.min(safeTotal, Number(completed) || 0));
    const percent = Math.round((safeCompleted / safeTotal) * 100);
    bulkProgress.hidden = false;
    bulkProgressPhase.textContent = phase;
    bulkProgressCount.textContent = `Processed ${safeCompleted} of ${total} word${total === 1 ? '' : 's'} · ${percent}%`;
    bulkProgressFill.style.width = `${percent}%`;
    bulkProgressTrack.setAttribute('aria-valuenow', String(percent));
    if (finished || safeCompleted >= safeTotal) {
      bulkProgressEta.textContent = 'Complete';
      return;
    }
    if (!safeCompleted) {
      bulkProgressEta.textContent = 'Estimating time…';
      return;
    }
    const elapsedMs = Date.now() - startedAt;
    const remainingSeconds = Math.max(1, Math.ceil((elapsedMs / safeCompleted) * (safeTotal - safeCompleted) / 1000));
    bulkProgressEta.textContent = remainingSeconds < 60
      ? `About ${remainingSeconds} sec left`
      : `About ${Math.ceil(remainingSeconds / 60)} min left`;
  };

  const resetAsyncControls = () => {
    btnFetch.disabled = false;
    btnFetch.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Find meanings';
    btnSave.disabled = false;
    btnSave.innerHTML = '<i class="fa-solid fa-bookmark"></i> Save meaning';
    bulkPrepare.disabled = false;
    bulkPrepare.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Find meanings';
    bulkSave.disabled = true;
    bulkSave.innerHTML = '<i class="fa-solid fa-bookmark"></i> Save word list';
    bulkRetryMissing.disabled = false;
    bulkRetryMissing.hidden = true;
    bulkRetryMissing.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Retry missing meanings';
    bulkProgress.hidden = true;
    bulkProgressPhase.textContent = 'Finding meanings';
    bulkProgressEta.textContent = 'Estimating time…';
    bulkProgressCount.textContent = 'Processed 0 of 0 words';
    bulkProgressFill.style.width = '0%';
    bulkProgressTrack.setAttribute('aria-valuenow', '0');
  };

  const openModal = () => {
    resetAsyncControls();
    modal.classList.add('active');
    window.setTimeout(() => input.focus(), 0);
  };

  const setAddMode = (mode, focus = true) => {
    const bulk = mode === 'bulk';
    singleTab.classList.toggle('active', !bulk);
    bulkTab.classList.toggle('active', bulk);
    singleTab.setAttribute('aria-selected', String(!bulk));
    bulkTab.setAttribute('aria-selected', String(bulk));
    singlePanel.hidden = bulk;
    bulkPanel.hidden = !bulk;
    if (focus) window.setTimeout(() => (bulk ? bulkInput : input).focus(), 0);
  };

  const updateBulkSaveState = () => {
    const complete = bulkResults.length > 0 && bulkResults.every((result, index) => {
      if (result.status === 'ready') return true;
      return Boolean(result.manualDefinition?.trim());
    });
    bulkSave.disabled = !complete;
    bulkSave.innerHTML = `<i class="fa-solid fa-bookmark"></i> Save ${bulkResults.length || ''} word${bulkResults.length === 1 ? '' : 's'}`;
    const missingCount = bulkResults.filter(result => result.status !== 'ready').length;
    bulkRetryMissing.hidden = missingCount === 0;
    bulkRetryMissing.innerHTML = `<i class="fa-solid fa-rotate-right"></i> Retry ${missingCount || ''} missing meaning${missingCount === 1 ? '' : 's'}`;
  };

  const renderBulkResults = () => {
    bulkResultsList.innerHTML = '';
    bulkResults.forEach((result, index) => {
      const row = document.createElement('article');
      row.className = `bulk-word-row ${result.status}`;
      const heading = document.createElement('div');
      heading.className = 'bulk-word-heading';
      const title = document.createElement('strong');
      title.textContent = result.data?.word || result.term;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${result.term}`);
      remove.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      remove.addEventListener('click', () => {
        bulkResults.splice(index, 1);
        renderBulkResults();
        bulkStatus.textContent = `${bulkResults.length} word${bulkResults.length === 1 ? '' : 's'} ready to review.`;
      });
      const titleGroup = document.createElement('span');
      titleGroup.appendChild(title);
      if (result.data?.correctedFrom) {
        const correction = document.createElement('small');
        correction.className = 'spelling-correction';
        correction.textContent = `Corrected from ${result.data.correctedFrom}`;
        titleGroup.appendChild(correction);
      }
      heading.append(titleGroup, remove);
      row.appendChild(heading);

      if (result.status === 'ready') {
        const senses = Array.isArray(result.data?.senses) && result.data.senses.length ? result.data.senses : [result.data];
        const label = document.createElement('label');
        label.textContent = 'Meaning to import';
        const select = document.createElement('select');
        select.dataset.bulkSense = String(index);
        senses.forEach((sense, senseIndex) => {
          const option = document.createElement('option');
          option.value = String(senseIndex);
          option.textContent = `${sense.partOfSpeech || 'word'} — ${sense.definition || 'Definition unavailable'}`;
          select.appendChild(option);
        });
        select.value = String(result.selectedSenseIndex || 0);
        select.addEventListener('change', () => { result.selectedSenseIndex = Number(select.value); });
        label.appendChild(select);
        row.appendChild(label);
      } else {
        const note = document.createElement('p');
        note.textContent = result.error || 'No dictionary meaning was found.';
        const label = document.createElement('label');
        label.textContent = 'Add the intended meaning manually';
        const definition = document.createElement('textarea');
        definition.rows = 2;
        definition.dataset.bulkManual = String(index);
        definition.placeholder = `Definition of ${result.term}`;
        definition.value = result.manualDefinition || '';
        definition.addEventListener('input', () => { result.manualDefinition = definition.value; updateBulkSaveState(); });
        label.appendChild(definition);
        row.append(note, label);
      }
      bulkResultsList.appendChild(row);
    });
    updateBulkSaveState();
  };

  const clearSenseState = () => {
    senseDrafts = new Map();
    selectedSenseIds = new Set();
    focusedSenseId = null;
    senseList.innerHTML = '';
    editorTitle.textContent = 'Meaning to save';
    editorSubtitle.textContent = 'Type a custom meaning or find dictionary meanings above';
    btnSave.innerHTML = '<i class="fa-solid fa-bookmark"></i> Save meaning';
  };

  const closeModal = () => {
    modal.classList.remove('active');
    preview.style.display = 'none';
    input.value = '';
    clearSenseState();
    posInput.value = '';
    phoneticInput.value = '';
    definitionInput.value = '';
    exampleInput.value = '';
    formStatus.textContent = '';
    bulkInput.value = '';
    bulkCount.textContent = '0 words';
    bulkStatus.textContent = '';
    bulkProgress.hidden = true;
    bulkResults = [];
    bulkResultsList.innerHTML = '';
    resetAsyncControls();
    setAddMode('single', false);
    currentFetchedData = null;
  };

  const persistFocusedDraft = () => {
    if (!focusedSenseId || !senseDrafts.has(focusedSenseId)) return;
    senseDrafts.set(focusedSenseId, {
      ...senseDrafts.get(focusedSenseId),
      phonetic: phoneticInput.value.trim(),
      partOfSpeech: posInput.value.trim() || 'unknown',
      definition: definitionInput.value.trim(),
      example: exampleInput.value.trim()
    });
  };

  const loadFocusedDraft = () => {
    const draft = senseDrafts.get(focusedSenseId);
    if (!draft) return;
    posInput.value = draft.partOfSpeech || 'unknown';
    phoneticInput.value = draft.phonetic || currentFetchedData?.phonetic || '';
    definitionInput.value = draft.definition || '';
    exampleInput.value = draft.example || '';
    const position = [...senseDrafts.keys()].indexOf(focusedSenseId) + 1;
    editorTitle.textContent = `Edit meaning ${position}`;
    editorSubtitle.textContent = selectedSenseIds.size > 1 ? `${selectedSenseIds.size} meanings will be saved` : 'This meaning will be saved as its own card';
  };

  const renderSenseOptions = () => {
    senseList.innerHTML = '';
    const senses = [...senseDrafts.values()];
    document.getElementById('sense-count-label').textContent = `${selectedSenseIds.size} of ${senses.length} selected`;
    btnSave.innerHTML = `<i class="fa-solid fa-bookmark"></i> Save ${selectedSenseIds.size} meaning${selectedSenseIds.size === 1 ? '' : 's'}`;
    senses.forEach((sense, index) => {
      const selected = selectedSenseIds.has(sense.id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `sense-option${selected ? ' selected' : ''}${focusedSenseId === sense.id ? ' focused' : ''}`;
      button.dataset.senseId = sense.id;
      button.setAttribute('aria-pressed', String(selected));
      const check = document.createElement('span');
      check.className = 'sense-option-check';
      check.innerHTML = selected ? '<i class="fa-solid fa-check"></i>' : '';
      const body = document.createElement('span');
      body.className = 'sense-option-body';
      const meta = document.createElement('span');
      meta.className = 'sense-option-meta';
      meta.textContent = `${index + 1}. ${sense.partOfSpeech || 'unknown'}`;
      const definition = document.createElement('strong');
      definition.textContent = sense.definition;
      body.append(meta, definition);
      if (sense.example) {
        const example = document.createElement('small');
        example.textContent = `“${sense.example}”`;
        body.appendChild(example);
      }
      button.append(check, body);
      button.addEventListener('click', () => {
        persistFocusedDraft();
        if (selectedSenseIds.has(sense.id) && selectedSenseIds.size > 1) selectedSenseIds.delete(sense.id);
        else selectedSenseIds.add(sense.id);
        focusedSenseId = selectedSenseIds.has(sense.id) ? sense.id : [...selectedSenseIds][0] || null;
        renderSenseOptions();
        loadFocusedDraft();
        formStatus.textContent = `${selectedSenseIds.size} meaning${selectedSenseIds.size === 1 ? '' : 's'} selected. Each keeps its own definition, example, and review progress.`;
      });
      senseList.appendChild(button);
    });
  };

  const renderSenses = data => {
    const senses = Array.isArray(data.senses) && data.senses.length ? data.senses : [data];
    senseDrafts = new Map(senses.map((sense, index) => {
      const id = String(sense.id || index);
      return [id, { ...sense, id, phonetic: data.phonetic || '', audioUrl: data.audioUrl || '' }];
    }));
    focusedSenseId = senseDrafts.keys().next().value || null;
    selectedSenseIds = new Set(focusedSenseId ? [focusedSenseId] : []);
    renderSenseOptions();
    loadFocusedDraft();
    formStatus.textContent = 'Select one or several meanings. Missing examples are filled from Tatoeba when available.';
  };

  btnOpen.addEventListener('click', openModal);
  singleTab.addEventListener('click', () => setAddMode('single'));
  bulkTab.addEventListener('click', () => setAddMode('bulk'));
  btnClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-bulk-add').addEventListener('click', closeModal);
  bulkInput.addEventListener('input', () => {
    const terms = parseBulkWordList(bulkInput.value, Number.MAX_SAFE_INTEGER);
    bulkCount.textContent = `${terms.length} word${terms.length === 1 ? '' : 's'}`;
    bulkStatus.textContent = terms.length > MAX_BULK_WORDS ? `You can import up to ${MAX_BULK_WORDS} words at once.` : '';
    bulkResults = [];
    bulkResultsList.innerHTML = '';
    bulkSave.disabled = true;
    bulkProgress.hidden = true;
    bulkRetryMissing.hidden = true;
  });
  bulkPrepare.addEventListener('click', async () => {
    const allTerms = parseBulkWordList(bulkInput.value, Number.MAX_SAFE_INTEGER);
    if (!allTerms.length) { bulkInput.focus(); return; }
    if (allTerms.length > MAX_BULK_WORDS) {
      bulkStatus.textContent = `This list has ${allTerms.length} words. Keep the first ${MAX_BULK_WORDS} or split it into smaller batches.`;
      return;
    }
    bulkPrepare.disabled = true;
    bulkPrepare.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Finding meanings…';
    bulkStatus.textContent = `Looking up ${allTerms.length} word${allTerms.length === 1 ? '' : 's'}…`;
    const lookupStartedAt = Date.now();
    updateBulkProgress({ completed: 0, total: allTerms.length, phase: 'Finding meanings', startedAt: lookupStartedAt });
    try {
      const lookedUp = await lookupBulkWords(allTerms, fetchWordDetails, {
        delayMs: BULK_LOOKUP_DELAY_MS,
        retries: 2,
        retryDelayMs: 750,
        onProgress: ({ completed, total, term }) => {
          bulkStatus.textContent = `Looking up ${completed} of ${total}: ${term}`;
          updateBulkProgress({ completed, total, phase: 'Finding meanings', startedAt: lookupStartedAt });
        }
      });
      bulkResults = dedupeBulkResults(lookedUp);
      renderBulkResults();
      const manualCount = bulkResults.filter(result => result.status === 'manual').length;
      const mergedCount = lookedUp.length - bulkResults.length;
      updateBulkProgress({ completed: lookedUp.length, total: lookedUp.length, phase: 'Meanings ready', startedAt: lookupStartedAt, finished: true });
      bulkStatus.textContent = manualCount
        ? `${bulkResults.length - manualCount} ready; ${manualCount} need${manualCount === 1 ? 's' : ''} a manual definition.`
        : `${bulkResults.length} words ready${mergedCount ? `; ${mergedCount} corrected duplicate${mergedCount === 1 ? ' was' : 's were'} merged` : ''}. Review each meaning, then save; images are chosen automatically.`;
    } catch (error) {
      bulkStatus.textContent = error.message || 'Some meanings could not be loaded. Try again.';
      showToast(bulkStatus.textContent, 'error');
    } finally {
      bulkPrepare.disabled = false;
      bulkPrepare.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Find meanings';
    }
  });
  bulkRetryMissing.addEventListener('click', async () => {
    const missingCount = bulkResults.filter(result => result.status !== 'ready').length;
    if (!missingCount) return;
    const retryStartedAt = Date.now();
    bulkRetryMissing.disabled = true;
    bulkPrepare.disabled = true;
    updateBulkProgress({ completed: 0, total: missingCount, phase: 'Retrying missing meanings', startedAt: retryStartedAt });
    bulkStatus.textContent = `Retrying only ${missingCount} missing word${missingCount === 1 ? '' : 's'}…`;
    try {
      bulkResults = await retryMissingBulkWords(bulkResults, fetchWordDetails, {
        delayMs: BULK_LOOKUP_DELAY_MS,
        retries: 2,
        retryDelayMs: 1000,
        onProgress: ({ completed, total, term }) => {
          bulkStatus.textContent = `Retrying ${completed} of ${total}: ${term}`;
          updateBulkProgress({ completed, total, phase: 'Retrying missing meanings', startedAt: retryStartedAt });
        }
      });
      bulkResults = dedupeBulkResults(bulkResults);
      renderBulkResults();
      const remaining = bulkResults.filter(result => result.status !== 'ready').length;
      updateBulkProgress({ completed: missingCount, total: missingCount, phase: 'Retry finished', startedAt: retryStartedAt, finished: true });
      bulkStatus.textContent = remaining
        ? `${missingCount - remaining} recovered; ${remaining} still need${remaining === 1 ? 's' : ''} a meaning. You can retry again or enter it manually.`
        : `All ${bulkResults.length} meanings are ready. Review them, then save.`;
    } finally {
      bulkRetryMissing.disabled = false;
      bulkPrepare.disabled = false;
    }
  });
  bulkSave.addEventListener('click', async () => {
    const items = bulkResults.map((result, index) => {
      const senseIndex = result.selectedSenseIndex || 0;
      const manualDefinition = result.manualDefinition || '';
      return bulkResultToWord(result, senseIndex, manualDefinition);
    });
    if (!items.length || items.some(item => !item.definition)) {
      bulkStatus.textContent = 'Every word needs an intended meaning before the list can be saved.';
      return;
    }
    const originalButton = bulkSave.innerHTML;
    bulkSave.disabled = true;
    const imageStartedAt = Date.now();
    updateBulkProgress({ completed: 0, total: items.length, phase: 'Choosing images', startedAt: imageStartedAt });
    try {
      const checkedItems = items.map(item => sanitizeExistingExamples(item.word, [item])[0]);
      const existingImageUrls = driveSync.getWords().flatMap(item => [item.imageUrl, item.imageSourceUrl]).filter(Boolean);
      const enrichedItems = await attachImagesSequentially(checkedItems, findRelevantImages, {
        excludeUrls: existingImageUrls,
        onProgress: ({ completed, total, word }) => {
          bulkStatus.textContent = `Choosing image ${completed} of ${total}: ${word}`;
          bulkSave.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Choosing images ${completed}/${total}`;
          updateBulkProgress({ completed, total, phase: 'Choosing images', startedAt: imageStartedAt });
        }
      });
      const saved = driveSync.addWords(enrichedItems);
      driveSync.setActiveNotebook(saved[0].notebook);
      wordsQueue = buildStudyQueue();
      currentIndex = 0;
      closeModal();
      showToast(`Saved ${saved.length} words to ${saved[0].notebook}.`);
      navigateTo(currentView);
    } catch (error) {
      bulkStatus.textContent = error.message;
      showToast(error.message, 'error');
      bulkSave.disabled = false;
      bulkSave.innerHTML = originalButton;
    }
  });
  input.addEventListener('input', () => {
    if (!currentFetchedData) return;
    currentFetchedData = null;
    preview.style.display = 'none';
    clearSenseState();
    posInput.value = '';
    phoneticInput.value = '';
    definitionInput.value = '';
    exampleInput.value = '';
    formStatus.textContent = 'The spelling changed. Fetch meanings again, or enter the intended meaning manually.';
  });

  lookupForm.addEventListener('submit', async event => {
    event.preventDefault();
    const w = input.value.trim();
    if (!w) { input.focus(); return; }

    btnFetch.disabled = true;
    btnFetch.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Finding meanings & examples…';

    try {
      currentFetchedData = await fetchWordDetails(w);
      if (currentFetchedData.correctedFrom) input.value = currentFetchedData.word;
      document.getElementById('prev-w-title').textContent = currentFetchedData.word;
      document.getElementById('prev-w-phonetic').textContent = currentFetchedData.phonetic;
      renderSenses(currentFetchedData);
      if (currentFetchedData.correctedFrom) {
        formStatus.textContent = `Spelling corrected from “${currentFetchedData.correctedFrom}” to “${currentFetchedData.word}”. Review the meaning before saving.`;
      }
      preview.style.display = 'block';
    } catch (err) {
      currentFetchedData = null;
      preview.style.display = 'none';
      formStatus.textContent = 'Lookup failed. You can still enter the exact meaning manually below.';
      showToast(err.message || 'Could not fetch word details.', 'error');
    } finally {
      btnFetch.disabled = false;
      btnFetch.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Find meanings';
    }
  });

  btnSave.addEventListener('click', async () => {
    const wordText = input.value.trim();
    if (!wordText) return;

    persistFocusedDraft();
    const selectedDrafts = [...selectedSenseIds].map(id => senseDrafts.get(id)).filter(Boolean);
    const items = currentFetchedData && selectedDrafts.length ? selectedDrafts.map(sense => ({
      word: currentFetchedData.word || wordText,
      phonetic: sense.phonetic || currentFetchedData.phonetic || '',
      audioUrl: sense.audioUrl || currentFetchedData.audioUrl || '',
      partOfSpeech: sense.partOfSpeech || 'unknown',
      definition: sense.definition,
      example: sense.example || '',
      exampleSourceUrl: sense.exampleSourceUrl || '',
      exampleAttribution: sense.exampleAttribution || '',
      exampleLicense: sense.exampleLicense || ''
    })) : [{
      word: wordText,
      phonetic: phoneticInput.value.trim(),
      partOfSpeech: posInput.value.trim() || 'unknown',
      definition: definitionInput.value.trim(),
      example: exampleInput.value.trim()
    }];

    if (items.some(item => !item.definition)) {
      formStatus.textContent = 'Choose a dictionary meaning or write the intended definition before saving.';
      definitionInput.focus();
      return;
    }

    const originalButton = btnSave.innerHTML;
    btnSave.disabled = true;
    try {
      const senseCheckedItems = items.map(item => sanitizeExistingExamples(item.word, [item])[0]);
      const existingImageUrls = driveSync.getWords().flatMap(item => [item.imageUrl, item.imageSourceUrl]).filter(Boolean);
      const enrichedItems = await attachImagesSequentially(senseCheckedItems, findRelevantImages, {
        excludeUrls: existingImageUrls,
        onProgress: ({ completed, total }) => {
          formStatus.textContent = `Choosing image ${completed} of ${total}…`;
          btnSave.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Choosing images ${completed}/${total}`;
        }
      });
      const saved = driveSync.addWords(enrichedItems);
      driveSync.setActiveNotebook(saved[0].notebook);
      wordsQueue = buildStudyQueue();
      currentIndex = 0;
      closeModal();
      showToast(`Saved ${saved.length} meaning${saved.length === 1 ? '' : 's'} of “${saved[0].word}” to ${saved[0].notebook}.`);
      navigateTo(currentView);
    } catch (error) {
      showToast(error.message, 'error');
      btnSave.disabled = false;
      btnSave.innerHTML = originalButton;
    }
  });
}

function setupDriveBackupModal() {
  const modal = document.getElementById('drive-auth-modal');
  const btnOpen = document.getElementById('btn-open-drive-auth');
  const btnClose = document.getElementById('btn-close-modal');
  const btnOAuth = document.getElementById('btn-modal-oauth');
  const btnSyncNow = document.getElementById('btn-sync-drive-now');
  const btnDisconnect = document.getElementById('btn-disconnect-drive');
  const clientIdInput = document.getElementById('modal-client-id-input');
  const status = document.getElementById('drive-auth-status');
  const origin = document.getElementById('drive-origin-value');
  const webOAuthConfig = document.getElementById('drive-web-oauth-config');
  const androidOAuthNote = document.getElementById('drive-android-oauth-note');
  const nativeAuthorization = usesNativeGoogleAuthorization();

  clientIdInput.value = driveSync.getGoogleClientId();
  if (origin) origin.textContent = window.location.origin;
  if (webOAuthConfig) webOAuthConfig.hidden = nativeAuthorization;
  if (androidOAuthNote) androidOAuthNote.hidden = !nativeAuthorization;
  btnOpen.addEventListener('click', () => {
    status.textContent = '';
    modal.classList.add('active');
  });
  btnClose.addEventListener('click', () => modal.classList.remove('active'));

  btnOAuth.addEventListener('click', async () => {
    const original = btnOAuth.innerHTML;
    btnOAuth.disabled = true;
    btnOAuth.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Waiting for Google…';
    status.textContent = nativeAuthorization
      ? 'Choose the Google account that will store your KeepVocab backup.'
      : 'Complete authorization in the Google dialog.';
    document.getElementById('pill-syncing').style.display = 'inline-flex';
    try {
      const result = await driveSync.connectGoogleDrive(clientIdInput.value);
      renderConnectionState();
      syncedDriveRevision = driveChangeRevision;
      lastAutomaticDriveSyncAt = Date.now();
      status.textContent = `Backed up ${result.totalWords} words across ${result.months} monthly files in “${result.folderName}”.`;
      showToast('Google Drive connected. The current screen was left untouched.');
    } catch (error) {
      renderConnectionState();
      status.textContent = error.message;
      showToast(error.message, 'error');
    } finally {
      btnOAuth.disabled = false;
      btnOAuth.innerHTML = original;
    }
  });

  btnSyncNow.addEventListener('click', async () => {
    const original = btnSyncNow.innerHTML;
    btnSyncNow.disabled = true;
    btnSyncNow.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Syncing…';
    try {
      const revisionAtStart = driveChangeRevision;
      const result = await runDriveSync();
      syncedDriveRevision = Math.max(syncedDriveRevision, revisionAtStart);
      lastAutomaticDriveSyncAt = Date.now();
      status.textContent = `Synchronized ${result.totalWords} words across ${result.months} monthly files.`;
      showToast('Google Drive backup is up to date. Your current screen was not refreshed.');
    } catch (error) {
      status.textContent = error.message;
      showToast(error.message, 'error');
    } finally {
      btnSyncNow.disabled = false;
      btnSyncNow.innerHTML = original;
    }
  });

  btnDisconnect.addEventListener('click', () => {
    driveSync.disconnectGoogleDrive();
    renderConnectionState();
    status.textContent = 'Google Drive disconnected. The local cache remains available on this device.';
    showToast('Google Drive disconnected.');
  });
}

let automaticSyncTimer = null;
let driveChangeRevision = 0;
let syncedDriveRevision = 0;
let lastAutomaticDriveSyncAt = 0;
let automaticSyncRunning = false;
let driveResumeRunning = false;

async function runDriveSync() {
  document.getElementById('pill-syncing').style.display = 'inline-flex';
  try {
    const result = await driveSync.syncGoogleDrive();
    renderConnectionState();
    return result;
  } catch (error) {
    driveSync.setDriveStatus({ isConnected: driveSync.getDriveStatus().isConnected, lastError: error.message });
    renderConnectionState();
    throw error;
  } finally {
    document.getElementById('pill-syncing').style.display = 'none';
  }
}

function hasPendingDriveChanges() {
  return driveChangeRevision > syncedDriveRevision;
}

function scheduleAutomaticDriveSync() {
  if (!driveSync.getDriveStatus().isConnected || !hasPendingDriveChanges() || automaticSyncTimer || automaticSyncRunning) return;
  const delay = backgroundSyncDelay(lastAutomaticDriveSyncAt);
  automaticSyncTimer = window.setTimeout(flushAutomaticDriveSync, delay);
}

async function flushAutomaticDriveSync() {
  automaticSyncTimer = null;
  if (!driveSync.getDriveStatus().isConnected || !hasPendingDriveChanges() || automaticSyncRunning) return;
  const revisionAtStart = driveChangeRevision;
  automaticSyncRunning = true;
  try {
    await runDriveSync();
    syncedDriveRevision = Math.max(syncedDriveRevision, revisionAtStart);
    lastAutomaticDriveSyncAt = Date.now();
  } catch (error) {
    console.warn('Automatic Drive backup failed.', error);
  } finally {
    automaticSyncRunning = false;
    if (hasPendingDriveChanges()) scheduleAutomaticDriveSync();
  }
}

function setupAutomaticDriveBackup() {
  window.addEventListener('keepvocab:data-changed', () => {
    driveChangeRevision += 1;
    scheduleAutomaticDriveSync();
  });
  window.addEventListener('online', () => {
    resumeRememberedDriveConnection();
    scheduleAutomaticDriveSync();
  });
  window.setInterval(scheduleAutomaticDriveSync, DRIVE_SYNC_MIN_INTERVAL_MS);
}

function waitForGoogleIdentity(timeoutMs = 6_000) {
  if (usesNativeGoogleAuthorization() || globalThis.google?.accounts?.oauth2) return Promise.resolve(true);
  return new Promise(resolve => {
    const startedAt = Date.now();
    const check = () => {
      if (globalThis.google?.accounts?.oauth2) resolve(true);
      else if (Date.now() - startedAt >= timeoutMs) resolve(false);
      else window.setTimeout(check, 150);
    };
    check();
  });
}

async function resumeRememberedDriveConnection() {
  if (driveResumeRunning) return;
  renderConnectionState();
  const auth = driveSync.getDriveStatus();
  if (!auth.remembered || auth.isConnected) return;
  driveResumeRunning = true;
  const syncingPill = document.getElementById('pill-syncing');
  if (syncingPill) syncingPill.style.display = 'inline-flex';
  try {
    if (!(await waitForGoogleIdentity())) return;
    await driveSync.resumeGoogleDrive();
    syncedDriveRevision = driveChangeRevision;
    lastAutomaticDriveSyncAt = Date.now();
  } catch (error) {
    console.warn('Drive background renewal is waiting for account confirmation or connectivity.', error);
  } finally {
    driveResumeRunning = false;
    renderConnectionState();
  }
}

function renderConnectionState() {
  const banner = document.getElementById('keep-banner-card');
  const auth = driveSync.getDriveStatus();
  const title = document.getElementById('banner-text-title');
  const subtitle = document.getElementById('banner-text-sub');
  const icon = document.getElementById('banner-icon-el');
  const connectedPill = document.getElementById('pill-connected');
  const syncingPill = document.getElementById('pill-syncing');
  const offlinePill = document.getElementById('pill-offline');
  const openButton = document.getElementById('btn-open-drive-auth');
  banner.hidden = !auth.lastError;

  if (auth.isConnected) {
    banner.className = 'keep-banner connected';
    icon.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
    title.textContent = 'Google Drive backup active';
    subtitle.textContent = `${auth.email || 'Google account'} · “${auth.folderName}” · Last sync ${auth.lastSynced ? new Date(auth.lastSynced).toLocaleString() : 'pending'}.`;
    connectedPill.style.display = 'inline-flex';
    offlinePill.style.display = 'none';
    openButton.innerHTML = '<i class="fa-solid fa-gear"></i> Manage Sync';
  } else if (auth.remembered && !auth.lastError) {
    banner.className = 'keep-banner disconnected';
    icon.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i>';
    title.textContent = 'Google Drive is ready to reconnect';
    subtitle.textContent = 'KeepVocab will not contact Drive until you choose to reconnect.';
    connectedPill.style.display = 'none';
    offlinePill.style.display = 'inline-flex';
    openButton.innerHTML = '<i class="fa-brands fa-google-drive"></i> Reconnect Drive';
  } else {
    banner.className = 'keep-banner disconnected';
    icon.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i>';
    title.textContent = 'Google Drive backup is off';
    subtitle.textContent = auth.lastError || 'Connect Drive to back up monthly vocabulary files and restore them after reinstalling.';
    connectedPill.style.display = 'none';
    offlinePill.style.display = 'inline-flex';
    openButton.innerHTML = '<i class="fa-brands fa-google-drive"></i> Connect Drive';
  }
  syncingPill.style.display = 'none';

  const lastSync = document.getElementById('stat-last-sync');
  const syncLabel = document.getElementById('sync-time-label');
  if (lastSync) lastSync.textContent = auth.lastSynced ? new Date(auth.lastSynced).toLocaleString() : 'Not backed up';
  if (syncLabel) syncLabel.textContent = auth.isConnected ? 'Drive active' : 'Drive off';
}

function setupFlashcardControls() {
  const audioBtn = document.getElementById('fc-audio-btn');
  const speedBtn = document.getElementById('btn-toggle-speech-speed');
  const wordEl = document.getElementById('fc-word');
  const posEl = document.getElementById('fc-pos');
  const defEl = document.getElementById('fc-def');
  const exampleEl = document.getElementById('fc-example');
  const indexEl = document.getElementById('fc-index');
  const totalEl = document.getElementById('fc-total');

  if (!wordEl) return;
  wordsQueue = buildStudyQueue();
  if (wordsQueue.length === 0) {
    wordEl.textContent = 'No words yet';
    if (posEl) posEl.textContent = 'Add vocabulary to begin';
    if (defEl) defEl.textContent = '';
    if (exampleEl) exampleEl.textContent = '';
    if (indexEl) indexEl.textContent = '0';
    if (totalEl) totalEl.textContent = '0';
    ['btn-rate-again', 'btn-rate-hard', 'btn-rate-good', 'btn-rate-easy', 'fc-audio-btn', 'btn-toggle-speech-speed'].forEach(id => {
      const button = document.getElementById(id);
      if (button) button.disabled = true;
    });
    return;
  }
  currentIndex %= wordsQueue.length;
  totalEl.textContent = wordsQueue.length;

  function updateCard() {
    const current = wordsQueue[currentIndex];
    wordEl.textContent = current.word;
    posEl.textContent = current.partOfSpeech;
    defEl.textContent = `"${current.definition}"`;
    exampleEl.textContent = `"${current.example}"`;
    indexEl.textContent = currentIndex + 1;
    const previews = getRatingPreviews(current);
    for (const rating of ['again', 'hard', 'good', 'easy']) {
      const label = document.querySelector(`#btn-rate-${rating} .rate-time`);
      if (label) label.textContent = previews[rating].label;
    }
    const card = document.getElementById('flashcard-spec-card');
    if (card) {
      card.classList.remove('flashcard-pop');
      requestAnimationFrame(() => card.classList.add('flashcard-pop'));
    }
  }

  if (audioBtn) {
    audioBtn.addEventListener('click', () => {
      const word = wordsQueue[currentIndex];
      speakWord(word.word, 'en-US', speechSpeed, word.audioUrl);
    });
  }

  if (speedBtn) {
    speedBtn.addEventListener('click', () => {
      speechSpeed = speechSpeed === 1.0 ? 0.75 : 1.0;
      speedBtn.textContent = `${speechSpeed}x`;
      showToast(`Speech rate set to ${speechSpeed}x`);
    });
  }

  const rateAction = (type) => {
    if (!wordsQueue.length) return;
    const current = wordsQueue[currentIndex];
    if (current.id) recordExerciseResult({
      wordId: current.id,
      exerciseType: 'flashcard-self-rating',
      correct: type !== 'Again',
      hintsUsed: 1,
      recallType: 'recognition',
      producedUnaided: false,
      learnerRating: type.toLowerCase()
    });
    rememberStudyStart();
    goalCount = Number(driveSync.getSettings().reviewsToday || 0);
    updateGoalDisplay();
    queueSmartReminderRefresh();

    showToast(`Rated “${current.word}” as ${type}. Review schedule updated.`);
    currentIndex = (currentIndex + 1) % wordsQueue.length;
    wordsQueue = buildStudyQueue();
    updateCard();
    updateDashboardDerivedState();
  };

  if (document.getElementById('btn-rate-again')) document.getElementById('btn-rate-again').addEventListener('click', () => rateAction('Again'));
  if (document.getElementById('btn-rate-hard')) document.getElementById('btn-rate-hard').addEventListener('click', () => rateAction('Hard'));
  if (document.getElementById('btn-rate-good')) document.getElementById('btn-rate-good').addEventListener('click', () => rateAction('Good'));
  if (document.getElementById('btn-rate-easy')) document.getElementById('btn-rate-easy').addEventListener('click', () => rateAction('Easy'));

  updateCard();
}

function setupMonthDropdown() {
  const btn = document.getElementById('month-dropdown-btn');
  const menu = document.getElementById('month-menu');
  const label = document.getElementById('active-month-label');

  if (!btn || !menu) return;
  const notebooks = driveSync.getNotebooks();
  const activeNotebook = driveSync.getActiveNotebook();
  label.textContent = activeNotebook.replace(/ Vocabulary$/, '');
  menu.innerHTML = notebooks.map(notebook => {
    const option = document.createElement('div');
    option.className = 'month-option';
    option.dataset.notebook = notebook.name;
    option.textContent = notebook.name;
    return option.outerHTML;
  }).join('');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('active');
  });

  document.addEventListener('click', () => menu.classList.remove('active'));

  menu.querySelectorAll('.month-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const notebook = opt.getAttribute('data-notebook');
      driveSync.setActiveNotebook(notebook);
      label.textContent = notebook.replace(/ Vocabulary$/, '');
      menu.classList.remove('active');
      wordsQueue = buildStudyQueue();
      currentIndex = 0;
      if (currentView === 'dashboard') navigateTo('dashboard');
      showToast(`Active vocabulary month changed to “${notebook}”.`);
    });
  });
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable) return;

    if (e.key === ' ') {
      if (!wordsQueue.length || currentView !== 'dashboard') return;
      e.preventDefault();
      const word = wordsQueue[currentIndex];
      speakWord(word.word, 'en-US', speechSpeed, word.audioUrl);
    } else if (e.key === '1') {
      const btn = document.getElementById('btn-rate-again');
      if (btn) btn.click();
    } else if (e.key === '2') {
      const btn = document.getElementById('btn-rate-hard');
      if (btn) btn.click();
    } else if (e.key === '3') {
      const btn = document.getElementById('btn-rate-good');
      if (btn) btn.click();
    } else if (e.key === '4') {
      const btn = document.getElementById('btn-rate-easy');
      if (btn) btn.click();
    } else if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('active'));
    }
  });
}
