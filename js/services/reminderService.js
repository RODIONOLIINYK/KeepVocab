import { localDateKey } from '../utils/dates.js';
import { isWordReadyForPractice, normalizeWordPracticeStats } from './wordSelection.js?v=18900';

export const DAILY_REMINDER_ID = 73001;
export const STREAK_REMINDER_ID = 73002;
export const TEST_REMINDER_ID = 73003;
export const REMINDER_CHANNEL_ID = 'keepvocab-practice';
export const REMINDER_HORIZON_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_SMART_HOUR = 8;
const MAX_SMART_MINUTES = 21 * 60 + 30;
const MIN_STREAK_MINUTES = 20 * 60 + 30;
const MAX_STREAK_MINUTES = 22 * 60;
const FINAL_STREAK_RESCUE_MINUTES = 23 * 60 + 15;
const STREAK_MILESTONES = new Set([3, 7, 14, 21, 30, 50, 75, 100, 365]);

function formatMinutesAsTime(totalMinutes) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

export function normalizeReminderTime(value, fallback = '19:00') {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function getNextReminderAt(time, now = new Date()) {
  const [hour, minute] = normalizeReminderTime(time).split(':').map(Number);
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

function getTomorrowReminderAt(time, now = new Date()) {
  const [hour, minute] = normalizeReminderTime(time).split(':').map(Number);
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(hour, minute, 0, 0);
  return next;
}

export function formatReminderTime(time, locale) {
  const [hour, minute] = normalizeReminderTime(time).split(':').map(Number);
  const value = new Date(2000, 0, 1, hour, minute);
  return value.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

export function appendStudyMoment(reviewMoments = [], now = new Date()) {
  const valid = (Array.isArray(reviewMoments) ? reviewMoments : [])
    .map(value => new Date(value))
    .filter(value => !Number.isNaN(value.getTime()));
  const today = localDateKey(now);
  if (!valid.some(value => localDateKey(value) === today)) valid.push(new Date(now));
  return valid.sort((a, b) => b - a).slice(0, 45).map(value => value.toISOString());
}

export function getHabitReminderTime(reviewMoments = [], preferredTime = '19:00', now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 60);
  const uniqueDays = new Map();
  for (const value of Array.isArray(reviewMoments) ? reviewMoments : []) {
    const moment = new Date(value);
    if (Number.isNaN(moment.getTime()) || moment < cutoff || moment > now) continue;
    const key = localDateKey(moment);
    if (!uniqueDays.has(key)) uniqueDays.set(key, moment.getHours() * 60 + moment.getMinutes());
  }
  // Weekends often have a different rhythm. Use that pattern once it has
  // enough evidence, otherwise keep the robust median across all study days.
  const weekend = now.getDay() === 0 || now.getDay() === 6;
  const matchingDays = [...uniqueDays.entries()].filter(([day]) => {
    const weekday = new Date(`${day}T12:00:00`).getDay();
    return (weekday === 0 || weekday === 6) === weekend;
  }).map(([, minutes]) => minutes);
  const minutes = (matchingDays.length >= 3 ? matchingDays : [...uniqueDays.values()]).sort((a, b) => a - b);
  if (minutes.length < 3) return normalizeReminderTime(preferredTime);
  const middle = Math.floor(minutes.length / 2);
  const median = minutes.length % 2 ? minutes[middle] : Math.round((minutes[middle - 1] + minutes[middle]) / 2);
  const rounded = Math.round(median / 15) * 15;
  const safeMinutes = Math.min(MAX_SMART_MINUTES, Math.max(MIN_SMART_HOUR * 60, rounded));
  return formatMinutesAsTime(safeMinutes);
}

function wordPracticeReadyTimestamp(word, now) {
  if (isWordReadyForPractice(word, now)) return now.getTime();
  const stats = normalizeWordPracticeStats(word);
  // Eligibility can change at a scheduled review or when an answer's rest
  // window ends. Ask the shared scheduler at each boundary so reminders also
  // respect reliable recall, mature schedules, and migrated statistics.
  const candidates = [
    Date.parse(word?.nextReviewDate || word?.createdAt || ''),
    Date.parse(stats.lastAnsweredAt) + DAY_MS,
    Date.parse(stats.lastUnaidedRecallAt) + DAY_MS
  ].filter(timestamp => Number.isFinite(timestamp) && timestamp > now.getTime())
    .sort((left, right) => left - right);
  return candidates.find(timestamp => isWordReadyForPractice(word, new Date(timestamp))) ?? Infinity;
}

export function getPracticeReadiness(words = [], now = new Date()) {
  const nowMs = now.getTime();
  const bySpelling = new Map();
  for (const word of Array.isArray(words) ? words : []) {
    if (!word?.id || !word.word || !word.definition) continue;
    const spelling = String(word.word).trim().toLowerCase();
    if (!spelling) continue;
    const readyAt = wordPracticeReadyTimestamp(word, now);
    const isWeak = normalizeWordPracticeStats(word).lastAnswerCorrect === false || Number(word.mistakes?.consecutiveFailures || 0) > 0;
    const previous = bySpelling.get(spelling);
    if (!previous || readyAt < previous.readyAt) {
      bySpelling.set(spelling, { readyAt, isWeak: Boolean(previous?.isWeak || isWeak) });
    } else if (isWeak) {
      previous.isWeak = true;
    }
  }
  let readyNowCount = 0;
  let weakReadyCount = 0;
  const upcoming = [];
  for (const item of bySpelling.values()) {
    if (item.readyAt <= nowMs) {
      readyNowCount += 1;
      if (item.isWeak) weakReadyCount += 1;
    } else if (Number.isFinite(item.readyAt)) {
      upcoming.push(item);
    }
  }
  upcoming.sort((a, b) => a.readyAt - b.readyAt);
  const nextReadyAt = upcoming.length ? new Date(upcoming[0].readyAt) : null;
  const batchWindowMs = nextReadyAt ? nextReadyAt.getTime() + 60 * 60 * 1000 : 0;
  const upcomingBatch = nextReadyAt ? upcoming.filter(item => item.readyAt <= batchWindowMs) : [];
  return {
    readyNowCount,
    weakReadyCount,
    nextReadyAt,
    nextReadyCount: upcomingBatch.length ? readyNowCount + upcomingBatch.length : readyNowCount,
    nextWeakCount: weakReadyCount + upcomingBatch.filter(item => item.isWeak).length,
    totalWords: bySpelling.size
  };
}

function clampToWakingReminderWindow(targetDate, now = new Date()) {
  const minFuture = new Date(now.getTime() + 15 * 60 * 1000);
  const next = new Date(Math.max(targetDate.getTime(), minFuture.getTime()));
  const roundedMinutes = Math.ceil((next.getHours() * 60 + next.getMinutes()) / 5) * 5;
  next.setHours(0, 0, 0, 0);
  next.setMinutes(roundedMinutes);
  const totalMinutes = next.getHours() * 60 + next.getMinutes();
  if (totalMinutes < MIN_SMART_HOUR * 60) {
    next.setHours(MIN_SMART_HOUR, 0, 0, 0);
  } else if (totalMinutes > MAX_SMART_MINUTES) {
    next.setDate(next.getDate() + 1);
    next.setHours(MIN_SMART_HOUR, 30, 0, 0);
  }
  return {
    nextAt: next,
    time: formatMinutesAsTime(next.getHours() * 60 + next.getMinutes())
  };
}

export function buildPracticeReadyPlan({
  enabled = true,
  practiceWords = [],
  nextPracticeReadyAt = null,
  dueCount = 0,
  reviewsToday = 0,
  dailyGoal = 20,
  courseName = 'Vocabulary',
  practiceRoute = 'review',
  primaryNextAt = null,
  streakNextAt = null,
  preferredTime = '19:00',
  smartTiming = true,
  reviewMoments = [],
  now = new Date()
} = {}) {
  const hasWordPool = Array.isArray(practiceWords) && practiceWords.length > 0;
  if (!enabled || (!hasWordPool && !nextPracticeReadyAt)) return null;
  const readiness = getPracticeReadiness(practiceWords, now);
  const completed = Math.max(0, Number(reviewsToday || 0));
  const normalizedGoal = Math.max(1, Number(dailyGoal || 20));
  const remaining = Math.max(0, normalizedGoal - completed);
  const readyNow = Math.max(0, Number(dueCount || 0), readiness.readyNowCount);
  const explicitUpcoming = nextPracticeReadyAt ? new Date(nextPracticeReadyAt) : readiness.nextReadyAt;
  const hasUpcoming = Boolean(explicitUpcoming && !Number.isNaN(explicitUpcoming.getTime()) && explicitUpcoming.getTime() > now.getTime());
  const primaryIsToday = Boolean(primaryNextAt && localDateKey(primaryNextAt) === localDateKey(now) && primaryNextAt.getTime() > now.getTime());

  let targetDate = null;
  let isUpcomingUnlock = false;

  if (readyNow > 0 && remaining > 0 && !primaryIsToday) {
    const habitTime = smartTiming
      ? getHabitReminderTime(reviewMoments, preferredTime, now)
      : normalizeReminderTime(preferredTime);
    const [hour, minute] = habitTime.split(':').map(Number);
    const habitToday = new Date(now);
    habitToday.setHours(hour, minute, 0, 0);
    targetDate = habitToday.getTime() >= now.getTime() + 15 * 60 * 1000
      ? habitToday
      : new Date(now.getTime() + 90 * 60 * 1000);
    const clampedToday = clampToWakingReminderWindow(targetDate, now);
    if (localDateKey(clampedToday.nextAt) !== localDateKey(now)) {
      targetDate = hasUpcoming ? explicitUpcoming : null;
      isUpcomingUnlock = hasUpcoming;
    }
  } else if (hasUpcoming) {
    targetDate = new Date(explicitUpcoming);
    isUpcomingUnlock = true;
    if (remaining === 0 && localDateKey(targetDate) === localDateKey(now)) {
      targetDate.setDate(targetDate.getDate() + 1);
      targetDate.setHours(MIN_SMART_HOUR, 30, 0, 0);
    }
  }

  if (!targetDate || targetDate.getTime() - now.getTime() > REMINDER_HORIZON_DAYS * DAY_MS) return null;
  let scheduled = clampToWakingReminderWindow(targetDate, now);

  if (primaryNextAt && Math.abs(scheduled.nextAt.getTime() - primaryNextAt.getTime()) < 45 * 60 * 1000) {
    const shifted = new Date(primaryNextAt.getTime() + 60 * 60 * 1000);
    const shiftedMinutes = shifted.getHours() * 60 + shifted.getMinutes();
    if (localDateKey(shifted) === localDateKey(primaryNextAt) && shiftedMinutes <= MAX_SMART_MINUTES) {
      scheduled = clampToWakingReminderWindow(shifted, now);
    } else {
      return null;
    }
  }

  if (streakNextAt && Math.abs(scheduled.nextAt.getTime() - streakNextAt.getTime()) < 45 * 60 * 1000) {
    const earlier = new Date(streakNextAt.getTime() - 60 * 60 * 1000);
    if (earlier.getTime() >= now.getTime() + 15 * 60 * 1000 && earlier.getHours() >= MIN_SMART_HOUR) {
      scheduled = clampToWakingReminderWindow(earlier, now);
    } else {
      return null;
    }
  }

  const readyCount = Math.max(1, isUpcomingUnlock ? (readiness.nextReadyCount || readyNow || 1) : readyNow);
  const weakCount = isUpcomingUnlock ? readiness.nextWeakCount : readiness.weakReadyCount;
  const title = weakCount > 0
    ? `${courseName}: ${readyCount} review exercise${readyCount === 1 ? '' : 's'} ready in Practice Mode`
    : `${courseName}: ${readyCount} exercise${readyCount === 1 ? ' is' : 's are'} ready in Practice Mode`;
  const body = completed > 0 && remaining > 0 && localDateKey(scheduled.nextAt) === localDateKey(now)
    ? `Your practice set is ready. ${remaining} more exercise${remaining === 1 ? '' : 's'} completes today’s goal.`
    : weakCount > 0
      ? 'Words you missed earlier are ready for a quick recovery round in Practice Mode.'
      : 'Your spaced-repetition review is ready. Jump into Practice Mode while these words are fresh.';

  return {
    time: scheduled.time,
    title,
    body,
    route: practiceRoute || 'review',
    reason: 'practice-ready',
    summary: `${readyCount} ready in practice`,
    repeat: false,
    nextAt: scheduled.nextAt,
    readyCount
  };
}

export function buildSmartReminderPlan({
  preferredTime = '19:00',
  smartTiming = true,
  reviewMoments = [],
  dueCount = 0,
  courseName = 'Vocabulary',
  practiceRoute = 'review',
  reviewsToday = 0,
  dailyGoal = 20,
  streak = 0,
  now = new Date()
} = {}) {
  const normalizedGoal = Math.max(1, Number(dailyGoal || 20));
  const completed = Math.max(0, Number(reviewsToday || 0));
  const due = Math.max(0, Number(dueCount || 0));
  const remaining = Math.max(0, normalizedGoal - completed);
  const time = smartTiming
    ? getHabitReminderTime(reviewMoments, preferredTime, now)
    : normalizeReminderTime(preferredTime);

  if (completed > 0) {
    return {
      time,
      title: `${courseName}: a fresh practice is ready`,
      body: 'Make a little time for learning today. A short practice keeps your habit growing.',
      route: practiceRoute,
      reason: remaining === 0 ? 'goal-complete' : 'studied-today',
      summary: remaining === 0 ? 'goal complete' : 'streak safe today',
      repeat: false,
      nextAt: getTomorrowReminderAt(time, now)
    };
  }

  if (due > 0) {
    return {
      time,
      title: `${courseName}: time for a little practice`,
      body: 'Revisit what you have learned and make it stick. Open your practice to see what is ready today.',
      route: practiceRoute,
      reason: 'due-review',
      summary: `${due} due`,
      repeat: false,
      nextAt: getNextReminderAt(time, now)
    };
  }

  return {
    time,
    title: `${courseName}: keep your learning growing`,
    body: 'A little practice goes a long way. Open KeepVocab and take the next step today.',
    route: practiceRoute,
    reason: 'keep-learning',
    summary: `${remaining} goal step${remaining === 1 ? '' : 's'} left`,
    repeat: false,
    nextAt: getNextReminderAt(time, now)
  };
}

export function getStreakReminderTime(primaryTime = '19:00') {
  const [hour, minute] = normalizeReminderTime(primaryTime).split(':').map(Number);
  const primaryMinutes = hour * 60 + minute;
  if (primaryMinutes >= MAX_STREAK_MINUTES) return '';
  const lateMinutes = Math.min(MAX_STREAK_MINUTES, Math.max(MIN_STREAK_MINUTES, primaryMinutes + 90));
  return formatMinutesAsTime(lateMinutes);
}

export function buildStreakMaintenancePlan({
  enabled = true,
  primaryTime = '19:00',
  reviewsToday = 0,
  streak = 0,
  dueCount = 0,
  now = new Date()
} = {}) {
  const activeStreak = Math.max(0, Number(streak || 0));
  const completed = Math.max(0, Number(reviewsToday || 0));
  const due = Math.max(0, Number(dueCount || 0));
  if (!enabled || !activeStreak) return null;

  const baseTime = getStreakReminderTime(primaryTime);
  let time = baseTime;
  let nextAt = null;
  let finalCall = false;

  if (completed > 0) {
    if (!baseTime) return null;
    const [hour, minute] = baseTime.split(':').map(Number);
    nextAt = new Date(now);
    nextAt.setDate(nextAt.getDate() + 1);
    nextAt.setHours(hour, minute, 0, 0);
  } else {
    if (baseTime) {
      const [hour, minute] = baseTime.split(':').map(Number);
      const candidate = new Date(now);
      candidate.setHours(hour, minute, 0, 0);
      if (candidate.getTime() > now.getTime()) {
        nextAt = candidate;
      }
    }
    if (!nextAt) {
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      if (nowMinutes + 15 > FINAL_STREAK_RESCUE_MINUTES) return null;
      const rescueMinutes = Math.min(
        FINAL_STREAK_RESCUE_MINUTES,
        Math.max(MAX_STREAK_MINUTES, Math.ceil((nowMinutes + 15) / 15) * 15)
      );
      time = formatMinutesAsTime(rescueMinutes);
      const [hour, minute] = time.split(':').map(Number);
      nextAt = new Date(now);
      nextAt.setHours(hour, minute, 0, 0);
      if (nextAt.getTime() <= now.getTime()) return null;
      finalCall = true;
    }
  }

  const nextMilestone = activeStreak % 7 === 6
    ? 'Your next weekly milestone is within reach.'
    : STREAK_MILESTONES.has(activeStreak + 1)
      ? `One quick session unlocks your ${activeStreak + 1}-day milestone.`
      : due > 0
        ? `${due} practice exercise${due === 1 ? ' is' : 's are'} ready right now.`
        : 'A small step counts—even on a busy day.';

  return {
    time,
    title: finalCall
      ? `Final call: protect your ${activeStreak}-day streak`
      : `Protect your ${activeStreak}-day streak`,
    body: finalCall
      ? `Midnight is close! One quick exercise keeps your ${activeStreak}-day streak alive. ${nextMilestone}`
      : `One exercise before midnight keeps your streak alive. ${nextMilestone}`,
    route: 'review',
    reason: 'streak-maintenance',
    summary: finalCall ? `${activeStreak}-day final call` : `${activeStreak}-day streak safeguard`,
    repeat: false,
    finalCall,
    nextAt
  };
}

const FOLLOW_UP_COPY = [
  {
    title: 'Your next small win is waiting',
    body: 'Meet familiar words in a new way. A short workout helps them stick.'
  },
  {
    title: 'Your memory garden is ready to grow',
    body: 'Reviewing words right as they fade locks them into long-term memory.'
  },
  {
    title: 'A fresh start is one word away',
    body: 'Even a two-minute practice session wakes up your vocabulary recall.'
  },
  {
    title: 'Keep your favorite words close',
    body: 'Pick up right where you left off with a light, focused practice.'
  },
  {
    title: 'A quick vocabulary check-in',
    body: 'No pressure—try a few quick flashcards or a listening prompt today.'
  },
  {
    title: 'A fresh start is one word away',
    body: 'No catching up required. Come back for a little practice whenever you are ready.'
  }
];

// Only the next unprotected day can truthfully threaten the current streak.
// Later reminders stay encouraging and make no claims about stale streak counts.
export function buildReminderSchedule(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const readiness = getPracticeReadiness(options.practiceWords, now);
  const effectiveDueCount = Math.max(Number(options.dueCount || 0), readiness.readyNowCount);
  const plan = buildSmartReminderPlan({ ...options, dueCount: effectiveDueCount, now });
  const todayPrimaryTime = plan.time;
  if (localDateKey(plan.nextAt) !== localDateKey(now) && options.smartTiming !== false) {
    plan.time = getHabitReminderTime(options.reviewMoments, options.preferredTime, plan.nextAt);
    const [hour, minute] = plan.time.split(':').map(Number);
    plan.nextAt.setHours(hour, minute, 0, 0);
  }
  const followUps = [];
  for (let day = 1; day < REMINDER_HORIZON_DAYS; day += 1) {
    const date = new Date(plan.nextAt);
    date.setDate(date.getDate() + day);
    const time = options.smartTiming === false
      ? normalizeReminderTime(options.preferredTime || '19:00')
      : getHabitReminderTime(options.reviewMoments, options.preferredTime, date);
    const [hour, minute] = time.split(':').map(Number);
    date.setHours(hour, minute, 0, 0);
    const copy = FOLLOW_UP_COPY[Math.min(day - 1, FOLLOW_UP_COPY.length - 1)];
    followUps.push({
      time,
      nextAt: date,
      repeat: false,
      title: copy.title,
      body: copy.body,
      route: options.practiceRoute || 'review',
      reason: 'habit-follow-up'
    });
  }
  const streakPrimaryTime = Number(options.reviewsToday || 0) > 0 ? plan.time : todayPrimaryTime;
  const streakPlan = buildStreakMaintenancePlan({
    enabled: options.streakReminderEnabled !== false,
    primaryTime: streakPrimaryTime,
    reviewsToday: options.reviewsToday,
    streak: options.streak,
    dueCount: effectiveDueCount,
    now
  });
  if (streakPlan) streakPlan.route = options.practiceRoute || 'review';
  const practiceReadyPlan = buildPracticeReadyPlan({
    enabled: options.practiceReadyReminderEnabled !== false,
    practiceWords: options.practiceWords,
    nextPracticeReadyAt: options.nextPracticeReadyAt,
    dueCount: effectiveDueCount,
    reviewsToday: options.reviewsToday,
    dailyGoal: options.dailyGoal,
    courseName: options.courseName || 'Vocabulary',
    practiceRoute: options.practiceRoute || 'review',
    primaryNextAt: plan.nextAt,
    streakNextAt: streakPlan?.nextAt || null,
    preferredTime: options.preferredTime,
    smartTiming: options.smartTiming !== false,
    reviewMoments: options.reviewMoments,
    now
  });
  return { ...plan, followUps, streakPlan, practiceReadyPlan };
}

export function reminderNotifications(plan, streakPlan = plan?.streakPlan ?? null, practiceReadyPlan = plan?.practiceReadyPlan ?? null) {
  const candidates = [
    ...(practiceReadyPlan ? [practiceReadyPlan] : []),
    plan,
    ...(plan.followUps || [])
  ].sort((a, b) => {
    const aTime = (a.nextAt || getNextReminderAt(a.time)).getTime();
    const bTime = (b.nextAt || getNextReminderAt(b.time)).getTime();
    return aTime - bTime;
  });
  const primary = candidates.slice(0, REMINDER_HORIZON_DAYS).map((item, index) => {
    const [hour, minute] = normalizeReminderTime(item.time).split(':').map(Number);
    return {
      id: DAILY_REMINDER_ID + index * 10,
      channelId: REMINDER_CHANNEL_ID,
      title: item.title, body: item.body,
      schedule: item.repeat ? { on: { hour, minute }, allowWhileIdle: true }
        : { at: item.nextAt || getNextReminderAt(item.time), allowWhileIdle: true },
      autoCancel: true,
      extra: { route: item.route, reason: item.reason }
    };
  });
  if (streakPlan) primary.push({
    id: STREAK_REMINDER_ID, title: streakPlan.title, body: streakPlan.body,
    channelId: REMINDER_CHANNEL_ID,
    schedule: { at: streakPlan.nextAt || getNextReminderAt(streakPlan.time), allowWhileIdle: true },
    autoCancel: true, extra: { route: streakPlan.route, reason: streakPlan.reason }
  });
  return primary;
}

function reminderIds() {
  return [DAILY_REMINDER_ID, STREAK_REMINDER_ID,
    ...Array.from({ length: REMINDER_HORIZON_DAYS - 1 }, (_, index) => DAILY_REMINDER_ID + (index + 1) * 10)]
    .map(id => ({ id }));
}

export function supportsReminders(target = globalThis) {
  return target.Capacitor?.getPlatform?.() === 'android';
}

function getNativeNotifications(target = globalThis) {
  const capacitor = target.Capacitor;
  const platform = capacitor?.getPlatform?.();
  if (platform !== 'android') return null;
  if (capacitor.Plugins?.LocalNotifications) return capacitor.Plugins.LocalNotifications;
  if (typeof capacitor.registerPlugin === 'function') return capacitor.registerPlugin('LocalNotifications');
  return null;
}

let notificationQueue = Promise.resolve();
function serializeNotifications(action) {
  const result = notificationQueue.then(action);
  notificationQueue = result.catch(() => {});
  return result;
}

async function scheduleNative(plugin, plan, streakPlan, practiceReadyPlan, requestPermission) {
  const readiness = await prepareNativeReminders(plugin, requestPermission);
  if (readiness.status !== 'ready') return readiness;
  const notifications = reminderNotifications(plan, streakPlan, practiceReadyPlan).map(item => ({
    ...item, isExactNotification: readiness.exactAlarm === 'granted'
  }));
  await plugin.cancel({ notifications: reminderIds() });
  await plugin.removeDeliveredNotifications?.({ notifications: reminderIds() });
  const scheduled = await plugin.schedule({ notifications });
  if (plugin.getPending) {
    const pending = await plugin.getPending();
    const ids = new Set(pending.notifications.map(item => item.id));
    if (notifications.some(item => !ids.has(item.id))) throw new Error('Android did not save every reminder. Try saving your routine again.');
  }
  return {
    status: 'scheduled',
    platform: 'native',
    exactAlarm: scheduled?.warning ? 'denied' : readiness.exactAlarm,
    nextAt: plan.nextAt || getNextReminderAt(plan.time),
    streakNextAt: streakPlan?.nextAt || null,
    practiceReadyNextAt: practiceReadyPlan?.nextAt || null
  };
}

async function prepareNativeReminders(plugin, requestPermission = false) {
  let permission = await plugin.checkPermissions();
  if (permission.display !== 'granted' && requestPermission) permission = await plugin.requestPermissions();
  if (permission.display !== 'granted') return { status: 'permission-required', platform: 'native' };
  if (plugin.areEnabled && !(await plugin.areEnabled()).value) return { status: 'permission-required', platform: 'native' };
  let channels = [];
  try {
    await plugin.createChannel?.({ id: REMINDER_CHANNEL_ID, name: 'Practice reminders',
      description: 'Daily vocabulary practice and streak protection', importance: 4, visibility: 1, vibration: true });
    channels = plugin.listChannels ? (await plugin.listChannels()).channels : [];
  } catch (error) {
    // Android 7/7.1 is supported by the app, but has no notification channels.
    // Capacitor rejects channel methods as UNAVAILABLE on those versions.
    if (error.code !== 'UNAVAILABLE') throw error;
  }
  if (channels.some(channel => channel.id === REMINDER_CHANNEL_ID && channel.importance === 0)) {
    return { status: 'channel-blocked', platform: 'native' };
  }
  const exact = plugin.checkExactNotificationSetting ? await plugin.checkExactNotificationSetting() : {};
  return { status: 'ready', platform: 'native', exactAlarm: exact.exact_alarm || 'denied' };
}

export async function getReminderStatus() {
  const plugin = getNativeNotifications();
  if (!plugin) return { status: supportsReminders() ? 'unavailable' : 'android-only' };
  return serializeNotifications(async () => {
    const ready = await prepareNativeReminders(plugin);
    if (ready.status !== 'ready') return ready;
    const pending = plugin.getPending ? (await plugin.getPending()).notifications : [];
    const ids = new Set(reminderIds().map(item => item.id));
    return { ...ready, pendingCount: pending.filter(item => ids.has(item.id)).length };
  });
}

export async function sendTestReminder({ delaySeconds = 0 } = {}) {
  const plugin = getNativeNotifications();
  if (!plugin) return { status: supportsReminders() ? 'unavailable' : 'android-only' };
  return serializeNotifications(async () => {
    const ready = await prepareNativeReminders(plugin, true);
    if (ready.status !== 'ready') return ready;
    const delayed = delaySeconds > 0;
    const scheduled = await plugin.schedule({ notifications: [{ id: TEST_REMINDER_ID, channelId: REMINDER_CHANNEL_ID,
      title: delayed ? 'KeepVocab background reminder' : 'KeepVocab notification test',
      body: delayed ? 'Your reminder arrived with KeepVocab in the background. Tap to open Practice.'
        : 'Notification access is enabled. Tap to open Practice.',
      ...(delayed ? { schedule: { at: new Date(Date.now() + delaySeconds * 1000), allowWhileIdle: true } } : {}),
      isExactNotification: delayed && ready.exactAlarm === 'granted', autoCancel: true,
      extra: { route: 'review', reason: 'delivery-test' } }] });
    if (delayed && plugin.getPending) {
      const pending = await plugin.getPending();
      if (!pending.notifications.some(item => item.id === TEST_REMINDER_ID)) {
        throw new Error('Android did not save the background test. Try again.');
      }
    } else if (!delayed && plugin.getDeliveredNotifications) {
      let delivered = await plugin.getDeliveredNotifications();
      // NotificationManager posts through the system service asynchronously.
      // Give it a brief chance to become visible before reporting a failure.
      for (let attempt = 0; attempt < 5 && !delivered.notifications.some(item => item.id === TEST_REMINDER_ID); attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
        delivered = await plugin.getDeliveredNotifications();
      }
      if (!delivered.notifications.some(item => item.id === TEST_REMINDER_ID)) {
        throw new Error('Android did not display the test notification. Check notification settings.');
      }
    }
    return { status: delayed ? 'test-scheduled' : 'test-sent', platform: 'native',
      exactAlarm: scheduled?.warning ? 'denied' : ready.exactAlarm };
  });
}

export async function openReminderSettings({ exactAlarms = false } = {}) {
  const plugin = getNativeNotifications();
  if (exactAlarms) return plugin?.changeExactNotificationSetting?.();
  const settings = globalThis.Capacitor?.Plugins?.ReminderSettings;
  if (!settings?.openNotificationSettings) throw new Error('Open Android Settings → Apps → KeepVocab → Notifications.');
  return settings.openNotificationSettings();
}

export async function scheduleDailyReminder({
  time = '19:00',
  title = 'A few words keep your streak growing',
  body = 'Your five-minute review is ready.',
  route = 'review',
  repeat = true,
  nextAt = null,
  reason = 'daily-reminder',
  streakPlan = null,
  practiceReadyPlan = null,
  followUps = [],
  requestPermission = false
} = {}) {
  const normalizedTime = normalizeReminderTime(time);
  const plan = { time: normalizedTime, title, body, route, repeat, reason, nextAt, followUps, streakPlan, practiceReadyPlan };
  const nativePlugin = getNativeNotifications();
  if (nativePlugin) return serializeNotifications(() => scheduleNative(nativePlugin, plan, streakPlan, practiceReadyPlan, requestPermission));
  if (supportsReminders()) return { status: 'unavailable', platform: 'native', nextAt: null };
  return { status: 'android-only', platform: 'web', nextAt: null, streakNextAt: null, practiceReadyNextAt: null };
}

export async function setupReminderNavigation(target = globalThis) {
  const plugin = getNativeNotifications(target);
  if (!plugin?.addListener) return false;
  await plugin.addListener('localNotificationActionPerformed', event => {
    const route = event?.notification?.extra?.route;
    if (!['dashboard', 'learn', 'daily', 'weak', 'review', 'library', 'stats', 'spelling', 'choose', 'visual', 'match', 'speaking'].includes(route)) return;
    if (target.location) target.location.hash = route;
    target.focus?.();
  });
  return true;
}

export async function cancelDailyReminder() {
  const nativePlugin = getNativeNotifications();
  if (nativePlugin) await serializeNotifications(async () => {
    await nativePlugin.cancel({ notifications: reminderIds() });
    await nativePlugin.removeDeliveredNotifications?.({ notifications: reminderIds() });
  });
}
