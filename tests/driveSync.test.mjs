import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DriveSyncService,
  GOOGLE_WEB_CLIENT_ID,
  MemoryStorage,
  getCurrentMonthNotebookTitle,
  mergeDriveSettings,
  usesNativeGoogleAuthorization
} from '../js/services/driveSync.js';
import { getGeminiSettings, saveGeminiSettings } from '../js/services/geminiSettings.js';
import { getImageProviderSettings, saveImageProviderSettings } from '../js/services/imageSearch.js';
import { getTranslationLanguage, getTranslationName, isUkrainianTranslationEnabled } from '../js/services/translationSettings.js';
import { recordExerciseResult } from '../js/services/exerciseResult.js';
import { recordModeWordSelections } from '../js/services/wordSelection.js';

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return structuredClone(payload); }
  };
}

class MockDrive {
  constructor() {
    this.folder = null;
    this.files = new Map();
    this.calls = [];
    this.nextId = 1;
    this.fetch = this.fetch.bind(this);
  }

  parseMultipart(body, contentType) {
    const boundary = contentType.match(/boundary=([^;]+)/)?.[1];
    const pattern = new RegExp(`Content-Type: application/json(?:; charset=UTF-8)?\\r\\n\\r\\n([\\s\\S]*?)(?=\\r\\n--${boundary})`, 'g');
    const parts = [...body.matchAll(pattern)].map(match => JSON.parse(match[1]));
    return { metadata: parts[0], payload: parts[1] };
  }

  async fetch(url, options = {}) {
    this.calls.push({ url: String(url), options });
    const parsed = new URL(url);
    const method = options.method || 'GET';

    if (parsed.hostname === 'www.googleapis.com' && parsed.pathname === '/drive/v3/files' && method === 'GET') {
      const query = parsed.searchParams.get('q') || '';
      if (query.includes("value='folder'")) return response({ files: this.folder ? [this.folder] : [] });
      if (query.includes("value='data'")) return response({ files: [...this.files.values()].map(item => item.metadata) });
      return response({ files: [] });
    }

    if (parsed.pathname === '/drive/v3/files' && method === 'POST') {
      const metadata = JSON.parse(options.body);
      const id = `folder-${this.nextId++}`;
      this.folder = { id, ...metadata, modifiedTime: new Date().toISOString() };
      return response(this.folder);
    }

    if (parsed.hostname === 'www.googleapis.com' && parsed.pathname.startsWith('/drive/v3/files/') && parsed.searchParams.get('alt') === 'media') {
      const id = decodeURIComponent(parsed.pathname.split('/').pop());
      return response(this.files.get(id)?.payload ?? {}, this.files.has(id) ? 200 : 404);
    }

    if (parsed.hostname === 'www.googleapis.com' && parsed.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const { metadata, payload } = this.parseMultipart(options.body, options.headers['Content-Type']);
      const id = `file-${this.nextId++}`;
      const stored = { metadata: { id, ...metadata, modifiedTime: new Date().toISOString() }, payload };
      this.files.set(id, stored);
      return response(stored.metadata);
    }

    if (parsed.hostname === 'www.googleapis.com' && parsed.pathname.startsWith('/upload/drive/v3/files/') && method === 'PATCH') {
      const id = decodeURIComponent(parsed.pathname.split('/').pop());
      const stored = this.files.get(id);
      if (!stored) return response({ error: { message: 'Missing file' } }, 404);
      stored.payload = JSON.parse(options.body);
      stored.metadata.modifiedTime = new Date().toISOString();
      return response(stored.metadata);
    }

    return response({ error: { message: `Unhandled mock request: ${method} ${parsed.pathname}` } }, 500);
  }

  payloadByName(name) {
    return [...this.files.values()].find(item => item.metadata.name === name)?.payload;
  }
}

function authorize(service) {
  service.accessToken = 'test-drive-token';
  service.tokenExpiresAt = Date.now() + 60_000;
}

test('new words always enter the real current month unless a migration target is explicit', () => {
  const service = new DriveSyncService(new MemoryStorage(), async () => { throw new Error('unused'); });
  service.updateSettings({ activeNotebook: 'January 2020 Vocabulary' }, { silent: true });
  const word = service.addWord({ word: 'calendarwise', partOfSpeech: 'adjective', definition: 'Filed by its real creation month.' });

  assert.equal(word.notebook, getCurrentMonthNotebookTitle());
  assert.equal(word.monthYear, getCurrentMonthNotebookTitle().replace(/ Vocabulary$/, ''));
  assert.equal(service.getWordsByMonthYear(word.monthYear).some(item => item.id === word.id), true);
});

test('a fresh install starts with an empty library', () => {
  const service = new DriveSyncService(new MemoryStorage(), async () => { throw new Error('unused'); });
  assert.deepEqual(service.getWords(), []);
  assert.equal(service.getNotebooks().length, 1);
  assert.equal(service.getSettings().translationLanguage, 'en');
});

test('library preserves separate intended senses and keeps stable identity when edited', () => {
  const service = new DriveSyncService(new MemoryStorage(), async () => { throw new Error('unused'); });
  service.saveWords([], { silent: true });
  const river = service.addWord({ word: 'bank', partOfSpeech: 'noun', definition: 'The land beside a river.' });
  const finance = service.addWord({ word: 'bank', partOfSpeech: 'noun', definition: 'A financial institution.' });
  const stableSenseId = finance.senseId;
  const edited = service.updateWord(finance.id, {
    definition: 'An institution that holds and lends money.',
    imageCustomConcept: 'customer depositing cash at a bank counter'
  });

  assert.equal(service.getWords().length, 2);
  assert.notEqual(river.id, finance.id);
  assert.equal(edited.id, finance.id);
  assert.equal(edited.senseId, stableSenseId);
  assert.equal(service.getWords().find(word => word.id === finance.id).imageCustomConcept, 'customer depositing cash at a bank counter');
  assert.throws(() => service.addWord({ word: 'bank', partOfSpeech: 'noun', definition: 'The land beside a river.' }), /meaning.*already/i);
  assert.throws(() => service.updateWord(river.id, { imageUrl: 'javascript:alert(1)' }), /https:\/\//);
});

test('multiple selected meanings are saved atomically with separate learning identities', () => {
  const service = new DriveSyncService(new MemoryStorage(), async () => { throw new Error('unused'); });
  service.saveWords([], { silent: true });
  const saved = service.addWords([
    { word: 'bank', partOfSpeech: 'noun', definition: 'A financial institution.', example: 'She deposited money at the bank.' },
    { word: 'bank', partOfSpeech: 'noun', definition: 'The land beside a river.', example: 'They rested on the river bank.' }
  ]);

  assert.equal(saved.length, 2);
  assert.equal(service.getWords().filter(item => item.word === 'bank').length, 2);
  assert.equal(service.getMonthlyArchives()[0].wordCount, 1);
  assert.equal(service.getMonthlyArchives()[0].count, 2);
  assert.notEqual(saved[0].id, saved[1].id);
  assert.notEqual(saved[0].senseId, saved[1].senseId);
  assert.throws(() => service.addWords([
    { word: 'bank', partOfSpeech: 'noun', definition: 'A place that holds money.' },
    { word: 'bank', partOfSpeech: 'noun', definition: 'A place that holds money.' }
  ]), /duplicate definition/i);
  assert.equal(service.getWords().length, 2);
});

test('first sync creates one dedicated folder, monthly files, and a settings file', async () => {
  const drive = new MockDrive();
  const service = new DriveSyncService(new MemoryStorage(), drive.fetch);
  service.saveWords([], { silent: true });
  service.addWord({ word: 'bank', partOfSpeech: 'noun', definition: 'The land beside a river.', createdAt: '2026-05-10T10:00:00.000Z' }, 'May 2026 Vocabulary');
  service.addWord({ word: 'yield', partOfSpeech: 'verb', definition: 'To furnish or produce.', createdAt: '2026-07-20T10:00:00.000Z' }, 'July 2026 Vocabulary');
  service.updateSettings({ dailyGoal: 27, learningStats: { sessionsCompleted: 4, speakingMinutes: 18 }, speakingProgress: { completed: ['rent-apartment'], level: 'B2' } }, { silent: true });
  authorize(service);

  const result = await service.syncGoogleDrive();

  assert.equal(drive.folder.name, 'KeepVocab Dictionary Backup');
  assert.equal(drive.folder.mimeType, 'application/vnd.google-apps.folder');
  assert.equal(drive.folder.appProperties.keepVocabBackup, 'folder');
  assert.deepEqual([...drive.files.values()].map(item => item.metadata.name).sort(), [
    'Dictionary July 2026.json',
    'Dictionary May 2026.json',
    'KeepVocab Settings.json'
  ]);
  assert.equal(drive.payloadByName('Dictionary May 2026.json').words[0].definition, 'The land beside a river.');
  assert.equal(drive.payloadByName('Dictionary May 2026.json').schemaVersion, 2);
  assert.equal(drive.payloadByName('Dictionary July 2026.json').monthYear, 'July 2026');
  assert.equal(drive.payloadByName('KeepVocab Settings.json').settings.dailyGoal, 27);
  assert.equal(drive.payloadByName('KeepVocab Settings.json').settings.learningStats.sessionsCompleted, 4);
  assert.deepEqual(drive.payloadByName('KeepVocab Settings.json').settings.speakingProgress.completed, ['rent-apartment']);
  assert.equal(drive.payloadByName('KeepVocab Settings.json').schemaVersion, 2);
  assert.equal(drive.payloadByName('KeepVocab Settings.json').settings.courseProfiles.english.dailyGoal, 27);
  assert.equal(result.months, 2);
  assert.equal(result.createdFiles, 3);
  assert.ok(drive.calls.some(call => new URL(call.url).searchParams.get('q')?.includes("appProperties has { key='keepVocabBackup' and value='folder' }")));
  assert.ok(drive.calls.some(call => new URL(call.url).searchParams.get('q')?.includes("appProperties has { key='keepVocabBackup' and value='data' }")));
});

test('fresh reinstall restores exact meanings, original months, settings, and progress', async () => {
  const drive = new MockDrive();
  const original = new DriveSyncService(new MemoryStorage(), drive.fetch);
  original.saveWords([], { silent: true });
  const intended = original.addWord({
    word: 'run',
    partOfSpeech: 'noun',
    definition: 'An act or spell of running, not the verb meaning.',
    example: 'She went for a run.',
    createdAt: '2026-05-03T09:00:00.000Z',
    box: 4,
    nextReviewDate: '2026-08-01T00:00:00.000Z',
    practiceStats: { version: 1, attempts: 7, recalled: 5, missed: 2, selections: 9, byMode: { flashcards: { attempts: 3, recalled: 2, missed: 1, selections: 4 } } }
  }, 'May 2026 Vocabulary');
  original.addWord({ word: 'inflict', partOfSpeech: 'verb', definition: 'To cause something unpleasant to be suffered.', createdAt: '2026-07-02T09:00:00.000Z' }, 'July 2026 Vocabulary');
  original.updateSettings({ dailyGoal: 31, activeNotebook: 'May 2026 Vocabulary', learningStats: { sessionsCompleted: 7, weakWordsImproved: 3 }, speakingProgress: { completed: ['rent-apartment', 'present-idea'], level: 'B2' } }, { silent: true });
  authorize(original);
  await original.syncGoogleDrive();

  const reinstalled = new DriveSyncService(new MemoryStorage(), drive.fetch);
  authorize(reinstalled);
  const result = await reinstalled.syncGoogleDrive();
  const restored = reinstalled.getWords().find(word => word.id === intended.id);

  assert.equal(result.totalWords, 2);
  assert.equal(reinstalled.getWords().some(word => word.source === 'sample'), false);
  assert.equal(restored.word, 'run');
  assert.equal(restored.partOfSpeech, 'noun');
  assert.equal(restored.definition, 'An act or spell of running, not the verb meaning.');
  assert.equal(restored.example, 'She went for a run.');
  assert.equal(restored.monthYear, 'May 2026');
  assert.equal(restored.notebook, 'May 2026 Vocabulary');
  assert.equal(restored.box, 4);
  assert.equal(restored.nextReviewDate, '2026-08-01T00:00:00.000Z');
  assert.equal(restored.practiceStats.recalled, 5);
  assert.equal(restored.practiceStats.byMode.flashcards.missed, 1);
  assert.equal(reinstalled.getSettings().dailyGoal, 31);
  assert.equal(reinstalled.getSettings().learningStats.sessionsCompleted, 7);
  assert.deepEqual(reinstalled.getSettings().speakingProgress.completed, ['rent-apartment', 'present-idea']);
  assert.deepEqual(reinstalled.getMonthlyArchives().map(archive => archive.monthYear), ['July 2026', 'May 2026']);
});

test('newer metadata and selections cannot overwrite a newer recall from another device', async () => {
  const drive = new MockDrive();
  const first = new DriveSyncService(new MemoryStorage(), drive.fetch);
  const added = first.addWord({ word: 'remember', definition: 'To bring something back to mind.', createdAt: '2026-08-01T10:00:00.000Z' }, 'August 2026 Vocabulary');
  first.saveWords([{ ...added, updatedAt: added.createdAt }]);
  authorize(first);
  await first.syncGoogleDrive();
  const second = new DriveSyncService(new MemoryStorage(), drive.fetch);
  authorize(second);
  await second.syncGoogleDrive();

  const recalled = recordExerciseResult({ wordId: added.id, exerciseType: 'daily-typed-recall', correct: true,
    recallType: 'free-recall', producedUnaided: true, occurredAt: '2026-08-14T10:00:00.000Z' }, first).word;
  await first.syncGoogleDrive();
  // The offline copy still has no answer history when it is selected and edited.
  recordModeWordSelections(second, second.getWords(), { mode: 'flashcards', now: new Date('2026-08-15T10:00:00.000Z') });
  second.updateWord(added.id, { example: 'Remember to call tomorrow.' });
  await second.syncGoogleDrive();
  await first.syncGoogleDrive();

  for (const service of [first, second]) {
    const merged = service.getWords().find(word => word.id === added.id);
    assert.equal(merged.example, 'Remember to call tomorrow.');
    assert.equal(merged.practiceStats.attempts, 1);
    assert.equal(merged.practiceStats.unaidedRecalled, 1);
    assert.equal(merged.practiceStats.lastUnaidedRecallAt, '2026-08-14T10:00:00.000Z');
    assert.equal(merged.practiceStats.lastAnsweredAt, recalled.lastReviewedAt);
    assert.equal(merged.nextReviewDate, recalled.nextReviewDate);
    assert.deepEqual(merged.lastExerciseResult, recalled.lastExerciseResult);
    assert.equal(merged.practiceStats.selections, 1);
    assert.equal(merged.practiceStats.byMode.flashcards.selections, 1);
    assert.equal(merged.practiceStats.byMode.practice.attempts, 1);
  }
  const before = structuredClone(first.getWords());
  await first.syncGoogleDrive();
  await second.syncGoogleDrive();
  assert.deepEqual(first.getWords(), before);
  assert.deepEqual(second.getWords(), before);

  const reinstalled = new DriveSyncService(new MemoryStorage(), drive.fetch);
  authorize(reinstalled);
  await reinstalled.syncGoogleDrive();
  assert.deepEqual(reinstalled.getWords(), before);
});

test('concurrent answers keep the latest schedule and the last factual recall without adding snapshot counts', async () => {
  const drive = new MockDrive();
  const first = new DriveSyncService(new MemoryStorage(), drive.fetch);
  const added = first.addWord({ word: 'retain', definition: 'To keep something.', createdAt: '2026-08-01T10:00:00.000Z' }, 'August 2026 Vocabulary');
  first.saveWords([{ ...added, updatedAt: added.createdAt }]);
  authorize(first);
  await first.syncGoogleDrive();
  const second = new DriveSyncService(new MemoryStorage(), drive.fetch);
  authorize(second);
  await second.syncGoogleDrive();
  recordExerciseResult({ wordId: added.id, exerciseType: 'daily-typed-recall', correct: true,
    recallType: 'free-recall', producedUnaided: true, occurredAt: '2026-08-14T10:00:00.000Z' }, first);
  const failed = recordExerciseResult({ wordId: added.id, exerciseType: 'daily-typed-recall', correct: false,
    recallType: 'free-recall', producedUnaided: false, occurredAt: '2026-08-15T10:00:00.000Z' }, second).word;
  await first.syncGoogleDrive();
  await second.syncGoogleDrive();
  await first.syncGoogleDrive();
  for (const service of [first, second]) {
    const merged = service.getWords()[0];
    assert.equal(merged.practiceStats.attempts, failed.practiceStats.attempts);
    assert.equal(merged.practiceStats.missed, 1);
    assert.equal(merged.practiceStats.lastAnswerCorrect, false);
    assert.equal(merged.practiceStats.lastUnaidedRecallAt, '2026-08-14T10:00:00.000Z');
    assert.equal(merged.nextReviewDate, failed.nextReviewDate);
    assert.equal(merged.srs.lastRating, 'again');
    assert.deepEqual(merged.mistakes, failed.mistakes);
  }
});

test('conflicting sense identities retain whole-record conflict resolution', async () => {
  const drive = new MockDrive();
  const service = new DriveSyncService(new MemoryStorage(), drive.fetch);
  const added = service.addWord({ word: 'bank', definition: 'A financial institution.', createdAt: '2026-08-01T10:00:00.000Z' }, 'August 2026 Vocabulary');
  service.saveWords([{ ...added, updatedAt: added.createdAt }]);
  authorize(service);
  await service.syncGoogleDrive();
  const payload = drive.payloadByName('Dictionary August 2026.json');
  payload.words[0] = { ...payload.words[0], senseId: 'different-sense', definition: 'Land beside a river.', updatedAt: '2026-08-20T10:00:00.000Z' };
  recordExerciseResult({ wordId: added.id, exerciseType: 'daily-typed-recall', correct: true,
    recallType: 'free-recall', producedUnaided: true, occurredAt: '2026-08-14T10:00:00.000Z' }, service);
  await service.syncGoogleDrive();
  const merged = service.getWords()[0];
  assert.equal(merged.senseId, 'different-sense');
  assert.equal(merged.definition, 'Land beside a river.');
  assert.equal(merged.practiceStats, undefined);
  assert.equal(merged.lastReviewedAt, undefined);
});

test('retired active-course settings migrate to the saved English profile without mixing progress', () => {
  const storage = new MemoryStorage();
  storage.setItem('keepvocab_settings', JSON.stringify({
    activeCourseId: 'removed-course', translationLanguage: 'removed-language', dailyGoal: 99,
    activeNotebook: 'September 2026 Vocabulary', soundEnabled: false, activeLessonId: 'retired-lesson',
    courseProfiles: {
      english: {
        dailyGoal: 27, activeNotebook: 'July 2026 Vocabulary', practiceSessionSize: 35,
        exerciseActivityByDevice: { 'english-device': { '2026-07-20': 4 } },
        learningStats: { sessionsCompleted: 7 },
        speakingProgress: { 'rent-apartment': { completed: true, updatedAt: '2026-07-20T10:00:00.000Z' } },
        activeLessonId: 'retired-lesson'
      },
      'removed-course': { dailyGoal: 99, reviewActivity: { '2026-07-20': 20 } }
    }
  }));
  const service = new DriveSyncService(storage);
  const settings = service.getSettings();
  assert.equal(settings.activeCourseId, 'english');
  assert.equal(settings.translationLanguage, 'en');
  assert.equal(settings.dailyGoal, 27);
  assert.equal(settings.practiceSessionSize, 35);
  assert.equal(settings.activeNotebook, 'July 2026 Vocabulary');
  assert.equal(settings.soundEnabled, false);
  assert.equal(settings.learningStats.sessionsCompleted, 7);
  assert.equal(settings.speakingProgress['rent-apartment'].completed, true);
  assert.deepEqual(settings.reviewActivity, { '2026-07-20': 4 });
  assert.deepEqual(Object.keys(settings.courseProfiles), ['english']);
  assert.equal('activeLessonId' in settings, false);
  assert.equal('activeLessonId' in settings.courseProfiles.english, false);
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem('keepvocab_settings')).courseProfiles), ['english']);
  assert.throws(() => service.setActiveCourseId('removed-course'), /Unknown course/);
  assert.throws(() => service.updateCourseProfile('removed-course', { dailyGoal: 50 }), /Unknown course/);
});

test('startup removes unsupported vocabulary, keeps English learning evidence, and records deletion tombstones', () => {
  const storage = new MemoryStorage();
  const base = { monthYear: 'July 2026', definition: 'An intended meaning.', createdAt: '2026-07-01T10:00:00.000Z' };
  storage.setItem('keepvocab_words_db', JSON.stringify([
    { ...base, id: 'english', word: 'retain', courseId: 'english', languageCode: 'en-US', box: 4,
      practiceStats: { attempts: 5, recalled: 4, missed: 1 }, translation: 'зберігати', translationLanguage: 'uk' },
    { ...base, id: 'untagged', word: 'legacy', translation: 'old translation', translationLanguage: 'removed-language' },
    { ...base, id: 'removed-course-word', word: 'foreign-one', courseId: 'removed-course', senseId: 'foreign-sense' },
    { ...base, id: 'removed-language-word', word: 'foreign-two', courseId: 'english', languageCode: 'xx' }
  ]));
  const service = new DriveSyncService(storage);
  assert.deepEqual(service.getAllWords().map(word => word.id), ['english', 'untagged']);
  const preserved = service.getWords()[0];
  assert.equal(preserved.box, 4);
  assert.equal(preserved.practiceStats.recalled, 4);
  assert.equal(preserved.translation, 'зберігати');
  assert.equal(preserved.translationLanguage, 'uk');
  assert.equal(service.getWords()[1].translation, '');
  assert.equal(service.getWords()[1].translationLanguage, 'en');
  assert.deepEqual(service.getTombstones().map(item => item.id).sort(), ['removed-course-word', 'removed-language-word']);
  assert.equal(service.getTombstones().find(item => item.id === 'removed-course-word').senseId, 'foreign-sense');
  assert.ok(service.getTombstones().every(item => item.monthYear === 'July 2026' && Number.isFinite(Date.parse(item.deletedAt))));
  const reopened = new DriveSyncService(storage);
  assert.equal(reopened.getTombstones().length, 2);
  assert.throws(() => reopened.addWord({ word: 'foreign', definition: 'Meaning.', courseId: 'removed-course' }), /valid meaning/);
  assert.throws(() => reopened.addWord({ word: 'foreign', definition: 'Meaning.', languageCode: 'xx' }), /valid meaning/);
});

test('Drive restore rejects unsupported course and language records rather than relabeling them English', async () => {
  const drive = new MockDrive();
  const original = new DriveSyncService(new MemoryStorage(), drive.fetch);
  const english = original.addWord({ word: 'restore', definition: 'To bring back.', translation: 'відновлювати' }, 'July 2026 Vocabulary');
  authorize(original);
  await original.syncGoogleDrive();
  const legacyMonth = drive.payloadByName('Dictionary July 2026.json');
  legacyMonth.words.push(
    { ...english, id: 'unsupported-course', word: 'foreign-one', courseId: 'removed-course' },
    { ...english, id: 'unsupported-language', word: 'foreign-two', languageCode: 'xx' }
  );
  const legacySettings = drive.payloadByName('KeepVocab Settings.json').settings;
  legacySettings.activeCourseId = 'removed-course';
  legacySettings.translationLanguage = 'removed-language';
  legacySettings.courseProfiles['removed-course'] = { dailyGoal: 99 };
  const restored = new DriveSyncService(new MemoryStorage(), drive.fetch);
  authorize(restored);
  await restored.syncGoogleDrive();
  assert.deepEqual(restored.getAllWords().map(word => word.id), [english.id]);
  assert.equal(restored.getWords()[0].translation, 'відновлювати');
  assert.equal(restored.getActiveCourseId(), 'english');
  assert.equal(restored.getSettings().translationLanguage, 'en');
  assert.deepEqual(Object.keys(restored.getSettings().courseProfiles), ['english']);
  assert.deepEqual(restored.getTombstones().map(item => item.id).sort(), ['unsupported-course', 'unsupported-language']);
  const cleaned = drive.payloadByName('Dictionary July 2026.json');
  assert.deepEqual(cleaned.words.map(word => word.id), [english.id]);
  assert.deepEqual(cleaned.tombstones.map(item => item.id).sort(), ['unsupported-course', 'unsupported-language']);
  await restored.syncGoogleDrive();
  assert.deepEqual(restored.getAllWords().map(word => word.id), [english.id]);
});

test('English default and optional Ukrainian settings both roundtrip through backup and reinstall', async () => {
  const drive = new MockDrive();
  const storage = new MemoryStorage();
  const original = new DriveSyncService(storage, drive.fetch);
  assert.equal(original.getSettings().translationLanguage, 'en');
  assert.equal(getTranslationLanguage(storage), 'en');
  assert.equal(getTranslationName(storage), 'English');
  assert.equal(isUkrainianTranslationEnabled(storage), false);
  const word = original.addWord({ word: 'keep', definition: 'To retain.', translation: 'зберігати', translationLanguage: 'uk' }, 'July 2026 Vocabulary');
  const edited = original.updateWord(word.id, { translation: 'тримати' });
  assert.equal(edited.translationLanguage, 'uk');
  const plain = original.addWord({ word: 'plain', definition: 'Easy to understand.', translation: 'Easy to understand.', translationLanguage: 'en' }, 'July 2026 Vocabulary');
  assert.equal(original.updateWord(plain.id, { definition: 'Clearly understood.' }).translationLanguage, 'en');
  authorize(original);
  for (const language of ['uk', 'en']) {
    original.updateSettings({ translationLanguage: language, dailyGoal: 25 });
    assert.equal(JSON.parse(storage.getItem('keepvocab_settings')).translationLanguage, language);
    assert.equal(getTranslationLanguage(storage), language);
    assert.equal(getTranslationName(storage), language === 'uk' ? 'Ukrainian' : 'English');
    assert.equal(isUkrainianTranslationEnabled(storage), language === 'uk');
    await original.syncGoogleDrive();
    assert.equal(drive.payloadByName('KeepVocab Settings.json').settings.translationLanguage, language);
    const restoredStorage = new MemoryStorage();
    const restored = new DriveSyncService(restoredStorage, drive.fetch);
    authorize(restored);
    await restored.syncGoogleDrive();
    assert.equal(restored.getSettings().translationLanguage, language);
    assert.equal(getTranslationLanguage(restoredStorage), language);
    assert.equal(restored.getSettings().dailyGoal, 25);
    const translated = restored.getWords().find(item => item.id === word.id);
    assert.equal(translated.translation, 'тримати');
    assert.equal(translated.translationLanguage, 'uk');
    const english = restored.getWords().find(item => item.id === plain.id);
    assert.equal(english.translation, 'Easy to understand.');
    assert.equal(english.translationLanguage, 'en');
  }
});

test('unrelated word edits preserve explicit Ukrainian markers for translations without Cyrillic', () => {
  const service = new DriveSyncService(new MemoryStorage());
  const word = service.addWord({ word: 'wifi', definition: 'Wireless internet access.', translation: 'Wi-Fi', translationLanguage: 'uk' });
  const edited = service.updateWord(word.id, { example: 'The hotel has wifi.' });
  assert.equal(edited.translation, 'Wi-Fi');
  assert.equal(edited.translationLanguage, 'uk');
  const changed = service.updateWord(word.id, { translation: 'USB', translationLanguage: 'uk' });
  assert.equal(changed.translation, 'USB');
  assert.equal(changed.translationLanguage, 'uk');
  assert.equal(service.updateWord(word.id, { translation: '' }).translationLanguage, 'en');
});

test('invalid or corrupted translation preferences fall back to English', () => {
  const storage = new MemoryStorage();
  for (const saved of [null, 'not JSON', '{}', '{"translationLanguage":"removed-language"}']) {
    if (saved === null) storage.removeItem('keepvocab_settings');
    else storage.setItem('keepvocab_settings', saved);
    assert.equal(getTranslationLanguage(storage), 'en');
    assert.equal(getTranslationName(storage), 'English');
    assert.equal(isUkrainianTranslationEnabled(storage), false);
  }
  const service = new DriveSyncService(storage);
  service.updateSettings({ translationLanguage: 'removed-language' });
  assert.equal(service.getSettings().translationLanguage, 'en');
});

test('English sync keeps all completed speaking lessons and the newest scalar preferences', () => {
  const local = {
    activeCourseId: 'english', updatedAt: '2026-08-25T10:00:00.000Z',
    courseProfiles: { english: {
      updatedAt: '2026-08-25T10:00:00.000Z', dailyGoal: 27,
      exerciseActivityByDevice: { 'device-a': { '2026-08-20': 2 } },
      speakingProgress: { completed: ['rent-apartment', 'support-friend'], level: 'B1', weeklyGoal: 3,
        lastLessonId: 'support-friend', lastCompletedAt: '2026-08-25T09:00:00.000Z' }
    } }
  };
  const remote = {
    activeCourseId: 'removed-course', updatedAt: '2026-08-26T10:00:00.000Z', dailyGoal: 99,
    courseProfiles: {
      english: {
        updatedAt: '2026-08-26T10:00:00.000Z', dailyGoal: 25,
        exerciseActivityByDevice: { 'device-a': { '2026-08-20': 1 }, 'device-b': { '2026-08-20': 3 } },
        speakingProgress: { completed: ['rent-apartment', 'present-idea'], level: 'B2', weeklyGoal: 5,
          lastLessonId: 'present-idea', lastCompletedAt: '2026-08-26T09:00:00.000Z' }
      },
      'removed-course': { reviewActivity: { '2026-08-20': 50 } }
    }
  };
  const before = structuredClone({ local, remote });
  const merged = mergeDriveSettings(local, remote);
  assert.equal(merged.dailyGoal, 25);
  assert.deepEqual(merged.speakingProgress.completed, ['rent-apartment', 'present-idea', 'support-friend']);
  assert.equal(merged.speakingProgress.level, 'B2');
  assert.equal(merged.speakingProgress.weeklyGoal, 5);
  assert.equal(merged.speakingProgress.lastLessonId, 'present-idea');
  assert.equal(merged.speakingProgress.lastCompletedAt, '2026-08-26T09:00:00.000Z');
  assert.deepEqual(merged.reviewActivity, { '2026-08-20': 5 });
  assert.deepEqual(merged.exerciseActivityByDevice, { 'device-a': { '2026-08-20': 2 }, 'device-b': { '2026-08-20': 3 } });
  assert.equal(merged.translationLanguage, 'en');
  assert.deepEqual(Object.keys(merged.courseProfiles), ['english']);
  assert.deepEqual(mergeDriveSettings(merged, remote).speakingProgress, merged.speakingProgress);
  assert.deepEqual(mergeDriveSettings(remote, local).speakingProgress, merged.speakingProgress);
  assert.deepEqual({ local, remote }, before);
});

test('speaking snapshots use their own timestamps despite unrelated later settings changes', () => {
  const local = { updatedAt: '2026-08-27T10:00:00.000Z', courseProfiles: { english: {
    updatedAt: '2026-08-27T10:00:00.000Z',
    speakingProgress: { updatedAt: '2026-08-24T10:00:00.000Z', completed: ['rent-apartment'],
      level: 'B1', lastLessonId: 'rent-apartment', lastCompletedAt: '2026-08-24T09:00:00.000Z' }
  } } };
  const remote = { updatedAt: '2026-08-26T10:00:00.000Z', courseProfiles: { english: {
    updatedAt: '2026-08-26T10:00:00.000Z',
    speakingProgress: { updatedAt: '2026-08-26T10:00:00.000Z', completed: ['present-idea'],
      level: 'B2', lastLessonId: 'present-idea', lastCompletedAt: '2026-08-26T09:00:00.000Z' }
  } } };
  const merged = mergeDriveSettings(local, remote).speakingProgress;
  assert.equal(merged.level, 'B2');
  assert.equal(merged.lastLessonId, 'present-idea');
  assert.equal(merged.updatedAt, '2026-08-26T10:00:00.000Z');
  assert.deepEqual(merged.completed, ['present-idea', 'rent-apartment']);
  assert.equal(merged.lastCompletedAt, '2026-08-26T09:00:00.000Z');
});

test('phrase retention merges actual practice timestamps and cumulative evidence without duplicate sync counts', () => {
  const local = { courseProfiles: { english: { updatedAt: '2026-08-27T10:00:00.000Z', speakingProgress: {
    completed: ['rent-apartment'],
    phraseProgress: {
      shared: { exposures: 5, successes: 4, streak: 3, lastPracticedAt: '2026-08-25T10:00:00.000Z', nextReviewAt: '2026-09-01T10:00:00.000Z' },
      localOnly: { exposures: 1, successes: 1, streak: 1, lastPracticedAt: '2026-08-23T10:00:00.000Z', nextReviewAt: '2026-08-24T10:00:00.000Z' }
    }
  } } } };
  const remote = { courseProfiles: { english: { updatedAt: '2026-08-26T10:00:00.000Z', speakingProgress: {
    completed: ['present-idea'],
    phraseProgress: {
      shared: { exposures: 3, successes: 2, streak: 0, lastPracticedAt: '2026-08-26T10:00:00.000Z', nextReviewAt: '2026-08-27T10:00:00.000Z' },
      remoteOnly: { exposures: 2, successes: 2, streak: 2, lastPracticedAt: '2026-08-22T10:00:00.000Z', nextReviewAt: '2026-08-25T10:00:00.000Z' }
    }
  } } } };
  const merged = mergeDriveSettings(local, remote);
  const phrases = merged.speakingProgress.phraseProgress;
  assert.deepEqual(Object.keys(phrases).sort(), ['localOnly', 'remoteOnly', 'shared']);
  assert.equal(phrases.shared.exposures, 5);
  assert.equal(phrases.shared.successes, 4);
  assert.equal(phrases.shared.streak, 0);
  assert.equal(phrases.shared.lastPracticedAt, '2026-08-26T10:00:00.000Z');
  assert.equal(phrases.shared.nextReviewAt, '2026-08-27T10:00:00.000Z');
  assert.deepEqual(phrases.localOnly, local.courseProfiles.english.speakingProgress.phraseProgress.localOnly);
  assert.deepEqual(phrases.remoteOnly, remote.courseProfiles.english.speakingProgress.phraseProgress.remoteOnly);
  assert.deepEqual(mergeDriveSettings(merged, remote).speakingProgress, merged.speakingProgress);
  assert.deepEqual(mergeDriveSettings(remote, local).speakingProgress, merged.speakingProgress);
});

test('Drive combines exercise activity from multiple devices without double counting repeated syncs', async () => {
  const drive = new MockDrive();
  const day = new Date(2026, 7, 21, 12);
  const firstStorage = new MemoryStorage();
  firstStorage.setItem('keepvocab_device_id', 'device-a');
  const first = new DriveSyncService(firstStorage, drive.fetch);
  first.recordReview(day);
  first.recordReview(day);
  authorize(first);
  await first.syncGoogleDrive();

  const secondStorage = new MemoryStorage();
  secondStorage.setItem('keepvocab_device_id', 'device-b');
  const second = new DriveSyncService(secondStorage, drive.fetch);
  authorize(second);
  await second.syncGoogleDrive();
  second.recordReview(day);
  second.recordReview(day);
  second.recordReview(day);
  await second.syncGoogleDrive();
  await first.syncGoogleDrive();
  await second.syncGoogleDrive();

  for (const service of [first, second]) {
    const settings = service.getSettings();
    assert.equal(settings.reviewActivity['2026-08-21'], 5);
    assert.equal(settings.lastReviewDate, '2026-08-21');
    assert.equal(settings.reviewsToday, 0);
    assert.equal(settings.exerciseActivityByDevice['device-a']['2026-08-21'], 2);
    assert.equal(settings.exerciseActivityByDevice['device-b']['2026-08-21'], 3);
  }
  assert.equal(drive.payloadByName('KeepVocab Settings.json').settings.reviewActivity['2026-08-21'], 5);
});

test('legacy review activity migrates into the mergeable Drive activity format', () => {
  const merged = mergeDriveSettings(
    { reviewActivity: { '2026-08-20': 2 }, updatedAt: '2026-08-20T20:00:00.000Z' },
    { reviewActivity: { '2026-08-20': 3, '2026-08-19': 1 }, updatedAt: '2026-08-20T21:00:00.000Z' }
  );

  assert.deepEqual(merged.exerciseActivityByDevice.legacy, { '2026-08-20': 3, '2026-08-19': 1 });
  assert.deepEqual(merged.reviewActivity, { '2026-08-20': 3, '2026-08-19': 1 });
  assert.equal(merged.dailyStreak, 0);
});

test('Google Drive backs up and restores the centralized Google AI Studio key', async () => {
  const drive = new MockDrive();
  const originalStorage = new MemoryStorage();
  saveGeminiSettings({ apiKey: 'AIza-drive-backed-key-123456789', textModel: 'gemini-3.1-flash-lite' }, originalStorage, { silent: true });
  const original = new DriveSyncService(originalStorage, drive.fetch);
  original.saveWords([], { silent: true });
  original.addWord({ word: 'restore', partOfSpeech: 'verb', definition: 'To bring back.' }, 'July 2026 Vocabulary');
  authorize(original);
  await original.syncGoogleDrive();

  const payload = drive.payloadByName('KeepVocab Settings.json');
  assert.equal(payload.googleAiStudio.apiKey, 'AIza-drive-backed-key-123456789');
  assert.equal(payload.googleAiStudio.textModel, 'gemini-3.1-flash-lite');

  const reinstalledStorage = new MemoryStorage();
  const reinstalled = new DriveSyncService(reinstalledStorage, drive.fetch);
  authorize(reinstalled);
  await reinstalled.syncGoogleDrive();
  assert.equal(getGeminiSettings(reinstalledStorage).apiKey, 'AIza-drive-backed-key-123456789');
});

test('Google Drive backs up and restores the Pexels provider and API key', async () => {
  const drive = new MockDrive();
  const originalStorage = new MemoryStorage();
  saveImageProviderSettings({
    provider: 'pexels',
    pexelsApiKey: 'pexels-drive-backed-key-123456789',
    updatedAt: '2026-08-21T10:00:00.000Z'
  }, originalStorage, { silent: true });
  const original = new DriveSyncService(originalStorage, drive.fetch);
  original.saveWords([], { silent: true });
  original.addWord({ word: 'restore', partOfSpeech: 'verb', definition: 'To bring back.' }, 'July 2026 Vocabulary');
  authorize(original);
  await original.syncGoogleDrive();

  const payload = drive.payloadByName('KeepVocab Settings.json');
  assert.equal(payload.imageSearchProvider.provider, 'pexels');
  assert.equal(payload.imageSearchProvider.pexelsApiKey, 'pexels-drive-backed-key-123456789');

  const reinstalledStorage = new MemoryStorage();
  const reinstalled = new DriveSyncService(reinstalledStorage, drive.fetch);
  authorize(reinstalled);
  await reinstalled.syncGoogleDrive();
  assert.equal(getImageProviderSettings(reinstalledStorage).provider, 'pexels');
  assert.equal(getImageProviderSettings(reinstalledStorage).pexelsApiKey, 'pexels-drive-backed-key-123456789');
});

test('an older Drive backup without AI settings does not erase a local key', async () => {
  const drive = new MockDrive();
  const older = new DriveSyncService(new MemoryStorage(), drive.fetch);
  older.saveWords([], { silent: true });
  older.addWord({ word: 'legacy', partOfSpeech: 'noun', definition: 'Something inherited from the past.' }, 'July 2026 Vocabulary');
  authorize(older);
  await older.syncGoogleDrive();
  assert.equal(drive.payloadByName('KeepVocab Settings.json').googleAiStudio, undefined);

  const currentStorage = new MemoryStorage();
  saveGeminiSettings({ apiKey: 'AIza-local-key-survives-123456789' }, currentStorage, { silent: true });
  const current = new DriveSyncService(currentStorage, drive.fetch);
  authorize(current);
  await current.syncGoogleDrive();
  assert.equal(getGeminiSettings(currentStorage).apiKey, 'AIza-local-key-survives-123456789');
  assert.equal(drive.payloadByName('KeepVocab Settings.json').googleAiStudio.apiKey, 'AIza-local-key-survives-123456789');
});

test('deletion tombstones prevent a removed word from returning after reinstall', async () => {
  const drive = new MockDrive();
  const first = new DriveSyncService(new MemoryStorage(), drive.fetch);
  first.saveWords([], { silent: true });
  const keep = first.addWord({ word: 'retain', partOfSpeech: 'verb', definition: 'To keep.' }, 'July 2026 Vocabulary');
  const remove = first.addWord({ word: 'discard', partOfSpeech: 'verb', definition: 'To throw away.' }, 'July 2026 Vocabulary');
  authorize(first);
  await first.syncGoogleDrive();
  assert.equal(first.deleteWord(remove.id), true);
  await first.syncGoogleDrive();

  const payload = drive.payloadByName('Dictionary July 2026.json');
  assert.equal(payload.words.some(word => word.id === remove.id), false);
  assert.equal(payload.tombstones.some(item => item.id === remove.id), true);

  const reinstalled = new DriveSyncService(new MemoryStorage(), drive.fetch);
  authorize(reinstalled);
  await reinstalled.syncGoogleDrive();
  assert.deepEqual(reinstalled.getWords().map(word => word.id), [keep.id]);
});

test('newer local edits update the same Drive record instead of duplicating a sense', async () => {
  const drive = new MockDrive();
  const service = new DriveSyncService(new MemoryStorage(), drive.fetch);
  service.saveWords([], { silent: true });
  const word = service.addWord({ word: 'yield', partOfSpeech: 'verb', definition: 'Old intended definition.' }, 'July 2026 Vocabulary');
  authorize(service);
  await service.syncGoogleDrive();
  const beforeId = drive.payloadByName('Dictionary July 2026.json').words[0].id;

  await new Promise(resolve => setTimeout(resolve, 5));
  service.updateWord(word.id, { definition: 'To furnish, afford, or produce.' });
  const result = await service.syncGoogleDrive();
  const payload = drive.payloadByName('Dictionary July 2026.json');

  assert.equal(result.updatedFiles, 1);
  assert.equal(payload.words.length, 1);
  assert.equal(payload.words[0].id, beforeId);
  assert.equal(payload.words[0].definition, 'To furnish, afford, or produce.');
});

test('Drive API errors are explicit and never reported as successful backup', async () => {
  const service = new DriveSyncService(new MemoryStorage(), async () => response({ error: { message: 'Permission missing' } }, 403));
  authorize(service);
  await assert.rejects(() => service.syncGoogleDrive(), /Drive access was denied.*Permission missing/);
});

test('a remembered Drive connection silently renews on a later app launch', async () => {
  const drive = new MockDrive();
  const storage = new MemoryStorage();
  const service = new DriveSyncService(storage, async (url, options) => {
    if (String(url).includes('/oauth2/v3/userinfo')) return response({ email: 'learner@example.com' });
    return drive.fetch(url, options);
  });
  service.setDriveStatus({ isConnected: false, remembered: true, email: 'learner@example.com' });
  let requestedPrompt = null;
  let requestedScope = null;
  let requestedClientId = null;
  const previousGoogle = globalThis.google;
  globalThis.google = { accounts: { oauth2: {
    initTokenClient(config) {
      requestedScope = config.scope;
      requestedClientId = config.client_id;
      return { requestAccessToken({ prompt }) { requestedPrompt = prompt; config.callback({ access_token: 'renewed-token', expires_in: 3600 }); } };
    },
    revoke(_token, callback) { callback(); }
  } } };

  try {
    const result = await service.resumeGoogleDrive();
    assert.equal(requestedPrompt, '');
    assert.equal(requestedClientId, GOOGLE_WEB_CLIENT_ID);
    assert.match(requestedScope, /auth\/drive\.file/);
    assert.equal(result.folderName, 'KeepVocab Dictionary Backup');
    assert.equal(service.getDriveStatus().isConnected, true);
    assert.equal(service.getDriveStatus().remembered, true);
    service.disconnectGoogleDrive();
    assert.equal(service.getDriveStatus().remembered, false);
  } finally {
    globalThis.google = previousGoogle;
  }
});

test('the Android app authorizes Drive through the native account chooser without requesting a web client ID', async () => {
  const drive = new MockDrive();
  const storage = new MemoryStorage();
  const service = new DriveSyncService(storage, async (url, options) => {
    if (String(url).includes('/oauth2/v3/userinfo')) return response({ email: 'android@example.com' });
    return drive.fetch(url, options);
  });
  const previousCapacitor = globalThis.Capacitor;
  const calls = [];
  const plugin = {
    async authorize(options) {
      calls.push(options);
      return { accessToken: 'native-android-token', expiresIn: 3600 };
    },
    async revoke() {}
  };
  globalThis.Capacitor = {
    getPlatform: () => 'android',
    Plugins: { DriveAuth: plugin }
  };

  try {
    assert.equal(usesNativeGoogleAuthorization(), true);
    const result = await service.connectGoogleDrive();
    assert.deepEqual(calls, [{ interactive: true }]);
    assert.equal(result.folderName, 'KeepVocab Dictionary Backup');
    assert.equal(service.getGoogleClientId(), GOOGLE_WEB_CLIENT_ID);
    assert.equal(service.getDriveStatus().isConnected, true);
    assert.equal(service.accessToken, 'native-android-token');
  } finally {
    globalThis.Capacitor = previousCapacitor;
  }
});

test('a valid Drive token survives a page reload and remains connected', () => {
  const storage = new MemoryStorage();
  const firstPage = new DriveSyncService(storage, async () => { throw new Error('unused'); });
  firstPage.setDriveStatus({ isConnected: true, remembered: true, email: 'learner@example.com' });
  firstPage.acceptGoogleToken({ access_token: 'saved-short-lived-token', expires_in: 3600 });

  const reloadedPage = new DriveSyncService(storage, async () => { throw new Error('unused'); });

  assert.equal(reloadedPage.accessToken, 'saved-short-lived-token');
  assert.ok(reloadedPage.tokenExpiresAt > Date.now());
  assert.equal(reloadedPage.getDriveStatus().isConnected, true);
  assert.equal(reloadedPage.getDriveStatus().email, 'learner@example.com');
});

test('an expired Drive token is silently renewed before the next API request', async () => {
  const storage = new MemoryStorage();
  const authorizationHeaders = [];
  const service = new DriveSyncService(storage, async (_url, options) => {
    authorizationHeaders.push(options.headers.Authorization);
    return response({ ok: true });
  });
  service.setDriveStatus({ isConnected: true, remembered: true, email: 'learner@example.com' });
  service.accessToken = 'expired-token';
  service.tokenExpiresAt = Date.now() - 1;
  const previousCapacitor = globalThis.Capacitor;
  const calls = [];
  globalThis.Capacitor = {
    getPlatform: () => 'android',
    Plugins: { DriveAuth: {
      async authorize(options) {
        calls.push(options);
        return { accessToken: 'renewed-token', expiresIn: 3600 };
      }
    } }
  };

  try {
    await service.authorizedFetch('https://www.googleapis.com/drive/v3/files');
    assert.deepEqual(calls, [{ interactive: false }]);
    assert.deepEqual(authorizationHeaders, ['Bearer renewed-token']);
    assert.equal(service.getDriveStatus().isConnected, true);
    assert.equal(service.getDriveStatus().lastError, null);
  } finally {
    globalThis.Capacitor = previousCapacitor;
  }
});

test('a rejected Drive token is silently renewed and the request is retried once', async () => {
  const storage = new MemoryStorage();
  const authorizationHeaders = [];
  const service = new DriveSyncService(storage, async (_url, options) => {
    authorizationHeaders.push(options.headers.Authorization);
    return authorizationHeaders.length === 1
      ? response({ error: { message: 'Invalid Credentials' } }, 401)
      : response({ files: [] });
  });
  service.setDriveStatus({ isConnected: true, remembered: true, email: 'learner@example.com' });
  service.accessToken = 'rejected-token';
  service.tokenExpiresAt = Date.now() + 60_000;
  const previousCapacitor = globalThis.Capacitor;
  globalThis.Capacitor = {
    getPlatform: () => 'android',
    Plugins: { DriveAuth: {
      async authorize() { return { accessToken: 'replacement-token', expiresIn: 3600 }; }
    } }
  };

  try {
    const result = await service.authorizedFetch('https://www.googleapis.com/drive/v3/files');
    assert.equal(result.status, 200);
    assert.deepEqual(authorizationHeaders, ['Bearer rejected-token', 'Bearer replacement-token']);
    assert.equal(service.getDriveStatus().isConnected, true);
  } finally {
    globalThis.Capacitor = previousCapacitor;
  }
});

test('expired saved Drive tokens are discarded and require renewal', () => {
  const storage = new MemoryStorage();
  storage.setItem('keepvocab_drive_auth', JSON.stringify({ isConnected: true, remembered: true, email: 'learner@example.com' }));
  storage.setItem('keepvocab_drive_token', JSON.stringify({ accessToken: 'expired-token', expiresAt: Date.now() - 1 }));

  const service = new DriveSyncService(storage, async () => { throw new Error('unused'); });

  assert.equal(service.getDriveStatus().isConnected, false);
  assert.equal(service.getDriveStatus().remembered, true);
  assert.equal(storage.getItem('keepvocab_drive_token'), null);
});

test('legacy session-expired banner state is cleared before silent renewal', () => {
  const storage = new MemoryStorage();
  storage.setItem('keepvocab_drive_auth', JSON.stringify({
    isConnected: false,
    remembered: true,
    email: 'learner@example.com',
    lastError: 'Your Google Drive session expired. Renewing access is required.'
  }));

  const service = new DriveSyncService(storage, async () => { throw new Error('unused'); });

  assert.equal(service.getDriveStatus().remembered, true);
  assert.equal(service.getDriveStatus().lastError, null);
});

test('disconnecting removes the saved Drive token from this device', () => {
  const storage = new MemoryStorage();
  const service = new DriveSyncService(storage, async () => { throw new Error('unused'); });
  service.setDriveStatus({ isConnected: true, remembered: true, email: 'learner@example.com' });
  service.acceptGoogleToken({ access_token: 'saved-token', expires_in: 3600 });

  service.disconnectGoogleDrive(false);

  assert.equal(storage.getItem('keepvocab_drive_token'), null);
  assert.equal(service.getDriveStatus().isConnected, false);
  assert.equal(service.getDriveStatus().remembered, false);
});

test('a successful connection from the previous build migrates to remembered state', () => {
  const storage = new MemoryStorage();
  storage.setItem('keepvocab_drive_auth', JSON.stringify({
    isConnected: true,
    email: 'learner@example.com',
    lastSynced: '2026-07-23T00:00:00.000Z',
    folderId: 'folder-1'
  }));
  const service = new DriveSyncService(storage, async () => { throw new Error('unused'); });
  assert.equal(service.getDriveStatus().remembered, true);
});
