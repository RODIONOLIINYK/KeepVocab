import test from 'node:test';
import assert from 'node:assert/strict';
import { DriveSyncService, MemoryStorage } from '../js/services/driveSync.js';
import { imageSenseFingerprint, imageSceneRecordFor } from '../js/services/imageSearch.js';
import { applyReviewedExplanations } from '../js/components/MeaningExplanation.js';

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return structuredClone(payload); }
  };
}

class MeaningDrive {
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

const sourceDefinition = 'Seeming to be correct or likely to be true.';
const learnerDefinition = 'Believable enough to seem true.';
const example = 'The explanation sounded plausible, so we investigated it further.';
const notebook = 'May 2026 Vocabulary';
const offline = () => { throw new Error('Unexpected network request'); };
const makeService = storage => new DriveSyncService(storage || new MemoryStorage(), offline);

function sceneRecord(word) {
  return { version: 1, generatorVersion: '3', fingerprint: imageSenseFingerprint(word), source: 'gemini',
    scenes: ['person balancing stones beside quiet water'], generatedAt: '2026-05-12T09:00:00.000Z' };
}

function learningWord(overrides = {}) {
  return { id: 'meaning-one', word: 'plausible', partOfSpeech: 'adjective', definition: sourceDefinition, sourceDefinition,
    example, createdAt: '2026-05-01T09:00:00.000Z', lastReviewedAt: '2026-05-10T09:00:00.000Z',
    nextReviewDate: '2026-05-20T09:00:00.000Z', box: 2, mastered: false,
    srs: { version: 3, repetitions: 8, lapses: 2, scheduledDays: 10, stabilityDays: 10, lastRating: 'again' },
    mastery: { recall: 0.4, recognition: 0.6, lastPracticedAt: '2026-05-10T09:00:00.000Z' },
    mistakes: { incorrectAttempts: 2, consecutiveFailures: 2, recentFailures: ['2026-05-09T09:00:00.000Z', '2026-05-10T09:00:00.000Z'], byExercise: { spelling: 2 }, confusions: { other: 1 } },
    practiceStats: { version: 2, attempts: 8, recalled: 6, missed: 2, successfulRecallDays: 3, recallAttempts: 6,
      unaidedRecalled: 5, recognitionCorrect: 1, hintsUsed: 1, selections: 6, consecutiveMisses: 2,
      lastAnswerCorrect: false, lastAnsweredAt: '2026-05-10T09:00:00.000Z', lastMissedAt: '2026-05-10T09:00:00.000Z',
      lastUnaidedRecallAt: '2026-05-08T09:00:00.000Z', lastSelectedAt: '2026-05-10T09:00:00.000Z',
      recentResults: [{ correct: false, unaided: false, recallType: 'free-recall', occurredAt: '2026-05-10T09:00:00.000Z' }],
      byMode: { spelling: { selections: 6, attempts: 5, recalled: 3, missed: 2, lastAnsweredAt: '2026-05-10T09:00:00.000Z' } } },
    productiveSamples: [{ text: 'Her explanation sounded plausible.', correct: true, createdAt: '2026-05-08T09:00:00.000Z', exerciseType: 'use-it' }],
    ...overrides };
}

function duplicatePair(service) {
  const first = learningWord();
  const second = learningWord({ id: 'meaning-two', definition: 'Appearing to be correct or likely to be true.', sourceDefinition: 'Appearing to be correct or likely to be true.',
    box: 4, lastReviewedAt: '2026-05-12T09:00:00.000Z', nextReviewDate: '2026-05-16T09:00:00.000Z',
    srs: { version: 3, repetitions: 3, lapses: 1, scheduledDays: 4, stabilityDays: 4, lastRating: 'good' },
    mastery: { recall: 0.7, recognition: 0.8, lastPracticedAt: '2026-05-12T09:00:00.000Z' },
    lastExerciseResult: { correct: true, producedUnaided: true, recallType: 'free-recall', occurredAt: '2026-05-12T09:00:00.000Z' },
    mistakes: { incorrectAttempts: 1, consecutiveFailures: 0, recentFailures: ['2026-05-11T09:00:00.000Z'], byExercise: { choose: 1 }, confusions: { other: 2 } },
    practiceStats: { version: 2, attempts: 3, recalled: 2, missed: 1, successfulRecallDays: 2, recallAttempts: 3,
      unaidedRecalled: 2, recognitionCorrect: 0, hintsUsed: 0, selections: 3, consecutiveMisses: 0, consecutiveCorrect: 2,
      lastAnswerCorrect: true, lastAnsweredAt: '2026-05-12T09:00:00.000Z', lastCorrectAt: '2026-05-12T09:00:00.000Z',
      lastUnaidedRecallAt: '2026-05-12T09:00:00.000Z', lastSelectedAt: '2026-05-12T09:00:00.000Z',
      recentResults: [{ correct: true, unaided: true, recallType: 'free-recall', occurredAt: '2026-05-12T09:00:00.000Z' }],
      byMode: { spelling: { selections: 3, attempts: 2, recalled: 2, missed: 0, lastAnsweredAt: '2026-05-12T09:00:00.000Z' } } },
    productiveSamples: [{ text: 'We need a plausible reason for the delay.', correct: true, createdAt: '2026-05-12T09:00:00.000Z', exerciseType: 'use-it' }] });
  return service.addWords([first, second], notebook);
}

test('source definitions distinguish senses while learner paraphrases cannot create duplicate identities', () => {
  const service = makeService();
  const saved = service.addWord(learningWord({ definition: learnerDefinition }), notebook);
  assert.equal(saved.sourceDefinition, sourceDefinition);
  assert.throws(() => service.addWord(learningWord({ id: 'another-id', definition: 'A different learner paraphrase of the same meaning.' }), notebook), /meaning.*already/i);
  const banks = service.addWords([
    { word: 'bank', partOfSpeech: 'noun', definition: 'A place used by people.', sourceDefinition: 'A financial institution that accepts deposits and makes loans.' },
    { word: 'bank', partOfSpeech: 'noun', definition: 'A place used by people.', sourceDefinition: 'Land beside a river or stream.' }
  ], notebook);
  assert.notEqual(banks[0].id, banks[1].id);
  assert.notEqual(banks[0].senseId, banks[1].senseId);
});

test('reviewed learner explanations update metadata without replacing identity, SRS, counters, samples or image cache', () => {
  const service = makeService();
  const original = learningWord(); original.imageScenes = sceneRecord(original);
  const saved = service.addWord(original, notebook);
  const candidate = { ...saved, definition: learnerDefinition, example, usageNote: 'Use it for an explanation that seems believable.', explanationSource: 'Reviewed Gemini suggestion', explanationVersion: 1 };
  assert.deepEqual(applyReviewedExplanations(service, [{ original: saved, candidate, selected: true }]), { applied: 1, skipped: 0 });
  const updated = service.getWords().find(word => word.id === saved.id);
  assert.equal(updated.definition, learnerDefinition);
  assert.equal(updated.sourceDefinition, sourceDefinition);
  for (const key of ['id', 'senseId', 'srs', 'practiceStats', 'mastery', 'mistakes', 'productiveSamples', 'lastReviewedAt', 'nextReviewDate', 'box', 'imageScenes']) assert.deepEqual(updated[key], saved[key], key);
  const protectedUpdate = service.updateWord(saved.id, { id: 'replacement', practiceStats: { attempts: 0 }, srs: { repetitions: 0 }, definition: learnerDefinition, sourceDefinition });
  assert.equal(protectedUpdate.id, saved.id);
  assert.deepEqual(protectedUpdate.practiceStats, saved.practiceStats);
  assert.deepEqual(protectedUpdate.srs, saved.srs);
});

test('typed image scene records survive updates and restart while malformed cache shapes are discarded', () => {
  const storage = new MemoryStorage(); const service = makeService(storage);
  const saved = service.addWord(learningWord(), notebook);
  const record = sceneRecord(saved);
  const updated = service.updateWord(saved.id, { imageScenes: { ...record, ignored: 'not persisted' } });
  assert.deepEqual(updated.imageScenes, record);
  assert.deepEqual(imageSceneRecordFor(updated, { storage }), record);
  assert.deepEqual(makeService(storage).getWords()[0].imageScenes, record);
  for (const imageScenes of ['invalid', [], { ...record, version: 99 }, { ...record, generatorVersion: '' }, { ...record, source: 'untrusted' }, { ...record, scenes: [null, 42, ''] }]) {
    assert.equal(service.updateWord(saved.id, { imageScenes }).imageScenes, undefined);
    assert.equal(makeService(storage).getWords()[0].imageScenes, undefined);
  }
  const mismatched = service.updateWord(saved.id, { imageScenes: { ...record, fingerprint: 'another sense' } });
  assert.equal(imageSceneRecordFor(mismatched, { storage }), null);
});

test('semantic edits clear image scenes and feedback while learner wording with the same source keeps both', () => {
  const service = makeService(); const original = learningWord();
  original.imageScenes = sceneRecord(original);
  original.imageFeedback = { goodUrls: ['https://example.test/good.jpg'], rejectedUrls: ['https://example.test/wrong.jpg'], preferredConcepts: ['person balancing stones'], senseFingerprint: imageSenseFingerprint(original) };
  original.imageRejectedUrls = ['https://example.test/legacy.jpg'];
  original.imageUrl = 'https://example.test/current.jpg';
  const saved = service.addWord(original, notebook);
  const explained = service.updateWord(saved.id, { definition: learnerDefinition, sourceDefinition });
  assert.deepEqual(explained.imageScenes, saved.imageScenes);
  assert.deepEqual(explained.imageFeedback, saved.imageFeedback);
  const edited = service.updateWord(saved.id, { definition: 'Certain to be false rather than believable.' });
  assert.equal(edited.sourceDefinition, edited.definition);
  for (const key of ['imageScenes', 'imageFeedback', 'imageRejectedUrls']) assert.equal(edited[key], undefined, key);
  assert.equal(edited.imageUrl, '');
  assert.deepEqual(edited.practiceStats, saved.practiceStats);
});

test('Drive backup restores typed scenes, source identities and learning history on a fresh install', async () => {
  const drive = new MeaningDrive(); const service = new DriveSyncService(new MemoryStorage(), drive.fetch);
  const original = learningWord({ definition: learnerDefinition }); original.imageScenes = sceneRecord(original);
  const saved = service.addWord(original, notebook); authorize(service);
  await service.syncGoogleDrive();
  const payload = drive.payloadByName('Dictionary May 2026.json');
  assert.deepEqual(payload.words[0].imageScenes, saved.imageScenes);
  assert.equal(typeof payload.words[0].imageScenes, 'object');
  const restored = new DriveSyncService(new MemoryStorage(), drive.fetch); authorize(restored);
  await restored.syncGoogleDrive();
  const word = restored.getWords().find(item => item.id === saved.id);
  for (const key of ['id', 'senseId', 'sourceDefinition', 'definition', 'imageScenes', 'practiceStats', 'srs', 'productiveSamples']) assert.deepEqual(word[key], saved[key], key);
  assert.deepEqual(imageSceneRecordFor(word, { storage: null }), saved.imageScenes);
});

test('merging duplicate meanings preserves counters and history with a conservative schedule and latest recall', () => {
  const service = makeService(); const records = duplicatePair(service);
  const merged = service.mergeWordMeanings(records.map(word => word.id));
  assert.equal(merged.id, 'meaning-one');
  assert.equal(service.getWords().length, 1);
  assert.equal(merged.practiceStats.attempts, 11);
  assert.equal(merged.practiceStats.recalled, 8);
  assert.equal(merged.practiceStats.missed, 3);
  assert.equal(merged.practiceStats.successfulRecallDays, 3);
  assert.equal(merged.practiceStats.lastUnaidedRecallAt, '2026-05-12T09:00:00.000Z');
  assert.equal(merged.practiceStats.lastAnsweredAt, '2026-05-12T09:00:00.000Z');
  assert.equal(merged.practiceStats.lastAnswerCorrect, true);
  assert.equal(merged.practiceStats.consecutiveMisses, 0);
  assert.equal(merged.practiceStats.byMode.spelling.attempts, 7);
  assert.equal(merged.practiceStats.byMode.spelling.selections, 9);
  assert.equal(merged.practiceStats.recentResults.length, 2);
  assert.equal(merged.srs.lastRating, 'good');
  assert.equal(merged.nextReviewDate, '2026-05-16T09:00:00.000Z');
  assert.equal(merged.box, 2);
  assert.equal(merged.mistakes.incorrectAttempts, 3);
  assert.equal(merged.mistakes.consecutiveFailures, 0);
  assert.deepEqual(merged.mistakes.byExercise, { spelling: 2, choose: 1 });
  assert.deepEqual(merged.mistakes.confusions, { other: 3 });
  assert.equal(merged.productiveSamples.length, 2);
  assert.deepEqual(new Set(merged.sourceDefinitions), new Set(records.map(word => word.sourceDefinition)));
  assert.deepEqual(service.getTombstones().map(item => item.id), ['meaning-two']);
});

test('merging never combines finance and river senses, different months, or different grammatical families', () => {
  const service = makeService();
  const finance = service.addWord({ word: 'bank', partOfSpeech: 'noun', definition: 'A financial institution that accepts deposits.' }, notebook);
  const river = service.addWord({ word: 'bank', partOfSpeech: 'noun', definition: 'Land beside a river or stream.' }, notebook);
  assert.throws(() => service.mergeWordMeanings([finance.id, river.id]), /near-identical/);
  const otherMonth = service.addWord({ ...finance, id: 'other-month', monthYear: 'June 2026' }, 'June 2026 Vocabulary');
  assert.throws(() => service.mergeWordMeanings([finance.id, otherMonth.id]), /this month/);
  const verb = service.addWord({ word: 'bank', partOfSpeech: 'verb', definition: finance.definition }, notebook);
  assert.throws(() => service.mergeWordMeanings([finance.id, verb.id]), /near-identical/);
  assert.equal(service.getWords().length, 4);
  assert.deepEqual(service.getTombstones(), []);
});

test('merge tombstones survive stale device sync and stale duplicate remote files without resurrecting removed meanings', async () => {
  const drive = new MeaningDrive(); const first = new DriveSyncService(new MemoryStorage(), drive.fetch);
  const records = duplicatePair(first); authorize(first); await first.syncGoogleDrive();
  const stalePayload = structuredClone(drive.payloadByName('Dictionary May 2026.json'));
  const staleDevice = new DriveSyncService(new MemoryStorage(), drive.fetch); authorize(staleDevice); await staleDevice.syncGoogleDrive();
  const merged = first.mergeWordMeanings(records.map(word => word.id));
  await first.syncGoogleDrive();
  await staleDevice.syncGoogleDrive();
  assert.deepEqual(staleDevice.getWords().map(word => word.id), [merged.id]);
  assert.equal(staleDevice.getWords()[0].practiceStats.attempts, 11);
  const primary = [...drive.files.values()].find(file => file.metadata.name === 'Dictionary May 2026.json');
  drive.files.set('stale-month-copy', { metadata: { ...primary.metadata, id: 'stale-month-copy', modifiedTime: '2026-05-01T00:00:00.000Z' }, payload: stalePayload });
  const reinstalled = new DriveSyncService(new MemoryStorage(), drive.fetch); authorize(reinstalled); await reinstalled.syncGoogleDrive();
  assert.deepEqual(reinstalled.getWords().map(word => word.id), [merged.id]);
  assert.equal(reinstalled.getWords()[0].practiceStats.attempts, 11);
  assert.ok(reinstalled.getTombstones().some(item => item.id === 'meaning-two'));
});
