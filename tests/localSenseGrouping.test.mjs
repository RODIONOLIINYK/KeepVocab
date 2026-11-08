import test from 'node:test';
import assert from 'node:assert/strict';
import { groupEntrySensesLocally, hasExplicitMeaningConflict } from '../js/services/localSenseGrouping.js';
import { groupSimilarSenses, areSensesNearDuplicate } from '../js/services/learningDefinitions.js';
import { DriveSyncService, MemoryStorage } from '../js/services/driveSync.js';
import { CLIP_DIMENSION } from '../js/ml/clipConfig.js';
import { MEANING_EMBEDDING_CENTER } from '../js/ml/pretrainedSemanticHeads.js';

const vector = (cos = 1) => [cos, Math.sqrt(1 - cos * cos), ...Array(CLIP_DIMENSION - 2).fill(0)];
const sense = (id, definition, fields = {}) => ({ id, word: 'plausible', partOfSpeech: 'adjective', definition, ...fields });
function embeddingAt(index) {
  // Two orthogonal directions from the model mean, with unit-length outputs.
  const center = MEANING_EMBEDDING_CENTER;
  const scale = Math.sqrt(1 - center.reduce((sum, value) => sum + value ** 2, 0)) / Math.hypot(center[index], center[index + 1]);
  return center.map((value, axis) => value + (axis === index ? scale * center[index + 1] : axis === index + 1 ? -scale * center[index] : 0));
}

test('local similarity groups conservative paraphrases, selects the matching example and preserves its attribution', async () => {
  const a = sense('a', 'Seeming to be correct or likely to be true and reasonable.');
  const b = sense('b', 'Seeming to be correct or probably true and reasonable.', { example: 'That explanation sounds plausible.',
    sourceUrl: 'https://dictionary.example/b', exampleSourceUrl: 'https://dictionary.example/example', exampleAttribution: 'Example author', exampleLicense: 'CC BY' });
  const original = { word: 'plausible', senses: [a, b] }, before = structuredClone(original);
  const storage = new MemoryStorage(); let calls = 0;
  const result = await groupEntrySensesLocally(original, { storage, encodeDefinitionTexts: async () => { calls++; return [vector(), vector(.96)]; } });
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
  assert.equal(calls, 0, 'Rule-resolved paraphrases do not wait for model inference');
  const service = new DriveSyncService(new MemoryStorage());
  const saved = service.addWord(result.senses[0]);
  assert.equal(service.getWords().find(w => w.id === saved.id).groupedSenses.length, 2);
});

test('high centered cosine cannot merge contradictions, restrictions or reversed participant roles', async () => {
  for (const [left, right] of [
    ['Allowed to act.', 'Not allowed to act.'], ['Feeling happy.', 'Feeling unhappy.'],
    ['A person who can act.', "A person who can't act."],
    ['A person giving money to a child.', 'A child giving money to a person.'],
    ['Only used for people.', 'Used for people.'],
    ['Seeming to be correct, true and reasonable.', 'Correct, true and reasonable.'],
    ['A hot object on a table.', 'A cold object on a table.'],
    ['Lasting until the end of a day.', 'Lasting after the end of a day.']
  ]) {
    const entry = { word: 'probe', senses: [sense('a', left), sense('b', right)] };
    const result = await groupEntrySensesLocally(entry, { storage: new MemoryStorage(), encodeDefinitionTexts: async () => [vector(), vector()] });
    assert.equal(result.senses.length, 2, `${left} / ${right}`);
  }
  assert.equal(areSensesNearDuplicate(sense('a', 'Likely to be true.'), sense('b', 'Likely to be true.', { partOfSpeech: 'noun' })), false);
});

test('distant centered vectors, unavailable encoder and encoder failure keep separate meanings', async () => {
  const entry = { word: 'plausible', senses: [sense('a', 'An explanation supported by facts and likely to be true.'),
    sense('b', 'A reasonable account that could be believed.')] };
  for (const encodeDefinitionTexts of [async () => [embeddingAt(0), embeddingAt(2)], async () => null, async () => { throw new Error('offline'); }]) {
    assert.equal((await groupEntrySensesLocally(entry, { storage: new MemoryStorage(), encodeDefinitionTexts })).senses.length, 2);
  }
});

test('centered similarity can merge low-overlap wording and reuse scores during manual regrouping', async () => {
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
  assert.equal(grouped.senses.length, 1);
  assert.deepEqual(grouped.senses[0].groupedSenses, [a, b]);
  const regrouped = await groupEntrySensesLocally(grouped, { storage: null, reuseSemanticScoresOnly: true });
  assert.equal(regrouped.senses.length, 1);
});
test('explicit paraphrase rules merge without a downloaded model or helpful embedding', async () => {
  for (const [a, b] of [
    ['Able to bend repeatedly.', 'Capable of bending repeatedly.'],
    ['Characterized by a vivid colour.', 'Having a vivid color.'],
    ['Strange; odd; unusual.', 'Unusual; odd.'],
    ['Seeming to be correct or likely to be true and reasonable.', 'Seeming to be correct or probably true and reasonable.']
  ]) {
    const entry = { word: 'probe', senses: [sense('a', a), sense('b', b)] };
    const result = await groupEntrySensesLocally(entry, { storage: new MemoryStorage(), encodeDefinitionTexts: async () => null });
    assert.equal(result.senses.length, 1, `${a} / ${b}`);
    assert.equal(result.senses[0].groupedSenses.length, 2);
  }
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
test('Gemini grouping cannot bypass explicit polarity, numeric or restriction conflicts', () => {
  for (const [a, b] of [['Allowed to enter.', 'Not allowed to enter.'], ['An open doorway.', 'A closed doorway.'],
    ['A group of 3 people.', 'A group of 4 people.'], ['Only used for people.', 'Used for people.']]) {
    assert.equal(hasExplicitMeaningConflict({ definition: a }, { definition: b }), true);
  }
  assert.equal(hasExplicitMeaningConflict({ definition: 'Seeming reasonable.' }, { definition: 'Appearing to be reasonable.' }), false);
});
