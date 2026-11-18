import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageScoringSession } from '../js/services/imageScoringSession.js';
const image = text => new Blob([text], { type: 'image/jpeg' });

test('one addition shares in-flight and completed embeddings across meanings and workers by bytes', async () => {
  const session = createImageScoringSession();
  let calls = 0;
  const compute = async () => { calls++; return { fullVector: [1, 0], cropVector: [0, 1] }; };
  const [first, second] = await Promise.all([session.embed(image('same pixels'), 'encoder-v1', compute), session.embed(image('same pixels'), 'encoder-v1', compute)]);
  assert.equal(calls, 1); assert.equal(first, second);
  assert.equal(await session.embed(image('same pixels'), 'encoder-v1', compute), first);
  assert.equal(session.size, 1);
  await session.embed(image('same pixels'), 'encoder-v2', compute);
  await session.embed(image('different pixels'), 'encoder-v1', compute);
  assert.equal(calls, 3, 'model/preprocessing generation and exact bytes identify raw vision outputs');
  session.clear(); assert.equal(session.size, 0); assert.equal(session.closed, true);
  await assert.rejects(session.embed(image('same pixels'), 'encoder-v1', compute), /ended/);
  const nextAddition = createImageScoringSession();
  await nextAddition.embed(image('same pixels'), 'encoder-v1', compute);
  assert.equal(calls, 4, 'a later save operation starts empty');
});

test('save/cancel clears immediately and late completion cannot refill or reuse the cache', async () => {
  const session = createImageScoringSession();
  let release, started;
  const began = new Promise(resolve => { started = resolve; });
  const pending = session.embed(image('pending'), 'v1', () => { started(); return new Promise(resolve => { release = resolve; }); });
  await began; assert.equal(session.size, 1);
  session.clear(); assert.equal(session.size, 0);
  release([1]); await assert.rejects(pending, /ended/); assert.equal(session.size, 0);
});

test('failed computations can retry, and long bulk reviews have a fixed memory bound', async () => {
  const session = createImageScoringSession();
  await assert.rejects(session.embed(image('bad'), 'v1', () => { throw new Error('worker failed'); }), /failed/);
  assert.equal(session.size, 0);
  assert.deepEqual(await session.embed(image('bad'), 'v1', () => [1]), [1]);
  for (let i = 0; i < 120; i++) await session.embed(image(String(i)), 'v1', () => [i]);
  assert.equal(session.size, 96);
});
