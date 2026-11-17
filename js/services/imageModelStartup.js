// Only schedule the tiny worker-start message here. Model loading and inference
// belong in the dedicated worker, never inside a main-thread idle callback.
export function scheduleImageModelWarmup(callback, { host = globalThis } = {}) {
  const document = host.document;
  if (!document || typeof callback !== 'function') return () => {};

  let cancelled = false, completed = false, generation = 0;
  let frame = null, idle = null, timer = null, taskController = null;
  const isCurrent = expected => !cancelled && !completed && expected === generation;

  function clearPending() {
    generation++;
    if (frame !== null) host.cancelAnimationFrame?.(frame);
    if (idle !== null) host.cancelIdleCallback?.(idle);
    if (timer !== null) host.clearTimeout?.(timer);
    taskController?.abort();
    frame = idle = timer = taskController = null;
  }
  function removeVisibilityListener() {
    document.removeEventListener?.('visibilitychange', onVisibilityChange);
  }
  function run(expected) {
    if (!isCurrent(expected)) return;
    if (document.hidden) { clearPending(); return; }
    completed = true;
    clearPending();
    removeVisibilityListener();
    try { void Promise.resolve(callback()).catch(() => {}); }
    catch { /* A failed optional warmup must not interrupt opening the app. */ }
  }
  function scheduleBackground(expected) {
    if (!isCurrent(expected)) return;
    if (document.hidden) { clearPending(); return; }
    // The callback only posts worker initialization. Bound idle/background
    // deferral after paint so a busy foreground page cannot starve model loading.
    timer = host.setTimeout(() => { timer = null; run(expected); }, 750);
    timer?.unref?.();
    if (typeof host.requestIdleCallback === 'function') {
      try { idle = host.requestIdleCallback(() => { idle = null; run(expected); }, { timeout: 750 }); }
      catch { /* The deadline timer still starts loading. */ }
    } else if (typeof host.scheduler?.postTask === 'function') {
      const Controller = host.AbortController || globalThis.AbortController;
      taskController = new Controller();
      const controller = taskController;
      try {
        void Promise.resolve(host.scheduler.postTask(() => run(expected), {
          priority: 'background', signal: controller.signal
        })).catch(() => {});
      } catch { /* The deadline timer still starts loading. */ }
    }
  }
  function schedule() {
    if (cancelled || completed) return;
    clearPending();
    if (document.hidden) return;
    const expected = generation;
    if (typeof host.requestAnimationFrame === 'function') {
      frame = host.requestAnimationFrame(() => {
        frame = null;
        if (!isCurrent(expected)) return;
        if (document.hidden) { clearPending(); return; }
        frame = host.requestAnimationFrame(() => {
          frame = null;
          scheduleBackground(expected);
        });
      });
    } else {
      scheduleBackground(expected);
    }
  }
  function onVisibilityChange() {
    if (cancelled || completed) return;
    if (document.hidden) clearPending();
    else schedule();
  }

  document.addEventListener?.('visibilitychange', onVisibilityChange);
  schedule();
  return () => {
    if (cancelled || completed) return;
    cancelled = true;
    clearPending();
    removeVisibilityListener();
  };
}
