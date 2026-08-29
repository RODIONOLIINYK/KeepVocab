import { COURSE_DEFINITIONS, COURSE_IDS, getCourseDefinition, isCourseId } from '../data/courses.js';

export const COURSE_SCOPED_SETTING_KEYS = Object.freeze([
  'activeNotebook', 'dailyGoal', 'dailyStreak', 'lastReviewDate', 'reviewsToday', 'reviewsDate',
  'reviewActivity', 'exerciseActivityByDevice', 'learningStats', 'speakingProgress', 'lessonProgress',
  'lessonAttempts', 'completedNodeIds', 'canDoEvidence', 'phraseProgress', 'activeLessonId',
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
    dailyGoal: course.dailyGoal,
    dailyStreak: 0,
    lastReviewDate: null,
    reviewsToday: 0,
    reviewsDate: null,
    reviewActivity: {},
    exerciseActivityByDevice: {},
    learningStats: {},
    speakingProgress: {},
    lessonProgress: {},
    lessonAttempts: {},
    completedNodeIds: [],
    canDoEvidence: [],
    phraseProgress: {},
    activeLessonId: null,
    ...copyScopedSettings(seed)
  };
}

export function migrateCourseSettings(settings = {}) {
  const activeCourseId = isCourseId(settings.activeCourseId) ? settings.activeCourseId : 'english';
  const storedProfiles = settings.courseProfiles && typeof settings.courseProfiles === 'object' ? settings.courseProfiles : {};
  const courseProfiles = {};
  for (const courseId of COURSE_IDS) {
    const seed = storedProfiles[courseId] || (courseId === 'english' ? settings : {});
    courseProfiles[courseId] = defaultCourseProfile(courseId, seed);
  }
  const activeProfile = courseProfiles[activeCourseId];
  return {
    ...settings,
    ...copyScopedSettings(activeProfile),
    activeCourseId,
    courseProfiles
  };
}

export function updateActiveCourseSettings(settings = {}, patch = {}) {
  const migrated = migrateCourseSettings(settings);
  const courseId = migrated.activeCourseId;
  const scopedPatch = copyScopedSettings(patch);
  return {
    ...migrated,
    ...patch,
    courseProfiles: {
      ...migrated.courseProfiles,
      [courseId]: {
        ...migrated.courseProfiles[courseId],
        ...scopedPatch,
        courseId,
        updatedAt: patch.updatedAt || migrated.courseProfiles[courseId]?.updatedAt || new Date().toISOString()
      }
    }
  };
}

export function switchActiveCourse(settings = {}, nextCourseId) {
  if (!isCourseId(nextCourseId)) throw new Error(`Unknown course: ${nextCourseId}`);
  const migrated = migrateCourseSettings(settings);
  const currentId = migrated.activeCourseId;
  const profiles = {
    ...migrated.courseProfiles,
    [currentId]: {
      ...migrated.courseProfiles[currentId],
      ...copyScopedSettings(migrated),
      courseId: currentId
    }
  };
  const nextProfile = profiles[nextCourseId] || defaultCourseProfile(nextCourseId);
  return {
    ...migrated,
    ...copyScopedSettings(nextProfile),
    activeCourseId: nextCourseId,
    courseProfiles: profiles
  };
}

function newestRecord(localValue, remoteValue) {
  if (!localValue) return remoteValue;
  if (!remoteValue) return localValue;
  const localTime = Date.parse(localValue.updatedAt || localValue.completedAt || localValue.createdAt || 0) || 0;
  const remoteTime = Date.parse(remoteValue.updatedAt || remoteValue.completedAt || remoteValue.createdAt || 0) || 0;
  return remoteTime > localTime ? remoteValue : localValue;
}

export function mergeCourseProfiles(localSettings = {}, remoteSettings = {}) {
  const local = migrateCourseSettings(localSettings);
  const remote = migrateCourseSettings(remoteSettings);
  const hasProfileData = (raw, courseId) => Boolean(raw?.courseProfiles?.[courseId])
    || (courseId === 'english' && COURSE_SCOPED_SETTING_KEYS.some(key => Object.prototype.hasOwnProperty.call(raw || {}, key)));
  const courseProfiles = {};
  for (const courseId of COURSE_IDS) {
    const localProfile = local.courseProfiles[courseId];
    const remoteProfile = remote.courseProfiles[courseId];
    const localHasData = hasProfileData(localSettings, courseId);
    const remoteHasData = hasProfileData(remoteSettings, courseId);
    const baseProfile = !localHasData ? remoteProfile : !remoteHasData ? localProfile : newestRecord(localProfile, remoteProfile);
    const lessonAttempts = { ...(localProfile.lessonAttempts || {}) };
    for (const [id, attempt] of Object.entries(remoteProfile.lessonAttempts || {})) {
      lessonAttempts[id] = newestRecord(lessonAttempts[id], attempt);
    }
    const canDoById = new Map();
    for (const evidence of [...(localProfile.canDoEvidence || []), ...(remoteProfile.canDoEvidence || [])]) {
      const id = evidence.id || `${evidence.nodeId}-${evidence.completedAt}`;
      canDoById.set(id, newestRecord(canDoById.get(id), evidence));
    }
    courseProfiles[courseId] = {
      ...baseProfile,
      completedNodeIds: [...new Set([...(localProfile.completedNodeIds || []), ...(remoteProfile.completedNodeIds || [])])],
      lessonAttempts,
      lessonProgress: { ...(localProfile.lessonProgress || {}), ...(remoteProfile.lessonProgress || {}) },
      phraseProgress: { ...(localProfile.phraseProgress || {}), ...(remoteProfile.phraseProgress || {}) },
      canDoEvidence: [...canDoById.values()],
      courseId
    };
  }
  const activeCourseId = isCourseId(local.activeCourseId) ? local.activeCourseId : remote.activeCourseId;
  return migrateCourseSettings({ ...local, courseProfiles, activeCourseId });
}

export { COURSE_DEFINITIONS };
