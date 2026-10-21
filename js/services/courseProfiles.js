import { mergeActivityByDevice, aggregateActivity, currentStudyStats } from './studyActivity.js';
import { COURSE_DEFINITIONS, getCourseDefinition, isCourseId } from '../data/courses.js';
import { normalizeTranslationLanguage } from './translationSettings.js';

export const COURSE_SCOPED_SETTING_KEYS = Object.freeze([
  'activeNotebook', 'dailyGoal', 'practiceSessionSize', 'dailyStreak', 'lastReviewDate', 'reviewsToday', 'reviewsDate',
  'reviewActivity', 'exerciseActivityByDevice', 'learningStats', 'speakingProgress',
  'reminderEnabled', 'reminderExplicitlyDisabled', 'smartReminderEnabled', 'streakReminderEnabled', 'reminderTime', 'reviewStartMoments',
  'practicePreferenceUpdatedAt'
]);

// Daily targets carry their own edit time. The profile's updatedAt moves on
// every answered exercise, so it cannot tell which device changed the goal last.
export const PRACTICE_PREFERENCE_KEYS = Object.freeze(['dailyGoal', 'practiceSessionSize']);

function preferenceTimes(profile = {}) {
  const saved = profile.practicePreferenceUpdatedAt;
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
}

export function stampPracticePreferences(previousProfile = {}, patch = {}, timestamp = new Date().toISOString()) {
  const changed = PRACTICE_PREFERENCE_KEYS.filter(key => Object.hasOwn(patch, key)
    && Number(patch[key]) !== Number(previousProfile[key]));
  if (!changed.length) return patch;
  return {
    ...patch,
    practicePreferenceUpdatedAt: {
      ...preferenceTimes(previousProfile),
      ...Object.fromEntries(changed.map(key => [key, timestamp]))
    }
  };
}

function mergePracticePreferences(localProfile, remoteProfile, baseProfile) {
  const localTimes = preferenceTimes(localProfile);
  const remoteTimes = preferenceTimes(remoteProfile);
  const merged = { practicePreferenceUpdatedAt: { ...preferenceTimes(baseProfile) } };
  for (const key of PRACTICE_PREFERENCE_KEYS) {
    const localTime = Date.parse(localTimes[key] || '') || 0;
    const remoteTime = Date.parse(remoteTimes[key] || '') || 0;
    if (!localTime && !remoteTime) continue;
    const winner = remoteTime > localTime ? remoteProfile : localProfile;
    if (Object.hasOwn(winner, key)) merged[key] = winner[key];
    merged.practicePreferenceUpdatedAt[key] = remoteTime > localTime ? remoteTimes[key] : localTimes[key];
  }
  return merged;
}

function copyScopedSettings(source = {}) {
  return Object.fromEntries(COURSE_SCOPED_SETTING_KEYS
    .filter(key => Object.prototype.hasOwnProperty.call(source, key))
    .map(key => [key, source[key]]));
}

export function defaultCourseProfile(courseId, seed = {}) {
  const course = getCourseDefinition(courseId);
  const copied = copyScopedSettings(seed);
  const explicitlyDisabled = copied.reminderExplicitlyDisabled === true;
  const reminderEnabled = explicitlyDisabled
    ? false
    : typeof copied.reminderEnabled === 'boolean' && copied.reminderEnabled
      ? true
      : !explicitlyDisabled;
  return {
    courseId: course.id,
    updatedAt: seed.updatedAt || null,
    dailyGoal: course.dailyGoal,
    practiceSessionSize: 20,
    dailyStreak: 0,
    lastReviewDate: null,
    reviewsToday: 0,
    reviewsDate: null,
    reviewActivity: {},
    exerciseActivityByDevice: {},
    learningStats: {},
    speakingProgress: {},
    reminderEnabled: true,
    reminderExplicitlyDisabled: false,
    smartReminderEnabled: true,
    streakReminderEnabled: true,
    reminderTime: '19:00',
    reviewStartMoments: [],
    ...copied,
    reminderEnabled,
    reminderExplicitlyDisabled: explicitlyDisabled
  };
}

// Drop retired course state, including its top-level mirror, on load and restore.
const RETIRED_SETTING_KEYS = new Set(['lessonProgress', 'lessonAttempts', 'completedNodeIds', 'canDoEvidence', 'phraseProgress', 'activeLessonId']);

export function migrateCourseSettings(settings = {}) {
  const globals = Object.fromEntries(Object.entries(settings).filter(([key]) => !RETIRED_SETTING_KEYS.has(key)));
  const seed = settings.courseProfiles?.english || (!settings.activeCourseId || settings.activeCourseId === 'english' ? settings : {});
  const profile = defaultCourseProfile('english', seed);
  return {
    ...globals,
    ...copyScopedSettings(profile),
    activeCourseId: 'english',
    translationLanguage: normalizeTranslationLanguage(settings.translationLanguage),
    courseProfiles: { english: profile }
  };
}

export function updateActiveCourseSettings(settings = {}, patch = {}) {
  const migrated = migrateCourseSettings(settings);
  const stampedPatch = stampPracticePreferences(migrated.courseProfiles.english, patch, patch.updatedAt || new Date().toISOString());
  const normalizedPatch = {
    ...stampedPatch,
    ...(Object.prototype.hasOwnProperty.call(patch, 'reminderEnabled')
      ? { reminderExplicitlyDisabled: patch.reminderEnabled === false }
      : {})
  };
  return migrateCourseSettings({
    ...migrated,
    ...normalizedPatch,
    courseProfiles: { english: {
      ...migrated.courseProfiles.english,
      ...copyScopedSettings(normalizedPatch),
      updatedAt: normalizedPatch.updatedAt || new Date().toISOString()
    } }
  });
}

export function switchActiveCourse(settings = {}, nextCourseId) {
  if (!isCourseId(nextCourseId)) throw new Error(`Unknown course: ${nextCourseId}`);
  return migrateCourseSettings(settings);
}

function newestRecord(localValue, remoteValue) {
  if (!localValue) return remoteValue;
  if (!remoteValue) return localValue;
  const localTime = Date.parse(localValue.updatedAt || localValue.completedAt || localValue.createdAt || 0) || 0;
  const remoteTime = Date.parse(remoteValue.updatedAt || remoteValue.completedAt || remoteValue.createdAt || 0) || 0;
  return remoteTime > localTime ? remoteValue : localValue;
}

function mergeSpeakingProgress(localProfile, remoteProfile) {
  const local = localProfile.speakingProgress || {};
  const remote = remoteProfile.speakingProgress || {};
  const localTime = Date.parse(local.updatedAt || localProfile.updatedAt || local.lastCompletedAt || '') || 0;
  const remoteTime = Date.parse(remote.updatedAt || remoteProfile.updatedAt || remote.lastCompletedAt || '') || 0;
  const useRemote = !Object.keys(local).length || (Object.keys(remote).length && remoteTime > localTime);
  const merged = useRemote ? { ...local, ...remote } : { ...remote, ...local };
  if (Array.isArray(local.completed) || Array.isArray(remote.completed)) {
    const localCompleted = Array.isArray(local.completed) ? local.completed : [];
    const remoteCompleted = Array.isArray(remote.completed) ? remote.completed : [];
    merged.completed = [...new Set(useRemote ? [...remoteCompleted, ...localCompleted] : [...localCompleted, ...remoteCompleted])];
  }
  if ((Date.parse(remote.lastCompletedAt || '') || 0) > (Date.parse(local.lastCompletedAt || '') || 0)) merged.lastCompletedAt = remote.lastCompletedAt;
  else if (local.lastCompletedAt) merged.lastCompletedAt = local.lastCompletedAt;
  if (local.phraseProgress || remote.phraseProgress) {
    const phrases = { ...(local.phraseProgress || {}) };
    for (const [id, progress] of Object.entries(remote.phraseProgress || {})) {
      const previous = phrases[id];
      if (!previous) { phrases[id] = progress; continue; }
      const remoteNewest = (Date.parse(progress.lastPracticedAt || progress.updatedAt || '') || 0)
        > (Date.parse(previous.lastPracticedAt || previous.updatedAt || '') || 0);
      phrases[id] = {
        ...(remoteNewest ? previous : progress),
        ...(remoteNewest ? progress : previous),
        // These counters are cumulative snapshots with no per-device evidence.
        // Taking their maximum preserves progress without recounting it on sync.
        exposures: Math.max(Number(previous.exposures) || 0, Number(progress.exposures) || 0),
        successes: Math.max(Number(previous.successes) || 0, Number(progress.successes) || 0)
      };
    }
    merged.phraseProgress = phrases;
  }
  return merged;
}

import { localDateKey } from '../utils/dates.js';

function mergeReviewStartMoments(localProfile = {}, remoteProfile = {}) {
  const byDay = new Map();
  for (const raw of [...(Array.isArray(localProfile.reviewStartMoments) ? localProfile.reviewStartMoments : []),
    ...(Array.isArray(remoteProfile.reviewStartMoments) ? remoteProfile.reviewStartMoments : [])]) {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) continue;
    const key = localDateKey(parsed);
    const existing = byDay.get(key);
    if (!existing || parsed < existing) byDay.set(key, parsed);
  }
  return [...byDay.values()].sort((a, b) => b - a).slice(0, 45).map(date => date.toISOString());
}

export function mergeCourseProfiles(localSettings = {}, remoteSettings = {}) {
  const local = migrateCourseSettings(localSettings);
  const remote = migrateCourseSettings(remoteSettings);
  const hasProfileData = raw => Boolean(raw?.courseProfiles?.english)
    || ((!raw?.activeCourseId || raw.activeCourseId === 'english') && COURSE_SCOPED_SETTING_KEYS.some(key => Object.hasOwn(raw || {}, key)));
  const localProfile = local.courseProfiles.english;
  const remoteProfile = remote.courseProfiles.english;
  const baseProfile = !hasProfileData(localSettings) ? remoteProfile : !hasProfileData(remoteSettings) ? localProfile : newestRecord(localProfile, remoteProfile);
  const speakingProgress = mergeSpeakingProgress(localProfile, remoteProfile);
  const practicePreferences = mergePracticePreferences(localProfile, remoteProfile, baseProfile);
  const exerciseActivityByDevice = mergeActivityByDevice(localProfile, remoteProfile);
  const reviewActivity = aggregateActivity(exerciseActivityByDevice);
  const lastReviewDate = Object.keys(reviewActivity).sort().at(-1) || baseProfile.lastReviewDate;
  const reviewStartMoments = mergeReviewStartMoments(localProfile, remoteProfile);
  const explicitlyDisabled = baseProfile.reminderExplicitlyDisabled === true;
  const reminderEnabled = explicitlyDisabled ? false : Boolean(localProfile.reminderEnabled || remoteProfile.reminderEnabled || baseProfile.reminderEnabled);
  return migrateCourseSettings({ ...local, courseProfiles: { english: {
    ...baseProfile,
    ...practicePreferences,
    reminderEnabled,
    reminderExplicitlyDisabled: explicitlyDisabled,
    reviewStartMoments,
    speakingProgress,
    exerciseActivityByDevice,
    reviewActivity,
    lastReviewDate,
    ...currentStudyStats({ ...baseProfile, reviewActivity, lastReviewDate })
  } } });
}

export { COURSE_DEFINITIONS };
