// Review-only synthetic reproductions. No network, encoder downloads or saved weights.
import assert from 'node:assert/strict';
const root = new URL('../../', import.meta.url);
const load = path => import(new URL(path, root));
const { MemoryStorage, driveSync } = await load('js/services/driveSync.js?v=18908');
const { recordImagePreference, resetImagePreferences, disableImageLearning, rankEmbeddedImages, imageClipPrompts } = await load('js/services/imageLearning.js?v=18908');
const { imageSenseFingerprint, filterLoadableImages } = await load('js/services/imageSearch.js?v=18908');
const { imageReplacementLabels } = await load('js/services/imageChoicePolicy.js');
const { CLIP_TAG, CLIP_DIMENSION } = await load('js/ml/clipConfig.js');
const { encodeMeaning, IMAGE_PREPROCESSING, createPersonalizer, trainImagePersonalizer, splitImageDecisions, activeImageExamples } = await load('js/services/imagePersonalizer.js');
const { encodeFullFeatures, preferenceFeatures } = await load('js/services/imagePreferences.js');
const { INVARIANT_HEAD_VERSION, validInvariantHead, validRankingEvidence } = await load('js/services/vocabInvariantHead.js');
const { ImageLearningHistoryStore } = await load('js/services/imageLearningHistory.js');
const { ImagePersonalizerTraining } = await load('js/services/imagePersonalizerTraining.js');
const { recordMeaningJudgment, meaningLearningState } = await load('js/services/meaningEquivalenceLearning.js');
const { imageChoiceHistory } = await load('tests/fixtures/imageChoices.mjs');
const vector = axis => Array.from({ length: CLIP_DIMENSION }, (_, i) => Number(i === axis));
const outputs = [];
const originalStorage = globalThis.localStorage;
const originalDocument = globalThis.document;
globalThis.localStorage = new MemoryStorage();
localStorage.setItem('keepvocab_image_learning_device_v1', JSON.stringify({ enabled: true }));
await resetImagePreferences();
try {
  const [word] = driveSync.addWords([{ word: 'bank', partOfSpeech: 'noun', definition: 'Land beside a river.' }]);
  const metadata = axis => ({ model: CLIP_TAG, sense: imageSenseFingerprint(word), preprocessing: IMAGE_PREPROCESSING,
    meaningFeatures: encodeMeaning(vector(0)), features: encodeFullFeatures(preferenceFeatures(vector(axis), { selected: .4, margin: .2, unwanted: .1 })) });
  const oldMl = metadata(1), newMl = metadata(2);
  driveSync.saveWords([{ ...word, imageUrl: 'https://example.test/old.jpg', imageMl: oldMl }]);
  const changed = driveSync.updateWord(word.id, { imageUrl: 'https://example.test/new.jpg', imageMl: newMl });
  assert.deepEqual(changed.imageMl, oldMl);
  assert.equal((await recordImagePreference(changed, 'good', { url: changed.imageUrl, ml: changed.imageMl })).recorded, true);
  const [event] = await driveSync.getImageEvents();
  assert.equal(event.context.imageUrl, changed.imageUrl);
  assert.equal(event.features, oldMl.features);
  assert.ok(driveSync.updateWord(word.id, { imageUrl: '', imageMl: undefined }).imageMl);
  outputs.push('imageMl: old image features are recorded against the replacement URL; clearing the image retains metadata');

  const previous = { url: 'https://example.test/a.jpg', ml: oldMl };
  const selected = { url: 'https://example.test/b.jpg', ml: newMl };
  const comparison = imageReplacementLabels(word, previous, selected).find(r => r.action === 'less-preferred');
  assert.equal((await recordImagePreference(comparison.word, comparison.action, comparison.image)).recorded, false);
  assert.equal((await recordImagePreference(comparison.word, comparison.action, comparison.image, comparison)).recorded, true);
  outputs.push('Visual Match: dropping the fourth argument rejects a valid comparison; forwarding it succeeds');

  const positives = imageChoiceHistory().map(r => ({ ...r, kind: 'label', label: 1 }));
  assert.throws(() => trainImagePersonalizer(positives, null), /No usable training observations/);
  outputs.push('positive-only feedback: 60 meanings pass decision-count checks but throw before any training step');

  const split = splitImageDecisions(imageChoiceHistory());
  const incumbent = { ...createPersonalizer(), role: 'preference', trainingDecisionIds: split.train.map(r => r.id),
    validationDecisionIds: split.validation.map(r => r.id), testDecisionIds: split.test.map(r => r.id) };
  const blocked = trainImagePersonalizer(imageChoiceHistory(80), incumbent);
  assert.equal(blocked.accepted, false);
  assert.match(blocked.reason, /Waiting for later choices/);
  outputs.push('retraining: an incumbent with 60 prior meanings is blocked with 20 later independent meanings');

  const head = { version: INVARIANT_HEAD_VERSION, encoder: CLIP_TAG, dimension: CLIP_DIMENSION,
    uBg: Array(CLIP_DIMENSION).fill(0), fisherDiag: Array(CLIP_DIMENSION).fill(1), backgroundStrength: 0,
    scorer: { weights: Array(12).fill(0), mean: Array(12).fill(0), scale: Array(12).fill(1), bias: 0 } };
  assert.ok(validInvariantHead(head));
  const history = new ImageLearningHistoryStore(new MemoryStorage(), undefined);
  await history.ready;
  await history.writeState('invariantHead', head);
  await history.merge([], '2026-11-13T00:00:00.000Z');
  const trainer = new ImagePersonalizerTraining({ imageHistory: history }, { pretrained: async () => ({ getPretrainedImageModel: () => null }) });
  assert.equal(await trainer.personal(), null);
  assert.ok((await trainer.current()).wInv);
  trainer.stop();
  outputs.push('remote reset: the old invariant head remains active after a newer resetAt');

  const evidence = { encoder: CLIP_TAG, full: vector(0), crop: vector(1), meaning: vector(1), scene: vector(1), contrast: null, unwanted: vector(2) };
  const items = [.35, .45].map((value, i) => ({ candidate: { id: ['A', 'B'][i] }, vector: vector(i),
    meaningFeatures: encodeMeaning(vector(1)), rankingEvidence: evidence,
    semantic: { selected: value, score: value, cosine: value, margin: .1, unwanted: 0, contrast: null } }));
  const model = { ...createPersonalizer(), role: 'preference' };
  const personal = rankEmbeddedImages(items, model);
  const overridden = rankEmbeddedImages(items, { ...model, wInv: head });
  assert.equal(personal.length, 2);
  assert.notEqual(personal[0].score, personal[1].score);
  assert.equal(overridden.length, 2);
  assert.ok(overridden.every(r => r.score === .5));
  outputs.push('ranking: a valid invariant head replaces both distinct personalizer scores with its own probability');

  const base = imageChoiceHistory(1)[0];
  const corrections = [{ ...base, id: 'old', kind: 'label', key: 'same', label: 1, updatedAt: '2026-01-01T00:00:00Z', rankingEvidence: evidence },
    { ...base, id: 'new', kind: 'label', key: 'same', label: 0, updatedAt: '2026-02-01T00:00:00Z', rankingEvidence: evidence }];
  assert.deepEqual(activeImageExamples(corrections).map(r => r.label), [0]);
  assert.deepEqual(corrections.filter(r => r.kind !== 'comparison' && validRankingEvidence(r.rankingEvidence)).map(r => r.label), [1, 0]);
  outputs.push('invariant training: its worker predicate retains both old and corrected labels; activeImageExamples retains only the correction');

  const result = await recordMeaningJudgment('bank', { partOfSpeech: 'noun', definition: 'Land beside a river.' },
    { partOfSpeech: 'noun', definition: 'A financial institution.' }, false, { encodeDefinitionTexts: async () => null });
  const state = await meaningLearningState();
  assert.equal(result.recorded, true);
  assert.equal(result.trained, false);
  assert.equal(state.records.find(r => r.word === 'bank').evidence, undefined);
  outputs.push('meaning review: the UI null-encoder option saves the manual label without any learning evidence');

  const attempted = [];
  globalThis.document = { createElement: () => ({ set src(url) { attempted.push(url); queueMicrotask(() => this.onerror?.()); } }) };
  const scored = { url: 'https://example.test/broken-display.jpg', thumbnailUrl: 'https://example.test/working-thumb.jpg', ml: { screening: 'scored' } };
  assert.equal((await filterLoadableImages([scored])).length, 1);
  assert.equal(attempted.length, 0);
  assert.equal((await filterLoadableImages([{ ...scored, ml: undefined }], { retries: -1 })).length, 0);
  assert.ok(attempted.includes(scored.url));
  outputs.push('display validation: an ML-scored candidate bypasses the browser display-URL loader entirely');
  const condition = { word: 'empty', partOfSpeech: 'adjective', definition: 'A container, without anything inside.' };
  const prompt = imageClipPrompts(condition).texts[0];
  assert.equal(prompt, 'A photo illustrating empty (adjective): A container.');
  assert.ok(!prompt.includes('without anything inside'));
  const meanings = ['A person, without physical restraint.', 'A person, without obligations.'];
  const prompts = meanings.map(definition => imageClipPrompts({ word: 'free', partOfSpeech: 'adjective', definition }).texts[0]);
  assert.equal(prompts[0], prompts[1]);
  outputs.push('prompt cleanup: defining absence conditions are removed; two distinct definitions can produce the same model text');
  console.log(outputs.map((value, i) => `${i + 1}. REPRODUCED: ${value}`).join('\n'));
} finally {
  await resetImagePreferences();
  disableImageLearning();
  if (originalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = originalStorage;
  if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
}
