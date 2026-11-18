import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from '../js/services/driveSync.js?v=18908';
import { initializeImageLearning, enableImageLearning, disableImageLearning, getImageLearningStatus,
  inferencePlan, rankImagesLocally, subscribeImageLearning } from '../js/services/imageLearning.js?v=18908';
import { mountImageReview } from '../js/components/ImageReview.js';
import { CLIP_TAG, CLIP_DIMENSION } from '../js/ml/clipConfig.js';

class ReviewContainer {
  innerHTML = '';
  listeners = new Map();
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  removeEventListener(type, callback) { if (this.listeners.get(type) === callback) this.listeners.delete(type); }
  contains() { return true; }
  click(action) {
    const button = { dataset: { imageReviewAction: action, imageReviewIndex: '0', imageReviewCandidate: '0' } };
    return this.listeners.get('click')?.({ target: { closest: () => button } });
  }
}

const meaning = { id: 'river', word: 'bank', definition: 'Land beside a river.', partOfSpeech: 'noun' };
const photo = { url: 'https://images.example/river.jpg', title: 'A river bank' };

test('mobile inference budgets RAM conservatively across native apps, browsers and tablets', () => {
  const android = { userAgent: 'Mozilla/5.0 (Linux; Android 16)', hardwareConcurrency: 8 };
  for (const deviceMemory of [undefined, 0, 2, 4]) {
    assert.deepEqual(inferencePlan({ navigator: { ...android, deviceMemory } }), { workers: 1, threads: 1 });
    assert.deepEqual(inferencePlan({ navigator: { ...android, deviceMemory }, crossOriginIsolated: true }), { workers: 1, threads: 1 });
  }
  assert.deepEqual(inferencePlan({ navigator: { ...android, deviceMemory: 8 } }), { workers: 2, threads: 1 });
  assert.deepEqual(inferencePlan({ navigator: { ...android, deviceMemory: 8 }, crossOriginIsolated: true }), { workers: 1, threads: 2 });
  assert.deepEqual(inferencePlan({ navigator: { ...android, deviceMemory: 8, hardwareConcurrency: 2 } }), { workers: 1, threads: 1 });
  assert.deepEqual(inferencePlan({ navigator: { hardwareConcurrency: 8, userAgent: 'iPhone' } }), { workers: 1, threads: 1 });
  assert.deepEqual(inferencePlan({ navigator: { hardwareConcurrency: 8, platform: 'MacIntel', maxTouchPoints: 5 } }), { workers: 1, threads: 1 });
  assert.deepEqual(inferencePlan({ navigator: { hardwareConcurrency: 8 }, Capacitor: { getPlatform: () => 'android' } }), { workers: 1, threads: 1 });
  assert.deepEqual(inferencePlan({ navigator: { hardwareConcurrency: 8, deviceMemory: 8, userAgentData: { mobile: true } } }), { workers: 2, threads: 1 });
});

async function setup(context, navigator = { hardwareConcurrency: 2 }) {
  const original = { storage: globalThis.localStorage, Worker: globalThis.Worker };
  context.mock.getter(globalThis, 'navigator', () => navigator);
  const cleanup = [];
  globalThis.localStorage = new MemoryStorage();
  localStorage.setItem('keepvocab_image_learning_device_v1', JSON.stringify({ enabled: true, downloadConsent: 'accepted' }));
  localStorage.setItem('keepvocab_image_candidate_budget', '9');
  await initializeImageLearning({ cacheStorage: { keys: async () => [] } });
  context.after(() => {
    for (const release of cleanup) release();
    disableImageLearning();
    if (original.storage === undefined) delete globalThis.localStorage; else globalThis.localStorage = original.storage;
    if (original.Worker === undefined) delete globalThis.Worker; else globalThis.Worker = original.Worker;
  });
  return cleanup;
}

test('the chooser stays usable without exposing installation or training state', async context => {
  const cleanup = await setup(context);
  assert.equal(getImageLearningStatus().enabled, true);
  assert.equal(getImageLearningStatus().installed, false);
  const container = new ReviewContainer();
  const controller = mountImageReview(container, [{ ...meaning, imageCandidates: [{ ...photo,
    ml: { model: CLIP_TAG, score: .4, trainedLabels: 52 }
  }] }]);
  cleanup.push(() => controller.destroy());
  assert.match(container.innerHTML, /Choose an image/);
  assert.doesNotMatch(container.innerHTML, /learning|model|trained|labels|parameters|Settings|confidence|uncertain/i);
  await container.click('choose');
  assert.match(container.innerHTML, /aria-checked="true"/);
});

test('background download progress leaves the chosen photo and picker markup untouched', async context => {
  const cleanup = await setup(context);
  let finishLoading;
  globalThis.Worker = class {
    postMessage(data) {
      finishLoading = () => {
        this.onmessage({ data: { type: 'status', phase: 'ready', backend: 'wasm' } });
        this.onmessage({ data: { id: data.id, result: { backend: 'wasm' } } });
      };
    }
    terminate() {}
  };
  const container = new ReviewContainer();
  const controller = mountImageReview(container, [{ ...meaning, imageCandidates: [photo] }]);
  cleanup.push(() => controller.destroy());
  await container.click('choose');
  const selectedMarkup = container.innerHTML;
  disableImageLearning();
  assert.equal(container.innerHTML, selectedMarkup);
  const loading = enableImageLearning({ allowMetered: true });
  assert.equal(container.innerHTML, selectedMarkup);
  finishLoading();
  await loading;
  assert.equal(getImageLearningStatus().installed, true);
  assert.equal(container.innerHTML, selectedMarkup);
  controller.destroy();
  disableImageLearning();
  assert.equal(container.innerHTML, selectedMarkup);
});

test('lazy local scoring marks the model installed when its worker becomes ready, without a Settings enable action', async context => {
  const cleanup = await setup(context);
  const messages = [];
  const states = [];
  const vector = axis => Array.from({ length: CLIP_DIMENSION }, (_, index) => Number(index === axis));
  cleanup.push(subscribeImageLearning(state => states.push(state)));
  globalThis.Worker = class {
    postMessage(data) {
      messages.push(data.type);
      queueMicrotask(() => {
        if (data.type === 'texts') this.onmessage({ data: { type: 'status', phase: 'ready', backend: 'wasm' } });
        const result = data.type === 'texts' ? data.payload.texts.map((_, index) => vector(index ? 1 : 0)) : vector(0);
        this.onmessage({ data: { id: data.id, result } });
      });
    }
    terminate() {}
  };
  const images = await rankImagesLocally(meaning, [photo], {
    fetchImpl: async () => new Response('image pixels', { headers: { 'content-type': 'image/jpeg' } }),
    decode: async () => ({ width: 64, height: 64 }),
    resize: () => assert.fail('The test image already fits the thumbnail limit')
  });
  assert.deepEqual(messages, ['texts', 'image']);
  assert.equal(images[0].ml.model, CLIP_TAG);
  assert.ok(Number.isFinite(images[0].ml.score));
  assert.equal(getImageLearningStatus().enabled, true);
  assert.equal(getImageLearningStatus().installed, true);
  assert.ok(states.some(state => state.phase === 'ready' && state.installed === true));
});

test('even exhaustive requests are bounded to nine scene candidates and reject failures before display', async context => {
  await setup(context); let imageCalls = 0;
  const vector = axis => Array.from({ length: CLIP_DIMENSION }, (_, i) => Number(i === axis));
  globalThis.Worker = class {
    postMessage(data) {
      let result;
      if (data.type === 'texts') result = data.payload.texts.map((_, i) => vector(i ? 1 : 0));
      else {
        const index = imageCalls++;
        result = index === 8 ? vector(1) : vector(index + 2).map((value, i) => i === 0 ? .6 : value * .8);
      }
      queueMicrotask(() => {
        if (data.type === 'texts') this.onmessage({ data: { type: 'status', phase: 'ready', backend: 'wasm' } });
        this.onmessage({ data: { id: data.id, result } });
      });
    }
    terminate() {}
  };
  const candidates = Array.from({ length: 45 }, (_, i) => ({ url: `https://clip45.test/${i}.jpg`, title: `River scene ${i}`, visualScene: `scene ${i % 3}` }));
  const results = await rankImagesLocally(meaning, candidates, {
    exhaustiveScoring: true,
    fetchImpl: async url => new Response(String(url), { headers: { 'content-type': 'image/jpeg' } }),
    decode: async () => ({ width: 64, height: 64 }), resize: () => assert.fail('Small images need no resize')
  });
  assert.equal(imageCalls, 9);
  assert.equal(results.length, 8);
  assert.ok(!results.some(image => image.url === candidates[8].url));
});

test('three and four scoring workers receive every prepared candidate in larger and partial batches', async context => {
  const navigator = { hardwareConcurrency: 4, deviceMemory: 8 };
  await setup(context, navigator);
  const workers = [];
  const scored = [];
  const axis = index => Array.from({ length: CLIP_DIMENSION }, (_, i) => Number(i === index));
  globalThis.Worker = class {
    constructor() { workers.push(this); }
    postMessage(data) {
      queueMicrotask(async () => {
        let result;
        if (data.type === 'initialize') {
          if (data.role === 'vision') assert.equal(data.allowDownloads, false);
          result = { backend: 'wasm' };
        } else if (data.type === 'texts') {
          result = data.payload.texts.map((_, i) => axis(i ? 1 : 0));
        } else {
          const index = Number(await data.payload.blob.text());
          scored.push(index);
          result = axis(index + 2).map((value, i) => i === 0 ? .6 : value * .8);
        }
        this.onmessage({ data: { id: data.id, result } });
      });
    }
    terminate() {}
  };

  for (const size of [3, 4]) {
    navigator.hardwareConcurrency = size + 1;
    assert.equal(inferencePlan().workers, size);
    workers.length = 0;
    scored.length = 0;
    await enableImageLearning();
    const candidates = Array.from({ length: 45 }, (_, index) => ({ url: `https://pool-${size}.test/${index}.jpg` }));
    const results = await rankImagesLocally(meaning, candidates, {
      exhaustiveScoring: true,
      fetchImpl: async url => {
        const index = Number(new URL(url).pathname.slice(1, -4));
        return new Response(String(index), { status: index === 5 ? 404 : 200, headers: { 'content-type': 'image/jpeg' } });
      },
      decode: async () => ({ width: 64, height: 64 })
    });
    const expected = candidates.slice(0, 9).map((_, index) => index).filter(index => index !== 5);
    assert.equal(workers.length, size);
    assert.deepEqual(scored.sort((a, b) => a - b), expected);
    assert.deepEqual(results.map(image => image.url).sort(), expected.map(index => candidates[index].url).sort());
    disableImageLearning();
  }
});

test('production local scoring returns nine closest failed matches as manual-only review candidates', async context => {
  const cleanup = await setup(context);
  let imageCalls = 0;
  const vector = axis => Array.from({ length: CLIP_DIMENSION }, (_, i) => Number(i === axis));
  globalThis.Worker = class {
    async postMessage(data) {
      let result;
      if (data.type === 'texts') result = data.payload.texts.map((_, i) => vector(i ? 1 : 0));
      else {
        imageCalls++;
        const index = Number(new URL(await data.payload.blob.text()).pathname.slice(1, -4)), similarity = .05 + index * .005;
        result = Array(CLIP_DIMENSION).fill(0); result[0] = similarity; result[1] = .2;
        result[index + 2] = Math.sqrt(1 - similarity ** 2 - .2 ** 2);
      }
      queueMicrotask(() => {
        if (data.type === 'texts') this.onmessage({ data: { type: 'status', phase: 'ready', backend: 'wasm' } });
        this.onmessage({ data: { id: data.id, result } });
      });
    }
    terminate() {}
  };
  const candidates = Array.from({ length: 12 }, (_, i) => ({ url: `https://fallback-review.test/${i}.jpg` }));
  const images = await rankImagesLocally(meaning, candidates, {
    fetchImpl: async url => new Response(String(url), { headers: { 'content-type': 'image/jpeg' } }),
    decode: async () => ({ width: 64, height: 64 }), resize: () => assert.fail('No resize needed')
  });
  assert.equal(imageCalls, 9); assert.equal(images.length, 9);
  assert.deepEqual(images.map(image => image.url), candidates.slice(0, 9).reverse().map(image => image.url));
  assert.ok(images.every(image => image.ml.belowThreshold && image.ml.selected <= image.ml.unwanted));
  assert.ok(images.every((image, i) => !i || image.ml.cosine <= images[i - 1].ml.cosine));
  const container = new ReviewContainer();
  const review = mountImageReview(container, [{ ...meaning, imageCandidates: images }]);
  cleanup.push(() => review.destroy());
  assert.match(container.innerHTML, /No images passed the match threshold/);
  assert.doesNotMatch(container.innerHTML, /aria-checked="true"/);
  await container.click('choose');
  assert.match(container.innerHTML, /aria-checked="true"/);
});

test('foreground evaluations load at most one extra vision graph and never download more than nine photos', async context => {
  await setup(context, { hardwareConcurrency: 8, deviceMemory: 8 });
  const workers = [], scored = [];
  const vector = axis => Array.from({ length: CLIP_DIMENSION }, (_, i) => Number(i === axis));
  globalThis.Worker = class {
    constructor() { workers.push(this); }
    postMessage(data) {
      const result = data.type === 'initialize' ? { backend: 'wasm' }
        : data.type === 'texts' ? data.payload.texts.map((_, i) => vector(i ? 1 : 0))
          : (scored.push(data.payload.blob), vector(0));
      queueMicrotask(() => this.onmessage({ data: { id: data.id, result } }));
    }
    terminate() {}
  };
  for (const count of [3, 40]) {
    disableImageLearning();
    localStorage.setItem('keepvocab_image_learning_device_v1', JSON.stringify({ enabled: true, downloadConsent: 'accepted' }));
    workers.length = 0; scored.length = 0;
    await enableImageLearning();
    let downloads = 0;
    await rankImagesLocally(meaning, Array.from({ length: count }, (_, i) => ({ url: `https://bounded-workers-${count}.test/${i}.jpg` })), {
      localCandidateLimit: 45,
      fetchImpl: async url => { downloads++; return new Response(String(url), { headers: { 'content-type': 'image/jpeg' } }); },
      decode: async () => ({ width: 64, height: 64 })
    });
    assert.equal(workers.length, count === 3 ? 1 : 2);
    assert.equal(downloads, Math.min(count, 9));
    assert.equal(scored.length, Math.min(count, 9), 'an output limit cannot silently expand the evaluation budget');
  }
});

test('provider suggestions remain manually available when inference fails, without falsely claiming a failed threshold',async context=>{
 const cleanup=await setup(context);
 globalThis.Worker=class{
  postMessage(data){queueMicrotask(()=>this.onmessage({data:{id:data.id,error:'Synthetic inference failure'}}));}
  terminate(){}
 };
 const {findRelevantImages}=await import('../js/services/imageSearch.js');
 const images=await findRelevantImages(meaning,{
  provider:'pexels',pexelsApiKey:'synthetic-test-key',aiScenes:false,validateImages:false,limit:9,
  onlyExtraQueries:true,extraQueries:['river bank'],
  fetchImpl:async()=>({ok:true,json:async()=>({photos:Array.from({length:20},(_,i)=>({id:9000+i,url:`https://www.pexels.com/photo/${9000+i}/`,alt:`River scene ${i}`,src:{medium:`https://images.pexels.com/photos/${9000+i}/image.jpeg`}}))})})
 });
 assert.equal(images.length,3);
 assert.ok(images.every(image=>image.ml.screening==='not-scored'&&image.ml.uncertain&&!image.ml.belowThreshold));
 const container=new ReviewContainer();const controller=mountImageReview(container,[{...meaning,imageCandidates:images}]);cleanup.push(()=>controller.destroy());
 assert.match(container.innerHTML,/have not been checked/);
 assert.doesNotMatch(container.innerHTML,/No images passed the match threshold/);
});

test('foreground scoring keeps its budget for good, scarce, duplicate and late-scene candidates',async context=>{
 await setup(context);const vector=axis=>Array.from({length:CLIP_DIMENSION},(_,i)=>Number(i===axis));
 for(const mode of ['good','scarce','duplicates','late-scene']){
  disableImageLearning();localStorage.setItem('keepvocab_image_learning_device_v1',JSON.stringify({enabled:true,downloadConsent:'accepted'}));let calls=0;
  globalThis.Worker=class{postMessage(data){let result;if(data.type==='texts')result=data.payload.texts.map((_,i)=>vector(i?1:0));else{const index=calls++;result=mode==='scarce'&&index<44?vector(1):vector(mode==='duplicates'?2:index+2).map((v,i)=>i===0?.6:v*.8);}queueMicrotask(()=>{if(data.type==='texts')this.onmessage({data:{type:'status',phase:'ready',backend:'wasm'}});this.onmessage({data:{id:data.id,result}});});}terminate(){}};
  const candidates=Array.from({length:45},(_,i)=>({url:`https://adaptive-${mode}.test/${i}.jpg`,visualScene:mode==='late-scene'&&i===44?'last':`scene${mode==='late-scene'?0:i%3}`}));
  const result=await rankImagesLocally(meaning,candidates,{fetchImpl:async url=>new Response(String(url),{headers:{'content-type':'image/jpeg'}}),decode:async()=>({width:64,height:64})});
  assert.equal(calls,mode==='late-scene'?4:9,mode);assert.ok(result.length>=1);
  assert.ok(result.every(image=>image.ml.screening==='scored'));
  if(mode==='scarce') assert.ok(result.every(image=>image.ml.belowThreshold));
  if(mode==='late-scene') assert.ok(result.some(image=>image.visualScene==='last'));
 }
});

test('a failed vision helper retries its image on the primary worker', async context => {
  await setup(context, { hardwareConcurrency: 4, deviceMemory: 4 });
  const successful = [];
  const terminated = [];
  let constructed = 0;
  let helperFailures = 0;
  const axis = index => Array.from({ length: CLIP_DIMENSION }, (_, i) => Number(i === index));
  globalThis.Worker = class {
    constructor() { this.index = constructed++; }
    postMessage(data) {
      queueMicrotask(async () => {
        if (data.type === 'initialize') {
          this.onmessage({ data: { id: data.id, result: { backend: 'wasm' } } });
        } else if (data.type === 'texts') {
          this.onmessage({ data: { id: data.id, result: data.payload.texts.map((_, i) => axis(i ? 1 : 0)) } });
        } else if (data.type === 'image') {
          const index = Number(await data.payload.blob.text());
          await new Promise(resolve => setTimeout(resolve, 1));
          if (this.index > 0) {
            assert.equal(data.allowDownloads, false);
            helperFailures++;
            this.onmessage({ data: { id: data.id, error: 'Vision helper failed' } });
            return;
          }
          successful.push(index);
          const result = axis(index + 2).map((value, i) => i === 0 ? .6 : value * .8);
          this.onmessage({ data: { id: data.id, result } });
        }
      });
    }
    terminate() { terminated.push(this.index); }
  };

  const candidates = Array.from({ length: 8 }, (_, index) => ({ url: 'https://retry-helper.test/' + index + '.jpg' }));
  const results = await rankImagesLocally(meaning, candidates, {
    exhaustiveScoring: true,
    fetchImpl: async url => new Response(new URL(url).pathname.slice(1, -4), { headers: { 'content-type': 'image/jpeg' } }),
    decode: async () => ({ width: 64, height: 64 })
  });
  assert.ok(helperFailures > 0);
  assert.deepEqual(terminated, [1]);
  assert.deepEqual(successful.sort((a, b) => a - b), candidates.map((_, index) => index));
  assert.deepEqual(results.map(item => item.url), candidates.map(item => item.url));
});

test('a loading helper cannot delay images and becomes eligible only after its initialize reply', async context => {
  await setup(context, { hardwareConcurrency: 4, deviceMemory: 4 });
  const { rankImagesLocally: rankFresh, disableImageLearning: disableFresh } = await import(`../js/services/imageLearning.js?coldHelper=${Date.now()}`);
  context.after(() => disableFresh());
  const workers = [], scored = [], waiting = [];
  const axis = index => Array.from({ length: CLIP_DIMENSION }, (_, i) => Number(i === index));
  globalThis.Worker = class {
    constructor() { this.index = workers.length; workers.push(this); }
    postMessage(data) {
      if (this.index && data.type === 'initialize') {
        waiting.push(() => this.onmessage({ data: { id: data.id, result: { backend: 'wasm' } } }));
        return; // Deliberately keep the helper cold until the first batch finishes.
      }
      queueMicrotask(async () => {
        if (data.type === 'cancel') return;
        if (data.type === 'image') { scored.push(this.index); await new Promise(resolve => setTimeout(resolve, 1)); }
        const result = data.type === 'initialize' ? { backend: 'wasm' }
          : data.type === 'texts' ? data.payload.texts.map(() => axis(0)) : axis(0);
        this.onmessage({ data: { id: data.id, result } });
      });
    }
    terminate() {}
  };
  const candidates = Array.from({ length: 8 }, (_, i) => ({ url: `https://cold-helper.test/${i}.jpg` }));
  const rank = () => rankFresh(meaning, candidates, {
    exhaustiveScoring: true,
    fetchImpl: async url => new Response(String(url), { headers: { 'content-type': 'image/jpeg' } }),
    decode: async () => ({ width: 64, height: 64 })
  });
  const timeout = setTimeout(() => assert.fail('A cold helper blocked the primary batch'), 1000);
  context.after(() => clearTimeout(timeout));
  await rank(); clearTimeout(timeout);
  assert.equal(workers.length, 2); assert.equal(waiting.length, 1);
  assert.deepEqual(scored, Array(8).fill(0));
  waiting[0](); scored.length = 0;
  await rank();
  assert.ok(scored.includes(1), 'the initialized helper can score later images');
  assert.equal(workers.length, 2, 'initialization does not create duplicate helpers');
});

test('review starts after three images and publishes each later candidate as it finishes', async context => {
  const { createImageScoringSession } = await import('../js/services/imageScoringSession.js');
  await setup(context);
  let images = 0;
  const downloads = [];
  const axis = index => Array.from({ length: CLIP_DIMENSION }, (_, i) => Number(i === index));
  globalThis.Worker = class {
    postMessage(data) {
      let result;
      if (data.type === 'texts') result = data.payload.texts.map((_, i) => axis(i ? 1 : 0));
      else if (data.type === 'image') {
        const index = images++;
        const similarity = index === 0 ? .8 : .5;
        result = axis(index + 2).map((v, i) => i === 0 ? similarity : v * Math.sqrt(1 - similarity ** 2));
      } else result = { backend: 'wasm' };
      queueMicrotask(() => this.onmessage({ data: { id: data.id, result } }));
    }
    terminate() {}
  };
  const candidates = Array.from({ length: 9 }, (_, i) => ({ url: `https://six-first.test/${i}.jpg` }));
  const imageScoringSession = createImageScoringSession();
  const results = await rankImagesLocally(meaning, candidates, {
    imageScoringSession, imageCandidateBudget: 9, deferImageScoring: true,
    fetchImpl: async url => { downloads.push(url); return new Response(url, { headers: { 'content-type': 'image/jpeg' } }); },
    decode: async () => ({ width: 64, height: 64 })
  });
  assert.equal(images, 3);
  assert.equal(downloads.length, 3);
  assert.equal(results.filter(image => image.ml.screening === 'pending').length, 6);
  const snapshots = [];
  await new Promise(resolve => {
    imageScoringSession.subscribe(results.at(-1).ml.reviewJob, update => {
      snapshots.push(update);
      if (!update.some(image => image.ml.screening === 'pending')) resolve();
    });
  });
  assert.deepEqual(snapshots.map(update => update.filter(image => image.ml.screening === 'pending').length), [5, 4, 3, 2, 1, 0]);
  assert.equal(images, 9);
  assert.equal(downloads.length, 9);
  imageScoringSession.clear();
  assert.equal(imageScoringSession.size, 0);
});

test('addition-scoped raw vectors are reused for another meaning and cleared before the next addition', async context => {
  const { createImageScoringSession } = await import('../js/services/imageScoringSession.js');
  await setup(context);
  let imageCalls = 0, textCalls = 0;
  const vector = axis => Array.from({ length: CLIP_DIMENSION }, (_, i) => Number(i === axis));
  globalThis.Worker = class {
    postMessage(data) {
      const result = data.type === 'texts' ? (textCalls++, data.payload.texts.map(() => vector(textCalls % 2)))
        : data.type === 'image' ? (imageCalls++, vector(0)) : { backend: 'wasm' };
      queueMicrotask(() => this.onmessage({ data: { id: data.id, result } }));
    }
    terminate() {}
  };
  const session = createImageScoringSession();
  const options = { imageScoringSession: session, fetchImpl: async () => new Response('same bytes', { headers: { 'content-type': 'image/jpeg' } }), decode: async () => ({ width: 64, height: 64 }) };
  const first = await rankImagesLocally(meaning, [photo], options);
  const second = await rankImagesLocally({ ...meaning, definition: 'A different definition.' }, [photo], options);
  assert.equal(imageCalls, 1); assert.equal(textCalls, 2);
  assert.notEqual(first[0].ml.sense, second[0].ml.sense);
  assert.notEqual(first[0].ml.selected, second[0].ml.selected, 'scores use the new meaning embedding');
  session.clear(); assert.equal(session.size, 0);
  await rankImagesLocally(meaning, [photo], { ...options, imageScoringSession: createImageScoringSession() });
  assert.equal(imageCalls, 2);
});

test('the foreground chooser keeps the full budget when the model prefers only one photo', async context => {
  await setup(context);
  const { findRelevantImages } = await import('../js/services/imageSearch.js');
  const { createImageScoringSession } = await import('../js/services/imageScoringSession.js');
  const axis = index => Array.from({ length: CLIP_DIMENSION }, (_, i) => Number(i === index));
  const textPrompts = [];
  globalThis.Worker = class {
    async postMessage(data) {
      let result = { backend: 'wasm' };
      if (data.type === 'texts') {
        textPrompts.push(data.payload.texts);
        result = data.payload.texts.map((_, index) => axis(index === 0 ? 0 : 1));
      }
      if (data.type === 'image') {
        const url = new URL(await data.payload.blob.text());
        result = axis(url.pathname.endsWith('/word/0.jpg') ? 0 : 1);
      }
      queueMicrotask(() => this.onmessage({ data: { id: data.id, result } }));
    }
    terminate() {}
  };

  for (const budget of [3, 6, 9]) {
    const session = createImageScoringSession();
    const candidates = await findRelevantImages({ ...meaning, word: `probe${budget}` }, {
      imageCandidateBudget: budget, imageScoringSession: session, deferImageScoring: true, aiScenes: false,
      provider: 'pexels', pexelsApiKey: 'synthetic', validateImages: false,
      fetchImpl: async value => {
        const url = new URL(value);
        if (url.hostname !== 'api.pexels.com') return new Response(value, { headers: { 'content-type': 'image/jpeg' } });
        const query = url.searchParams.get('query') === `probe${budget}` ? 'word' : 'definition';
        const count = Number(url.searchParams.get('per_page'));
        return Response.json({ photos: Array.from({ length: count }, (_, i) => ({
          url: `https://full-budget.test/${budget}/${query}/${i}`, alt: 'A photo',
          src: { medium: `https://full-budget.test/${budget}/${query}/${i}.jpg` }
        })) });
      },
      decode: async () => ({ width: 64, height: 64 })
    });
    assert.equal(candidates.length, budget);
    assert.equal(candidates.filter(image => image.ml.screening === 'scored').length, 3);
    const final = budget === 3 ? candidates : await new Promise(resolve => {
      session.subscribe(candidates.at(-1).ml.reviewJob, update => {
        if (!update.some(image => image.ml.screening === 'pending')) resolve(update);
      });
    });
    assert.equal(final.length, budget);
    assert.match(final[0].url, /word\/0\.jpg$/);
    assert.equal(final.filter(image => image.ml.belowThreshold).length, budget - 1);
    session.clear();
  }
  assert.ok(textPrompts[0].some(text => text === 'A photo of probe3'));
  assert.ok(textPrompts[0][0].includes(meaning.definition));
});
