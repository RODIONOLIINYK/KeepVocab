import test from 'node:test';
import assert from 'node:assert/strict';
import { mountImageReview } from '../js/components/ImageReview.js';

class Container {
  innerHTML = '';
  listeners = new Set();
  addEventListener(type, callback) { assert.equal(type, 'click'); this.listeners.add(callback); }
  removeEventListener(_type, callback) { this.listeners.delete(callback); }
  contains() { return true; }
  click(action, index = 0) {
    const button = { dataset: { imageReviewAction: action, imageReviewIndex: String(index) } };
    return Promise.all([...this.listeners].map(callback => callback({ target: { closest: () => button } })));
  }
}

const image = id => ({ url: `https://images.example/${id}.jpg`, thumbnailUrl: `https://images.example/${id}-thumb.jpg`, sourceUrl: `https://sources.example/${id}`, attribution: 'Photographer', license: 'CC BY', searchQuery: 'specific visible scene' });
const word = (id, hasImage = true) => ({ id, word: `word ${id}`, definition: `The exact full meaning for ${id}.`, imageUrl: hasImage ? image(id).url : '', imageSourceUrl: hasImage ? image(id).sourceUrl : '', lastRecalledAt: '2026-10-20T12:00:00Z', recallStats: { correct: 9, attempts: 10 }, imageFeedback: { goodUrls: [], rejectedUrls: [] } });

test('review requires explicit decisions, applies image metadata only, and never mutates source progress', async () => {
  const container = new Container();
  const source = [word('first'), word('second', false)];
  const saved = structuredClone(source);
  const applied = [];
  mountImageReview(container, source, { onApply: words => applied.push(words), findImages: async () => [image('new')] });
  await container.click('apply');
  assert.equal(applied.length, 0);
  await container.click('next', 0);
  assert.match(container.innerHTML, /new-thumb\.jpg/);
  await container.click('apply');
  assert.equal(applied.length, 0);
  await container.click('keep', 0);
  await container.click('skip', 1);
  assert.equal(applied.length, 0);
  await container.click('apply');
  assert.equal(applied.length, 1);
  assert.equal(applied[0][0].imageUrl, image('new').url);
  assert.equal(applied[0][0].imageAttribution, 'Photographer');
  assert.deepEqual(applied[0][0].recallStats, saved[0].recallStats);
  assert.equal(applied[0][0].lastRecalledAt, saved[0].lastRecalledAt);
  assert.deepEqual(applied[0][0].imageFeedback, saved[0].imageFeedback);
  assert.deepEqual(applied[0][1], saved[1]);
  applied[0][0].recallStats.correct = 0;
  assert.deepEqual(source, saved);
});

test('next image excludes visited images and other reserved URL/source identities', async () => {
  const container = new Container();
  const calls = [];
  const third = image('third');
  mountImageReview(container, [word('first'), word('second')], { findImages: async (_word, options) => {
    calls.push(options);
    return calls.length === 1 ? [image('second'), { ...third, sourceUrl: image('second').sourceUrl }, third] : [third, image('fourth')];
  } });
  await container.click('next', 0);
  assert.ok(calls[0].excludeUrls.includes(image('first').url));
  assert.ok(calls[0].excludeUrls.includes(image('second').url));
  assert.ok(calls[0].excludeUrls.includes(image('second').sourceUrl));
  assert.match(container.innerHTML, /third-thumb\.jpg/);
  await container.click('next', 0);
  assert.equal(calls[1].page, 2);
  assert.ok(calls[1].excludeUrls.includes(third.url));
  assert.match(container.innerHTML, /fourth-thumb\.jpg/);
});

test('concurrent candidate results cannot reserve the same image for two meanings', async () => {
  const container = new Container();
  const resolvers = [];
  const progress = [];
  mountImageReview(container, [word('first', false), word('second', false)], {
    findImages: () => new Promise(resolve => resolvers.push(resolve)), onProgress: state => progress.push(state)
  });
  const first = container.click('next', 0);
  const second = container.click('next', 1);
  resolvers[0]([image('shared')]);
  await first;
  resolvers[1]([image('shared')]);
  await second;
  assert.match(container.innerHTML, /No different image found/);
  await container.click('keep-all');
  assert.equal(progress.at(-1).kept, 1);
  assert.equal(progress.at(-1).skipped, 1);
});

test('Keep all proposed images confirms pending images and skips missing images without overriding an explicit Skip', async () => {
  const container = new Container();
  const applied = [];
  const progress = [];
  mountImageReview(container, [word('first'), word('second', false), word('third')], { onApply: rows => applied.push(rows), onProgress: value => progress.push(value) });
  await container.click('skip', 2);
  await container.click('keep-all');
  assert.equal(progress.at(-1).kept, 1);
  assert.equal(progress.at(-1).skipped, 2);
  assert.equal(progress.at(-1).pending, 0);
  assert.equal(applied.length, 0);
  await container.click('apply');
  assert.equal(applied.length, 1);
});

test('Next after Keep resets confirmation, while Skip restores the original image without negative labels', async () => {
  const container = new Container();
  let applied;
  mountImageReview(container, [word('first')], { onApply: value => { applied = value; }, findImages: async () => [image('new')] });
  await container.click('keep');
  await container.click('next');
  await container.click('apply');
  assert.equal(applied, undefined);
  await container.click('skip');
  assert.doesNotMatch(container.innerHTML, /new-thumb\.jpg/);
  await container.click('apply');
  assert.deepEqual(applied, [word('first')]);
});

test('Skip discards prepared proposals while preserving the real original image and new learner metadata', async () => {
  const container = new Container();
  const originals = [word('new', false), word('existing')];
  const prepared = originals.map((item, index) => ({ ...item, definition: 'An improved learner explanation.', imageUrl: image(`proposal-${index}`).url, imageSourceUrl: image(`proposal-${index}`).sourceUrl }));
  let applied;
  mountImageReview(container, prepared, { originalWords: originals, onApply: value => { applied = value; } });
  await container.click('skip', 0);
  await container.click('skip', 1);
  await container.click('keep-all');
  await container.click('apply');
  assert.equal(applied[0].imageUrl, '');
  assert.equal(applied[0].imageSourceUrl, '');
  assert.equal(applied[1].imageUrl, originals[1].imageUrl);
  assert.equal(applied[1].imageSourceUrl, originals[1].imageSourceUrl);
  assert.equal(applied[0].definition, prepared[0].definition);
  assert.deepEqual(applied[0].imageFeedback, originals[0].imageFeedback);
  assert.equal(prepared[0].imageUrl, image('proposal-0').url);
});

test('destroy and Cancel abort active searches and ignore late results after navigation', async () => {
  for (const cancel of [false, true]) {
    const container = new Container();
    let resolve;
    let signal;
    let cancellations = 0;
    const controller = mountImageReview(container, [word('first')], {
      onCancel: () => cancellations++, findImages: (_word, options) => { signal = options.signal; return new Promise(done => { resolve = done; }); }
    });
    const pending = container.click('next');
    if (cancel) await container.click('cancel'); else controller.destroy();
    const markup = container.innerHTML;
    assert.equal(signal.aborted, true);
    resolve([image('late')]);
    await pending;
    assert.equal(container.innerHTML, markup);
    assert.equal(container.listeners.size, 0);
    assert.equal(cancellations, cancel ? 1 : 0);
  }
});

test('per-card search errors do not block reviewing other rows or skipping the failed row', async () => {
  const container = new Container();
  let applied;
  mountImageReview(container, [word('first'), word('second')], { findImages: async () => { throw new Error('offline'); }, onApply: value => { applied = value; } });
  await container.click('next', 0);
  assert.match(container.innerHTML, /Images are unavailable right now/);
  await container.click('skip', 0);
  await container.click('keep', 1);
  await container.click('apply');
  assert.equal(applied.length, 2);
});

test('word text is escaped, unsafe credit links are omitted, and previews load lazily', () => {
  const container = new Container();
  mountImageReview(container, [{ ...word('<script>'), definition: '<img onerror="steal()">', imageSourceUrl: 'javascript:alert(1)', imageAttribution: '<svg/onload=alert(1)>' }]);
  assert.match(container.innerHTML, /&lt;script&gt;/);
  assert.match(container.innerHTML, /&lt;img onerror=&quot;steal\(\)&quot;&gt;/);
  assert.doesNotMatch(container.innerHTML, /href="javascript:/);
  assert.match(container.innerHTML, /loading="lazy"/);
});
