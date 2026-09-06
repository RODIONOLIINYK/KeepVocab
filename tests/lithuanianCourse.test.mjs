import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage, DriveSyncService, mergeDriveSettings } from '../js/services/driveSync.js';
import { migrateCourseSettings, mergeCourseProfiles, switchActiveCourse, updateActiveCourseSettings } from '../js/services/courseProfiles.js';
import { LITHUANIAN_UNITS, LITHUANIAN_SESSIONS, validateLithuanianCurriculum } from '../js/data/lithuanianCurriculum.js';
import { answerMatches, advanceLessonAttempt, currentSessionId, isSessionUnlocked, selfPacedPathStatus, startLessonAttempt } from '../js/services/lessonEngine.js';
import { lessonVocabularyRecords } from '../js/components/LessonMode.js';

test('legacy settings migrate into English while Lithuanian starts independently', () => {
  const migrated = migrateCourseSettings({ dailyGoal: 31, dailyStreak: 7, speakingProgress: { completed: ['old-lesson'] } });
  assert.equal(migrated.activeCourseId, 'english');
  assert.equal(migrated.courseProfiles.english.dailyGoal, 31);
  assert.deepEqual(migrated.courseProfiles.english.speakingProgress.completed, ['old-lesson']);
  assert.equal(migrated.courseProfiles.lithuanian.dailyGoal, 15);
  assert.deepEqual(migrated.courseProfiles.lithuanian.completedNodeIds, []);
});

test('switching courses preserves isolated goals, stats, speaking, and lesson progress', () => {
  let settings = migrateCourseSettings({ dailyGoal: 20, learningStats: { sessionsCompleted: 9 } });
  settings = switchActiveCourse(settings, 'lithuanian');
  settings = updateActiveCourseSettings(settings, { dailyGoal: 12, speakingProgress: { completed: ['lt-speaking-sep-01'] }, completedNodeIds: ['sep-01-s1'] });
  settings = switchActiveCourse(settings, 'english');
  assert.equal(settings.dailyGoal, 20);
  assert.equal(settings.learningStats.sessionsCompleted, 9);
  assert.deepEqual(settings.speakingProgress, {});
  settings = switchActiveCourse(settings, 'lithuanian');
  assert.equal(settings.dailyGoal, 12);
  assert.deepEqual(settings.completedNodeIds, ['sep-01-s1']);
});

test('legacy words keep IDs and SRS while course vocabulary is isolated', () => {
  const storage = new MemoryStorage();
  const legacy = { id: 'stable-legacy-id', word: 'labas', definition: 'English test sense', box: 4, mastered: true, createdAt: '2025-01-02T00:00:00.000Z', nextReviewDate: '2026-09-01T00:00:00.000Z', monthYear: 'January 2025' };
  storage.setItem('keepvocab_words_db', JSON.stringify([legacy]));
  const service = new DriveSyncService(storage, async () => { throw new Error('No network expected'); });
  const migrated = service.getWords()[0];
  assert.equal(migrated.id, legacy.id);
  assert.equal(migrated.courseId, 'english');
  assert.equal(migrated.box, 4);
  assert.equal(migrated.mastered, true);
  service.setActiveCourseId('lithuanian');
  assert.deepEqual(service.getWords(), []);
  service.addWord({ word: 'labas', definition: 'hello', translation: 'hello' });
  assert.equal(service.getWords().length, 1);
  assert.equal(service.getWords()[0].courseId, 'lithuanian');
  assert.ok(service.getMonthlyArchives().every(archive => archive.words.every(word => word.courseId === 'lithuanian')));
  service.setActiveCourseId('english');
  assert.equal(service.getWords()[0].id, legacy.id);
  assert.ok(service.getMonthlyArchives().every(archive => archive.words.every(word => word.courseId === 'english')));
});

test('Drive profile merge unions completed nodes and keeps the newest resumable attempt', () => {
  const older = { sessionId: 'sep-01-s1', exerciseIndex: 2, status: 'in-progress', updatedAt: '2026-09-01T10:00:00.000Z' };
  const newer = { sessionId: 'sep-01-s1', exerciseIndex: 4, status: 'in-progress', updatedAt: '2026-09-01T11:00:00.000Z' };
  const local = migrateCourseSettings({ activeCourseId: 'lithuanian', courseProfiles: { lithuanian: { completedNodeIds: ['sep-01-s1'], lessonAttempts: { 'sep-01-s2': older } } } });
  const remote = migrateCourseSettings({ activeCourseId: 'lithuanian', courseProfiles: { lithuanian: { completedNodeIds: ['sep-01-s2'], lessonAttempts: { 'sep-01-s2': newer } } } });
  const merged = mergeCourseProfiles(local, remote);
  assert.deepEqual(new Set(merged.courseProfiles.lithuanian.completedNodeIds), new Set(['sep-01-s1', 'sep-01-s2']));
  assert.equal(merged.courseProfiles.lithuanian.lessonAttempts['sep-01-s2'].exerciseIndex, 4);
  const restored = mergeDriveSettings(local, remote);
  assert.equal(restored.courseProfiles.lithuanian.lessonAttempts['sep-01-s2'].exerciseIndex, 4);
});

test('the complete authored course has valid self-paced modules, lessons, answers, and outcomes', () => {
  assert.equal(LITHUANIAN_UNITS.length, 36);
  assert.equal(LITHUANIAN_SESSIONS.length, 216);
  assert.deepEqual(validateLithuanianCurriculum(), []);
  assert.ok(LITHUANIAN_UNITS.every(unit => unit.sessions.length === 6));
  assert.ok(LITHUANIAN_SESSIONS.every(session => session.exercises.length >= 5 && session.exercises.length <= 7));
  assert.ok(LITHUANIAN_SESSIONS.every(session => session.exercises.every(exercise => exercise.phrase.en && exercise.acceptedAnswers.length && exercise.outcomeTag)));
  assert.ok(LITHUANIAN_SESSIONS.every(session => new Set(session.exercises.map(exercise => exercise.type)).size >= 5));
  assert.ok(LITHUANIAN_SESSIONS.every(session => new Set(session.exercises.map(exercise => exercise.phrase.lt)).size >= 3));
});

test('every lesson teaches authored grammar before practice and the course covers foundations and tenses', () => {
  assert.ok(LITHUANIAN_UNITS.every(unit => unit.guide.summary && unit.guide.rule && unit.guide.forms.length >= 3 && unit.guide.tip));
  assert.ok(LITHUANIAN_SESSIONS.every(session => session.exercises[0].type === 'pattern' && session.exercises[0].guide === LITHUANIAN_UNITS.find(unit => unit.id === session.unitId).guide));
  assert.equal(LITHUANIAN_UNITS[0].guide.alphabet.flatMap(group => group.split(/\s+/)).length, 32);
  assert.match(LITHUANIAN_UNITS[0].title, /alphabet/i);
  assert.match(LITHUANIAN_UNITS[1].grammar, /aš esu.*tu esi.*yra/i);
  assert.ok(LITHUANIAN_UNITS.some(unit => /noun.*ending|ending.*noun/i.test(`${unit.title} ${unit.guide.summary}`)));
  assert.ok(LITHUANIAN_UNITS.some(unit => /past frequentative/i.test(`${unit.guide.summary} ${unit.guide.rule}`)));
  assert.ok(LITHUANIAN_UNITS.some(unit => /future/i.test(`${unit.guide.summary} ${unit.guide.rule}`)));
});

test('every unit includes AI listening, an interactive dialogue, and adaptive translation', () => {
  assert.ok(LITHUANIAN_UNITS.every(unit => unit.sessions[2].exercises.some(exercise => exercise.type === 'ai-listening')));
  assert.ok(LITHUANIAN_UNITS.every(unit => unit.sessions[3].exercises.some(exercise => exercise.type === 'ai-dialogue')));
  assert.ok(LITHUANIAN_UNITS.every(unit => unit.sessions.slice(4).some(session => session.exercises.some(exercise => exercise.type === 'adaptive-translation'))));
});

test('lesson attempts resume deterministically and unlock only the next stable node', () => {
  const first = LITHUANIAN_SESSIONS[0];
  const second = LITHUANIAN_SESSIONS[1];
  let attempt = startLessonAttempt(first.id, null, new Date('2026-09-01T10:00:00Z'));
  attempt = advanceLessonAttempt(attempt, first, new Date('2026-09-01T10:01:00Z'));
  const resumed = startLessonAttempt(first.id, attempt);
  assert.equal(resumed.id, attempt.id);
  assert.equal(resumed.exerciseIndex, 2);
  assert.equal(currentSessionId({ completedNodeIds: [] }), first.id);
  assert.equal(isSessionUnlocked(second.id, { completedNodeIds: [] }), false);
  assert.equal(isSessionUnlocked(second.id, { completedNodeIds: [first.id] }), true);
});

test('Lithuanian answer matching respects diacritics and accepted authored forms', () => {
  const exercise = LITHUANIAN_SESSIONS[3].exercises.find(item => item.acceptedAnswers.length);
  assert.equal(answerMatches(exercise, exercise.acceptedAnswers[0]), true);
  assert.equal(answerMatches(exercise, `  ${exercise.acceptedAnswers[0]}! `), true);
  assert.equal(answerMatches(exercise, 'unrelated answer'), false);
});

test('the path reports only self-paced progress and never calendar catch-up', () => {
  const partial = selfPacedPathStatus({ completedNodeIds: LITHUANIAN_SESSIONS.slice(0, 5).map(session => session.id) });
  const status = selfPacedPathStatus({ completedNodeIds: LITHUANIAN_SESSIONS.slice(0, 6).map(session => session.id) });
  assert.equal(partial.completedUnits, 0);
  assert.equal(partial.remainingUnits, 36);
  assert.equal(status.completedUnits, 1);
  assert.equal(status.nextUnit, 2);
  assert.equal(status.remainingUnits, 35);
  assert.equal('recommendedUnits' in status, false);
});

test('cloze exercises accept the missing word and matching exercises contain separate pairs', () => {
  const clozeExercises = LITHUANIAN_SESSIONS.flatMap(session => session.exercises).filter(exercise => exercise.type === 'cloze');
  const cloze = clozeExercises[0];
  const matching = LITHUANIAN_SESSIONS.flatMap(session => session.exercises).find(exercise => exercise.type === 'matching');
  assert.equal(answerMatches(cloze, cloze.clozeAnswer), true);
  assert.equal(answerMatches(cloze, cloze.answer), true);
  assert.ok(cloze.clozePrompt.includes('_____'));
  assert.ok(clozeExercises.every(exercise => exercise.answer.replace(/[?!.,–]/g, '').trim().split(/\s+/).length > 1));
  assert.ok(clozeExercises.every(exercise => exercise.clozePrompt.replace(/[?!.,–]/g, '').trim() !== '_____'));
  assert.match(cloze.instruction, /English cue/);
  assert.equal(matching.matchPairs.length, 2);
  assert.notEqual(matching.matchPairs[0].lt, matching.matchPairs[0].en);
});

test('lesson vocabulary creates stable Lithuanian-only Library records', () => {
  const session = LITHUANIAN_SESSIONS[0];
  const unit = LITHUANIAN_UNITS[0];
  const records = lessonVocabularyRecords(session, unit);
  assert.equal(records.length, 4);
  assert.ok(records.every(record => record.courseId === 'lithuanian' && record.languageCode === 'lt'));
  assert.ok(records.every(record => record.id.startsWith(`lt-course-${unit.id}-`)));
});
