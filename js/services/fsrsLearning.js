import { driveSync } from './driveSync.js?v=18900';
import { readFsrsConfig, normalizeFsrsConfig } from './fsrsConfig.js';
import { optimizeFsrsChannel, reviewDatasetFingerprint, MIN_TRAINING_REVIEWS, MIN_TRAINING_WORDS } from './fsrsOptimizer.js';
import { replayWordFsrsHistory } from './srsEngine.js?v=18900';
import { sourceDefinitionFingerprint } from './learningDefinitions.js?v=18900';
const ATTEMPT_KEY = 'keepvocab_fsrs_training_attempt_v1';
const listeners = new Set();
const scheduled = new WeakMap();
let active;
let phase = 'idle';
let message = '';
function attempt(persistence) { try { return JSON.parse(persistence.storage?.getItem(ATTEMPT_KEY) || '{}'); } catch { return {}; } }
function emit(persistence = driveSync) { for (const listener of listeners) listener(getFsrsLearningStatus(persistence)); }
export function subscribeFsrsLearning(listener) { listeners.add(listener);return () => listeners.delete(listener); }
export function getFsrsLearningStatus(persistence = driveSync) {
  const config = readFsrsConfig(persistence.getSettings());
  return { phase, message, config, minimumReviews: MIN_TRAINING_REVIEWS, minimumWords: MIN_TRAINING_WORDS,
    lastAttempt: attempt(persistence), historyWarning: persistence.reviewHistory?.error || '' };
}
export function saveFsrsPreferences(patch, persistence = driveSync) {
  const config = normalizeFsrsConfig({ ...readFsrsConfig(persistence.getSettings()), ...patch, updatedAt: new Date().toISOString() });
  persistence.updateSettings({ fsrs: config });emit(persistence);return config;
}
function trainWorker(events, models, persistence) {
  if (typeof Worker === 'undefined') return Promise.resolve(Object.fromEntries(['recall', 'recognition', 'assisted'].map(channel => [channel, optimizeFsrsChannel(events, channel, models[channel])])));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../ml/fsrsTrainer.worker.js', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => { worker.terminate();reject(new Error('Memory training took too long. Current parameters were retained.')); }, 60000);
    const finish = () => { clearTimeout(timer);worker.terminate(); };
    worker.onmessage = ({ data }) => {
      if (data.progress) { message = `Fitting ${data.progress.channel} memory parameters (${data.progress.pass}/${data.progress.total})…`;emit(persistence);return; }
      finish();if (data.error) reject(new Error(data.error)); else resolve(data.results);
    };
    worker.onerror = () => { finish();reject(new Error('Memory training could not finish. Current parameters were retained.')); };
    worker.postMessage({ events, models });
  });
}
export async function trainPersonalScheduler(persistence = driveSync, { force = false } = {}) {
  if (active) return active;
  const operation = async () => {
    const events = await persistence.getReviewEvents();
    const last = attempt(persistence);
    const fingerprint = reviewDatasetFingerprint(events);
    if (last.fingerprint === fingerprint) { message = 'No new review history to fit.';emit(persistence);return last; }
    if (!force && (events.length < MIN_TRAINING_REVIEWS || events.length - (last.totalEvents || 0) < 100)) return null;
    phase = 'training';message = 'Checking dated review history and fitting FSRS-6 locally…';emit(persistence);
    try {
      const config = readFsrsConfig(persistence.getSettings());
      const results = await trainWorker(events, config.models, persistence);
      // Preferences and word answers may have changed while the worker ran.
      const latest = readFsrsConfig(persistence.getSettings());
      let accepted = 0;
      for (const [channel, result] of Object.entries(results)) if (result.accepted) {
        const current = latest.models[channel];
        if ((current?.revision || 0) === (config.models[channel]?.revision || 0)) { latest.models[channel] = result.model;accepted += 1; }
      }
      if (accepted) {
        persistence.updateSettings({ fsrs: latest });
        const history = await persistence.getReviewEvents();
        const grouped = new Map();
        for (const event of history) { if (!grouped.has(event.wordId)) grouped.set(event.wordId, []); grouped.get(event.wordId).push(event); }
        const words = persistence.getWords().map(word => replayWordFsrsHistory(word, grouped.get(word.id), latest,
          { preserveDue: true, sourceFingerprint: sourceDefinitionFingerprint(word) }));
        persistence.saveWords(words);
      }
      const summary = { attemptedAt: new Date().toISOString(), fingerprint, totalEvents: events.length, accepted, results };
      persistence.storage?.setItem(ATTEMPT_KEY, JSON.stringify(summary));
      phase = 'idle';message = accepted ? 'Personal memory parameters passed chronological validation and are active.'
        : results.recall?.reason || 'Current memory parameters were retained.';
      emit(persistence);return summary;
    } catch (error) { phase = 'error';message = error.message;emit(persistence);throw error; }
  };
  active = operation().finally(() => { active = null; });
  return active;
}
export function requestSchedulerTraining(persistence = driveSync) {
  if (!readFsrsConfig(persistence.getSettings()).automaticTraining) return;
  clearTimeout(scheduled.get(persistence));
  const timer = setTimeout(() => { scheduled.delete(persistence);void trainPersonalScheduler(persistence).catch(() => {}); }, 30000);
  timer.unref?.();scheduled.set(persistence, timer);
}
