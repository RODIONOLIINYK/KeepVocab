import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMeaningExplanation, reviewedExplanationPatch, applyReviewedExplanations } from '../js/components/MeaningExplanation.js';
import { renderLibraryView } from '../js/components/LibraryView.js';
import { driveSync } from '../js/services/driveSync.js?v=18900';

const source = 'Appearing to be foreign; strange, unfamiliar.';
const original = { id: 'meaning', word: 'outlandish', partOfSpeech: 'adjective', definition: source, sourceDefinition: source, example: '' };
const candidate = { ...original, definition: 'Very strange or unusual, especially compared with what people normally expect.', example: 'His outlandish outfit made everyone turn to look.', usageNote: 'Use it for ideas, clothes, or behaviour that seem unusually strange.', explanationSource: 'gemini', explanationVersion: 2 };

test('a learner explanation has one primary meaning and optional source evidence, with escaped text', () => {
  const html = renderMeaningExplanation({ ...candidate, usageNote: '<script>bad</script>' });
  assert.match(html, /class="meaning-definition"/);
  assert.ok(html.includes(candidate.definition));
  assert.match(html, /<summary>Dictionary source<\/summary>/);
  assert.ok(html.includes(source));
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(html, /concise|Full definition|<script>/);
  assert.doesNotMatch(renderMeaningExplanation(original), /<details/);
});

test('review application requires a modern example bound to the exact saved source sense', () => {
  const patch = reviewedExplanationPatch(original, candidate);
  assert.equal(patch.definition, candidate.definition);
  assert.equal(patch.sourceDefinition, source);
  assert.equal(patch.example, candidate.example);
  assert.equal(patch.exampleSourceUrl, '');
  assert.equal(patch.exampleLicense, '');
  assert.ok(!Object.hasOwn(patch, 'practiceStats'));
  assert.throws(() => reviewedExplanationPatch(original, { ...candidate, sourceDefinition: 'Another sense.' }), /does not match/);
  assert.throws(() => reviewedExplanationPatch(original, { ...candidate, example: '' }), /modern example/);
  assert.throws(() => reviewedExplanationPatch(original, { ...candidate, example: 'I think I have ſeen your Ladyſhip in ſuch an outlandiſh one.' }), /modern example/);
});

test('review preserves progress changed while preview is open and skips separately edited meanings', () => {
  const latest = { ...original, practiceStats: { attempts: 12 }, srs: { stability: 20 } };
  const patches = [];
  const service = { getWords: () => [latest], updateWord: (id, patch) => { patches.push({ id, patch }); Object.assign(latest, patch); } };
  assert.deepEqual(applyReviewedExplanations(service, [{ original, candidate, selected: true }]), { applied: 1, skipped: 0 });
  assert.equal(latest.practiceStats.attempts, 12);
  assert.equal(latest.srs.stability, 20);
  assert.equal(patches.length, 1);
  assert.deepEqual(applyReviewedExplanations(service, [{ original, candidate, selected: true }]), { applied: 0, skipped: 1 });
});

test('Library shows the canonical learner explanation and no competing short clue', () => {
  const methods = ['getActiveNotebook', 'getWords', 'getWordsByMonthYear', 'getMonthlyArchives'];
  const originals = new Map(methods.map(name => [name, driveSync[name]]));
  const controls = new Map();
  const container = { innerHTML: '', querySelector(selector) {
    if (!controls.has(selector)) controls.set(selector, { addEventListener() {}, value: '' });
    return controls.get(selector);
  }, querySelectorAll() { return []; } };
  try {
    driveSync.getActiveNotebook = () => 'October 2026 Vocabulary';
    driveSync.getWords = driveSync.getWordsByMonthYear = () => [{ ...candidate, conciseDefinition: 'Obsolete competing clue.' }];
    driveSync.getMonthlyArchives = () => [{ monthYear: 'October 2026', wordCount: 1, count: 1 }];
    renderLibraryView(container);
    assert.ok(container.innerHTML.includes(candidate.definition));
    assert.ok(container.innerHTML.includes(candidate.example));
    assert.match(container.innerHTML, /Understand meaning/);
    assert.doesNotMatch(container.innerHTML, /Obsolete competing clue|shorten-definition|conciseDefinition|Choose the notebook you want to manage|Keep your vocabulary, meanings, and memory cues in one place/);
  } finally { for (const [name, method] of originals) driveSync[name] = method; }
});

test('an empty or failed explanation has no review form or Apply button', async () => {
  const { renderExplanationReview } = await import('../js/components/MeaningExplanation.js');
  assert.equal(renderExplanationReview([]), '');
  assert.equal(renderExplanationReview([{ original, error: 'provider failed' }]), '');
});


test('Library exposes Delete beside Edit and confirms before deleting a meaning', () => {
  const methods = ['getActiveNotebook', 'getWords', 'getWordsByMonthYear', 'getMonthlyArchives', 'deleteWord'];
  const originals = new Map(methods.map(name => [name, driveSync[name]]));
  const controls = new Map();
  const getControl = selector => {
    if (!controls.has(selector)) controls.set(selector, { callbacks: {}, dataset: {}, value: '', addEventListener(event, callback) { this.callbacks[event] = callback; } });
    return controls.get(selector);
  };
  const deleteButton = getControl('delete-button');
  deleteButton.dataset.deleteWord = candidate.id;
  const container = {
    innerHTML: '',
    querySelector: getControl,
    querySelectorAll(selector) { return selector === '[data-delete-word]' ? [deleteButton] : []; }
  };
  let words = [{ ...candidate }];
  const deleted = [];
  try {
    driveSync.getActiveNotebook = () => 'October 2026 Vocabulary';
    driveSync.getWords = driveSync.getWordsByMonthYear = () => words;
    driveSync.getMonthlyArchives = () => [];
    driveSync.deleteWord = id => { deleted.push(id); words = []; };
    renderLibraryView(container);
    const actions = container.innerHTML.split('class="library-card-actions"')[1].split('<details')[0];
    assert.match(actions, /data-edit-word="meaning"/);
    assert.match(actions, /data-delete-word="meaning"/);
    assert.match(actions, /> Delete<\/button>/);
    deleteButton.callbacks.click();
    assert.deepEqual(deleted, []);
    assert.match(container.innerHTML, /Delete this meaning of/);
    getControl('[data-confirm-delete]').callbacks.click({ currentTarget: { dataset: { confirmDelete: candidate.id } } });
    assert.deepEqual(deleted, [candidate.id]);
    assert.match(container.innerHTML, /Add your first word/);
  } finally { for (const [name, method] of originals) driveSync[name] = method; }
});
