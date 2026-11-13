import test from 'node:test';
import assert from 'node:assert/strict';
import { groupEntrySensesLocally } from '../js/services/localSenseGrouping.js';
import { groupSimilarSenses, areSensesNearDuplicate } from '../js/services/learningDefinitions.js';
import { driveSync, DriveSyncService, MemoryStorage } from '../js/services/driveSync.js?v=18908';
import { MEANING_EMBEDDING_CENTER } from '../js/ml/pretrainedSemanticHeads.js';
import { meaningPairKey } from '../js/services/meaningEquivalenceLearning.js';

const sense = (id, definition, fields = {}) => ({ id, word: 'plausible', partOfSpeech: 'adjective', definition, ...fields });
function embeddingAt(index) {
  // Two orthogonal directions from the model mean, with unit-length outputs.
  const center = MEANING_EMBEDDING_CENTER;
  const scale = Math.sqrt(1 - center.reduce((sum, value) => sum + value ** 2, 0)) / Math.hypot(center[index], center[index + 1]);
  return center.map((value, axis) => value + (axis === index ? scale * center[index + 1] : axis === index + 1 ? -scale * center[index] : 0));
}

test('exact grammar variants group without inference and preserve the matching example attribution', async () => {
  const a = sense('a', 'Seeming to be correct or likely to be true and reasonable.');
  const b = sense('b', '(UK) Seeming to be correct or likely to be true and reasonable.', { example: 'That explanation sounds plausible.',
    sourceUrl: 'https://dictionary.example/b', exampleSourceUrl: 'https://dictionary.example/example', exampleAttribution: 'Example author', exampleLicense: 'CC BY' });
  const original = { word: 'plausible', senses: [a, b] }, before = structuredClone(original);
  const storage = new MemoryStorage(); let calls = 0;
  const result = await groupEntrySensesLocally(original, { storage, encodeDefinitionTexts: async () => { calls++; return [embeddingAt(0), embeddingAt(0)]; } });
  assert.equal(result.senses.length, 1);
  assert.ok(result.senses[0].definition.includes('correct'));
  assert.ok(/likely|probably/.test(result.senses[0].definition));
  assert.deepEqual(result.senses[0].sourceDefinitions, [a.definition, b.definition]);
  assert.equal(result.senses[0].exampleAttribution, 'Example author');
  assert.equal(result.senses[0].exampleSourceUrl, b.exampleSourceUrl);
  assert.deepEqual(result.senses[0].groupedSenses, [a, b]);
  assert.deepEqual(original, before);
  const restarted = await groupEntrySensesLocally({ ...original, senses: [a, { ...b, exampleAttribution: 'Updated author' }] },
    { storage, encodeDefinitionTexts: () => assert.fail('Reuse grouping cache') });
  assert.equal(restarted.senses[0].exampleAttribution, 'Updated author');
  assert.equal(calls, 0, 'Exact grammar variants do not require statistical inference');
  const service = new DriveSyncService(new MemoryStorage());
  const saved = service.addWord(result.senses[0]);
  assert.equal(service.getWords().find(w => w.id === saved.id).groupedSenses.length, 2);
});

test('only senses of the same word and part of speech are eligible for local grouping', async () => {
  const a = sense('a', 'Used for people.');
  for (const other of [{ word: 'other' }, { partOfSpeech: 'noun' }]) {
    const b = sense('b', a.definition, other);
    const result = await groupEntrySensesLocally({ word: a.word, senses: [a, b] }, {
      storage: null, encodeDefinitionTexts: () => assert.fail('Different words or parts of speech cannot be candidates')
    });
    assert.equal(result.senses.length, 2);
  }
});

test('distant centered vectors, unavailable encoder and encoder failure keep separate meanings', async () => {
  const entry = { word: 'plausible', senses: [sense('a', 'An explanation supported by facts and likely to be true.'),
    sense('b', 'A reasonable account that could be believed.')] };
  for (const encodeDefinitionTexts of [async () => [embeddingAt(0), embeddingAt(2)], async () => null, async () => { throw new Error('offline'); }]) {
    assert.equal((await groupEntrySensesLocally(entry, { storage: new MemoryStorage(), encodeDefinitionTexts })).senses.length, 2);
  }
});

test('uncalibrated centered similarity offers low-overlap wording for review and reuses scores', async () => {
  const a = sense('a', 'To commence.', { word: 'begin', partOfSpeech: 'verb' });
  const b = sense('b', '(UK) To start doing something.', { word: 'begin', partOfSpeech: 'verb' });
  assert.equal(areSensesNearDuplicate(a, b), false);
  const entry = { word: 'begin', senses: [a, b] };
  const grouped = await groupEntrySensesLocally(entry, {
    storage: null,
    encodeDefinitionTexts: async texts => {
      assert.deepEqual(texts, ['to commence.', 'to start doing something.']);
      return [embeddingAt(0), embeddingAt(0)];
    }
  });
  assert.equal(grouped.senses.length, 2);
  assert.equal(grouped.meaningReviewScores.length, 1);
  const regrouped = await groupEntrySensesLocally(grouped, { storage: null, reuseSemanticScoresOnly: true });
  assert.equal(regrouped.senses.length, 2);
});
test('uncalibrated centered similarity cannot automatically merge opposite meanings', async () => {
  const senses = [sense('a', 'Permitted to enter.'), sense('b', 'Not allowed to enter.')];
  const center = MEANING_EMBEDDING_CENTER, first = embeddingAt(0), second = embeddingAt(2);
  for (const similarity of [0.449, 0.451]) {
    const vector = center.map((value, index) => value + similarity * (first[index] - value)
      + Math.sqrt(1 - similarity ** 2) * (second[index] - value));
    const result = await groupEntrySensesLocally({ word: senses[0].word, senses }, {
      storage: null, encodeDefinitionTexts: async () => [first, vector]
    });
    assert.equal(result.senses.length, 2);
  }
});

test('an explicit Different meanings judgment splits a model merge without rerunning inference', async context => {
  const a = sense('a', 'Permitted to enter.'), b = sense('b', 'Forbidden to enter.');
  const entry = { word: a.word, senses: [a, b] };
  const grouped = { ...entry, senses: groupSimilarSenses(entry.senses, { matches: () => true }) };
  assert.equal(grouped.senses.length, 1);
  context.mock.method(driveSync.imageHistory, 'readState', async () => ({
    records: [{ source: 'user', label: 0, key: meaningPairKey(a.word, a.partOfSpeech, a.definition, b.definition) }]
  }));
  const regrouped = await groupEntrySensesLocally(grouped, { storage: null, reuseSemanticScoresOnly: true });
  assert.equal(regrouped.senses.length, 2);
  assert.equal(regrouped.senseConsolidation.userReviewed, true);
});

test('complete linkage prevents transitive merging and a valid example selects the whole source record', () => {
  const senses = ['a', 'b', 'c'].map((id, i) => sense(id, `A plausible explanation ${i}.`));
  const grouped = groupSimilarSenses(senses, { matches: (a, b) => Math.abs(Number(a.definition.at(-2)) - Number(b.definition.at(-2))) < 2 });
  assert.equal(grouped.length, 2);
});
test('offline lexical fallback preserves no and non- qualifications in otherwise matching definitions', async () => {
  for (const [a, b] of [
    ['A domesticated carnivorous mammal with soft fur and whiskers.', 'A non-domesticated carnivorous mammal with soft fur and whiskers.'],
    ['A small animal that has a tail and fur.', 'A small animal that has no tail and fur.']
  ]) {
    const entry = { word: 'probe', senses: [sense('a', a), sense('b', b)] };
    const result = await groupEntrySensesLocally(entry, { storage: new MemoryStorage(), encodeDefinitionTexts: async () => null });
    assert.equal(result.senses.length, 2, `${a} / ${b}`);
  }
});
