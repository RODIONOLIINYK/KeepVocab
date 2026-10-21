import test from 'node:test';
import assert from 'node:assert/strict';
import { areSensesNearDuplicate, definitionForLearning, exampleForLearning, groupSimilarSenses, improveLearnerExplanation,
  isModernUsageExample, needsLearnerExplanation, sourceDefinitionFingerprint, withLearnerExplanations } from '../js/services/learningDefinitions.js';
import { MemoryStorage } from '../js/services/driveSync.js';
import { saveGeminiSettings } from '../js/services/geminiSettings.js';

const SOURCE = 'The quality or condition of being scrupulously attentive to the minute particulars of a task, especially where accuracy and thoroughness are required.';
const CLEAR = 'Paying close attention to small details so that a job is done carefully and accurately.';
const sense = { id: 'kept-id', word: 'meticulous', partOfSpeech: 'adjective', definition: SOURCE,
  example: 'She is meticulous about spelling.', translation: 'Дуже уважний до деталей.', translationLanguage: 'uk' };
const HISTORICAL = 'I believe, Lady, your Ladyſhip obſerved a young VVoman at Church yeſterday at Even-ſong, vvho vvas dreſt in one of your outlandiſh Garments; I think I have ſeen your Ladyſhip in ſuch a one. Hovvever, in the Country, ſuch Dreſſes are / Rara avis in Terris, nigroq; ſimillima Cycno, / That is, Madam, as much to ſay, / A rare Bird upon the Earth, and very like a black Svvan.';

function fixture(rewrite = item => ({ definition: CLEAR, example: item.example || 'She was meticulous when checking every figure.', usageNote: '' })) {
  const storage = new MemoryStorage();
  saveGeminiSettings({ apiKey: 'fake-key-for-learner-explanations-tests' }, storage, { silent: true });
  const calls = [];
  return { storage, calls, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    const prompt = body.contents[0].parts[0].text;
    const items = JSON.parse(prompt.slice(prompt.lastIndexOf('\nSenses: ') + 9));
    calls.push({ url, body, items });
    const senses = items.flatMap(item => {
      const result = rewrite(item);
      return result === null ? [] : [{ id: item.id, sourceFingerprint: item.sourceFingerprint, meaningPreserved: true, ...result }];
    });
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ senses }) }] } }] }) };
  } };
}

test('one primary explanation replaces difficult wording, preserving exact source, identity, good example and translations', async () => {
  const original = { word: sense.word, audioUrl: 'audio.mp3', senses: [sense] };
  const before = structuredClone(original);
  const options = fixture();
  const result = await withLearnerExplanations(original, options);
  const learned = result.senses[0];
  assert.equal(learned.definition, CLEAR);
  assert.equal(learned.sourceDefinition, SOURCE);
  assert.equal(learned.sourceFingerprint, sourceDefinitionFingerprint(sense));
  assert.equal(learned.id, sense.id);
  assert.equal(learned.example, sense.example);
  assert.equal(learned.translation, sense.translation);
  assert.equal(learned.conciseDefinition, undefined);
  assert.equal(definitionForLearning({ ...learned, conciseDefinition: 'obsolete clue' }), CLEAR);
  assert.equal(result.audioUrl, 'audio.mp3');
  assert.deepEqual(original, before);
  assert.equal(options.calls.length, 1);
  assert.match(options.calls[0].body.contents[0].parts[0].text, /There is no word limit/);
});

test('simple sensible definitions and good examples make no request; difficult short jargon does', async () => {
  const options = fixture();
  const clear = { word: 'careful', definition: 'Paying attention so that you avoid mistakes.', example: 'She was careful when crossing the road.' };
  assert.equal(needsLearnerExplanation(clear), false);
  assert.equal((await withLearnerExplanations({ senses: [clear] }, options)).definition, clear.definition);
  assert.equal(options.calls.length, 0);
  assert.equal(needsLearnerExplanation({ word: 'transformation', definition: 'An ontological physicochemical transmutation.' }), true);
  assert.equal(needsLearnerExplanation({ word: 'meticulous', definition: 'Meticulous attention to details.' }), true);
});

test('clarity permits a longer explanation when important restrictions need space', async () => {
  const definition = 'The condition of being authorised to act only for a child under 18, not for an adult, unless a court has expressly given permission.';
  const clear = 'A person who is allowed to make decisions only for a child under 18, not for an adult, unless a court has specifically given permission to do so.';
  const item = { word: 'guardian', partOfSpeech: 'noun', definition, example: 'Her guardian signed the school permission form.' };
  const options = fixture(() => ({ definition: clear, example: item.example, usageNote: 'Used for a legal responsibility.' }));
  const result = await withLearnerExplanations({ senses: [item] }, options);
  assert.ok(result.definition.split(/\s+/).length > 18);
  assert.equal(result.definition, clear);
  assert.equal(result.usageNote, 'Used for a legal responsibility.');
});

test('exact source and model cache survives restart; another source, POS or model is isolated', async () => {
  const options = fixture();
  await withLearnerExplanations({ senses: [sense] }, options);
  const restarted = new MemoryStorage();
  for (const [key, value] of options.storage.values) restarted.setItem(key, value);
  const result = await withLearnerExplanations({ senses: [sense] }, { storage: restarted, fetchImpl: async () => assert.fail('Use exact source cache') });
  assert.equal(result.definition, CLEAR);
  await withLearnerExplanations({ senses: [{ ...sense, definition: `${SOURCE} Further source detail.` }] }, options);
  await withLearnerExplanations({ senses: [{ ...sense, partOfSpeech: 'noun' }] }, options);
  await withLearnerExplanations({ senses: [sense] }, { ...options, model: 'another-model' });
  assert.equal(options.calls.length, 4);
});

test('a missing example gets concrete support even when the definition is already understandable', async () => {
  const item = { word: 'outlandish', partOfSpeech: 'adjective', definition: 'Appearing to be foreign; strange, unfamiliar.', example: HISTORICAL };
  const options = fixture(row => ({ definition: row.currentDefinition,
    example: 'The unfamiliar clothes looked outlandish to the visitors.', usageNote: 'This selected sense describes something that seems foreign or unfamiliar.' }));
  const result = await withLearnerExplanations({ senses: [item] }, options);
  assert.equal(result.definition, item.definition);
  assert.equal(result.example, 'The unfamiliar clothes looked outlandish to the visitors.');
  assert.equal(result.needsExample, false);
  assert.equal(result.sourceDefinition, item.definition);
  assert.equal(exampleForLearning(item), '');
  assert.equal(isModernUsageExample(item, HISTORICAL), false);
  assert.equal(options.calls.length, 1);
});

test('failure to produce an example is honest, with no invented generic sentence or cached invalid result', async () => {
  const item = { word: 'outlandish', definition: 'Appearing to be foreign; strange, unfamiliar.', example: HISTORICAL };
  const options = fixture(row => ({ definition: row.currentDefinition, example: HISTORICAL }));
  const result = await withLearnerExplanations({ senses: [item] }, options);
  assert.equal(result.example, '');
  assert.equal(result.needsExample, true);
  assert.equal(result.definition, item.definition);
  await assert.rejects(improveLearnerExplanation(item, options), { code: 'EXPLANATION_UNAVAILABLE' });
});

test('manual wording and already approved explanations remain unchanged while missing examples may be repaired', async () => {
  const options = fixture(row => ({ definition: row.currentDefinition, example: 'She was meticulous when checking the figures.', usageNote: '' }));
  const manual = { ...sense, explanationSource: 'manual', example: '' };
  const result = await withLearnerExplanations({ senses: [manual] }, options);
  assert.equal(result.definition, SOURCE);
  assert.equal(result.explanationSource, 'manual');
  assert.equal(result.needsExample, false);
  assert.equal(options.calls[0].items[0].retainDefinition, true);
  await withLearnerExplanations({ senses: [{ ...manual, example: sense.example }] }, options);
  assert.equal(options.calls.length, 1);
  const ownWording = { ...manual, definition: 'Of or pertaining to careful checking.', example: sense.example };
  assert.equal((await withLearnerExplanations({ senses: [ownWording] }, options)).definition, ownWording.definition);
});

test('wrong fingerprints, circular jargon, lost restrictions and wrong-sense examples are rejected individually', async () => {
  const item = { word: 'bank', partOfSpeech: 'noun', definition: 'The condition of being a financial institution that only accepts deposits, not loans.', example: 'The bank accepted her deposit.' };
  const valid = { definition: 'A place that only keeps deposited money, not one that gives loans.', example: item.example };
  for (const invalid of [
    { ...valid, sourceFingerprint: 'different-source' }, { ...valid, meaningPreserved: false },
    { ...valid, definition: 'A bank that accepts deposits.' }, { ...valid, definition: 'An ontological financial establishment.' },
    { ...valid, definition: 'A place that accepts deposits.' }, { ...valid, example: 'They picnicked by the river bank.' },
    { ...valid, example: 'This word is very important.' }, { ...valid, definition: { text: 'bad' } }
  ]) {
    const options = fixture(() => invalid);
    const result = await withLearnerExplanations({ senses: [item] }, options);
    assert.equal(result.definition, item.definition);
    assert.equal(result.sourceDefinition, item.definition);
  }
});

test('large explicit repairs use bounded batches, keep order, and preserve partial valid successes', async () => {
  const originals = Array.from({ length: 27 }, (_, index) => ({ ...sense, id: `saved-${index}`, word: `term${index}`, definition: `${SOURCE} ${index}` }));
  const options = fixture(row => Number(row.id) === 13 ? null : ({ definition: `Only the ${row.sourceDefinition.match(/\d+$/)[0]} details must be checked with care.`,
    example: `They checked term${row.sourceDefinition.match(/\d+$/)[0]} with great care.` }));
  const result = await withLearnerExplanations({ senses: originals }, { ...options, force: true });
  assert.deepEqual(options.calls.map(call => call.items.length), [12, 12, 3]);
  assert.deepEqual(result.senses.map(item => item.id), originals.map(item => item.id));
  assert.equal(result.senses[13].definition, originals[13].definition);
  assert.notEqual(result.senses[0].definition, originals[0].definition);
});

test('near duplicate senses group conservatively with source evidence while qualifiers and domains stay separate', () => {
  const left = { id: 'old-1', partOfSpeech: 'adjective', definition: 'Appearing to be foreign; strange, unfamiliar.' };
  const right = { id: 'old-2', partOfSpeech: 'adjective', definition: 'Foreign-looking; strange or unfamiliar.' };
  assert.equal(areSensesNearDuplicate(left, right), true);
  const groups = groupSimilarSenses([left, right, { id: 'modern', partOfSpeech: 'adjective', definition: 'Very unusual or strange.', labels: ['informal'] }]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].mergedSenseIds, ['old-1', 'old-2']);
  assert.deepEqual(groups[0].sourceDefinitions, [left.definition, right.definition]);
  assert.equal(areSensesNearDuplicate({ partOfSpeech: 'noun', definition: 'Land beside a river.' }, { partOfSpeech: 'noun', definition: 'A place that keeps and lends money.' }), false);
  assert.equal(areSensesNearDuplicate(left, { ...right, labels: ['archaic'] }), false);
  assert.equal(areSensesNearDuplicate(left, { ...right, usageNote: 'Usage: archaic.' }), false);
  assert.equal(areSensesNearDuplicate({ ...left, word: 'outlandish' }, { ...right, word: 'foreign' }), false);
  assert.equal(areSensesNearDuplicate(left, { ...right, partOfSpeech: 'noun' }), false);
  assert.equal(areSensesNearDuplicate({ partOfSpeech: 'adjective', definition: 'Only used for people.' }, { partOfSpeech: 'adjective', definition: 'Used for people.' }), false);
});

test('unconfigured, disabled and cancelled operations never pay for explanations or erase valid source data', async () => {
  const options = fixture();
  for (const setting of [{ storage: new MemoryStorage() }, { ...options, settings: { enabled: false } }]) {
    const result = await withLearnerExplanations({ senses: [sense] }, { ...setting, fetchImpl: async () => assert.fail('No request') });
    assert.equal(result.definition, SOURCE);
  }
  await assert.rejects(improveLearnerExplanation(sense, { storage: new MemoryStorage() }), { code: 'AI_NOT_CONFIGURED' });
  const controller = new AbortController(); controller.abort();
  const result = await withLearnerExplanations({ senses: [sense] }, { ...options, signal: controller.signal });
  assert.equal(result.definition, SOURCE);
  assert.equal(options.calls.length, 0);
});
