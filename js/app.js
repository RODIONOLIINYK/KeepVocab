import { getActivePracticeWords, getScheduledPracticeWords } from './services/wordSelection.js?v=18100';
import { setupAddWordModal } from './components/AddWordModal.js?v=18100';
import { startAutomaticUpdateChecks } from './services/appUpdates.js?v=18100';
// Native application controller with monthly Google Drive backup.

import { driveSync, usesNativeGoogleAuthorization } from './services/driveSync.js?v=18100';
import { DRIVE_SYNC_MIN_INTERVAL_MS, backgroundSyncDelay } from './services/syncPolicy.js?v=18100';
import { hasExampleSenseConflict, sanitizeExistingExamples } from './services/exampleSearch.js?v=18100';
import { playInteractionSound, setInteractionSoundEnabledProvider, setupButtonSounds } from './services/interactionSound.js?v=18100';
import { appendStudyMoment, buildReminderSchedule, cancelDailyReminder, formatReminderTime, getReminderStatus, normalizeReminderTime, openReminderSettings, scheduleDailyReminder, sendTestReminder, setupReminderNavigation, supportsReminders } from './services/reminderService.js?v=18100';
import { buildScheduledPracticeSession } from './services/dailySession.js?v=18100';
import { localDateKey } from './utils/dates.js';
import { backfillLibraryTranslations } from './services/libraryTranslations.js?v=18100';

import { renderLibraryView } from './components/LibraryView.js?v=18100';
import { renderStatsView } from './components/StatsView.js?v=18100';
import { renderSpellingMode, renderChooseWordMode } from './components/PracticeModes.js?v=18100';
import { renderVisualMatchMode } from './components/VisualMatchMode.js?v=18100';
import { renderMatchSprintMode, teardownMatchSprintMode } from './components/MatchSprintMode.js?v=18100';
import { renderSpeakingMode, teardownSpeakingMode } from './components/SpeakingMode.js?v=18100';
import { renderDashboardView } from './components/DashboardView.js?v=18100';
import { renderDailySessionMode } from './components/DailySessionMode.js?v=18100';
import { renderFlashcardsMode } from './components/FlashcardsMode.js?v=18100';
import { renderContextQuizMode } from './components/ContextQuizMode.js?v=18100';
import { renderUseItMode, teardownUseItMode } from './components/UseItMode.js?v=18100';
import { renderSettingsView } from './components/SettingsView.js?v=18100';

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
let viewEnterTimer = null;
let navigationRevision = 0;
let reminderRefreshTimer = null;
let pendingReminderPermissionRequest = false;

document.addEventListener('DOMContentLoaded', initApp);

function initApp() {
  startAutomaticUpdateChecks();
  setInteractionSoundEnabledProvider(() => driveSync.getSettings().soundEnabled !== false);
  setupButtonSounds();
  setupNavigation();
  setupDriveBackupModal();
  setupAddWordModal({ showToast, onSaved: () => {
    navigateTo(currentView);
    queueSmartReminderRefresh({ requestPermission: true });
  } });
  setupEngagementSystem();
  setupReminderNavigation().catch(error => console.warn('Reminder navigation setup failed.', error));
  setupMonthDropdown();
  setupKeyboardShortcuts();
  setupAutomaticDriveBackup();
  resumeRememberedDriveConnection();

  window.addEventListener('keepvocab:progress', () => {
    rememberStudyStart();
    const settings = driveSync.getSettings();
    goalCount = settings.reviewsDate === localDateKey() ? Number(settings.reviewsToday || 0) : 0;
    updateGoalDisplay();
    updateEngagementCard();
    queueSmartReminderRefresh({ requestPermission: true });
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
  if (hdrGoal) hdrGoal.textContent = display;
}

function updateDashboardDerivedState() {
  const settings = driveSync.getSettings();
  goalCount = Number(settings.reviewsToday || 0);
  updateGoalDisplay();
  const streak = document.getElementById('hdr-streak-count');
  if (streak) streak.textContent = String(Number(settings.dailyStreak || 0));
  updateEngagementCard();
  renderConnectionState();
}

function currentSmartReminderPlan(settingsOverride = {}, now = new Date()) {
  const settings = { ...driveSync.getSettings(), ...settingsOverride };
  const reviewsToday = settings.reviewsDate === localDateKey(now) ? Number(settings.reviewsToday || 0) : 0;
  const practiceWords = getScheduledPracticeWords(driveSync);
  const dueCount = buildScheduledPracticeSession(practiceWords, settings, { now }).wordCount;
  return buildReminderSchedule({
    courseName: 'Vocabulary',
    practiceRoute: practiceWords.length ? 'review' : 'dashboard',
    preferredTime: settings.reminderTime || '19:00',
    smartTiming: settings.smartReminderEnabled !== false,
    streakReminderEnabled: settings.streakReminderEnabled !== false,
    reviewMoments: settings.reviewStartMoments || [],
    practiceWords,
    dueCount,
    reviewsToday,
    dailyGoal: settings.dailyGoal || 20,
    streak: settings.dailyStreak || 0,
    now
  });
}

function currentStreakMaintenancePlan(settingsOverride = {}, now = new Date()) {
  return currentSmartReminderPlan(settingsOverride, now).streakPlan;
}

function rememberStudyStart(now = new Date()) {
  const settings = driveSync.getSettings();
  if (settings.reviewsDate !== localDateKey(now) || !(Number(settings.reviewsToday) > 0)) return;
  const previous = Array.isArray(settings.reviewStartMoments) ? settings.reviewStartMoments : [];
  const next = appendStudyMoment(previous, now);
  if (next.join('|') !== previous.join('|')) driveSync.updateSettings({ reviewStartMoments: next }, { silent: true });
}

async function refreshSmartReminder({ requestPermission = false, settingsOverride = {} } = {}) {
  if (!supportsReminders()) return { status: 'android-only', plan: null };
  const settings = { ...driveSync.getSettings(), ...settingsOverride };
  if (!settings.reminderEnabled) {
    await cancelDailyReminder();
    return { status: 'disabled', plan: null };
  }
  const plan = currentSmartReminderPlan(settingsOverride);
  const streakPlan = plan.streakPlan;
  const practiceReadyPlan = plan.practiceReadyPlan;
  const result = await scheduleDailyReminder({ ...plan, streakPlan, practiceReadyPlan, requestPermission });
  return { ...result, plan, streakPlan, practiceReadyPlan };
}

function queueSmartReminderRefresh({ requestPermission = false } = {}) {
  if (!supportsReminders()) return;
  if (requestPermission) pendingReminderPermissionRequest = true;
  globalThis.clearTimeout(reminderRefreshTimer);
  reminderRefreshTimer = globalThis.setTimeout(() => {
    const shouldRequest = pendingReminderPermissionRequest;
    pendingReminderPermissionRequest = false;
    refreshSmartReminder({ requestPermission: shouldRequest }).catch(error => console.warn('Smart reminder refresh failed.', error));
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
  const dueCount = buildScheduledPracticeSession(getScheduledPracticeWords(driveSync), settings).wordCount;
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
    copy.textContent = `Practice ${dueCount} word${dueCount === 1 ? '' : 's'} from ${driveSync.getActiveNotebook().replace(/ Vocabulary$/, '')}.`;
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
  const practiceReady = reminderPlan.practiceReadyPlan;
  status.innerHTML = settings.reminderEnabled
    ? `<i class="fa-solid fa-bell"></i> ${settings.smartReminderEnabled !== false ? 'Smart reminder' : 'Daily reminder'} at ${formatReminderTime(reminderPlan.time)} · ${reminderPlan.summary}${practiceReady ? ` · practice ready at ${formatReminderTime(practiceReady.time)}` : ''}${currentStreakMaintenancePlan() ? ' · streak safeguard on' : ''}`
    : '<i class="fa-regular fa-bell"></i> Daily reminder is off';
}

function setupEngagementSystem() {
  const modal = document.getElementById('engagement-settings-modal');
  const reminderEnabled = document.getElementById('reminder-enabled');
  const smartReminderEnabled = document.getElementById('smart-reminder-enabled');
  const streakReminderEnabled = document.getElementById('streak-reminder-enabled');
  const reminderTime = document.getElementById('reminder-time');
  const soundEnabled = document.getElementById('sound-enabled');
  const routineGoal = document.getElementById('routine-daily-goal');
  const sessionSize = document.getElementById('routine-session-size');
  const deliveryStatus = document.getElementById('reminder-delivery-status');
  const helper = document.getElementById('reminder-helper');
  const save = document.getElementById('btn-save-engagement-settings');
  if (!modal || !reminderEnabled || !smartReminderEnabled || !streakReminderEnabled || !reminderTime || !soundEnabled || !routineGoal || !helper || !save) return;

  const remindersAvailable = supportsReminders();
  const deliveryMessage = result => {
    if (result.status === 'permission-required') return 'Notifications are blocked. Allow KeepVocab notifications in Android settings, then save your routine.';
    if (result.status === 'channel-blocked') return 'Practice reminders are blocked. Enable the Practice reminders category in Android settings.';
    if (result.status === 'unavailable') return 'The notification service is unavailable. Install the latest Android build.';
    if (result.status === 'test-sent') return 'Test sent. Check your notification shade for KeepVocab.';
    if (result.status === 'test-scheduled') return result.exactAlarm === 'granted'
      ? 'Test scheduled for one minute from now. Press Home or close the app, then check your notifications.'
      : 'Background test saved. Press Home or close the app. Android may delay it beyond one minute; allow precise timing for a timed test.';
    return `${result.pendingCount || 0} reminders scheduled. ${result.exactAlarm === 'granted' ? 'Precise timing is allowed.' : 'Android may delay delivery. Allow precise timing for reminders closer to your chosen time.'}`;
  };
  const updateDeliveryStatus = async () => {
    if (!remindersAvailable) return;
    try { deliveryStatus.textContent = deliveryMessage(await getReminderStatus()); }
    catch (error) { deliveryStatus.textContent = error.message || 'Cannot check notification delivery.'; }
  };
  document.getElementById('android-reminder-settings').hidden = !remindersAvailable;
  document.getElementById('android-reminder-note').hidden = !remindersAvailable;
  if (remindersAvailable) {
    document.getElementById('routine-description').textContent = 'Let Sprig learn your weekday and weekend rhythm. One exercise keeps your streak safe and silences today’s reminders.';
    document.getElementById('routine-mascot').src = 'assets/keepvocab-sprig-reminder.webp';
  }
  const updateHelper = () => {
    if (!remindersAvailable) { helper.textContent = 'Your goal and sound preferences are saved on this device.'; return; }
    if (!reminderEnabled.checked) {
      helper.textContent = 'Reminders are off. Your progress and app sounds still work normally.';
      return;
    }
    const plan = currentSmartReminderPlan({
      reminderTime: normalizeReminderTime(reminderTime.value),
      smartReminderEnabled: smartReminderEnabled.checked,
      streakReminderEnabled: streakReminderEnabled.checked
    });
    const streakPlan = plan.streakPlan;
    const practiceReadyPlan = plan.practiceReadyPlan;
    const learnedTime = smartReminderEnabled.checked && plan.time !== normalizeReminderTime(reminderTime.value);
    const timingCopy = !smartReminderEnabled.checked
      ? 'Fixed timing is active.'
      : learnedTime
        ? 'Timing learned separately for weekdays and weekends.'
        : 'Smart timing will learn after three study days; your preferred time is used for now.';
    helper.textContent = `Next plan: ${formatReminderTime(plan.time)} · ${plan.title}. ${timingCopy}${practiceReadyPlan ? ` Practice-ready alert at ${formatReminderTime(practiceReadyPlan.time)} (${practiceReadyPlan.summary}).` : ''}${streakPlan ? ` A streak safeguard is planned for ${formatReminderTime(streakPlan.time)} if you still have no activity. One exercise cancels today’s reminders.` : ''}`;
  };

  const updateTimeState = () => {
    reminderTime.disabled = !reminderEnabled.checked;
    smartReminderEnabled.disabled = !reminderEnabled.checked;
    streakReminderEnabled.disabled = !reminderEnabled.checked;
    updateHelper();
  };

  const openSettings = ({ enableReminders = false } = {}) => {
    const settings = driveSync.getSettings();
    reminderEnabled.checked = enableReminders || Boolean(settings.reminderEnabled);
    smartReminderEnabled.checked = settings.smartReminderEnabled !== false;
    streakReminderEnabled.checked = settings.streakReminderEnabled !== false;
    reminderTime.value = normalizeReminderTime(settings.reminderTime || '19:00');
    soundEnabled.checked = settings.soundEnabled !== false;
    routineGoal.value = Math.max(1, Math.min(200, Math.round(Number(settings.dailyGoal) || 20)));
    sessionSize.value = Math.max(5, Math.min(50, Math.round(Number(settings.practiceSessionSize) || 20)));
    updateTimeState();
    modal.classList.add('active');
    if (remindersAvailable && reminderEnabled.checked) {
      refreshSmartReminder({ requestPermission: true })
        .catch(() => {})
        .finally(() => updateDeliveryStatus());
    } else {
      updateDeliveryStatus();
    }
  };

  const closeSettings = () => modal.classList.remove('active');

  reminderEnabled.addEventListener('change', updateTimeState);
  smartReminderEnabled.addEventListener('change', updateHelper);
  streakReminderEnabled.addEventListener('change', updateHelper);
  reminderTime.addEventListener('input', updateHelper);
  document.getElementById('btn-test-reminder').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try { deliveryStatus.textContent = deliveryMessage(await sendTestReminder()); }
    catch (error) { deliveryStatus.textContent = error.message || 'Could not send a test notification.'; }
    finally { button.disabled = false; }
  });
  document.getElementById('btn-test-background-reminder').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try { deliveryStatus.textContent = deliveryMessage(await sendTestReminder({ delaySeconds: 60 })); }
    catch (error) { deliveryStatus.textContent = error.message || 'Could not schedule a background test.'; }
    finally { button.disabled = false; }
  });
  document.getElementById('btn-reminder-system-settings').addEventListener('click', async () => {
    try {
      await openReminderSettings();
      await refreshSmartReminder();
      await updateDeliveryStatus();
    } catch (error) { deliveryStatus.textContent = error.message; }
  });
  document.getElementById('btn-reminder-exact-settings').addEventListener('click', async () => {
    try {
      await openReminderSettings({ exactAlarms: true });
      await refreshSmartReminder();
      await updateDeliveryStatus();
    } catch (error) { deliveryStatus.textContent = error.message; }
  });
  document.addEventListener('click', event => {
    const control = event.target.closest('button, a');
    if (!control) return;
    if (control.id === 'btn-open-engagement-settings' || control.id === 'settings-routine') openSettings();
    if (control.id === 'settings-notifications') openSettings({ enableReminders: true });
    if (control.id === 'btn-coach-review') window.location.hash = 'review';
    if (control.id === 'btn-close-engagement-settings' || control.id === 'btn-cancel-engagement-settings') closeSettings();
  });

  save.addEventListener('click', async () => {
    if (!routineGoal.reportValidity() || !sessionSize.reportValidity()) return;
    const enabled = remindersAvailable && reminderEnabled.checked;
    const time = normalizeReminderTime(reminderTime.value);
    const smartTiming = smartReminderEnabled.checked;
    save.disabled = true;
    save.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
    helper.textContent = enabled ? 'Requesting notification access and scheduling your reminder…' : 'Saving your routine…';
    try {
      driveSync.updateSettings({
        ...(remindersAvailable ? {
          reminderEnabled: enabled,
          smartReminderEnabled: smartTiming,
          streakReminderEnabled: streakReminderEnabled.checked,
          reminderTime: time
        } : {}),
        soundEnabled: soundEnabled.checked,
        dailyGoal: Number(routineGoal.value),
        practiceSessionSize: Number(sessionSize.value)
      });
      const result = !remindersAvailable ? { status: 'sound-only' } : enabled
        ? await refreshSmartReminder({ requestPermission: true })
        : (await cancelDailyReminder(), { status: 'disabled' });
      updateEngagementCard();
      if (['permission-required', 'channel-blocked', 'unavailable'].includes(result.status)) {
        deliveryStatus.textContent = deliveryMessage(result);
        helper.textContent = 'Your routine is saved. Resolve notification access above to receive reminders.';
        return;
      }
      closeSettings();
      if (['dashboard', 'settings'].includes(currentView)) navigateTo(currentView);
      const message = result.status === 'scheduled'
        ? `${smartTiming ? 'Smart' : 'Daily'} reminder set for ${formatReminderTime(result.plan?.time || time)}.${result.exactAlarm !== 'granted' ? ' Android may delay delivery.' : ''}`
        : result.status === 'permission-required'
          ? 'Reminder saved. Enable notification permission in system settings to receive it.'
          : result.status === 'android-only'
            ? 'Routine saved. Reminders are available in the installed Android app.'
          : result.status === 'sound-only'
            ? 'Routine saved.'
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

  // Refresh at local-day boundaries and after the app resumes, so yesterday's
  // goal and streak never keep today's alarms alive after practice.
  let reminderDay = localDateKey();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      const today = localDateKey();
      if (today !== reminderDay) {
        reminderDay = today;
        updateDashboardDerivedState();
        if (['dashboard', 'stats', 'settings'].includes(currentView)) navigateTo(currentView);
      }
      updateEngagementCard();
      queueSmartReminderRefresh();
      if (modal.classList.contains('active')) updateDeliveryStatus();
    }
  });
  window.addEventListener('focus', queueSmartReminderRefresh);
  globalThis.setInterval(() => {
    const today = localDateKey();
    if (today === reminderDay) return;
    reminderDay = today;
    updateDashboardDerivedState();
    if (currentView === 'dashboard') navigateTo('dashboard');
    updateEngagementCard();
    queueSmartReminderRefresh();
  }, 60_000);
  const settings = driveSync.getSettings();
  if (remindersAvailable && settings.reminderEnabled) {
    refreshSmartReminder().catch(error => console.warn('Smart reminder restore failed.', error));
  }
}

function navigateTo(viewName) {
  const navigationId = ++navigationRevision;
  if (viewName === 'daily') {
    viewName = 'review';
    if (location.hash === '#daily') history.replaceState(null, '', '#review');
  }
  if (viewName === 'challenge') viewName = 'choose';
  if (!['dashboard', 'weak', 'review', 'library', 'stats', 'spelling', 'choose', 'visual', 'match', 'flashcards', 'context', 'useit', 'speaking', 'settings'].includes(viewName)) viewName = 'dashboard';
  if (currentView === 'match' && viewName !== 'match') teardownMatchSprintMode();
  if (currentView === 'speaking' && viewName !== 'speaking') teardownSpeakingMode();
  if (currentView === 'useit' && viewName !== 'useit') teardownUseItMode();
  currentView = viewName;
  if (location.hash !== `#${viewName}`) history.pushState(null, '', `#${viewName}`);
  document.body.classList.toggle('speaking-view', viewName === 'speaking');
  document.body.classList.toggle('dashboard-view', viewName === 'dashboard');
  document.body.classList.toggle('immersive-view', ['weak', 'review', 'spelling', 'choose', 'visual', 'match', 'flashcards', 'context', 'useit', 'library', 'stats', 'settings'].includes(viewName));
  const activeMonthLabel = document.getElementById('active-month-label');
  if (activeMonthLabel) activeMonthLabel.textContent = driveSync.getActiveNotebook().replace(/ Vocabulary$/, '');

  document.querySelectorAll('.nav-link-item').forEach(link => {
    const isActive = link.getAttribute('data-view') === viewName;
    link.classList.toggle('active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  const container = document.getElementById('view-container');
  if (!container) return;

  if (viewName === 'weak') {
    renderDailySessionMode(container, navigateTo, { kind: 'weak' });
  } else if (viewName === 'review') {
    renderDailySessionMode(container, navigateTo);

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
  if (driveSync.getSettings().translationLanguage === 'uk') {
    void backfillLibraryTranslations(getActivePracticeWords(driveSync)).then(count => {
      if (count && navigationId === navigationRevision && currentView === viewName && viewName === 'library'
        && !container.querySelector('#library-edit-form') && !container.contains(document.activeElement)) navigateTo('library');
    }).catch(error => console.warn('Translation hints could not be prepared.', error));
  }
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
      updateDashboardDerivedState();
      queueSmartReminderRefresh();
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
    updateDashboardDerivedState();
    queueSmartReminderRefresh();
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
    updateDashboardDerivedState();
    queueSmartReminderRefresh();
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
      if (['dashboard', 'library', 'stats'].includes(currentView)) navigateTo(currentView);
      showToast(`Active vocabulary month changed to “${notebook}”.`);
    });
  });
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable) return;

    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('active'));
    }
  });
}
