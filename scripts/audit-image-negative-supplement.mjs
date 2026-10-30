import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { imageClipPrompts, semanticScores } from '../js/services/imageLearning.js';
import { passesImageSemanticGate } from '../js/services/imageSemanticGate.js';
const base = new URL('../tests/fixtures/image-negative-supplement/', import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const bytes = await readFile(new URL('manifest.json', base)), manifest = JSON.parse(bytes);
const vectors = JSON.parse(gunzipSync(await readFile(new URL('vectors.json.gz', base))));
const review = JSON.parse(await readFile(new URL('independent-review-revised.json', base)));
const cases = JSON.parse(await readFile(new URL('../tests/fixtures/image-pretraining-v2/cases.json', import.meta.url)));
const source = new Map(cases.cases.map(item => [item.id, item]));
assert.equal(vectors.sourceManifestSha256, sha(bytes));
assert.equal(manifest.items.length, 36); assert.equal(vectors.items.length, 36);
assert.equal(manifest.trained, false); assert.equal(manifest.personalPreference, false);
const counts = {};
for (const item of manifest.items) {
  const target = source.get(item.targetCaseId);
  assert.equal(target.split, 'train'); assert.equal(item.target.definition, target.word.definition);
  assert.equal(item.suitabilityLabel, 0);
  const judgment = review.items.find(row => row.id === item.id);
  assert.equal(judgment.label, 'wrong'); assert.equal(judgment.assetSha256, item.source.sha256);
  if (item.distractorKind === 'photo') {
    const parent = source.get(item.source.sourceCaseId);
    assert.equal(parent.split, 'train');
    assert.ok(parent.candidates.some(photo => photo.sha256 === item.source.sha256));
  } else assert.equal(sha(await readFile(new URL(item.path, base))), item.source.sha256);
  const row = vectors.items.find(row => row.id === item.id);
  assert.equal(row.assetSha256, item.source.sha256);
  const prompt = imageClipPrompts(item.target);
  assert.deepEqual(row.targetPrompts, prompt.texts);
  for (const vector of [row.imageVector, ...row.textVectors]) {
    assert.equal(vector.length, 512); assert.ok(vector.every(Number.isFinite));
    assert.ok(Math.abs(vector.reduce((sum, x) => sum + x*x, 0) - 1) < 1e-5);
  }
  const semantic = semanticScores(row.imageVector, row.textVectors, prompt.sceneCount, prompt.alternativeCount);
  const group = counts[item.distractorKind] ||= { labeledWrong: 0, acceptedByCurrentGate: 0 };
  group.labeledWrong++; group.acceptedByCurrentGate += Number(passesImageSemanticGate(semantic));
}
console.log(JSON.stringify({ count: 36, task: 'semantic', trained: false, trainOnly: true,
  distinctReusedPhotos: new Set(manifest.items.filter(x => x.distractorKind === 'photo').map(x => x.source.sha256)).size,
  currentGateDiagnostic: counts, note: 'Training supplement only; not an independent accuracy evaluation.' }, null, 2));
