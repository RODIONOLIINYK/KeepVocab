import test from 'node:test';
import assert from 'node:assert/strict';
import { DriveSyncService, MemoryStorage } from '../js/services/driveSync.js';
import { recordExerciseResult } from '../js/services/exerciseResult.js';
import { replayWordFsrsHistory } from '../js/services/srsEngine.js';
import { sourceDefinitionFingerprint } from '../js/services/learningDefinitions.js';
import { reviewHistorySources, indexReviewEvents, reviewEventsForWord } from '../js/services/reviewHistorySources.js';
import { createEmptyCard, fsrsScheduler, readFsrsConfig, serializeFsrsCard } from '../js/services/fsrsConfig.js';

const monthYear = 'November 2026';
const notebook = `${monthYear} Vocabulary`;
const definitions = ['Seeming to be correct or likely to be true.', '(formal) Seeming to be correct or likely to be true.', '(literary) Seeming to be correct or likely to be true.'];
const service = () => new DriveSyncService(new MemoryStorage(), () => { throw new Error('Unexpected HTTP request'); });

test.beforeEach(context => {
  // All explicit conflict timestamps below follow the original records. Wall
  // clock time must not turn those intended later edits into stale snapshots.
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-12T11:00:00.000Z') });
});

function addMeanings(persistence, count = 2) {
  return persistence.addWords(definitions.slice(0, count).map((definition, index) => ({
    id: `meaning-${index}`, word: 'plausible', partOfSpeech: 'adjective', definition,
    createdAt: '2026-11-01T00:00:00.000Z', nextReviewDate: '2026-11-01T00:00:00.000Z'
  })), notebook);
}

function answer(persistence, wordId, day, id = `review-${wordId}-${day}`) {
  recordExerciseResult({ id, wordId, exerciseType: 'typed-recall', correct: true, producedUnaided: true,
    recallType: 'free-recall', occurredAt: `2026-11-${String(day).padStart(2, '0')}T10:00:00.000Z` }, persistence);
}

function replay(word, events) {
  return replayWordFsrsHistory(word, reviewEventsForWord(word, indexReviewEvents(events)), {},
    { sourceFingerprint: sourceDefinitionFingerprint(word) });
}

function expectedRecall(events) {
  const ordered = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  const scheduler = fsrsScheduler(readFsrsConfig({}), 'recall');
  let card = createEmptyCard(new Date(ordered[0].occurredAt));
  for (const event of ordered) card = scheduler.next(card, new Date(event.occurredAt), event.grade).card;
  return serializeFsrsCard(card);
}

// Exercise synchronization itself while keeping the Drive transport out of
// these tests; token renewal and HTTP pagination have separate regression tests.
class Backup {
  files = new Map();
  nextId = 0;
  attach(persistence) {
    persistence.findOrCreateBackupFolder = async () => ({ id: 'folder' });
    persistence.listBackupFiles = async () => [...this.files.values()].map(file => structuredClone(file.metadata));
    persistence.downloadJsonFile = async id => structuredClone(this.files.get(id).payload);
    persistence.createJsonFile = async (folder, name, kind, payload, monthYear = '', extra = {}) => {
      const metadata = { id: `file-${this.nextId++}`, name, modifiedTime: new Date().toISOString(), appProperties: { kind, monthYear, ...extra } };
      this.files.set(metadata.id, { metadata, payload: structuredClone(payload) });
      return metadata;
    };
    persistence.updateJsonFile = async (id, payload) => {
      const file = this.files.get(id);
      file.payload = structuredClone(payload);file.metadata.modifiedTime = new Date().toISOString();
      return file.metadata;
    };
    return persistence;
  }
}

test('merged meanings replay exact source pairs chronologically, including a new answer before sync', async () => {
  const persistence = service();const originals = addMeanings(persistence);
  answer(persistence, originals[0].id, 1);answer(persistence, originals[1].id, 2);
  const merged = persistence.mergeWordMeanings(originals.map(word => word.id));
  assert.deepEqual(reviewHistorySources(merged), originals.map(word => ({ wordId: word.id, senseId: sourceDefinitionFingerprint(word) })));
  answer(persistence, merged.id, 3);
  const events = await persistence.getReviewEvents();
  const beforeReplay = structuredClone(events);
  const wrongSense = { ...events[1], id: 'unrelated-sense', senseId: sourceDefinitionFingerprint({ ...originals[1], sourceDefinition: 'A different meaning.' }) };
  const current = persistence.getWords()[0];
  const result = replay(current, [wrongSense, ...events.toReversed(), events[0]]);
  assert.equal(result.srs.cards.recall.reps, 3);
  assert.deepEqual(result.srs.cards.recall, expectedRecall(events));
  assert.deepEqual(events, beforeReplay, 'immutable observations keep original IDs and fingerprints');
  const preserved = replayWordFsrsHistory(current, events, {}, { preserveDue: true, sourceFingerprint: sourceDefinitionFingerprint(current) });
  assert.equal(preserved.nextReviewDate, current.nextReviewDate);
  assert.equal(preserved.srs.cards.recall.reps, 3);
});

test('Drive synchronization and reinstall preserve alias history and the reconstructed schedule', async () => {
  const backup = new Backup();const first = backup.attach(service());const originals = addMeanings(first);
  answer(first, originals[0].id, 1);answer(first, originals[1].id, 2);
  const merged = first.mergeWordMeanings(originals.map(word => word.id));answer(first, merged.id, 3);
  const originalEvents = await first.getReviewEvents();
  await first.syncGoogleDrive();
  const scheduled = first.getWords()[0];
  assert.deepEqual(scheduled.srs.cards.recall, expectedRecall(originalEvents));
  await first.syncGoogleDrive();
  assert.deepEqual(first.getWords()[0].srs, scheduled.srs, 'repeated sync does not apply reviews twice');
  const restored = backup.attach(service());await restored.syncGoogleDrive();
  assert.equal(restored.getWords().length, 1);
  assert.deepEqual(restored.getWords()[0].srs.cards, scheduled.srs.cards);
  assert.equal(restored.getWords()[0].nextReviewDate, scheduled.nextReviewDate);
  assert.deepEqual(reviewHistorySources(restored.getWords()[0]), reviewHistorySources(scheduled));
  assert.deepEqual(await restored.getReviewEvents(), originalEvents);
});

test('independent merges into the same survivor union aliases on sync', async () => {
  const backup = new Backup();const first = backup.attach(service());const originals = addMeanings(first, 3);
  originals.forEach((word, index) => answer(first, word.id, index + 1));
  await first.syncGoogleDrive();
  const second = backup.attach(service());await second.syncGoogleDrive();
  first.mergeWordMeanings([originals[0].id, originals[1].id]);
  second.mergeWordMeanings([originals[0].id, originals[2].id]);
  await first.syncGoogleDrive();await second.syncGoogleDrive();await first.syncGoogleDrive();
  for (const persistence of [first, second]) {
    assert.deepEqual(persistence.getWords().map(word => word.id), [originals[0].id]);
    const word = persistence.getWords()[0];
    assert.equal(reviewHistorySources(word).length, 3);
    assert.deepEqual(word.srs.cards.recall, expectedRecall(await persistence.getReviewEvents()));
  }
});

test('repeated merges preserve earlier aliases and meaning edits invalidate them', async () => {
  const persistence = service();const originals = addMeanings(persistence, 3);
  originals.forEach((word, index) => answer(persistence, word.id, index + 1));
  const first = persistence.mergeWordMeanings([originals[0].id, originals[1].id]);
  const merged = persistence.mergeWordMeanings([first.id, originals[2].id]);
  assert.equal(reviewHistorySources(merged).length, 3);
  assert.equal(replay(merged, await persistence.getReviewEvents()).srs.cards.recall.reps, 3);
  const edited = persistence.updateWord(merged.id, { definition: 'Very unlikely to be correct or true.' });
  assert.equal(edited.reviewHistoryAliases, undefined);
  assert.equal(edited.reviewHistoryIdentity, undefined);
  assert.equal(reviewHistorySources(edited).length, 1);
  assert.equal(replay(edited, await persistence.getReviewEvents()), edited, 'old meaning evidence is ineligible after editing');
  for (const patch of [{ id: 'another-card' }, { monthYear: 'December 2026' }, { courseId: 'another-course' }]) {
    assert.equal(reviewHistorySources({ ...merged, ...patch }).length, 1, 'alias metadata is bound to its original card context');
  }
});

function stampMerge(persistence, timestamp) {
  persistence.saveWords(persistence.getWords().map(word => ({ ...word, updatedAt: timestamp })));
  persistence.saveTombstones(persistence.getTombstones().map(item => ({ ...item, deletedAt: timestamp })));
}

test('overlapping offline merges with different survivors converge without recounting shared snapshots', async () => {
  const backup = new Backup();const first = backup.attach(service());const originals = addMeanings(first, 3);
  originals.forEach((word, index) => answer(first, word.id, index + 1));
  await first.syncGoogleDrive();const second = backup.attach(service());await second.syncGoogleDrive();
  first.mergeWordMeanings([originals[0].id, originals[1].id]);stampMerge(first, '2026-11-12T12:00:01.000Z');
  second.mergeWordMeanings([originals[1].id, originals[2].id]);stampMerge(second, '2026-11-12T12:00:02.000Z');
  await first.syncGoogleDrive();await second.syncGoogleDrive();await first.syncGoogleDrive();await second.syncGoogleDrive();
  for (const persistence of [first, second]) {
    assert.deepEqual(persistence.getWords().map(word => word.id), [originals[0].id]);
    const word = persistence.getWords()[0];
    assert.equal(reviewHistorySources(word).length, 3);
    assert.equal(word.practiceStats.attempts, 2, 'overlapping legacy snapshots are retained once, not summed');
    assert.deepEqual(word.srs.cards.recall, expectedRecall(await persistence.getReviewEvents()));
  }
});

test('reciprocal merge tombstones converge at equal timestamps without deleting both survivors', async () => {
  const backup = new Backup();const first = backup.attach(service());const originals = addMeanings(first);
  originals.forEach((word, index) => answer(first, word.id, index + 1));
  await first.syncGoogleDrive();const second = backup.attach(service());await second.syncGoogleDrive();
  first.mergeWordMeanings(originals.map(word => word.id));
  const other = second.getWords();other[1].practiceStats.attempts = 5;second.saveWords(other);
  assert.equal(second.mergeWordMeanings(originals.map(word => word.id)).id, originals[1].id);
  stampMerge(first, '2026-11-12T12:00:01.000Z');stampMerge(second, '2026-11-12T12:00:01.000Z');
  await first.syncGoogleDrive();await second.syncGoogleDrive();await first.syncGoogleDrive();
  assert.deepEqual(first.getWords().map(word => word.id), [originals[0].id]);
  assert.equal(reviewHistorySources(first.getWords()[0]).length, 2);
  assert.ok(!first.getTombstones().some(item => item.id === originals[0].id));
});

test('deleting a merged meaning prevents resurrection from a newer stale constituent', async () => {
  const backup = new Backup();const first = backup.attach(service());const originals = addMeanings(first);
  await first.syncGoogleDrive();const stale = backup.attach(service());await stale.syncGoogleDrive();
  const merged = first.mergeWordMeanings(originals.map(word => word.id));
  stampMerge(first, '2026-11-12T12:00:01.000Z');await first.syncGoogleDrive();
  first.deleteWord(merged.id);stampMerge(first, '2026-11-12T12:00:02.000Z');await first.syncGoogleDrive();
  const staleWords = stale.getWords();staleWords[1].updatedAt = '2026-11-12T12:00:03.000Z';stale.saveWords(staleWords);
  await stale.syncGoogleDrive();await first.syncGoogleDrive();
  assert.deepEqual(first.getWords(), []);assert.deepEqual(stale.getWords(), []);
});

test('a semantic edit after an offline merge cannot bridge its former alias group', async () => {
  const backup = new Backup();const first = backup.attach(service());const originals = addMeanings(first, 3);
  await first.syncGoogleDrive();const second = backup.attach(service());await second.syncGoogleDrive();
  first.mergeWordMeanings([originals[0].id, originals[1].id]);stampMerge(first, '2026-11-12T12:00:01.000Z');
  const other = second.mergeWordMeanings([originals[1].id, originals[2].id]);
  second.updateWord(other.id, { definition: 'Very unlikely to be correct or true.' });
  stampMerge(second, '2026-11-12T12:00:02.000Z');
  await first.syncGoogleDrive();await second.syncGoogleDrive();await first.syncGoogleDrive();
  assert.deepEqual(first.getWords().map(word => word.id).sort(), [originals[0].id, originals[1].id]);
  assert.equal(reviewHistorySources(first.getWords().find(word => word.id === originals[0].id)).length, 2);
  assert.equal(reviewHistorySources(first.getWords().find(word => word.id === originals[1].id)).length, 1);
});

test('a newer stale merge redirect cannot erase the deleted group marker', async () => {
  const backup = new Backup();const first = backup.attach(service());const originals = addMeanings(first);
  await first.syncGoogleDrive();const stale = backup.attach(service());await stale.syncGoogleDrive();
  const merged = first.mergeWordMeanings(originals.map(word => word.id));
  stampMerge(first, '2026-11-12T12:00:01.000Z');await first.syncGoogleDrive();
  first.deleteWord(merged.id);stampMerge(first, '2026-11-12T12:00:02.000Z');await first.syncGoogleDrive();
  const staleWords = stale.getWords();staleWords[1].practiceStats = { attempts: 5 };stale.saveWords(staleWords);
  assert.equal(stale.mergeWordMeanings(originals.map(word => word.id)).id, originals[1].id);
  stampMerge(stale, '2026-11-12T12:00:03.000Z');
  await stale.syncGoogleDrive();await first.syncGoogleDrive();await stale.syncGoogleDrive();
  assert.deepEqual(first.getWords(), []);assert.deepEqual(stale.getWords(), []);
  assert.ok(stale.getTombstones().some(item => item.deletedSources?.length === 2));
});
