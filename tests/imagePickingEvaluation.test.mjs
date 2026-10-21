import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateImagePicking } from '../scripts/evaluate-image-picking.mjs';

// These fixtures are synthetic metadata regressions, not photographed-image ground truth.
const candidate = (id, title) => ({ id, url: `https://images.example/${id}.jpg?token=private`, title, source: 'Pexels', category: 'photograph' });
const sense = feedback => ({ id: 'synthetic-running', word: { word: 'run', definition: 'Move at a speed faster than a walk.', apiKey: 'not part of the fixture contract' }, concepts: ['athlete sprinting track'], candidates: [candidate('strong', 'athlete sprinting track'), candidate('weaker', 'athlete sprinting'), candidate('unrelated', 'city skyline')], feedback });

test('offline evaluation reports top1/top3 only against explicit synthetic labels without leaking labels into ranking', () => {
  const report = evaluateImagePicking({ kind: 'synthetic', cases: [sense({ selected: ['weaker'], wrong: ['unrelated'] })] });
  assert.equal(report.fixtureKind, 'synthetic');
  assert.equal(report.top1.positiveHits, 0);
  assert.equal(report.top3.positiveHits, 1);
  assert.equal(report.unlabeledAtTop1, 1);
  assert.equal(report.cases[0].rankedIds[0], 'strong');
  assert.match(report.note, /not real-world accuracy/);
  assert.doesNotMatch(JSON.stringify(report), /private|apiKey|not part of/);
});

test('no fixture or no explicit positive labels produces no invented accuracy denominator', () => {
  const empty = evaluateImagePicking();
  assert.equal(empty.evaluatedCases, 0);
  assert.equal(empty.top1.rate, null);
  assert.match(empty.note, /no accuracy claim/);
  const wrongOnly = evaluateImagePicking({ kind: 'synthetic', cases: [sense({ wrong: ['strong'] })] });
  assert.equal(wrongOnly.explicitlyWrongAtTop1, 1);
  assert.equal(wrongOnly.top1.rate, null);
  assert.equal(wrongOnly.top3.rate, null);
});

test('evaluation rejects conflicting, unknown, and duplicate candidate labels', () => {
  assert.throws(() => evaluateImagePicking({ cases: [sense({ good: ['strong'], wrong: ['strong'] })] }), /Conflicting/);
  assert.throws(() => evaluateImagePicking({ cases: [sense({ selected: ['missing'] })] }), /missing candidate/);
  const duplicate = sense({ selected: ['strong'] });
  duplicate.candidates.push(duplicate.candidates[0]);
  assert.throws(() => evaluateImagePicking({ cases: [duplicate] }), /duplicate/);
});
