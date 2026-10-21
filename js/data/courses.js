export const COURSE_DEFINITIONS = Object.freeze({
  english: Object.freeze({
    id: 'english',
    name: 'English',
    shortLabel: 'English',
    languageCode: 'en',
    locale: 'en-US',
    nativeCode: 'en',
    level: 'Personal vocabulary',
    dailyGoal: 20,
    hasLearningPath: false
  })
});

const COURSE_IDS = Object.freeze(Object.keys(COURSE_DEFINITIONS));

export function getCourseDefinition(courseId = 'english') {
  return COURSE_DEFINITIONS[courseId] || COURSE_DEFINITIONS.english;
}

export function isCourseId(courseId) {
  return COURSE_IDS.includes(String(courseId || ''));
}
