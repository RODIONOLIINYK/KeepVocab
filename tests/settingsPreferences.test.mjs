import test from 'node:test';
import { MODEL_DOWNLOAD_MB } from '../js/ml/clipConfig.js';
import assert from 'node:assert/strict';
import { renderSettingsView } from '../js/components/SettingsView.js';
import { MemoryStorage } from '../js/services/driveSync.js?v=18900';
import { initializeImageLearning, disableImageLearning } from '../js/services/imageLearning.js?v=18900';
import { getFsrsLearningStatus } from '../js/services/fsrsLearning.js';

async function setup(t) {
  const original = { storage: globalThis.localStorage, Worker: globalThis.Worker };
  globalThis.localStorage = new MemoryStorage();
  localStorage.setItem('keepvocab_image_learning_device_v1', JSON.stringify({ enabled: false, prompted: true }));
  await initializeImageLearning({ cacheStorage: { keys: async () => [] } });
  const controls = new Map();
  const query = selector => {
    if (!controls.has(selector)) controls.set(selector, {
      value: '', checked: false, hidden: false, disabled: false, listeners: new Map(),
      addEventListener(type, listener) { this.listeners.set(type, listener); },
      classList: { toggle() {} }
    });
    return controls.get(selector);
  };
  const container = { innerHTML: '', querySelector: query, querySelectorAll: () => [] };
  t.after(() => {
    container.releaseImageLearning?.();
    container.releaseFsrsLearning?.();
    disableImageLearning();
    if (original.storage === undefined) delete globalThis.localStorage; else globalThis.localStorage = original.storage;
    if (original.Worker === undefined) delete globalThis.Worker; else globalThis.Worker = original.Worker;
  });
  return { container, query, controls };
}

test('Settings keeps useful image and review preferences without technical diagnostics or labeling tasks', async t => {
  const { container, query, controls } = await setup(t);
  renderSettingsView(container);
  const visibleCopy = container.innerHTML.replace(/<[^>]*>/g, ' ');
  assert.match(visibleCopy, /Image suggestions/);
  assert.ok(visibleCopy.includes(`one-time download of about ${MODEL_DOWNLOAD_MB} MB`));
  assert.match(visibleCopy, /private Drive backup/);
  assert.match(visibleCopy, /Reset photo preferences/);
  assert.match(visibleCopy, /Recall target/);
  assert.match(visibleCopy, /Adjust timing from my practice/);
  assert.doesNotMatch(visibleCopy, /FSRS|training|parameters|weights|revision|labels|logistic|encoder|held-out|negative example|Fit from review history/i);
  for (const selector of ['#image-training-rows', '#image-learning-diagnostics', '#image-training-inspector', '#train-memory-model', '#memory-training-diagnostics']) {
    assert.equal(controls.has(selector), false, `${selector} must not be rendered or queried`);
  }
  assert.equal(query('#image-learning-status').textContent, 'Off.');
  assert.equal(query('#disable-image-learning').hidden, true);
  assert.equal(query('#clear-image-model').hidden, true);
  query('#memory-retention').value = '0.95';
  query('#memory-auto-training').checked = false;
  query('#memory-settings-form').listeners.get('submit')({ preventDefault() {} });
  assert.equal(getFsrsLearningStatus().config.retention, 0.95);
  assert.equal(getFsrsLearningStatus().config.automaticTraining, false);
  assert.match(query('#memory-settings-status').textContent, /Review preferences saved/);
});

test('image suggestion status shows download progress and useful states while hiding worker internals', async t => {
  const { container, query } = await setup(t);
  let worker;
  globalThis.Worker = class {
    constructor() { worker = this; }
    postMessage(request) { this.request = request; }
    terminate() {}
  };
  renderSettingsView(container);
  const enable = query('#enable-image-learning');
  const status = query('#image-learning-status');
  const action = enable.listeners.get('click')();
  assert.equal(status.textContent, 'Downloading…');
  worker.onmessage({ data: { type: 'status', phase: 'loading', progress: 135, message: 'WASM tensor backend initializing', backend: 'wasm' } });
  assert.equal(status.textContent, 'Downloading… 100%');
  worker.onmessage({ data: { type: 'status', phase: 'ready', message: 'Trained revision 20; 516 parameters changed' } });
  worker.onmessage({ data: { id: worker.request.id, result: { backend: 'wasm' } } });
  await action;
  assert.equal(status.textContent, 'Ready.');
  assert.equal(enable.hidden, true);
  assert.equal(query('#clear-image-model').hidden, false);
  worker.onmessage({ data: { type: 'status', phase: 'scoring', message: 'Scored 12 image embeddings' } });
  assert.equal(status.textContent, 'Ready.');
  worker.onmessage({ data: { type: 'status', phase: 'error', message: 'ONNX unsupported kernel; private debug details' } });
  assert.match(status.textContent, /Try turning them on again/);
  assert.doesNotMatch(status.textContent, /ONNX|kernel|private|embedding|parameters|revision/i);
  assert.equal(enable.hidden, false);
  await query('#disable-image-learning').listeners.get('click')();
  assert.equal(status.textContent, 'Off.');
  await query('#reset-image-preferences').listeners.get('click')();
  assert.equal(status.textContent, 'Photo preferences reset.');
});

test('failed enabling reports a concise recovery action instead of the raw exception', async t => {
  const { container, query } = await setup(t);
  globalThis.Worker = class {
    postMessage(request) { queueMicrotask(() => this.onmessage({ data: { id: request.id, error: 'ONNX model decoder stack detail' } })); }
    terminate() {}
  };
  renderSettingsView(container);
  const enable = query('#enable-image-learning');
  await enable.listeners.get('click')();
  assert.equal(query('#image-learning-status').textContent, 'Could not turn on image suggestions. Check your connection and try again.');
  assert.equal(enable.disabled, false);
});
