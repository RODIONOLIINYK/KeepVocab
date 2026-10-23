import test from 'node:test';
import assert from 'node:assert/strict';
import { focusPracticeInput } from '../js/components/PracticeElements.js';
import { renderSpellingMode } from '../js/components/PracticeModes.js';
import { mountUseItExercise } from '../js/components/UseItExercise.js';
import { DriveSyncService, MemoryStorage, driveSync } from '../js/services/driveSync.js?v=18900';

function replaceGlobal(context, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  context.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
}

// Minimal controls for executing real view callbacks without a browser. Focus
// calls are observable while form submissions use the actual result service.
class PracticeContainer {
  controls = new Map();
  focusCalls = [];
  markup = '';
  set innerHTML(value) { this.markup = value; this.controls.clear(); }
  get innerHTML() { return this.markup; }
  querySelector(selector) {
    const exists = selector.startsWith('#') ? this.markup.includes(`id="${selector.slice(1)}"`)
      : selector.startsWith('[') && this.markup.includes(selector.slice(1, -1));
    if (!exists) return null;
    if (!this.controls.has(selector)) {
      const container = this;
      this.controls.set(selector, {
        value: '', listeners: {},
        addEventListener(event, callback) { this.listeners[event] = callback; },
        focus(options) { container.focusCalls.push({ selector, options }); }
      });
    }
    return this.controls.get(selector);
  }
  querySelectorAll() { return []; }
}

function installPractice(context, touch) {
  const persistence = new DriveSyncService(new MemoryStorage());
  const now = new Date();
  const words = ['apple', 'pear'].map(word => ({ id: word, word, definition: `The meaning of ${word}.`,
    courseId: 'english', monthYear: 'October 2026',
    createdAt: new Date(now - 86400000).toISOString(), nextReviewDate: new Date(now - 60000).toISOString() }));
  persistence.saveWords(words);
  persistence.setActiveNotebook('October 2026 Vocabulary');
  const names = ['getActiveNotebook', 'getWordsByMonthYear', 'getSettings', 'updateSettings', 'getWords', 'saveWords', 'recordReview', 'appendReviewEvent'];
  const original = new Map(names.map(name => [name, driveSync[name]]));
  for (const name of names) driveSync[name] = name === 'appendReviewEvent' ? undefined : persistence[name].bind(persistence);
  context.after(() => { for (const [name, value] of original) driveSync[name] = value; });
  replaceGlobal(context, 'matchMedia', () => ({ matches: touch }));
  const events = [];
  replaceGlobal(context, 'window', { dispatchEvent(event) { events.push(event.type); } });
  return { persistence, words, events };
}

test('desktop focus remains automatic without scrolling the clue away', context => {
  replaceGlobal(context, 'matchMedia', () => ({ matches: false }));
  const calls = [];
  focusPracticeInput({ focus: options => calls.push(options) });
  assert.deepEqual(calls, [{ preventScroll: true }]);
  assert.doesNotThrow(() => focusPracticeInput(null));
});

test('coarse pointer entry waits for a tap while an explicit typing action can open the keyboard', context => {
  replaceGlobal(context, 'matchMedia', () => ({ matches: true }));
  const calls = [];
  const input = { focus: options => calls.push(options) };
  focusPracticeInput(input);
  assert.deepEqual(calls, []);
  focusPracticeInput(input, { allowTouch: true });
  assert.deepEqual(calls, [{ preventScroll: false }]);
});

test('spelling preserves desktop autofocus and records a real submitted answer', context => {
  const { persistence, words, events } = installPractice(context, false);
  const container = new PracticeContainer();
  renderSpellingMode(container);
  assert.deepEqual(container.focusCalls, [{ selector: '#spell-answer', options: { preventScroll: true } }]);
  const target = words.find(word => container.innerHTML.includes(word.definition));
  container.querySelector('#spell-answer').value = target.word;
  container.querySelector('#spell-form').listeners.submit({ preventDefault() {} });
  const reviewed = persistence.getWords().find(word => word.id === target.id);
  assert.equal(reviewed.practiceStats.attempts, 1);
  assert.equal(reviewed.practiceStats.recalled, 1);
  assert.equal(reviewed.lastExerciseResult.recallType, 'listening-recall');
  assert.deepEqual(events, ['keepvocab:progress']);
  assert.match(container.innerHTML, /Excellent recall/);
});

test('mobile spelling keeps the first clue visible, resumes typing on Next, and still records correct and missed outcomes', context => {
  const { persistence, words, events } = installPractice(context, true);
  const container = new PracticeContainer();
  renderSpellingMode(container);
  assert.deepEqual(container.focusCalls, []);
  const first = words.find(word => container.innerHTML.includes(word.definition));
  container.querySelector('#spell-answer').value = first.word;
  container.querySelector('#spell-form').listeners.submit({ preventDefault() {} });
  assert.deepEqual(container.focusCalls, []);
  container.querySelector('#spell-next').listeners.click();
  assert.deepEqual(container.focusCalls, [{ selector: '#spell-answer', options: { preventScroll: false } }]);
  const second = words.find(word => word.id !== first.id);
  assert.ok(container.innerHTML.includes(second.definition));
  container.querySelector('#spell-answer').value = 'a different word';
  container.querySelector('#spell-form').listeners.submit({ preventDefault() {} });
  const saved = persistence.getWords();
  assert.equal(saved.find(word => word.id === first.id).practiceStats.recalled, 1);
  const missed = saved.find(word => word.id === second.id);
  assert.equal(missed.practiceStats.missed, 1);
  assert.equal(missed.lastExerciseResult.correct, false);
  assert.ok(Date.parse(missed.nextReviewDate) > Date.now());
  assert.deepEqual(events, ['keepvocab:progress', 'keepvocab:progress']);
});

test('Use It opens the touch keyboard for an explicit Edit action and preserves the sentence', context => {
  replaceGlobal(context, 'matchMedia', () => ({ matches: true }));
  const container = new PracticeContainer();
  const sentence = 'I can restrain my enthusiasm.';
  const controller = mountUseItExercise(container, {
    word: { id: 'restrain', word: 'restrain', definition: 'To hold back.' }, sentence,
    result: { correct: true, feedback: 'Good use of the meaning.' }
  });
  assert.deepEqual(container.focusCalls, []);
  container.querySelector('[data-useit-retry]').listeners.click();
  assert.deepEqual(container.focusCalls, [{ selector: '[data-useit-sentence]', options: { preventScroll: false } }]);
  assert.ok(container.innerHTML.includes(sentence));
  assert.ok(container.querySelector('[data-useit-form]'));
  controller.destroy();
});
