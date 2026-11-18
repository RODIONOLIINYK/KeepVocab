import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, driveSync } from '../js/services/driveSync.js?v=18908';
import { consolidationStatusMessages, setupAddWordModal } from '../js/components/AddWordModal.js';
import { mountMeaningPairReview } from '../js/components/MeaningPairReview.js';
import { getMeaningCorrectionsForTraining, createMeaningJudgment, recordMeaningJudgment } from '../js/services/meaningEquivalenceLearning.js';
import { disableImageLearning } from '../js/services/imageLearning.js?v=18908';
import { MEANING_MODEL_TAG } from '../js/ml/meaningConfig.js';
import { removeMeaningModel } from '../js/services/meaningReference.js';

function installMergeModel(context) {
  globalThis.caches = { open: async () => ({ has: async () => true }), delete: async () => true };
  globalThis.Worker = class {
    postMessage({ id, pairs = [] }) {
      queueMicrotask(() => this.onmessage({ data: { id, result: { model: MEANING_MODEL_TAG, scores: pairs.map(() => 0) } } }));
    }
    terminate() {}
  };
  context.after(removeMeaningModel);
}
class MockClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  _syncFromString(value) {
    this.set = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }
  _syncToAttr() {
    this.el._className = [...this.set].join(' ');
  }
  add(...names) { names.forEach(n => this.set.add(n)); this._syncToAttr(); }
  remove(...names) { names.forEach(n => this.set.delete(n)); this._syncToAttr(); }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : Boolean(force);
    if (on) this.set.add(name);
    else this.set.delete(name);
    this._syncToAttr();
    return on;
  }
  contains(name) { return this.set.has(name); }
}

class MockElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.dataset = {};
    this.classList = new MockClassList(this);
    this._className = '';
    this._textContent = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.type = '';
    this.lang = '';
    this.rows = 0;
  }
  get className() { return this._className; }
  set className(value) {
    this._className = String(value || '');
    this.classList._syncFromString(this._className);
  }
  get id() { return this.attributes.get('id') || ''; }
  set id(value) { this.attributes.set('id', String(value)); }
  get textContent() {
    if (!this.children.length) return this._textContent;
    return this.children.map(child => child.textContent).join('');
  }
  set textContent(value) {
    this.children = [];
    this._textContent = value == null ? '' : String(value);
  }
  set innerHTML(value) {
    this.children = [];
    this._textContent = '';
    this._rawInnerHTML = String(value || '');
  }
  get innerHTML() { return this._rawInnerHTML || ''; }
  setAttribute(name, value) {
    const val = String(value);
    this.attributes.set(name, val);
    if (name === 'class') this.className = val;
    else if (name === 'hidden') this.hidden = true;
    else if (name === 'disabled') this.disabled = true;
    else if (name.startsWith('data-')) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      this.dataset[camel] = val;
    }
  }
  getAttribute(name) {
    if (name === 'class') return this.className;
    if (name === 'hidden') return this.hidden ? '' : null;
    if (name === 'disabled') return this.disabled ? '' : null;
    return this.attributes.get(name) ?? null;
  }
  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === 'string') {
        this._textContent += node;
      } else if (node) {
        node.parentNode = this;
        this.children.push(node);
      }
    }
  }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) {
    this.children = [];
    this._textContent = '';
    this.append(...nodes);
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  async dispatchEvent(event) {
    const ev = { type: event.type, target: this, preventDefault() {}, stopImmediatePropagation() {}, ...event };
    for (const fn of this.listeners.get(ev.type) || []) await fn(ev);
  }
  async click() {
    if (this.disabled) return;
    await this.dispatchEvent({ type: 'click' });
  }
  focus() {}
  insertAdjacentHTML(_position, html) {
    const parsed = parseHtmlFragment(html);
    for (const node of parsed) this.appendChild(node);
  }
  _matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('[') && selector.endsWith(']')) {
      const attr = selector.slice(1, -1);
      const equality = attr.match(/^([^=]+)="([^"]*)"$/);
      if (equality) return this.getAttribute(equality[1]) === equality[2];
      return this.attributes.has(attr) || (attr === 'data-meaning-mode' && Object.hasOwn(this.dataset, 'meaningMode'));
    }
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    const found = [];
    const walk = node => {
      for (const child of node.children) {
        if (child._matches(selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

const VOID_TAGS = new Set(['input', 'br', 'hr', 'img']);
function parseHtmlFragment(html) {
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, '');
  const root = new MockElement('div');
  const stack = [root];
  const tokenRe = /<\/?([a-zA-Z0-9-]+)([^>]*)>|([^<]+)/g;
  let match;
  while ((match = tokenRe.exec(cleaned))) {
    const [full, tag, attrs, text] = match;
    if (text !== undefined) {
      if (text.trim()) stack.at(-1).append(text);
      continue;
    }
    if (full.startsWith('</')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const el = new MockElement(tag);
    const attrRe = /([a-zA-Z0-9:-]+)(?:="([^"]*)")?/g;
    let attrMatch;
    while ((attrMatch = attrRe.exec(attrs))) {
      el.setAttribute(attrMatch[1], attrMatch[2] ?? '');
    }
    stack.at(-1).appendChild(el);
    if (!VOID_TAGS.has(tag.toLowerCase()) && !full.endsWith('/>')) stack.push(el);
  }
  return root.children;
}

function setupDom(context) {
  const originals = Object.fromEntries(
    ['document', 'window', 'localStorage', 'fetch', 'caches', 'Worker']
      .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  );
  const storage = new MemoryStorage();
  const body = new MockElement('body');
  const doc = {
    body,
    createElement: tag => new MockElement(tag),
    getElementById: id => body.querySelector(`#${id}`),
    querySelectorAll: selector => body.querySelectorAll(selector),
    addEventListener() {}
  };
  const win = {
    addEventListener() {},
    setTimeout: fn => { fn(); return 1; }
  };
  globalThis.document = doc;
  globalThis.window = win;
  globalThis.localStorage = storage;
  disableImageLearning();

  context.after(() => {
    disableImageLearning();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { storage, document: doc, body };
}

test('consolidation status retains actionable warnings without technical diagnostics or counts', () => {
  const single = consolidationStatusMessages({
    senses: [{ id: 'g1' }, { id: 'g2' }],
    consolidationWarning: 'Meaning groups contradicted a saved Different meanings judgment.',
    meaningInference: { local: 'ready', comparedPairs: 2, scorer: 'calibrated-equivalence', gemini: 'failed' },
    senseConsolidation: { originalCount: 4, coreCount: 2 }
  }, { single: true });

  assert.equal(single.warning, 'Automatic meaning grouping warning: Meaning groups contradicted a saved Different meanings judgment.');




  assert.deepEqual(single.lines, [single.warning]);
  assert.equal(single.diagnostics, ''); assert.equal(single.summary, '');

  const unavailableBulk = consolidationStatusMessages({
    senses: [{ id: 'g1' }, { id: 'g2' }],
    consolidationWarning: 'Meaning grouping is temporarily unavailable.',
    meaningInference: { local: 'unavailable', comparedPairs: 0 },
    senseConsolidation: { originalCount: 3, coreCount: 2 }
  }, { single: false });
  assert.equal(unavailableBulk.warning, 'Meaning grouping is temporarily unavailable.');


  assert.deepEqual(unavailableBulk.lines, [unavailableBulk.warning]);

  // Simple entry with not-needed inference produces no noisy diagnostics
  const quiet = consolidationStatusMessages({
    senses: [{ id: 'g1' }],
    meaningInference: { local: 'not-needed', comparedPairs: 0 },
    senseConsolidation: { originalCount: 1, coreCount: 1 }
  }, { single: true });
  assert.equal(quiet.warning, '');
  assert.equal(quiet.diagnostics, '');

});

test('AddWordModal shows actionable warnings only in single and bulk flows', async context => {
  const { storage, document } = setupDom(context);
  driveSync.storage = storage;
  storage.setItem('keepvocab_gemini_live_key_v1', 'synthetic-gemini-test-key');

  globalThis.fetch = async url => {
    const text = String(url);
    if (text.includes('freedictionaryapi.com')) {
      return new Response(JSON.stringify([{
        word: 'charge',
        phonetics: [{ text: '/tʃɑːdʒ/' }],
        meanings: [{
          partOfSpeech: 'verb',
          definitions: [
            { definition: 'To demand money as a price for a service.' },
            { definition: 'To accuse someone formally of an offence.' }
          ]
        }]
      }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (text.includes('generativelanguage.googleapis.com')) {
      return new Response(JSON.stringify({ error: { message: 'Synthetic Gemini outage' } }), {
        status: 500, headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error(`Unexpected fetch URL: ${text}`);
  };

  setupAddWordModal();

  // Single-word lookup flow
  const wordInput = document.getElementById('add-word-input');
  const lookupForm = document.getElementById('add-word-lookup-form');
  const find = document.getElementById('btn-auto-fetch-word');
  wordInput.value = 'charge';
  await lookupForm.dispatchEvent({ type: 'submit' });
  for (let i = 0; i < 40 && find.disabled; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }

  const notes = document.getElementById('add-word-consolidation-notes');
  assert.equal(notes.hidden, false);
  const children = notes.children;
  assert.equal(children.length, 1);
  assert.ok(children[0].classList.contains('consolidation-warning'));
  assert.equal(children[0].getAttribute('role'), 'alert');
  assert.match(children[0].textContent, /Synthetic Gemini outage/);
  assert.equal(children.some(child => child.classList.contains('consolidation-diagnostics') || child.classList.contains('consolidation-summary')), false);

  // Bulk lookup flow
  const bulkInput = document.getElementById('bulk-word-input');
  const bulkPrepare = document.getElementById('prepare-bulk-words');
  bulkInput.value = 'charge';
  await bulkPrepare.click();

  const bulkRow = document.getElementById('bulk-word-results').querySelector('.bulk-word-row');
  assert.ok(bulkRow);
  const bulkNotes = bulkRow.children.filter(el => el.classList.contains('sense-helper'));
  assert.equal(bulkNotes.length, 1);
  assert.ok(bulkNotes[0].classList.contains('consolidation-warning'));


});

test('MeaningPairReview logs exact decisions without vectors, workers or permanent overrides', async context => {
  const { storage, document } = setupDom(context);
  driveSync.storage = storage;
  const a = { id: 'a', word: 'probe', partOfSpeech: 'verb', definition: 'To examine closely with an instrument.' };
  const b = { id: 'b', word: 'probe', partOfSpeech: 'verb', definition: '(UK) To investigate thoroughly.' };
  let changes = 0;
  globalThis.Worker = class { constructor() { assert.fail('Feedback must not load an encoder'); } };
  const container = document.createElement('div');
  mountMeaningPairReview(container, { word: 'probe', senses: [a, b] }, {
    onChange: record => { changes++; assert.equal(record.label, 1); },
    encodeDefinitionTexts: () => assert.fail('Feedback must not encode vectors')
  });
  await container.children[0].click();
  await container.children[1].querySelectorAll('button').find(b => b.textContent === 'Same meaning').click();
  assert.equal(changes, 1);
  assert.equal(container.children[1].hidden, false);
  const { corrections } = await getMeaningCorrectionsForTraining();
  const saved = corrections.find(row => row.word === 'probe');
  assert.equal(saved.label, 1);
  assert.equal(saved.senseA.definition, a.definition);
  const persisted = await driveSync.imageHistory.readState('meaningEquivalenceLearning-v1');
  assert.deepEqual(Object.keys(persisted), ['corrections']);
  assert.equal(JSON.stringify(persisted).includes('rawA'), false);

  // A fresh review does not hide a pair simply because it was logged before.
  const next = document.createElement('div');
  mountMeaningPairReview(next, { word: 'probe', senses: [a, b] });
  await next.children[0].click();
  assert.ok(next.children[1].querySelectorAll('button').find(b => b.textContent === 'Same meaning'));
});

test('MeaningPairReview stays closed when the user closes it during an asynchronous update', async context => {
  const { storage, document } = setupDom(context); driveSync.storage = storage;
  let release, started;
  const updating = new Promise(resolve => { started = resolve; });
  const container = document.createElement('div');
  mountMeaningPairReview(container, { word: 'bank', senses: [
    { partOfSpeech: 'noun', definition: 'A financial institution.' },
    { partOfSpeech: 'noun', definition: 'The land alongside a river.' }
  ] }, { onChange: async () => { started(); await new Promise(resolve => { release = resolve; }); } });
  const [opener, panel] = container.children;
  await opener.click();
  const pending = panel.querySelectorAll('button').find(b => b.textContent === 'Different meanings').click();
  await updating;
  await opener.click();
  release(); await pending;
  assert.equal(panel.hidden, true);
  assert.equal(opener.getAttribute('aria-expanded'), 'false');
});

test('MeaningPairReview skips deterministic near-duplicates and already-judged near-duplicate twins', async context => {
  const { storage, document } = setupDom(context);
  driveSync.storage = storage;
  await driveSync.imageHistory.ready;

  const calmSenses = [
    { id: 'a', word: 'calm', partOfSpeech: 'verb', definition: 'To make calm.' },
    { id: 'b', word: 'calm', partOfSpeech: 'verb', definition: 'To become calm.' },
    { id: 'c', word: 'calm', partOfSpeech: 'verb', definition: '(transitive) To make calm.' },
    { id: 'd', word: 'calm', partOfSpeech: 'verb', definition: '(intransitive) To become calm.' },
    { id: 'e', word: 'calm', partOfSpeech: 'verb', definition: 'To soothe or quiet down.' }
  ];
  const sessionRecord = createMeaningJudgment('calm', calmSenses[0], calmSenses[1], false);

  const container = document.createElement('div');
  mountMeaningPairReview(container, { word: 'calm', senses: calmSenses }, { sessionRecords: [sessionRecord] });
  await container.children[0].click();
  const paragraphs = container.children[1].querySelectorAll('p').map(p => p.textContent);
  assert.ok(paragraphs.some(text => text === 'To soothe or quiet down.'),
    'review queue should skip all calm make/become near-duplicate twins and advance to unjudged pairs');
  assert.ok(!paragraphs.some(text => text === '(intransitive) To become calm.')
    || !paragraphs.some(text => text === '(transitive) To make calm.'));
});

test('AddWordModal shows an Unmerge button on merged meanings and splits them cleanly when clicked', async context => {
  const { storage, document } = setupDom(context);
  driveSync.storage = storage;
  installMergeModel(context);
  await driveSync.imageHistory.ready;

  globalThis.fetch = async url => {
    const text = String(url);
    if (text.includes('freedictionaryapi.com')) {
      return new Response(JSON.stringify([{
        word: 'warm',
        phonetics: [{ text: '/wɔːm/' }],
        meanings: [{
          partOfSpeech: 'verb',
          definitions: [
            { definition: '(transitive) To make or keep warm.' },
            { definition: '(intransitive) To make or keep warm.' },
            { definition: 'To show affection toward.' }
          ]
        }]
      }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected fetch URL: ${text}`);
  };

  setupAddWordModal();
  const wordInput = document.getElementById('add-word-input');
  const lookupForm = document.getElementById('add-word-lookup-form');
  const find = document.getElementById('btn-auto-fetch-word');
  wordInput.value = 'warm';
  await lookupForm.dispatchEvent({ type: 'submit' });
  for (let i = 0; i < 40 && find.disabled; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }

  const senseList = document.getElementById('add-word-sense-list');
  assert.equal(senseList.querySelectorAll('.sense-option').length, 2);
  const unmergeBtn = senseList.querySelector('.sense-unmerge-btn');
  assert.ok(unmergeBtn, 'merged sense row must render an Unmerge button');
  assert.equal(unmergeBtn.textContent, 'Unmerge');

  const before = (await getMeaningCorrectionsForTraining()).corrections.length;
  await unmergeBtn.click();
  let review = senseList.querySelector('.unmerge-review');
  assert.ok(review.textContent.includes('(transitive) To make or keep warm.'));
  assert.ok(review.textContent.includes('(intransitive) To make or keep warm.'));
  assert.equal(senseList.querySelectorAll('.sense-option').length, 2, 'preview must not split yet');
  await review.querySelectorAll('button').find(b => b.textContent === 'Keep merged').click();
  assert.equal((await getMeaningCorrectionsForTraining()).corrections.length, before, 'cancel must not record a label');
  await unmergeBtn.click();
  review = senseList.querySelector('.unmerge-review');
  await review.querySelectorAll('button').find(b => b.textContent === 'Unmerge these meanings').click();
  for (let i = 0; i < 40 && senseList.querySelectorAll('.sense-option').length < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }

  assert.equal(senseList.querySelectorAll('.sense-option').length, 3);
  assert.equal(senseList.querySelector('.sense-unmerge-btn'), null);
  const savedState = await getMeaningCorrectionsForTraining();
  assert.ok(savedState.corrections.some(r => r.word === 'warm' && r.action === 'unmerge' && r.surface === 'add-word'));
  await lookupForm.dispatchEvent({ type: 'submit' });
  for (let i = 0; i < 40 && senseList.querySelectorAll('.sense-option').length !== 2; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(senseList.querySelectorAll('.sense-option').length, 2, 'new lookup must merge normally despite the log');

});

test('user correction journal preserves merge/unmerge reversals and exact provenance without storing vectors or overrides', async context => {
  const { storage } = setupDom(context); driveSync.storage = storage;
  const a = { word: 'correction-probe', partOfSpeech: 'noun', sourceDefinition: 'Original dictionary A.', sourceUrl: 'https://dictionary.test/a', license: 'CC BY-SA' };
  const b = { ...a, sourceDefinition: 'Original dictionary B.', sourceUrl: 'https://dictionary.test/b' };
  for (const label of [false, true, false]) await recordMeaningJudgment(a.word, a, b, label,
    { encodeDefinitionTexts: async () => null, surface: 'library', modelScore: .72 });
  const state = await getMeaningCorrectionsForTraining(), events = state.corrections.filter(row => row.word === a.word);
  assert.deepEqual(events.map(row => row.label), [0, 1, 0]);
  assert.equal(new Set(events.map(row => row.id)).size, 3);
  assert.equal(events[0].senseA.sourceDefinition, a.sourceDefinition);
  assert.equal(events[0].senseB.sourceUrl, b.sourceUrl);
  assert.equal(events[0].model.score, .72);
  assert.equal(events[0].trainingEligibility, 'pending-dictionary-provenance-validation');
  assert.equal(state.records, undefined);
});

test('AddWordModal keeps Review similar meanings open and applies decisions only to the current lookup', async context => {
  const { storage, document } = setupDom(context); driveSync.storage = storage;
  installMergeModel(context);
  globalThis.fetch = async () => new Response(JSON.stringify([{
    word: 'bank', meanings: [{ partOfSpeech: 'noun', definitions: [
      { definition: 'A financial institution.' }, { definition: 'A business providing financial services.' }, { definition: 'The land alongside a river.' }
    ] }]
  }]), { headers: { 'content-type': 'application/json' } });
  setupAddWordModal();
  document.getElementById('add-word-input').value = 'bank';
  const lookup = document.getElementById('add-word-lookup-form');
  await lookup.dispatchEvent({ type: 'submit' });
  const container = document.getElementById('add-word-meaning-review');
  for (let i = 0; i < 40 && !container.children.length; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const [opener, panel] = container.children;
  const list = document.getElementById('add-word-sense-list');
  assert.equal(list.querySelectorAll('.sense-option').length, 3);
  await opener.click();
  await panel.querySelectorAll('button').find(b => b.textContent === 'Same meaning').click();
  assert.equal(list.querySelectorAll('.sense-option').length, 2);
  assert.equal(container.children[1], panel, 'regrouping must keep the same review panel');
  assert.equal(panel.hidden, false);
  assert.equal(opener.getAttribute('aria-expanded'), 'true');
  await panel.querySelectorAll('button').find(b => b.textContent === 'Different meanings').click();
  assert.equal(panel.hidden, false);
  await panel.querySelectorAll('button').find(b => b.textContent === 'Skip').click();
  assert.match(panel.textContent, /No more meaning pairs/);
  await lookup.dispatchEvent({ type: 'submit' });
  for (let i = 0; i < 40 && list.querySelectorAll('.sense-option').length !== 3; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(list.querySelectorAll('.sense-option').length, 3);
  assert.notEqual(container.children[1], panel);
  assert.equal(container.children[1].hidden, true);
});

test('jit shows every source in a three-member merge, including the displayed representative', async context => {
  const { storage, document } = setupDom(context); driveSync.storage = storage;
  installMergeModel(context);
  const definitions = [
    '(US, originally prison slang, derogatory) An inexperienced, foolhardy young man.',
    '(African-American Vernacular, Florida, slang) A term of address for a young man.',
    '(African-American Vernacular, slang) A child.'
  ];
  globalThis.fetch = async () => new Response(JSON.stringify([{
    word: 'jit', meanings: [{ partOfSpeech: 'noun', definitions: definitions.map(definition => ({ definition })) }]
  }]), { headers: { 'content-type': 'application/json' } });
  setupAddWordModal();
  document.getElementById('add-word-input').value = 'jit';
  await document.getElementById('add-word-lookup-form').dispatchEvent({ type: 'submit' });
  const review = document.getElementById('add-word-meaning-review');
  for (let i = 0; i < 40 && !review.children.length; i++) await new Promise(resolve => setTimeout(resolve, 5));
  await review.children[0].click();
  for (let i = 0; i < 2; i++) await review.children[1].querySelectorAll('button').find(b => b.textContent === 'Same meaning').click();
  const list = document.getElementById('add-word-sense-list');
  assert.equal(list.querySelectorAll('.sense-option').length, 1);
  const sources = list.querySelector('.merged-definition-list');
  assert.ok(sources.textContent.includes('All 3 merged definitions'));
  const items = sources.querySelectorAll('[role="listitem"]');
  assert.equal(items.length, 3);
  for (const definition of definitions) assert.ok(items.some(item => item.textContent.endsWith(definition)));
});

test('bulk import shows all merged definitions and uses a compact example disclosure', async context => {
  const { storage, document } = setupDom(context); driveSync.storage = storage;
  installMergeModel(context);
  const definitions = ['To make or keep warm.', '(transitive) To make or keep warm.', '(intransitive) To make or keep warm.'];
  globalThis.fetch = async () => new Response(JSON.stringify([{
    word: 'warm', meanings: [{ partOfSpeech: 'verb', definitions: definitions.map(definition => ({ definition })) }]
  }]), { headers: { 'content-type': 'application/json' } });
  setupAddWordModal();
  document.getElementById('bulk-word-input').value = 'warm';
  await document.getElementById('prepare-bulk-words').click();
  const row = document.getElementById('bulk-word-results').querySelector('.bulk-word-row');
  const sources = row.querySelector('.merged-definition-list');
  assert.ok(sources.textContent.includes('All 3 merged definitions'));
  assert.equal(sources.querySelectorAll('[role="listitem"]').length, 3);
  const disclosure = row.querySelector('.bulk-example-details');
  assert.equal(disclosure.tagName, 'DETAILS');
  assert.match(disclosure.querySelector('summary').textContent, /example \(optional\)/i);
});

test('progressive lookup keeps the final grouping order, preserves explicit choices, and starts fresh after close', async context => {
  const { storage, document } = setupDom(context);
  driveSync.storage = storage;
  storage.setItem('keepvocab_gemini_live_key_v1', 'synthetic-progressive-grouping-key');
  const definitions = [
    'To make a quiet repeated sound.',
    'To emit a faint noise over and over.',
    'To move rapidly around a room.'
  ];
  let lookups = 0;
  let finishMerge;
  globalThis.fetch = async (url, request) => {
    if (String(url).includes('freedictionaryapi.com')) {
      lookups++;
      return Response.json([{ word: 'buzz', meanings: [{ partOfSpeech: 'verb', definitions: definitions.map(definition => ({ definition })) }] }]);
    }
    const prompt = JSON.parse(request.body).contents[0].parts[0].text;
    const [{ id, senses }] = JSON.parse(prompt.split('\nParts: ')[1]);
    const distinct = senses.find(sense => sense.definition.includes('move rapidly'));
    const groups = [
      { members: [distinct.id], definition: distinct.definition, usageNote: '' },
      { members: senses.filter(sense => sense !== distinct).map(sense => sense.id), definition: definitions[0], usageNote: '' }
    ];
    return new Promise(resolve => { finishMerge = () => resolve(Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ parts: { [id]: groups } }) }] } }] })); });
  };
  const modal = setupAddWordModal();
  const form = document.getElementById('add-word-lookup-form');
  const input = document.getElementById('add-word-input');
  const list = document.getElementById('add-word-sense-list');
  const find = document.getElementById('btn-auto-fetch-word');
  const waitFor = async predicate => {
    for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 2));
    assert.ok(predicate());
  };
  for (const selectRaw of [false, true]) {
    finishMerge = null;
    modal.open();
    input.value = 'buzz';
    await form.dispatchEvent({ type: 'submit' });
    await waitFor(() => Boolean(finishMerge));
    const raw = list.querySelectorAll('.sense-option');
    assert.equal(raw.length, 3);
    if (selectRaw) await raw[1].click();
    finishMerge();
    await waitFor(() => !find.disabled);
    const final = list.querySelectorAll('.sense-option');
    assert.equal(final.length, 2);
    assert.match(final[0].textContent, /move rapidly/);
    assert.match(final[1].textContent, /2 merged/);
    assert.equal(final[0].getAttribute('aria-pressed'), String(!selectRaw));
    assert.equal(final[1].getAttribute('aria-pressed'), String(selectRaw));
    modal.close();
    assert.equal(input.value, '');
    assert.equal(list.querySelectorAll('.sense-option').length, 0);
  }
  assert.equal(lookups, 2, 'closing drops the lookup and merge result caches');
  assert.equal(storage.getItem('keepvocab_dictionary_cache_v5'), null);
  assert.equal(storage.getItem('keepvocab_learner_meaning_groups_v1'), null);
});

test('single and bulk lookup show dictionary choices without grouping controls when both providers are absent', async context => {
  const { storage, document } = setupDom(context);
  driveSync.storage = storage;
  globalThis.Worker = undefined;
  globalThis.fetch = async url => {
    assert.match(String(url), /freedictionaryapi/);
    return Response.json([{ word: 'bank', meanings: [{ partOfSpeech: 'noun', definitions: [
      { definition: 'A financial institution.' }, { definition: 'The land alongside a river.' }
    ] }] }]);
  };
  setupAddWordModal();
  document.getElementById('add-word-input').value = 'bank';
  await document.getElementById('add-word-lookup-form').dispatchEvent({ type: 'submit' });
  for (let i = 0; i < 40 && document.getElementById('btn-auto-fetch-word').disabled; i++) await new Promise(setImmediate);
  assert.equal(document.getElementById('add-word-meaning-modes').hidden, true);
  assert.equal(document.getElementById('add-word-meaning-review').children.length, 0);
  assert.equal(document.getElementById('add-word-sense-list').querySelectorAll('.sense-option').length, 2);
  assert.equal(document.getElementById('btn-save-new-word').disabled, false);
  document.getElementById('bulk-word-input').value = 'bank';
  await document.getElementById('prepare-bulk-words').click();
  const row = document.getElementById('bulk-word-results').querySelector('.bulk-word-row');
  assert.equal(row.querySelector('.meaning-mode-switch'), null);
  assert.equal(row.querySelector('select').children.length, 2);
});
