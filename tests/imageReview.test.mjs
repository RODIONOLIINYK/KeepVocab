import test from 'node:test';
import assert from 'node:assert/strict';
import { mountImageReview } from '../js/components/ImageReview.js';

class Container {
  innerHTML = '';
  listeners = new Set();
  addEventListener(type, callback) { if (type === 'keydown') { this.keyHandler = callback; return; } assert.equal(type, 'click'); this.listeners.add(callback); }
  removeEventListener(type, callback) { if (type === 'keydown') { this.keyHandler = null; return; } this.listeners.delete(callback); }
  contains() { return true; }
  click(action, index = 0, candidateIndex = 0) {
    const button = { dataset: { imageReviewAction: action, imageReviewIndex: String(index), imageReviewCandidate: String(candidateIndex) } };
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

test('review can prepare missing meaning prompts and preserves existing scene metadata for reuse', async () => {
  const container = new Container();
  const original = { ...word('scene', false), sourceDefinition: 'A formal warning of an upcoming change.', imageScenes: { scenes: ['tenant reading eviction letter beside apartment doorway'] } };
  mountImageReview(container, [original], { findImages: async (item, options) => {
    assert.equal(item.sourceDefinition, original.sourceDefinition);
    assert.deepEqual(item.imageScenes, original.imageScenes);
    assert.notEqual(options.aiScenes, false, 'older meanings without prepared prompts may generate them');
    return [image('scene')];
  } });
  await container.click('next');
  assert.match(container.innerHTML, /scene-thumb\.jpg/);
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

test('finding more preserves a chosen image, while keeping the original does not create negative labels', async () => {
  const container = new Container();
  let applied;
  mountImageReview(container, [word('first')], { onApply: value => { applied = value; }, findImages: async () => [image('new')] });
  await container.click('keep');
  await container.click('next');
  await container.click('apply');
  assert.equal(applied[0].imageUrl, image('first').url);
  await container.click('skip');
  assert.match(container.innerHTML, /Current image kept/);
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

test('word text is escaped, unsafe credit links are omitted, and previews load promptly', () => {
  const container = new Container();
  mountImageReview(container, [{ ...word('<script>'), definition: '<img onerror="steal()">', imageSourceUrl: 'javascript:alert(1)', imageAttribution: '<svg/onload=alert(1)>' }]);
  assert.match(container.innerHTML, /&lt;script&gt;/);
  assert.match(container.innerHTML, /&lt;img onerror=&quot;steal\(\)&quot;&gt;/);
  assert.doesNotMatch(container.innerHTML, /href="javascript:/);
  assert.match(container.innerHTML, /loading="eager"/);
});

test('learning receives only confirmed Keep choices after Apply succeeds, never Cancel, Next or Skip', async () => {
  const feedback = [];
  const container = new Container();
  let fail = true;
  mountImageReview(container, [word('first'), word('second')], {
    findImages: async () => [image('new')],
    onFeedback: (...args) => feedback.push(args),
    onApply: () => { if (fail) throw new Error('Save failed'); }
  });
  await container.click('next', 0);
  await container.click('keep', 0);
  await container.click('skip', 1);
  assert.equal(feedback.length, 0);
  await container.click('apply');
  assert.equal(feedback.length, 0);
  fail = false;
  await container.click('apply');
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0][0].id, 'first');
  assert.equal(feedback[0][1], 'good');
  assert.equal(feedback[0][2].url, image('new').url);
  const cancelled = new Container();
  mountImageReview(cancelled, [word('cancelled')], { onFeedback: (...args) => feedback.push(args) });
  await cancelled.click('keep');
  await cancelled.click('cancel');
  assert.equal(feedback.length, 1);
});

test('stale rows excluded by the host do not teach preferences, and learning failures do not fail saving', async () => {
  const container = new Container();
  const taught = [];
  mountImageReview(container, [word('stale'), word('saved')], {
    onApply: () => ({ appliedIds: ['saved'] }),
    onFeedback: item => { taught.push(item.id); throw new Error('Learning unavailable'); }
  });
  await container.click('keep-all');
  await container.click('apply');
  await Promise.resolve();
  assert.deepEqual(taught, ['saved']);
  assert.doesNotMatch(container.innerHTML, /could not be applied/);
});

test('add flow displays six ready options, selects locally without another request, and strips transient candidates', async () => {
  const container = new Container();
  const options = Array.from({ length: 6 }, (_, i) => image(`option-${i}`));
  const source = { ...word('new', false), imageCandidates: options };
  const taught = [];
  let saved;
  mountImageReview(container, [source], {
    allowSkipPending: true, onApply: rows => { saved = rows; },
    findImages: () => assert.fail('Selecting a ready option must not search again'),
    onFeedback: (_word, action, selected) => taught.push({ action, url: selected.url })
  });
  assert.equal((container.innerHTML.match(/data-image-review-action="choose"/g) || []).length, 6);
  await container.click('choose', 0, 4);
  await container.click('apply');
  assert.equal(saved[0].imageUrl, options[4].url);
  assert.equal(Object.hasOwn(saved[0], 'imageCandidates'), false);
  assert.deepEqual(taught, [{ action: 'good', url: options[4].url }]);
});

test('add flow can save all words without per-word image approval', async () => {
  const container = new Container();
  const originals = [word('one', false), word('two', false)];
  const prepared = originals.map((item, i) => ({ ...item, imageUrl: image(`proposal${i}`).url, imageCandidates: [image(`proposal${i}`)] }));
  let saved;
  mountImageReview(container, prepared, { allowSkipPending: true, originalWords: originals, onApply: rows => { saved = rows; }, onFeedback: () => assert.fail('Unselected suggestions are not labels') });
  await container.click('apply');
  assert.deepEqual(saved.map(item => item.imageUrl), ['', '']);
});

test('automatic suggestions require a clear semantic match and never self-train', async () => {
  const { CLIP_TAG } = await import('../js/ml/clipConfig.js');
  const { canAutoSelectImage } = await import('../js/services/imageChoicePolicy.js');
  const best = { ...image('automatic'), ml: { model: CLIP_TAG, sense: 'exact', trainedLabels: 40, selected: .4, margin: .12, unwanted: .05, preference: .96, score: .5 } };
  const runnerUp = { ...image('runnerup'), ml: { ...best.ml, score: .4 } };
  assert.equal(canAutoSelectImage([best, runnerUp]), true);
  for (const patch of [{ margin: -.1 }, { unwanted: .3 }, { selected: .1 }, { score: .42 }]) {
    assert.equal(canAutoSelectImage([{ ...best, ml: { ...best.ml, ...patch } }, runnerUp]), false);
  }
  assert.equal(canAutoSelectImage([{ ...best, ml: { ...best.ml, trainedLabels: 0, preference: .5 } }, runnerUp]), true);
  assert.equal(canAutoSelectImage([best]), false);
  assert.equal(canAutoSelectImage([best, runnerUp, { ...runnerUp, ml: { ...runnerUp.ml, score: .49 } }]), false);
  assert.equal(canAutoSelectImage([{ ...best, ml: { ...best.ml, contrast: null, margin: 0 } }, runnerUp]), true);
  const container = new Container();
  let saved;
  mountImageReview(container, [{ ...word('automatic', false), imageCandidates: [best, runnerUp] }], { onApply: rows => { saved = rows; }, onFeedback: () => assert.fail('Automatic choices are not human labels') });
  await container.click('apply');
  assert.equal(saved[0].imageUrl, best.url);
});


test('review hands explicit labels to a save host without teaching before that host persists', async () => {
  const container = new Container();
  let context;
  mountImageReview(container, [word('deferred', false)], {
    findImages: async () => [image('chosen')],
    onApply: (_rows, value) => { context = value; },
    onFeedback: () => {} // The Add host replays these only after addWords succeeds.
  });
  await container.click('next');
  await container.click('keep');
  await container.click('apply');
  assert.deepEqual(context.feedback.map(label => [label.action, label.image.url]), [['good', image('chosen').url]]);
});


test('Save without image saves a new single word immediately, with no label or extra Apply step', async () => {
  const container = new Container();
  const original = word('single', false);
  let saved;
  mountImageReview(container, [{ ...original, imageCandidates: [image('one'), image('two')] }], {
    allowSkipPending: true, originalWords: [original], onApply: rows => { saved = rows; },
    onFeedback: () => assert.fail('Saving without a photo is not a training label')
  });
  assert.doesNotMatch(container.innerHTML, />Skip<|Keep all proposed/);
  await container.click('choose', 0, 1);
  await container.click('skip');
  assert.equal(saved[0].word, original.word);
  assert.equal(saved[0].definition, original.definition);
  assert.equal(saved[0].imageUrl, '');
});

test('the gallery shows all available options without truncating to six or a narrow preview column', () => {
  const container = new Container();
  mountImageReview(container, [{ ...word('many', false), imageCandidates: Array.from({ length: 12 }, (_, i) => image('option-'+i)) }]);
  assert.equal((container.innerHTML.match(/data-image-review-action="choose"/g) || []).length, 12);
  assert.doesNotMatch(container.innerHTML, /image-review__preview|max-height:62vh/);
});

test('single word can be saved without an image while a slow search is still pending', async () => {
  const container = new Container();
  let finishSearch;
  let signal;
  let saved;
  mountImageReview(container, [word('waiting', false)], {
    allowSkipPending:true, findImages: (_word, options) => { signal=options.signal; return new Promise(resolve=>{finishSearch=resolve;}); },
    onApply: rows=>{saved=rows;}, onFeedback:()=>assert.fail('No feedback for skipped search')
  });
  const pending=container.click('next');
  await container.click('skip');
  assert.equal(saved[0].imageUrl,'');
  assert.equal(signal.aborted,true);
  finishSearch([image('late')]);
  await pending;
  assert.equal(saved[0].imageUrl,'');
});


test('gallery arrow keys choose one option at a time and wrap without a network search', async () => {
  const container = new Container();
  let saved;
  mountImageReview(container, [{ ...word('keyboard', false), imageCandidates: [image('a'),image('b'),image('c')] }], {
    onApply:rows=>{saved=rows;}, findImages:()=>assert.fail('Keyboard selection should be local'), onFeedback:()=>{}
  });
  let prevented=false;
  container.keyHandler({ key:'ArrowRight', preventDefault:()=>{prevented=true;}, target:{closest:()=>({dataset:{imageReviewIndex:'0',imageReviewCandidate:'0'}})} });
  assert.equal(prevented,true);
  assert.equal((container.innerHTML.match(/aria-checked="true"/g)||[]).length,1);
  await container.click('apply');
  assert.equal(saved[0].imageUrl,image('b').url);
});

function visiblePhotos(container, context, specs) {
  const before = { width: globalThis.innerWidth, height: globalThis.innerHeight };
  globalThis.innerWidth = 800; globalThis.innerHeight = 600;
  context.after(() => {
    if (before.width == null) delete globalThis.innerWidth; else globalThis.innerWidth = before.width;
    if (before.height == null) delete globalThis.innerHeight; else globalThis.innerHeight = before.height;
  });
  container.querySelectorAll = () => specs.map(({ index, top = 50, loaded = true }) => ({
    complete: loaded, naturalWidth: loaded ? 400 : 0,
    getBoundingClientRect: () => ({ top, bottom: top + 100, left: 50, right: 250, width: 200, height: 100 }),
    closest: () => ({ dataset: { imageReviewCandidate: String(index) } })
  }));
}

test('ordinary saved choices learn relative preferences only from visible loaded alternatives', async context => {
  const container = new Container();
  const photos = Array.from({ length: 6 }, (_, i) => image(`exposure-${i}`));
  const taught = [];
  visiblePhotos(container, context, [{ index: 0 }, { index: 1 }, { index: 2, loaded: false }, { index: 3, top: 700 }, { index: 4, top: 570 }]);
  let saved;
  mountImageReview(container, [{ ...word('exposure', false), imageCandidates: photos }], {
    onApply: rows => { saved = rows; }, onFeedback: (...args) => taught.push(args)
  });
  await container.click('choose', 0, 0);
  assert.equal(taught.length, 0);
  await container.click('apply');
  assert.deepEqual(taught.map(args => [args[1], args[2].url]), [['good', photos[0].url], ['less-preferred', photos[1].url]]);
  assert.equal(taught[1][3].preferredImage.url, photos[0].url);
  assert.deepEqual(saved[0].imageFeedback.rejectedUrls, []);
});

test('the normal picker contains only image choices and useful save/search controls', () => {
  const container = new Container();
  mountImageReview(container, [{ ...word('simple', false), imageCandidates: [image('one'), image('two')] }]);
  assert.doesNotMatch(container.innerHTML, /training|model|labels|parameters|Learning your taste|Compare two|fit meaning|rated examples|confidence|certainty/i);
  assert.match(container.innerHTML, /Choose an image/);
  assert.match(container.innerHTML, /Find more/);
});
