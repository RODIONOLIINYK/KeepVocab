import test from 'node:test';
import assert from 'node:assert/strict';
import { LITHUANIAN_UNITS, LITHUANIAN_SESSIONS } from '../js/data/lithuanianCurriculum.js';
import { FORM_TOPICS, NOUN_FORM_TABLES } from '../js/data/lithuanianForms.js';
import { answerMatches, startLessonAttempt, completionEvidence } from '../js/services/lessonEngine.js';

test('all seven cases have production practice for both genders and both numbers', () => {
  const drills = FORM_TOPICS.flatMap(topic => topic.drills);
  assert.equal(drills.length, 54);
  for (const grammaticalCase of ['nominative','genitive','dative','accusative','instrumental','locative','vocative']) {
    for (const number of ['singular','plural']) {
      for (const gender of ['masculine','feminine']) {
        assert.ok(drills.some(item => item.grammaticalCase === grammaticalCase && item.number === number && item.gender === gender), `${grammaticalCase} ${number} ${gender}`);
      }
    }
  }
});

test('form exercises accept the required ending or completed sentence, rejecting unchanged base forms', () => {
  for (const session of LITHUANIAN_SESSIONS) {
    for (const exercise of session.exercises.filter(item => item.formFocus)) {
      assert.ok(exercise.clozePrompt.includes('_____'));
      assert.equal(answerMatches(exercise, exercise.formFocus.target), true, exercise.id);
      assert.equal(answerMatches(exercise, exercise.phrase.lt), true, exercise.id);
      if (exercise.formFocus.base !== exercise.answer) assert.equal(answerMatches(exercise, exercise.formFocus.base), false, exercise.id);
      assert.ok(exercise.formFocus.explanation);
    }
  }
});

test('all topics are taught before cumulative review and checkpoint contrasts have already been introduced', () => {
  for (const [unitIndex, unit] of LITHUANIAN_UNITS.entries()) {
    for (const session of unit.sessions) {
      const exercises = session.exercises.filter(item => item.formFocus);
      assert.equal(exercises.length > 0, unitIndex >= 2);
      for (const exercise of exercises) {
        assert.ok(LITHUANIAN_UNITS.findIndex(item => item.id === exercise.formFocus.topicId) <= unitIndex);
      }
    }
    if (FORM_TOPICS.some(topic => topic.unitId === unit.id)) {
      const checkpoint = unit.sessions[5].exercises.find(item => item.formFocus);
      const introduced = unit.sessions.slice(0,5).flatMap(session => session.exercises).filter(item => item.formFocus);
      assert.ok(introduced.some(item => item.answer === checkpoint.answer && item.clozePrompt === checkpoint.clozePrompt));
    }
  }
  for (const topic of FORM_TOPICS) {
    assert.ok(LITHUANIAN_UNITS.some(unit => unit.id !== topic.unitId && unit.sessions.some(session => session.exercises.some(ex => ex.formFocus?.topicId === topic.unitId))));
  }
});

test('form answers contribute to scored completion evidence', () => {
  const session = LITHUANIAN_UNITS[2].sessions[5];
  const exercise = session.exercises.find(item => item.formFocus);
  const wrong = completionEvidence(session, { responses: [] });
  const right = completionEvidence(session, { responses: [{ exerciseId: exercise.id, correct: true }] });
  assert.equal(right.correct, wrong.correct + 1);
});

test('changed in-progress lessons restart safely while new revisions and pending word reviews resume', () => {
  const session = LITHUANIAN_UNITS[2].sessions[0];
  const old = { ...startLessonAttempt(session.id), exerciseRevision: 2, exerciseIndex: 4 };
  assert.equal(startLessonAttempt(session.id, old).exerciseIndex, 1);
  const current = { ...old, exerciseRevision: 3 };
  assert.equal(startLessonAttempt(session.id, current).exerciseIndex, 4);
  const pending = { ...old, status: 'completed', vocabularyReviewPending: true };
  assert.equal(startLessonAttempt(session.id, pending).status, 'completed');
});

test('reference tables retain distinctions easily confused across number and case', () => {
  assert.ok(NOUN_FORM_TABLES.every(table => table.singular.length === 7 && table.plural.length === 7));
  const book = NOUN_FORM_TABLES.find(table => table.word === 'knyga');
  assert.equal(book.singular[3], 'knygą');
  assert.equal(book.plural[3], 'knygas');
  assert.equal(book.singular[1], book.plural[0]);
  const street = NOUN_FORM_TABLES.find(table => table.word === 'gatvė');
  assert.equal(street.singular[4], 'gatve');
  assert.equal(street.singular[5], 'gatvėje');
});
