import { mergeActivityByDevice, aggregateActivity, currentStudyStats } from './studyActivity.js';
import { COURSE_DEFINITIONS, getCourseDefinition, isCourseId } from '../data/courses.js';
import { normalizeTranslationLanguage } from './translationSettings.js';

export const COURSE_SCOPED_SETTING_KEYS = Object.freeze([
  'activeNotebook', 'dailyGoal', 'practiceSessionSize', 'dailyStreak', 'lastReviewDate', 'reviewsToday', 'reviewsDate',
  'reviewActivity', 'exerciseActivityByDevice', 'learningStats', 'speakingProgress',
  'reminderEnabled', 'smartReminderEnabled', 'streakReminderEnabled', 'reminderTime', 'reviewStartMoments'
]);

function copyScopedSettings(source = {}) {
  return Object.fromEntries(COURSE_SCOPED_SETTING_KEYS
    .filter(key => Object.prototype.hasOwnProperty.call(source, key))
    .map(key => [key, source[key]]));
}

export function defaultCourseProfile(courseId, seed = {}) {
  const course = getCourseDefinition(courseId);
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
    reminderEnabled: false,
    smartReminderEnabled: true,
    streakReminderEnabled: true,
    reminderTime: '19:00',
    reviewStartMoments: [],
    ...copyScopedSettings(seed)
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
  return migrateCourseSettings({
    ...migrated,
    ...patch,
    courseProfiles: { english: {
      ...migrated.courseProfiles.english,
      ...copyScopedSettings(patch),
      updatedAt: patch.updatedAt || new Date().toISOString()
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

export function mergeCourseProfiles(localSettings = {}, remoteSettings = {}) {
  const local = migrateCourseSettings(localSettings);
  const remote = migrateCourseSettings(remoteSettings);
  const hasProfileData = raw => Boolean(raw?.courseProfiles?.english)
    || ((!raw?.activeCourseId || raw.activeCourseId === 'english') && COURSE_SCOPED_SETTING_KEYS.some(key => Object.hasOwn(raw || {}, key)));
  const localProfile = local.courseProfiles.english;
  const remoteProfile = remote.courseProfiles.english;
  const baseProfile = !hasProfileData(localSettings) ? remoteProfile : !hasProfileData(remoteSettings) ? localProfile : newestRecord(localProfile, remoteProfile);
  const speakingProgress = mergeSpeakingProgress(localProfile, remoteProfile);
  const exerciseActivityByDevice = mergeActivityByDevice(localProfile, remoteProfile);
  const reviewActivity = aggregateActivity(exerciseActivityByDevice);
  const lastReviewDate = Object.keys(reviewActivity).sort().at(-1) || baseProfile.lastReviewDate;
  return migrateCourseSettings({ ...local, courseProfiles: { english: {
    ...baseProfile,
    speakingProgress,
    exerciseActivityByDevice,
    reviewActivity,
    lastReviewDate,
    ...currentStudyStats({ ...baseProfile, reviewActivity, lastReviewDate })
  } } });
}

export { COURSE_DEFINITIONS };
