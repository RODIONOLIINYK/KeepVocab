import { setupAddWordModal } from './components/AddWordModal.js?v=1602';
import { startAutomaticUpdateChecks } from './services/appUpdates.js?v=1602';
// Native application controller with monthly Google Drive backup.

import { driveSync, getCurrentMonthNotebookTitle, usesNativeGoogleAuthorization } from './services/driveSync.js?v=1602';
import { speakWord } from './services/speechService.js?v=1602';
import { getDueWords, getRatingPreviews } from './services/srsEngine.js?v=1602';
import { recordExerciseResult } from './services/exerciseResult.js?v=1602';
import { DRIVE_SYNC_MIN_INTERVAL_MS, backgroundSyncDelay } from './services/syncPolicy.js?v=1602';
import { hasExampleSenseConflict, sanitizeExistingExamples } from './services/exampleSearch.js?v=1602';
import { playInteractionSound, setInteractionSoundEnabledProvider, setupButtonSounds } from './services/interactionSound.js?v=1602';
import { appendStudyMoment, buildSmartReminderPlan, buildStreakMaintenancePlan, cancelDailyReminder, formatReminderTime, normalizeReminderTime, scheduleDailyReminder, setupReminderNavigation } from './services/reminderService.js?v=1602';
import { localDateKey } from './utils/dates.js';

import { renderReviewView } from './components/ReviewView.js?v=1602';
import { renderLibraryView } from './components/LibraryView.js?v=1602';
import { renderStatsView } from './components/StatsView.js?v=1602';
import { renderSpellingMode, renderChooseWordMode } from './components/PracticeModes.js?v=1602';
import { renderVisualMatchMode } from './components/VisualMatchMode.js?v=1602';
import { renderMatchSprintMode } from './components/MatchSprintMode.js?v=1602';
import { renderSpeakingMode, teardownSpeakingMode } from './components/SpeakingMode.js?v=1602';
import { renderDashboardView } from './components/DashboardView.js?v=1602';
import { renderDailySessionMode } from './components/DailySessionMode.js?v=1602';
import { renderFlashcardsMode } from './components/FlashcardsMode.js?v=1602';
import { renderContextQuizMode } from './components/ContextQuizMode.js?v=1602';
import { renderUseItMode, teardownUseItMode } from './components/UseItMode.js?v=1602';
import { renderSettingsView } from './components/SettingsView.js?v=1602';
import { renderLearningPathView } from './components/LearningPathView.js?v=1602';
import { renderLessonMode, teardownLessonMode } from './components/LessonMode.js?v=1602';
import { getCourseDefinition } from './data/courses.js?v=1602';

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
if (typeof reminderDefaults.smartReminderEnabled !== 'boolean' || typeof reminderDefaults.streakReminderEnabled !== 'boolean' || !Array.isArray(reminderDefaults.reviewStartMoments)) {
  driveSync.updateSettings({
    smartReminderEnabled: typeof reminderDefaults.smartReminderEnabled === 'boolean' ? reminderDefaults.smartReminderEnabled : true,
    streakReminderEnabled: typeof reminderDefaults.streakReminderEnabled === 'boolean' ? reminderDefaults.streakReminderEnabled : true,
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
  startAutomaticUpdateChecks();
  setInteractionSoundEnabledProvider(() => driveSync.getSettings().soundEnabled !== false);
  setupButtonSounds();
  setupNavigation();
  setupCourseSwitcher();
  setupDriveBackupModal();
  setupAddWordModal({ showToast, onSaved: () => {
    wordsQueue = buildStudyQueue();
    currentIndex = 0;
    navigateTo(currentView);
  } });
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
  goalCount = Number(driveSync.getSettings().reviewsToday || 0);
  updateGoalDisplay();
  const settings = driveSync.getSettings();
  const allWords = driveSync.getWords();
  const boxCounts = [1, 2, 3, 4, 5].map(box => allWords.filter(word => Number(word.box || 1) === box).length);
  boxCounts.forEach((count, index) => {
    const element = document.getElementById(`b${index + 1}-count`);
    if (element) element.textContent = String(count);
  });
  const currentEntries = allWords.filter(word => word.notebook === driveSync.getActiveNotebook());
  const currentWords = new Set(currentEntries.map(word => String(word.word || '').trim().toLowerCase())).size;
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
  const dueCount = getDueWords().length;
  return buildSmartReminderPlan({
    courseName: driveSync.getActiveCourseId() === 'lithuanian' ? 'Lithuanian' : 'Vocabulary',
    hasLesson: driveSync.getActiveCourseId() === 'lithuanian',
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

function currentStreakMaintenancePlan(settingsOverride = {}, now = new Date()) {
  const settings = { ...driveSync.getSettings(), ...settingsOverride };
  const reviewsToday = settings.reviewsDate === localDateKey(now) ? Number(settings.reviewsToday || 0) : 0;
  const dueCount = getDueWords().length;
  const primaryPlan = currentSmartReminderPlan(settingsOverride, now);
  return buildStreakMaintenancePlan({
    enabled: settings.streakReminderEnabled !== false,
    primaryTime: primaryPlan.time,
    reviewsToday,
    streak: settings.dailyStreak || 0,
    dueCount,
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
  const streakPlan = currentStreakMaintenancePlan(settingsOverride);
  const result = await scheduleDailyReminder({ ...plan, streakPlan, requestPermission });
  return { ...result, plan, streakPlan };
}

function queueSmartReminderRefresh() {
  globalThis.clearTimeout(reminderRefreshTimer);
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
  const dueCount = getDueWords().length;
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
    ? `<i class="fa-solid fa-bell"></i> ${settings.smartReminderEnabled !== false ? 'Smart reminder' : 'Daily reminder'} at ${formatReminderTime(reminderPlan.time)} · ${reminderPlan.summary}${currentStreakMaintenancePlan() ? ' · streak safeguard on' : ''}`
    : '<i class="fa-regular fa-bell"></i> Daily reminder is off';
}

function setupEngagementSystem() {
  const modal = document.getElementById('engagement-settings-modal');
  const reminderEnabled = document.getElementById('reminder-enabled');
  const smartReminderEnabled = document.getElementById('smart-reminder-enabled');
  const streakReminderEnabled = document.getElementById('streak-reminder-enabled');
  const reminderTime = document.getElementById('reminder-time');
  const soundEnabled = document.getElementById('sound-enabled');
  const helper = document.getElementById('reminder-helper');
  const save = document.getElementById('btn-save-engagement-settings');
  if (!modal || !reminderEnabled || !smartReminderEnabled || !streakReminderEnabled || !reminderTime || !soundEnabled || !helper || !save) return;

  const updateHelper = () => {
    if (!reminderEnabled.checked) {
      helper.textContent = 'Reminders are off. Your progress and app sounds still work normally.';
      return;
    }
    const plan = currentSmartReminderPlan({
      reminderTime: normalizeReminderTime(reminderTime.value),
      smartReminderEnabled: smartReminderEnabled.checked,
      streakReminderEnabled: streakReminderEnabled.checked
    });
    const streakPlan = buildStreakMaintenancePlan({
      enabled: streakReminderEnabled.checked,
      primaryTime: plan.time,
      reviewsToday: driveSync.getSettings().reviewsDate === localDateKey() ? Number(driveSync.getSettings().reviewsToday || 0) : 0,
      streak: driveSync.getSettings().dailyStreak || 0,
      dueCount: getDueWords().length
    });
    const learnedTime = smartReminderEnabled.checked && plan.time !== normalizeReminderTime(reminderTime.value);
    const timingCopy = !smartReminderEnabled.checked
      ? 'Fixed timing is active.'
      : learnedTime
        ? 'Timing learned from your recent study days.'
        : 'Smart timing will learn after three study days; your preferred time is used for now.';
    helper.textContent = `Next plan: ${formatReminderTime(plan.time)} · ${plan.title}. ${timingCopy}${streakPlan ? ` A streak safeguard is planned for ${formatReminderTime(streakPlan.time)} if you still have no activity.` : ''}`;
  };

  const updateTimeState = () => {
    reminderTime.disabled = !reminderEnabled.checked;
    smartReminderEnabled.disabled = !reminderEnabled.checked;
    streakReminderEnabled.disabled = !reminderEnabled.checked;
    updateHelper();
  };

  const openSettings = () => {
    const settings = driveSync.getSettings();
    reminderEnabled.checked = Boolean(settings.reminderEnabled);
    smartReminderEnabled.checked = settings.smartReminderEnabled !== false;
    streakReminderEnabled.checked = settings.streakReminderEnabled !== false;
    reminderTime.value = normalizeReminderTime(settings.reminderTime || '19:00');
    soundEnabled.checked = settings.soundEnabled !== false;
    updateTimeState();
    modal.classList.add('active');
  };

  const closeSettings = () => modal.classList.remove('active');

  reminderEnabled.addEventListener('change', updateTimeState);
  smartReminderEnabled.addEventListener('change', updateHelper);
  streakReminderEnabled.addEventListener('change', updateHelper);
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
        streakReminderEnabled: streakReminderEnabled.checked,
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
          ? 'Reminder saved. Enable Android notification permission to receive it.'
          : result.status === 'android-only'
            ? 'Routine saved. Reminders are delivered only by the installed Android app.'
          : enabled
            ? 'Routine saved.'
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
  if (!['dashboard', 'learn', 'lesson', 'daily', 'weak', 'review', 'library', 'stats', 'spelling', 'choose', 'visual', 'match', 'flashcards', 'context', 'useit', 'speaking', 'settings'].includes(viewName)) viewName = 'dashboard';
  if (viewName === 'learn' && !getCourseDefinition(driveSync.getActiveCourseId()).hasLearningPath) {
    viewName = 'dashboard';
    if (window.location.hash === '#learn') window.history.replaceState(null, '', '#dashboard');
  }
  if (currentView === 'speaking' && viewName !== 'speaking') teardownSpeakingMode();
  if (currentView === 'useit' && viewName !== 'useit') teardownUseItMode();
  if (currentView === 'lesson' && viewName !== 'lesson') teardownLessonMode();
  currentView = viewName;
  if (location.hash !== `#${viewName}`) history.pushState(null, '', `#${viewName}`);
  document.body.classList.toggle('speaking-view', viewName === 'speaking');
  document.body.classList.toggle('learning-view', viewName === 'learn');
  document.body.classList.toggle('lesson-view', viewName === 'lesson');
  document.body.classList.toggle('dashboard-view', viewName === 'dashboard');
  document.body.classList.toggle('immersive-view', ['learn', 'lesson', 'daily', 'weak', 'review', 'spelling', 'choose', 'visual', 'match', 'flashcards', 'context', 'useit', 'library', 'stats', 'settings'].includes(viewName));
  const activeMonthLabel = document.getElementById('active-month-label');
  if (activeMonthLabel) activeMonthLabel.textContent = driveSync.getActiveNotebook().replace(/ Vocabulary$/, '');

  document.querySelectorAll('.nav-link-item').forEach(link => {
    const isActive = link.getAttribute('data-view') === (viewName === 'lesson' ? 'learn' : viewName);
    link.classList.toggle('active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  const container = document.getElementById('view-container');
  if (!container) return;

  if (viewName === 'daily') {
    renderDailySessionMode(container, navigateTo);
  } else if (viewName === 'weak') {
    renderDailySessionMode(container, navigateTo, { kind: 'weak' });
  } else if (viewName === 'review') {
    renderReviewView(container, navigateTo);
  } else if (viewName === 'learn') {
    renderLearningPathView(container, navigateTo);
  } else if (viewName === 'lesson') {
    renderLessonMode(container, navigateTo);
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

function setupCourseSwitcher() {
  const root = document.getElementById('course-switcher');
  const trigger = document.getElementById('course-switcher-trigger');
  const menu = document.getElementById('course-switcher-menu');
  const label = document.getElementById('course-switcher-label');
  const options = [...document.querySelectorAll('.course-switcher-option')];
  if (!root || !trigger || !menu || !label || !options.length) return;

  const sync = () => {
    const activeCourseId = driveSync.getActiveCourseId();
    const course = getCourseDefinition(activeCourseId);
    const learnLink = document.querySelector('.nav-link-item[data-view="learn"]');
    label.textContent = course.shortLabel || course.name;
    trigger.setAttribute('aria-label', `Switch language course. Current: ${course.shortLabel || course.name}`);
    trigger.title = `Switch course · ${course.shortLabel || course.name}`;
    document.body.classList.toggle('has-learning-path', Boolean(course.hasLearningPath));
    document.body.dataset.courseId = course.id;
    if (learnLink) learnLink.hidden = !course.hasLearningPath;
    options.forEach(option => {
      option.setAttribute('aria-selected', String(option.dataset.courseId === activeCourseId));
    });
  };

  const closeMenu = ({ restoreFocus = false } = {}) => {
    root.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    menu.hidden = true;
    if (restoreFocus) trigger.focus();
  };

  const openMenu = () => {
    root.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    const selected = options.find(option => option.getAttribute('aria-selected') === 'true') || options[0];
    requestAnimationFrame(() => selected.focus());
  };

  const selectCourse = courseId => {
    if (!courseId || courseId === driveSync.getActiveCourseId()) {
      closeMenu({ restoreFocus: true });
      return;
    }
    driveSync.setActiveCourseId(courseId);
    wordsQueue = buildStudyQueue();
    currentIndex = 0;
    goalCount = Number(driveSync.getSettings().reviewsToday || 0);
    const course = getCourseDefinition(courseId);
    sync();
    closeMenu({ restoreFocus: true });
    updateGoalDisplay();
    updateDashboardDerivedState();
    window.dispatchEvent(new CustomEvent('keepvocab:course-changed', { detail: { courseId: course.id } }));
    const courseAwareRoute = ['library', 'review', 'speaking', 'stats'].includes(currentView) ? currentView : null;
    const nextView = courseAwareRoute || (course.hasLearningPath ? 'learn' : 'dashboard');
    if (window.location.hash === `#${nextView}`) navigateTo(nextView);
    else window.location.hash = nextView;
    showToast(`${course.name} course selected.`);
  };

  sync();
  trigger.addEventListener('click', () => {
    if (menu.hidden) openMenu();
    else closeMenu();
  });
  options.forEach(option => option.addEventListener('click', () => selectCourse(option.dataset.courseId)));
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
      return;
    }
    if (menu.hidden && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      openMenu();
      return;
    }
    if (menu.hidden) return;
    const focusedIndex = Math.max(0, options.indexOf(document.activeElement));
    let nextIndex = focusedIndex;
    if (event.key === 'ArrowDown') nextIndex = (focusedIndex + 1) % options.length;
    else if (event.key === 'ArrowUp') nextIndex = (focusedIndex - 1 + options.length) % options.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = options.length - 1;
    else if (event.key === 'Tab') {
      closeMenu();
      return;
    } else return;
    event.preventDefault();
    options[nextIndex].focus();
  });
  document.addEventListener('pointerdown', event => {
    if (!root.contains(event.target)) closeMenu();
  });
  window.addEventListener('keepvocab:course-changed', () => {
    sync();
    closeMenu();
    wordsQueue = buildStudyQueue();
    goalCount = Number(driveSync.getSettings().reviewsToday || 0);
    updateGoalDisplay();
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


function setupDriveBackupModal() {
  const modal = document.getElementById('drive-auth-modal');
  const btnOpen = document.getElementById('btn-open-drive-auth');
  const btnClose = document.getElementById('btn-close-modal');
  const btnOAuth = document.getElementById('btn-modal-oauth');
  const btnSyncNow = document.getElementById('btn-sync-drive-now');
  const btnDisconnect = document.getElementById('btn-disconnect-drive');
  const status = document.getElementById('drive-auth-status');
  const nativeAuthorization = usesNativeGoogleAuthorization();

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
      const result = await driveSync.connectGoogleDrive();
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
    updateDashboardDerivedState();
    queueSmartReminderRefresh();
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
  const connectButton = document.getElementById('btn-modal-oauth');
  const connectedActions = document.getElementById('drive-connected-actions');
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
  if (connectButton) connectButton.hidden = auth.isConnected;
  if (connectedActions) connectedActions.hidden = !auth.isConnected;

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

// Recompute date-sensitive UI and alarms after midnight or returning to the app.
let lastStudyDate = localDateKey();
setInterval(() => {
  if (localDateKey() === lastStudyDate) return;
  lastStudyDate = localDateKey();
  updateDashboardDerivedState();
  queueSmartReminderRefresh();
}, 30_000);
