import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, driveSync } from '../js/services/driveSync.js?v=18908';
import { consolidationStatusMessages, setupAddWordModal } from '../js/components/AddWordModal.js';
import { mountMeaningPairReview } from '../js/components/MeaningPairReview.js';
import { meaningLearningState, meaningPairKey, recordMeaningJudgment } from '../js/services/meaningEquivalenceLearning.js';
import { MEANING_COMPARISON_VERSION } from '../js/services/meaningComparison.js';
import { disableImageLearning } from '../js/services/imageLearning.js?v=18908';
import { CLIP_CACHE, CLIP_DOWNLOAD_URLS, CLIP_TAG, CLIP_DIMENSION } from '../js/ml/clipConfig.js';

const vector = axis => Array.from({ length: CLIP_DIMENSION }, (_, i) => Number(i === axis));

function cachedFiles(urls = CLIP_DOWNLOAD_URLS) {
  const entries = new Set(urls);
  return {
    keys: async () => entries.size ? [CLIP_CACHE] : [],
    open: async () => ({
      keys: async () => [...entries],
      match: async url => entries.has(url)
        ? new Response('cached', { headers: { 'content-length': '6' } })
        : undefined
    })
  };
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

test('consolidationStatusMessages surfaces consolidationWarning before local summary and includes meaningInference diagnostics', () => {
  const single = consolidationStatusMessages({
    senses: [{ id: 'g1' }, { id: 'g2' }],
    consolidationWarning: 'Meaning groups contradicted a saved Different meanings judgment.',
    meaningInference: { local: 'ready', comparedPairs: 2, scorer: 'calibrated-equivalence', gemini: 'failed' },
    senseConsolidation: { originalCount: 4, coreCount: 2 }
  }, { single: true });

  assert.equal(single.warning, 'Automatic meaning grouping warning: Meaning groups contradicted a saved Different meanings judgment.');
  assert.match(single.diagnostics, /Local semantic comparison ran\./);
  assert.match(single.diagnostics, /Calibrated equivalence scorer active\./);
  assert.match(single.diagnostics, /2 pairs compared/);
  assert.match(single.summary, /^2 grouped meanings cover 4 dictionary definitions\./);
  assert.deepEqual(single.lines, [single.warning, single.diagnostics, single.summary]);

  const unavailableBulk = consolidationStatusMessages({
    senses: [{ id: 'g1' }, { id: 'g2' }],
    consolidationWarning: 'Meaning grouping is temporarily unavailable.',
    meaningInference: { local: 'unavailable', comparedPairs: 0 },
    senseConsolidation: { originalCount: 3, coreCount: 2 }
  }, { single: false });
  assert.equal(unavailableBulk.warning, 'Meaning grouping is temporarily unavailable.');
  assert.match(unavailableBulk.diagnostics, /Local semantic comparison unavailable/);
  assert.equal(unavailableBulk.summary, '2 grouped meanings cover 3 dictionary definitions');
  assert.deepEqual(unavailableBulk.lines, [unavailableBulk.warning, unavailableBulk.diagnostics, unavailableBulk.summary]);

  // Simple entry with not-needed inference produces no noisy diagnostics
  const quiet = consolidationStatusMessages({
    senses: [{ id: 'g1' }],
    meaningInference: { local: 'not-needed', comparedPairs: 0 },
    senseConsolidation: { originalCount: 1, coreCount: 1 }
  }, { single: true });
  assert.equal(quiet.warning, '');
  assert.equal(quiet.diagnostics, '');
  assert.match(quiet.summary, /^1 grouped meanings cover 1 dictionary definitions/);
});

test('AddWordModal renders consolidationWarning before inference diagnostics and local summary in both single and bulk flows', async context => {
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
  const preview = document.getElementById('add-word-preview');
  wordInput.value = 'charge';
  await lookupForm.dispatchEvent({ type: 'submit' });
  for (let i = 0; i < 40 && preview.style.display !== 'block'; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }

  const notes = document.getElementById('add-word-consolidation-notes');
  assert.equal(notes.hidden, false);
  const children = notes.children;
  assert.equal(children.length, 3);
  assert.ok(children[0].classList.contains('consolidation-warning'));
  assert.equal(children[0].getAttribute('role'), 'alert');
  assert.match(children[0].textContent, /Synthetic Gemini outage/);
  assert.ok(children[1].classList.contains('consolidation-diagnostics'));
  assert.match(children[1].textContent, /Local semantic comparison unavailable/);
  assert.ok(children[2].classList.contains('consolidation-summary'));
  assert.match(children[2].textContent, /2 grouped meanings cover 2 dictionary definitions/);

  const statusText = document.getElementById('add-word-form-status').textContent;
  assert.ok(statusText.indexOf(children[0].textContent) < statusText.indexOf(children[1].textContent));
  assert.ok(statusText.indexOf(children[1].textContent) < statusText.indexOf(children[2].textContent));

  // Bulk lookup flow
  const bulkInput = document.getElementById('bulk-word-input');
  const bulkPrepare = document.getElementById('prepare-bulk-words');
  bulkInput.value = 'charge';
  await bulkPrepare.click();

  const bulkRow = document.getElementById('bulk-word-results').querySelector('.bulk-word-row');
  assert.ok(bulkRow);
  const bulkNotes = bulkRow.children.filter(el => el.classList.contains('sense-helper'));
  assert.equal(bulkNotes.length, 3);
  assert.ok(bulkNotes[0].classList.contains('consolidation-warning'));
  assert.ok(bulkNotes[1].classList.contains('consolidation-diagnostics'));
  assert.ok(bulkNotes[2].classList.contains('consolidation-summary'));
});

test('MeaningPairReview persists manual judgments immediately without blocking and enriches exact unchanged records in the background', async context => {
  const { storage, document } = setupDom(context);
  driveSync.storage = storage;
  await driveSync.imageHistory.ready;

  const senseA = { id: 'a', word: 'probe', partOfSpeech: 'verb', definition: 'To examine closely with an instrument.' };
  const senseB = { id: 'b', word: 'probe', partOfSpeech: 'verb', definition: '(UK) To investigate thoroughly.' };
  const entry = { word: 'probe', senses: [senseA, senseB] };
  const key = meaningPairKey(entry.word, 'verb', senseA.definition, senseB.definition);

  let releaseEncode;
  const encodeStarted = new Promise(resolve => {
    // Wait hook set inside encoder below
    context._signalStart = resolve;
  });
  let encodeCalls = 0;
  let capturedTexts = null;

  const container = document.createElement('div');
  let changes = 0;
  const controller = mountMeaningPairReview(container, entry, {
    onChange: () => { changes++; },
    encodeDefinitionTexts: async texts => {
      encodeCalls++;
      capturedTexts = texts;
      context._signalStart();
      await new Promise(resolve => { releaseEncode = resolve; });
      return texts.map((_, index) => vector(index));
    }
  });

  const opener = container.children[0];
  const panel = container.children[1];
  await opener.click();
  const sameButton = panel.querySelectorAll('button').find(b => b.textContent === 'Same meaning');
  assert.ok(sameButton);

  // Manual click completes immediately without waiting on releaseEncode()
  await sameButton.click();
  assert.equal(changes, 1);

  const immediatelySaved = (await meaningLearningState()).records.find(r => r.key === key);
  assert.ok(immediatelySaved);
  assert.equal(immediatelySaved.label, 1);
  assert.equal(immediatelySaved.source, 'user');
  assert.equal(immediatelySaved.evidence, undefined);

  // Simulate AddWordModal re-rendering and destroying the controller while background enrichment runs
  controller.destroy();

  await encodeStarted;
  assert.equal(encodeCalls, 1);
  assert.equal(capturedTexts.length, 6);
  releaseEncode();
  await controller.whenEnriched();

  const enriched = (await meaningLearningState()).records.find(r => r.key === key);
  assert.equal(enriched.label, 1);
  assert.equal(enriched.evidence?.encoder, CLIP_TAG);
  assert.equal(enriched.evidence?.comparisonVersion, MEANING_COMPARISON_VERSION);
  assert.equal(enriched.evidence?.rawA?.length, CLIP_DIMENSION);
});

test('MeaningPairReview background enrichment skips downloads when uninstalled and refuses to overwrite a modified or encoder-mismatched record', async context => {
  const { storage, document } = setupDom(context);
  driveSync.storage = storage;
  await driveSync.imageHistory.ready;

  const workers = [];
  globalThis.Worker = class {
    constructor() { workers.push(this); }
    postMessage() {}
    terminate() {}
  };
  globalThis.caches = cachedFiles([]);

  const senseA = { id: 'a', word: 'draft', partOfSpeech: 'noun', definition: 'A preliminary version of a document.' };
  const senseB = { id: 'b', word: 'draft', partOfSpeech: 'noun', definition: 'A current of air in a room.' };
  const entry = { word: 'draft', senses: [senseA, senseB] };
  const key = meaningPairKey(entry.word, 'noun', senseA.definition, senseB.definition);

  // 1. Uninstalled model: manual judgment persists, zero workers spawned
  const container1 = document.createElement('div');
  const c1 = mountMeaningPairReview(container1, entry, {
    storage,
    cacheStorage: cachedFiles([])
  });
  await container1.children[0].click();
  await container1.children[1].querySelectorAll('button').find(b => b.textContent === 'Different meanings').click();
  await c1.whenEnriched();
  assert.equal(workers.length, 0);
  const savedUninstalled = (await meaningLearningState()).records.find(r => r.key === key);
  assert.equal(savedUninstalled.label, 0);
  assert.equal(savedUninstalled.evidence, undefined);

  // 2. Modified record during in-flight encoding: stale enrichment refuses to overwrite newer judgment
  const senseC = { id: 'c', word: 'bank', partOfSpeech: 'noun', definition: 'A financial institution.' };
  const senseD = { id: 'd', word: 'bank', partOfSpeech: 'noun', definition: 'The land alongside a river.' };
  const bankKey = meaningPairKey('bank', 'noun', senseC.definition, senseD.definition);
  let releaseBankEncode, bankEncodeStartedResolve;
  const bankEncodeStarted = new Promise(resolve => { bankEncodeStartedResolve = resolve; });

  const container2 = document.createElement('div');
  const c2 = mountMeaningPairReview(container2, { word: 'bank', senses: [senseC, senseD] }, {
    encodeDefinitionTexts: async texts => {
      bankEncodeStartedResolve();
      await new Promise(resolve => { releaseBankEncode = resolve; });
      return texts.map((_, index) => vector(index));
    }
  });
  await container2.children[0].click();
  await container2.children[1].querySelectorAll('button').find(b => b.textContent === 'Same meaning').click();
  await bankEncodeStarted;

  // Overwrite record externally before stale enrichment completes
  await recordMeaningJudgment('bank', senseC, senseD, false, { encodeDefinitionTexts: async () => null });
  releaseBankEncode();
  await c2.whenEnriched();

  const finalBank = (await meaningLearningState()).records.find(r => r.key === bankKey);
  assert.equal(finalBank.label, 0, 'newer Different meanings label must remain intact');
  assert.equal(finalBank.evidence, undefined, 'stale Same meaning enrichment must not attach after record changed');

  // 3. Mismatched encoder tag from custom encoder is rejected
  const senseE = { id: 'e', word: 'seal', partOfSpeech: 'noun', definition: 'A marine mammal.' };
  const senseF = { id: 'f', word: 'seal', partOfSpeech: 'noun', definition: 'A stamp used to close an envelope.' };
  const sealKey = meaningPairKey('seal', 'noun', senseE.definition, senseF.definition);

  const container3 = document.createElement('div');
  const c3 = mountMeaningPairReview(container3, { word: 'seal', senses: [senseE, senseF] }, {
    encodeDefinitionTexts: async texts => ({
      model: 'stale-encoder-v0',
      vectors: texts.map((_, index) => vector(index))
    })
  });
  await container3.children[0].click();
  await container3.children[1].querySelectorAll('button').find(b => b.textContent === 'Different meanings').click();
  await c3.whenEnriched();

  const finalSeal = (await meaningLearningState()).records.find(r => r.key === sealKey);
  assert.equal(finalSeal.label, 0);
  assert.equal(finalSeal.evidence, undefined);
});
