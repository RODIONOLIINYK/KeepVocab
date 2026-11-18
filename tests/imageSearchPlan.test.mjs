import test from 'node:test';
import assert from 'node:assert/strict';
import { imageCandidateBudgets, imageEvaluationCandidates } from '../js/services/imageSearchPlan.js';

test('image quotas retain up to three per prompt with a shared cap of nine', () => {
  assert.deepEqual(imageCandidateBudgets(0), []);
  assert.deepEqual(imageCandidateBudgets(Infinity), []);
  assert.deepEqual(imageCandidateBudgets(1), [3]);
  assert.deepEqual(imageCandidateBudgets(2), [3, 3]);
  assert.deepEqual(imageCandidateBudgets(3), [3, 3, 3]);
  assert.deepEqual(imageCandidateBudgets(4), [3, 2, 2, 2]);
  assert.deepEqual(imageCandidateBudgets(5), [2, 2, 2, 2, 1]);
  for (let count = 1; count <= 30; count++) {
    const totals = Array(count).fill(0);
    for (let page = 1; page <= count; page++) {
      const budgets = imageCandidateBudgets(count, page);
      assert.equal(budgets.reduce((sum, n) => sum + n, 0), Math.min(9, count * 3));
      assert.ok(Math.max(...budgets) <= 3);
      assert.ok(Math.max(...budgets) - Math.min(...budgets) <= 1);
      budgets.forEach((n, i) => { totals[i] += n; });
    }
    assert.equal(new Set(totals).size, 1, 'extra slots rotate fairly across pages');
  }
});

test('direct evaluation selects across grouped prompts before applying the nine-image cap', () => {
  const candidates = Array.from({ length: 4 }, (_, scene) => Array.from({ length: 10 }, (_, i) => ({
    url: `https://budget.test/${scene}/${i}.jpg`, visualScene: `scene ${scene}`
  }))).flat();
  const selected = imageEvaluationCandidates(candidates);
  assert.equal(selected.length, 9);
  assert.deepEqual([0, 1, 2, 3].map(i => selected.filter(image => image.visualScene === `scene ${i}`).length), [3, 2, 2, 2]);
  assert.deepEqual(imageEvaluationCandidates(selected, 2), selected, 'a retrieved pool is not allocated twice');
  assert.deepEqual(imageEvaluationCandidates([selected[0], ...selected]), selected, 'repeat URLs do not consume evaluation slots');
  assert.equal(candidates.length, 40, 'selection leaves the caller pool intact');
  const anonymous = candidates.map(({ visualScene, ...image }) => image);
  assert.deepEqual(imageEvaluationCandidates(anonymous), anonymous.slice(0, 9));
});

test('the six-image first pass keeps scene diversity and never exceeds a nine-image request', () => {
  const pool = Array.from({ length: 3 }, (_, scene) => Array.from({ length: 3 }, (_, i) => ({
    url: `https://progressive.test/${scene}/${i}.jpg`, visualScene: `scene ${scene}`
  }))).flat();
  const first = imageEvaluationCandidates(pool, 1, 6);
  assert.equal(first.length, 6);
  assert.deepEqual([0, 1, 2].map(i => first.filter(image => image.visualScene === `scene ${i}`).length), [2, 2, 2]);
  assert.equal(imageEvaluationCandidates(pool, 1, 45).length, 9);
});
