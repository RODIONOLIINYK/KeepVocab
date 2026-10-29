import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleImageModelWarmup } from '../js/services/imageModelStartup.js';

function fakeHost({ hidden = false, idle = true, scheduler = false, frames = true } = {}) {
  let id = 0;
  const listeners = new Set(), frameCallbacks = new Map(), idleCallbacks = new Map(), timers = new Map(), tasks = [];
  const calls = [];
  const host = {
    document: {
      hidden,
      addEventListener(name, callback) { assert.equal(name, 'visibilitychange'); listeners.add(callback); },
      removeEventListener(name, callback) { assert.equal(name, 'visibilitychange'); listeners.delete(callback); }
    },
    setTimeout(callback, delay) { calls.push(['timer', delay]); timers.set(++id, callback); return id; },
    clearTimeout(key) { timers.delete(key); },
    AbortController
  };
  if (frames) {
    host.requestAnimationFrame = callback => { calls.push(['frame']); frameCallbacks.set(++id, callback); return id; };
    host.cancelAnimationFrame = key => frameCallbacks.delete(key);
  }
  if (idle) {
    host.requestIdleCallback = (...args) => { calls.push(['idle', args.length]); idleCallbacks.set(++id, args[0]); return id; };
    host.cancelIdleCallback = key => idleCallbacks.delete(key);
  }
  if (scheduler) host.scheduler = {
    postTask(callback, options) {
      calls.push(['task', options.priority]);
      return new Promise((resolve, reject) => {
        const row = { callback, options, resolve, reject }; tasks.push(row);
        options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }
  };
  const flushMap = map => { const batch = [...map.values()]; map.clear(); for (const callback of batch) callback(); };
  return {
    host, calls, frameCallbacks, idleCallbacks, timers, tasks, listeners,
    frame: () => flushMap(frameCallbacks), idle: () => flushMap(idleCallbacks), tick: () => flushMap(timers),
    task() { const row = tasks.shift(); if (!row) return; if (row.options.signal.aborted) return; row.resolve(row.callback()); },
    visible(value) { host.document.hidden = !value; for (const callback of [...listeners]) callback(); }
  };
}
const nextMicrotask = () => new Promise(resolve => queueMicrotask(resolve));

test('warmup waits for two animation frames then an idle opportunity without a forced timeout', () => {
  const h = fakeHost({ scheduler: true }); let runs = 0;
  scheduleImageModelWarmup(() => { runs++; }, { host: h.host });
  assert.equal(runs, 0); assert.deepEqual(h.calls, [['frame']]);
  h.frame(); assert.equal(runs, 0); assert.equal(h.idleCallbacks.size, 0);
  h.frame(); assert.equal(runs, 0); assert.deepEqual(h.calls, [['frame'], ['frame'], ['idle', 1]]);
  h.idle(); assert.equal(runs, 1); assert.equal(h.listeners.size, 0);
  h.visible(true); h.frame(); h.idle(); assert.equal(runs, 1);
});

test('hidden startup waits for visibility and hiding an idle warmup cancels it until visible again', () => {
  const h = fakeHost({ hidden: true }); let runs = 0;
  scheduleImageModelWarmup(() => { runs++; }, { host: h.host });
  assert.deepEqual(h.calls, []); assert.equal(h.listeners.size, 1);
  h.visible(true); h.frame(); h.frame(); assert.equal(h.idleCallbacks.size, 1);
  h.visible(false); assert.equal(h.idleCallbacks.size, 0); h.idle(); assert.equal(runs, 0);
  h.visible(true); h.frame(); h.frame(); h.idle(); assert.equal(runs, 1);
});

test('cancelling at either frame or idle phase removes pending work and visibility listeners', () => {
  for (const phase of [0, 1, 2]) {
    const h = fakeHost(); let runs = 0;
    const cancel = scheduleImageModelWarmup(() => { runs++; }, { host: h.host });
    for (let i = 0; i < phase; i++) h.frame();
    cancel(); cancel(); h.frame(); h.frame(); h.idle(); h.visible(true);
    assert.equal(runs, 0); assert.equal(h.frameCallbacks.size, 0); assert.equal(h.idleCallbacks.size, 0); assert.equal(h.listeners.size, 0);
  }
});

test('postTask fallback uses cancellable background priority and resumes after hidden cancellation', async () => {
  const h = fakeHost({ idle: false, scheduler: true }); let runs = 0;
  const cancel = scheduleImageModelWarmup(() => { runs++; }, { host: h.host });
  h.frame(); h.frame(); assert.equal(h.tasks[0].options.priority, 'background');
  const first = h.tasks[0]; h.visible(false); assert.equal(first.options.signal.aborted, true);
  await nextMicrotask(); h.task(); assert.equal(runs, 0);
  h.visible(true); h.frame(); h.frame(); h.task(); await nextMicrotask();
  assert.equal(runs, 1); assert.equal(h.listeners.size, 0); cancel();
});

test('cancelling a background task or fallback timer prevents execution', async () => {
  const h = fakeHost({ idle: false, scheduler: true }); let runs = 0;
  const cancel = scheduleImageModelWarmup(() => { runs++; }, { host: h.host });
  h.frame(); h.frame(); const pending = h.tasks[0]; cancel();
  assert.equal(pending.options.signal.aborted, true); h.task(); await nextMicrotask(); assert.equal(runs, 0);
  const fallback = fakeHost({ idle: false });
  const cancelTimer = scheduleImageModelWarmup(() => { runs++; }, { host: fallback.host });
  fallback.frame(); fallback.frame(); assert.deepEqual(fallback.calls.at(-1), ['timer', 750]);
  cancelTimer(); fallback.tick(); assert.equal(runs, 0); assert.equal(fallback.listeners.size, 0);
});

test('unsupported idle and scheduling APIs use a delayed timer; missing animation API still defers work', () => {
  const h = fakeHost({ idle: false, frames: false }); let runs = 0;
  scheduleImageModelWarmup(() => { runs++; }, { host: h.host });
  assert.deepEqual(h.calls, [['timer', 750]]); assert.equal(runs, 0);
  h.tick(); assert.equal(runs, 1); assert.equal(h.listeners.size, 0);
});

test('callback errors and rejected promises cannot interrupt app startup; no-DOM environments do nothing', async () => {
  for (const callback of [() => { throw new Error('failed'); }, () => Promise.reject(new Error('failed'))]) {
    const h = fakeHost({ frames: false }); scheduleImageModelWarmup(callback, { host: h.host });
    assert.doesNotThrow(() => h.idle()); await nextMicrotask(); assert.equal(h.listeners.size, 0);
  }
  const h = fakeHost(); delete h.host.document;
  assert.doesNotThrow(() => scheduleImageModelWarmup(() => assert.fail('must not run'), { host: h.host })());
  assert.deepEqual(h.calls, []);
});

test('a rejected scheduler implementation falls back without running a duplicate warmup', async () => {
  const h = fakeHost({ idle: false, scheduler: true, frames: false }); let runs = 0;
  scheduleImageModelWarmup(() => { runs++; }, { host: h.host });
  h.tasks.shift().reject(new Error('scheduler unavailable')); await nextMicrotask();
  assert.equal(h.timers.size, 1); h.tick(); assert.equal(runs, 1);
});
