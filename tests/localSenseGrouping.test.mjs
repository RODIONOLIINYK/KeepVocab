import test from 'node:test';
import assert from 'node:assert/strict';
import { groupEntrySensesLocally } from '../js/services/localSenseGrouping.js';
import { groupSimilarSenses, areSensesNearDuplicate } from '../js/services/learningDefinitions.js';
import { DriveSyncService, MemoryStorage } from '../js/services/driveSync.js';

const vector = (cos = 1) => [cos, Math.sqrt(1 - cos * cos), ...Array(510).fill(0)];
const sense = (id, definition, fields = {}) => ({ id, word: 'plausible', partOfSpeech: 'adjective', definition, ...fields });

test('local similarity groups conservative paraphrases, selects the matching example and preserves its attribution', async () => {
  const a = sense('a', 'Seeming to be correct or likely to be true and reasonable.');
  const b = sense('b', 'Seeming to be correct or probably true and reasonable.', { example: 'That explanation sounds plausible.',
    sourceUrl: 'https://dictionary.example/b', exampleSourceUrl: 'https://dictionary.example/example', exampleAttribution: 'Example author', exampleLicense: 'CC BY' });
  const original = { word: 'plausible', senses: [a, b] }, before = structuredClone(original);
  const storage = new MemoryStorage(); let calls = 0;
  const result = await groupEntrySensesLocally(original, { storage, encodeDefinitionTexts: async () => { calls++; return [vector(), vector(.96)]; } });
  assert.equal(result.senses.length, 1);
  assert.ok(result.senses[0].definition.includes('correct'));
  assert.ok(result.senses[0].definition.includes('likely'));
  assert.ok(result.senses[0].definition.includes('probably'));
  assert.equal(result.senses[0].exampleAttribution, 'Example author');
  assert.equal(result.senses[0].exampleSourceUrl, b.exampleSourceUrl);
  assert.deepEqual(result.senses[0].groupedSenses, [a, b]);
  assert.deepEqual(original, before);
  const restarted = await groupEntrySensesLocally({ ...original, senses: [a, { ...b, exampleAttribution: 'Updated author' }] },
    { storage, encodeDefinitionTexts: () => assert.fail('Reuse grouping cache') });
  assert.equal(restarted.senses[0].exampleAttribution, 'Updated author');
  assert.equal(calls, 1);
  const service = new DriveSyncService(new MemoryStorage());
  const saved = service.addWord(result.senses[0]);
  assert.equal(service.getWords().find(w => w.id === saved.id).groupedSenses.length, 2);
});

test('high cosine cannot merge negation, antonyms, domain, restrictions, POS or reversed participant roles', async () => {
  for (const [left, right] of [
    ['Allowed to act.', 'Not allowed to act.'], ['Feeling happy.', 'Feeling unhappy.'],
    ['A person who can act.', "A person who can't act."],
    ['A person giving money to a child.', 'A child giving money to a person.'],
    ['Only used for people.', 'Used for people.'], ['Land beside a river.', 'A place that lends money.'],
    ['A hot object on a table.', 'A cold object on a table.'],
    ['Lasting until the end of a day.', 'Lasting after the end of a day.']
  ]) {
    const entry = { word: 'probe', senses: [sense('a', left), sense('b', right)] };
    const result = await groupEntrySensesLocally(entry, { storage: new MemoryStorage(), encodeDefinitionTexts: async () => [vector(), vector()] });
    assert.equal(result.senses.length, 2, `${left} / ${right}`);
  }
  assert.equal(areSensesNearDuplicate(sense('a', 'Likely to be true.'), sense('b', 'Likely to be true.', { partOfSpeech: 'noun' })), false);
});

test('low cosine, unavailable encoder and encoder failure keep separate meanings', async () => {
  const entry = { word: 'plausible', senses: [sense('a', 'Seeming to be correct or likely to be true and reasonable.'),
    sense('b', 'Seeming to be correct or probably true and reasonable.')] };
  // Use a wording difference beyond the lexical-only fallback.
  entry.senses[1].definition = 'Seeming to be correct or probably true and reasonable.';
  for (const encodeDefinitionTexts of [async () => [vector(), vector(.7)], async () => null, async () => { throw new Error('offline'); }]) {
    assert.equal((await groupEntrySensesLocally(entry, { storage: new MemoryStorage(), encodeDefinitionTexts })).senses.length, 2);
  }
});

test('complete linkage prevents transitive merging and a valid example selects the whole source record', () => {
  const senses = ['a', 'b', 'c'].map((id, i) => sense(id, `A plausible explanation ${i}.`));
  const grouped = groupSimilarSenses(senses, { matches: (a, b) => Math.abs(Number(a.definition.at(-2)) - Number(b.definition.at(-2))) < 2 });
  assert.equal(grouped.length, 2);
});
