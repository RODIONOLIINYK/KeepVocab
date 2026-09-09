import test from 'node:test';
import assert from 'node:assert/strict';
import { lessonWordCandidates, lessonWordSelection, lessonVocabularyRecords, missingLessonWords, recordVocabularySelection } from '../js/services/lessonVocabulary.js';
import { mergeCourseProfiles } from '../js/services/courseProfiles.js';
import { startLessonAttempt } from '../js/services/lessonEngine.js';
import { LITHUANIAN_SESSIONS } from '../js/data/lithuanianCurriculum.js';

const session = {
  id: 'test-lesson', vocabulary: [{ lt: 'Aš esu studentas.', en: 'I am a student.' }],
  exercises: [{ phrase: { lt: 'Aš esu studentas!' } }]
};
const unit = { unitNumber: 2, grammar: 'Present tense' };

test('selected dictionary sense retains Add Words details through lesson saving and resumption', () => {
  const entry = { word: 'studentas', phonetic: '/test/', audioUrl: 'https://example.test/word.mp3', senses: [
    { definition: 'student', partOfSpeech: 'noun' },
    { definition: 'university student', partOfSpeech: 'noun', lemma: 'studentas', example: 'Jis yra studentas.', acceptedForms: ['studentas', 'studento'], grammaticalTags: ['masculine'], sourceUrl: 'https://example.test/entry' }
  ] };
  const selection = lessonWordSelection('studentas', entry, 1);
  const resumed = JSON.parse(JSON.stringify(recordVocabularySelection({}, [selection])));
  const [record] = lessonVocabularyRecords(session, unit, resumed);
  assert.equal(record.definition, 'university student');
  assert.equal(record.partOfSpeech, 'noun');
  assert.equal(record.example, 'Jis yra studentas.');
  assert.equal(record.audioUrl, entry.audioUrl);
  assert.deepEqual(record.acceptedForms, ['studentas', 'studento']);
  assert.ok(record.grammaticalTags.includes('masculine'));
  assert.equal(resumed.unknownWords[0].senseIndex, 1);
  assert.throws(() => lessonWordSelection('studentas', { senses: [] }), /No meaning/);
});

test('backup merges keep newer selections, cleared selections and finished reviews in either direction', () => {
  const now = new Date('2026-09-09T10:00:00Z');
  const initial = { id: 'attempt', sessionId: session.id, status: 'completed', unknownWords: [], updatedAt: now.toISOString() };
  const selected = recordVocabularySelection(initial, [{ word: 'studentas', definition: 'male student' }], true, now);
  const cleared = recordVocabularySelection(selected, [], true, now);
  const finished = recordVocabularySelection(cleared, [], false, now);
  const settings = attempt => ({ courseProfiles: { lithuanian: { lessonAttempts: { [session.id]: attempt } } } });
  for (const [older, newer] of [[initial, selected], [selected, cleared], [cleared, finished]]) {
    for (const [local, remote] of [[older, newer], [newer, older]]) {
      const result = mergeCourseProfiles(settings(local), settings(remote));
      assert.deepEqual(result.courseProfiles.lithuanian.lessonAttempts[session.id], newer);
    }
  }
  assert.deepEqual(initial.unknownWords, []);
});

test('sentences become unique individual candidates without copying the sentence meaning', () => {
  const candidates = lessonWordCandidates(session);
  assert.deepEqual(candidates.map(item => item.word), ['aš', 'esu', 'studentas']);
  assert.ok(candidates.every(item => item.definition === ''));
  assert.deepEqual(lessonVocabularyRecords(session, unit), []);
});

test('only explicitly unknown words are saved, with a word meaning and sentence example', () => {
  const records = lessonVocabularyRecords(session, unit, { unknownWords: [
    { word: 'STUDENTAS', definition: 'male student' },
    { word: 'Aš esu studentas.', definition: 'I am a student.' },
    { word: 'unrelated', definition: 'not encountered' }
  ] });
  assert.equal(records.length, 1);
  assert.equal(records[0].word, 'studentas');
  assert.equal(records[0].translation, 'male student');
  assert.equal(records[0].example, 'Aš esu studentas.');
  assert.equal(records[0].partOfSpeech, 'word');
  assert.equal(records[0].courseId, 'lithuanian');
});

test('unknown words need their own meaning; a failed lookup cannot save sentence translations', () => {
  assert.throws(() => lessonVocabularyRecords(session, unit, { unknownWords: [{ word: 'studentas' }] }), /English meaning/);
});

test('adaptive listening, dialogue and translation words are available even without introduced vocabulary', () => {
  const attempt = { responses: [{ vocabularyPhrases: [{ lt: 'Norėčiau kavos.' }] }], unknownWords: [{ word: 'kavos', definition: 'coffee (genitive)' }] };
  const records = lessonVocabularyRecords({ ...session, vocabulary: [] }, unit, attempt);
  assert.equal(records[0].word, 'kavos');
  assert.equal(records[0].example, 'Norėčiau kavos.');
});

test('repeated saves preserve existing words and their review progress across lessons', () => {
  const attempt = { unknownWords: [{ word: 'studentas', definition: 'male student' }] };
  const records = lessonVocabularyRecords(session, unit, attempt);
  const existing = [{ ...records[0], word: 'Studentas', mastered: true, nextReview: '2027-01-01' }];
  assert.deepEqual(missingLessonWords(records, existing), []);
  assert.equal(existing[0].mastered, true);
  assert.equal(missingLessonWords(records, [{ ...existing[0], courseId: 'english' }]).length, 1);
});

test('unfinished word selection resumes after reload; finished lessons can be practised again', () => {
  const realSession = LITHUANIAN_SESSIONS[0];
  const attempt = { ...startLessonAttempt(realSession.id), status: 'completed', exerciseIndex: realSession.exercises.length, vocabularyReviewPending: true, unknownWords: [{ word: 'ačiū', definition: 'thank you' }] };
  assert.deepEqual(startLessonAttempt(realSession.id, attempt), attempt);
  assert.equal(startLessonAttempt(realSession.id, { ...attempt, vocabularyReviewPending: false }).status, 'in-progress');
});
