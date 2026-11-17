// Bounded, session-only diagnostics. Never retain words, URLs, image data or
// model tensors. The small scalar records distinguish loading from forwards.
const recent = [];
const limit = 64;
export function recordInferenceTimings(rows) {
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (!['clip', 'meaning'].includes(row?.model) || !['initialize', 'text-forward', 'image-forward', 'meaning-forward', 'cache-read'].includes(row.stage)
      || !Number.isFinite(row.ms) || row.ms < 0) continue;
    const safe = { model: row.model, stage: row.stage, ms: row.ms };
    for (const key of ['first', 'batch', 'bytes']) if (typeof row[key] === 'boolean' || Number.isFinite(row[key])) safe[key] = row[key];
    recent.push(safe);
  }
  recent.splice(0, Math.max(0, recent.length - limit));
}
export function getInferenceTimings() { return recent.map(row => ({ ...row })); }
export function createInferenceTimings(model, { now = () => performance.now() } = {}) {
  const rows = [], seen = new Set();
  const start = (stage, details = {}) => {
    const began = now(); let done = false;
    return () => {
      if (done) return;
      done = true;
      rows.push({ model, stage, ms: Math.max(0, now() - began), ...details });
      rows.splice(0, Math.max(0, rows.length - limit));
    };
  };
  const measure = async (stage, operation, details = {}) => {
    const forward = stage.endsWith('-forward');
    const finish = start(stage, { ...details, ...(forward ? { first: !seen.has(stage) } : {}) });
    try { const result = await operation(); if (forward) seen.add(stage); return result; }
    finally { finish(); }
  };
  measure.start = start;
  return { measure, drain: () => rows.splice(0) };
}
