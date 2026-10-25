import { validPersonalizer, activeImageExamples } from './imagePersonalizer.js';

const signature = records => JSON.stringify(activeImageExamples(records).map(r => [r.id, r.updatedAt]).sort());
export class ImagePersonalizerTraining {
  constructor(persistence, { pretrained = () => import('../ml/pretrainedImagePersonalizer.js') } = {}) { this.persistence = persistence; this.pretrained = pretrained; this.timer = null; this.active = null; this.worker = null; this.generation = 0; this.report = null; }
  async current() {
    const history = this.persistence.imageHistory; await history.ready;
    const model = await history.model();
    if (validPersonalizer(model) && (model.resetAt || '') === history.resetAt) return model;
    const generic = await this.pretrained(); return generic?.getPretrainedImageModel?.() || null;
  }
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
      const records = await this.persistence.getImageEvents(), before = signature(records), model = await this.current();
      const generic = !model && await this.pretrained();
      const initialization = generic?.getImagePersonalizerInitialization?.() || null;
      if (requestedGeneration !== this.generation) return { accepted: false, reason: 'Training cancelled.' };
      const generation = this.generation, resetAt = this.persistence.imageHistory.resetAt;
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('../ml/imageTrainer.worker.js', import.meta.url), { type: 'module' }); this.worker = worker;
        const finish = () => { clearTimeout(timeout); worker.terminate(); if (this.worker === worker) this.worker = null; this.cancel = null; };
        const timeout = setTimeout(() => { finish(); reject(new Error('Photo preferences could not finish updating.')); }, 45000);
        this.cancel = () => { finish(); resolve({ accepted: false, reason: 'Training cancelled.' }); };
        worker.onmessage = ({ data }) => { if (data.progress) return; finish(); if (data.error) reject(new Error(data.error)); else resolve(data.result); };
        worker.onerror = () => { finish(); reject(new Error('Photo preferences could not be updated.')); };
        worker.postMessage({ records, model, options, initialization });
      });
      this.report = result;
      if (result.accepted && validPersonalizer(result.model)) {
        const latest = await this.persistence.getImageEvents(), active = await this.current();
        if (generation !== this.generation || resetAt !== this.persistence.imageHistory.resetAt || before !== signature(latest) || (active?.revision || 0) !== (model?.revision || 0)) {
          this.request(); return { accepted: false, reason: 'Photo choices changed during training; candidate discarded.' };
        }
        await this.persistence.imageHistory.saveModel({ ...result.model, resetAt });
      }
      return result;
    };
    this.active = operation().finally(() => { this.active = null; }); return this.active;
  }
}
