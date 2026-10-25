import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareImageThumbnails } from '../js/services/imageThumbnails.js';

const candidate = id => ({ url: `https://images.example/${id}.jpg` });
const imageResponse = (body = 'source') => new Response(body, { headers: { 'content-type': 'image/jpeg' } });
const smallDecode = async () => ({ width: 80, height: 60 });

test('small thumbnails preserve their original bytes and prefer previews to full images', async () => {
  const requested = [];
  const images = [{ ...candidate('full'), thumbnailUrl: 'https://images.example/preview.jpg' }];
  const result = await prepareImageThumbnails(images, {
    fetchImpl: async (url, options) => { requested.push(url); assert.equal(options.mode, 'cors'); assert.equal(options.credentials, 'omit'); return imageResponse(); },
    decode: smallDecode,
    resize: () => assert.fail('Small image bytes should be preserved')
  });
  assert.deepEqual(requested, [images[0].thumbnailUrl]);
  assert.equal(result[0].candidate, images[0]);
  assert.equal(result[0].candidateId, 0);
  assert.equal(result[0].index, 0);
  assert.equal(result[0].inlineData.data, Buffer.from('source').toString('base64'));
  assert.equal(result[0].inlineData.mimeType, 'image/jpeg');
  assert.equal(result[0].byteLength, 6);
});

test('large images are resized proportionally and output bytes are decoded again to verify dimensions', async () => {
  let decoded = 0;
  let closed = 0;
  const result = await prepareImageThumbnails([candidate('resize')], {
    maxDimension: 2000,
    fetchImpl: async () => imageResponse(),
    decode: async blob => {
      decoded++;
      const text = await blob.text();
      return { ...(text === 'source' ? { width: 1200, height: 600 } : JSON.parse(text)), close: () => closed++ };
    },
    resize: async (_image, options) => {
      assert.equal(options.width, 384);
      assert.equal(options.height, 192);
      return new Blob([JSON.stringify({ width: options.width, height: options.height })], { type: 'image/jpeg' });
    }
  });
  assert.equal(decoded, 2);
  assert.equal(closed, 2);
  assert.equal(result[0].width, 384);
  assert.equal(result[0].height, 192);
});

test('failed decodes and incorrectly resized or oversized outputs keep lexical-only fallback', async () => {
  for (const failure of ['decode', 'dimensions', 'bytes']) {
    let decodes = 0;
    const result = await prepareImageThumbnails([candidate(failure)], {
      maxBytes: 20,
      fetchImpl: async () => imageResponse(),
      decode: async () => { if (failure === 'decode') throw new Error('bad image'); decodes++; return { width: 1000, height: 1000 }; },
      resize: async () => new Blob([failure === 'bytes' ? 'x'.repeat(21) : 'bad dimensions'], { type: 'image/jpeg' })
    });
    assert.deepEqual(result, []);
    if (failure === 'dimensions') assert.equal(decodes, 2);
  }
});

test('at most four candidates and two downloads run, while failed candidate IDs retain their original positions', async () => {
  let active = 0;
  let maximum = 0;
  let calls = 0;
  const result = await prepareImageThumbnails(Array.from({ length: 10 }, (_, index) => candidate(index)), {
    limit: 100,
    fetchImpl: async url => {
      calls++; active++; maximum = Math.max(active, maximum);
      await new Promise(resolve => setTimeout(resolve, 2));
      active--;
      if (url.endsWith('/1.jpg')) throw new TypeError('CORS failure');
      return imageResponse();
    },
    decode: smallDecode
  });
  assert.equal(calls, 4);
  assert.equal(maximum, 2);
  assert.deepEqual(result.map(item => item.candidateId), [0, 2, 3]);
});

test('invalid protocols, unsupported content, advertised oversize, and streaming overflow never reach decoding', async () => {
  let cancelled = 0;
  let calls = 0;
  const images = [candidate('svg'), candidate('size'), candidate('stream'), { url: 'file:///private/secret.jpg' }];
  const result = await prepareImageThumbnails(images, {
    maxSourceBytes: 4,
    fetchImpl: async url => {
      calls++;
      if (url.endsWith('/svg.jpg')) return new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } });
      if (url.endsWith('/size.jpg')) return new Response('large', { headers: { 'content-type': 'image/jpeg', 'content-length': '3000000' } });
      return new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(3)); }, cancel() { cancelled++; } }), { headers: { 'content-type': 'image/jpeg' } });
    },
    decode: () => assert.fail('Invalid downloads must not be decoded')
  });
  assert.deepEqual(result, []);
  assert.equal(calls, 3);
  assert.equal(cancelled, 1);
});

test('timeouts abort hung fetches even if the fetch implementation ignores cancellation', async () => {
  let signal;
  const result = await prepareImageThumbnails([candidate('hung')], {
    timeoutMs: 5,
    fetchImpl: async (_url, options) => { signal = options.signal; return new Promise(() => {}); },
    decode: smallDecode
  });
  assert.deepEqual(result, []);
  assert.equal(signal.aborted, true);
});

test('concurrent reranking deduplicates downloads and one aborted consumer cannot cancel another', async () => {
  let calls = 0;
  let resolveFetch;
  let fetchSignal;
  const fetchImpl = (_url, options) => { calls++; fetchSignal = options.signal; return new Promise(resolve => { resolveFetch = resolve; }); };
  const options = { fetchImpl, decode: smallDecode };
  const controller = new AbortController();
  const first = prepareImageThumbnails([candidate('shared')], { ...options, signal: controller.signal });
  const second = prepareImageThumbnails([candidate('shared')], options);
  controller.abort();
  assert.deepEqual(await first, []);
  assert.equal(fetchSignal.aborted, false);
  resolveFetch(imageResponse());
  assert.equal((await second).length, 1);
  assert.equal(calls, 1);
  const cached = await prepareImageThumbnails([candidate('shared')], options);
  cached[0].inlineData.data = 'changed by caller';
  assert.equal((await prepareImageThumbnails([candidate('shared')], options))[0].inlineData.data, Buffer.from('source').toString('base64'));
  assert.equal(calls, 1);
});

test('aborting the only consumer cancels its download and does not poison later requests', async () => {
  let calls = 0;
  let signal;
  const fetchImpl = async (_url, options) => { calls++; signal = options.signal; return calls === 1 ? new Promise(() => {}) : imageResponse(); };
  const options = { fetchImpl, decode: smallDecode };
  const controller = new AbortController();
  const first = prepareImageThumbnails([candidate('retry-aborted')], { ...options, signal: controller.signal });
  controller.abort();
  assert.deepEqual(await first, []);
  assert.equal(signal.aborted, true);
  assert.equal((await prepareImageThumbnails([candidate('retry-aborted')], options)).length, 1);
  assert.equal(calls, 2);
});

test('cached thumbnails are bounded by entry count and configured zero limits avoid fetching', async () => {
  let calls = 0;
  const options = { fetchImpl: async () => { calls++; return imageResponse(); }, decode: smallDecode };
  for (let index = 0; index < 33; index++) await prepareImageThumbnails([candidate(`lru-${index}`)], options);
  await prepareImageThumbnails([candidate('lru-32')], options);
  assert.equal(calls, 33);
  await prepareImageThumbnails([candidate('lru-0')], options);
  assert.equal(calls, 34);
  assert.deepEqual(await prepareImageThumbnails([candidate('zero')], { ...options, limit: 0 }), []);
  assert.equal(calls, 34);
});


test('CLIP can prefer an uncropped original and falls back to its preview within the download budget', async () => {
  for (const oversized of [false,true]) {
    const seen=[];
    const photo={url:'https://photos.test/full-'+oversized,thumbnailUrl:'https://photos.test/preview-'+oversized};
    const result=await prepareImageThumbnails([photo],{preferOriginal:true,maxSourceBytes:20,
      fetchImpl:async url=>{seen.push(url);return url===photo.url&&oversized?new Response('big',{headers:{'content-type':'image/jpeg','content-length':'21'}}):imageResponse();},decode:smallDecode});
    assert.deepEqual(seen,oversized?[photo.url,photo.thumbnailUrl]:[photo.url]);assert.equal(result.length,1);
  }
});
