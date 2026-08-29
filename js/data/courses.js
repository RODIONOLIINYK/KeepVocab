export const COURSE_DEFINITIONS = Object.freeze({
  english: Object.freeze({
    id: 'english',
    name: 'English',
    shortLabel: 'English',
    languageCode: 'en',
    locale: 'en-US',
    level: 'Personal vocabulary',
    dailyGoal: 20,
    hasLearningPath: false
  }),
  lithuanian: Object.freeze({
    id: 'lithuanian',
    name: 'Lithuanian',
    shortLabel: 'Lithuanian',
    languageCode: 'lt',
    locale: 'lt-LT',
    level: 'A1 → strong A2',
    dailyGoal: 15,
    hasLearningPath: true
  })
});

export const COURSE_IDS = Object.freeze(Object.keys(COURSE_DEFINITIONS));

export function getCourseDefinition(courseId = 'english') {
  return COURSE_DEFINITIONS[courseId] || COURSE_DEFINITIONS.english;
}

export function isCourseId(courseId) {
  return COURSE_IDS.includes(String(courseId || ''));
}
