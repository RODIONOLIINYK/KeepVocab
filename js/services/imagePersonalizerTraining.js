import { isCurrentPersonalizer, activeImageExamples, isValidatedSemanticModel, createPreferencePersonalizer } from './imagePersonalizer.js';
import { IMAGE_TRAINING_RECIPE, MOBILE_IMAGE_TRAINING_BUDGET_MS } from '../ml/imageTrainingRecipe.js';
import { imageRankingAcceptance } from './imageChoicePolicy.js';

const signature = records => JSON.stringify(activeImageExamples(records).map(r => [r.id, r.updatedAt]).sort());
export class ImagePersonalizerTraining {
  constructor(persistence, { pretrained = () => import('../ml/pretrainedImagePersonalizer.js') } = {}) { this.persistence = persistence; this.pretrained = pretrained; this.timer = null; this.active = null; this.worker = null; this.generation = 0; this.report = null; }
  async personal() {
    const history = this.persistence.imageHistory; await history.ready;
    const model = await history.model();
    return isCurrentPersonalizer(model) && model.role !== 'semantic' && (model.resetAt || '') === history.resetAt ? model : null;
  }
  async semantic() {
    const generic = await this.pretrained(), model = generic?.getPretrainedImageModel?.();
    return isValidatedSemanticModel(model) ? model : null;
  }
  async current() { return await this.personal() || await this.semantic(); }
  request() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.train().catch(() => {}); }, 30000);
    this.timer.unref?.();
  }
  stop() {
    clearTimeout(this.timer); this.timer = null; this.generation++;
    this.cancel?.(); this.worker?.terminate(); this.worker = null;
  }
  async train(options = {}) {
    if (this.active) return this.active;
    if (typeof Worker === 'undefined') return { accepted: false, reason: 'Background training is unavailable on this device.' };
    const operation = async () => {
      const requestedGeneration = this.generation;
      const records = await this.persistence.getImageEvents(), before = signature(records), model = await this.personal();
      // A public semantic head stays immutable. Personal fitting starts as an
      // exact copy; the frozen copy remains an acceptance comparator.
      const initialization = model ? null : createPreferencePersonalizer(await this.semantic());
      if (requestedGeneration !== this.generation) return { accepted: false, reason: 'Training cancelled.' };
      const generation = this.generation, resetAt = this.persistence.imageHistory.resetAt;
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('../ml/imageTrainer.worker.js', import.meta.url), { type: 'module' }); this.worker = worker;
        const finish = () => { clearTimeout(timeout); worker.terminate(); if (this.worker === worker) this.worker = null; this.cancel = null; };
        const timeout = setTimeout(() => { finish(); reject(new Error('Photo preferences could not finish updating.')); }, 45000);
        this.cancel = () => { finish(); resolve({ accepted: false, reason: 'Training cancelled.' }); };
        worker.onmessage = ({ data }) => { if (data.progress) return; finish(); if (data.error) reject(new Error(data.error)); else resolve(data.result); };
        worker.onerror = () => { finish(); reject(new Error('Photo preferences could not be updated.')); };
        worker.postMessage({ records, model, options: { ...IMAGE_TRAINING_RECIPE, ...options,
          maxMilliseconds: Math.min(Number(options.maxMilliseconds) || MOBILE_IMAGE_TRAINING_BUDGET_MS, MOBILE_IMAGE_TRAINING_BUDGET_MS), task: 'preference' }, initialization });
      });
      this.report = result;
      if (result.accepted && (!isCurrentPersonalizer(result.model) || result.model.role !== 'preference')) {
        return { accepted: false, reason: 'Only a separately validated personal preference model can replace personal weights.' };
      }
      if (result.accepted) {
        const latest = await this.persistence.getImageEvents(), active = await this.personal();
        if (generation !== this.generation || resetAt !== this.persistence.imageHistory.resetAt || before !== signature(latest) || (active?.revision || 0) !== (model?.revision || 0)) {
          this.request(); return { accepted: false, reason: 'Photo choices changed during training; candidate discarded.' };
        }
        const ranking = imageRankingAcceptance(result);
        if (!ranking.accepted) return this.report = { ...result, accepted: false, reason: ranking.reason, ranking };
        await this.persistence.imageHistory.saveModel({ ...result.model, resetAt });
      }
      return result;
    };
    this.active = operation().finally(() => { this.active = null; }); return this.active;
  }
}
