import { trainImagePersonalizer } from '../services/imagePersonalizer.js';
import { fitInvariantHead, invariantRankingScore, invariantFeatures, validRankingEvidence } from '../services/vocabInvariantHead.js';
import { validateLearnedHead } from '../services/learnedHeadValidation.js';
import { logistic } from '../services/learnedScorer.js';
import { getPretrainedInvariantHead } from './pretrainedSemanticHeads.js';
self.onmessage = ({ data }) => {
  try {
    const records = data.records.filter(r => r.kind !== 'comparison' && validRankingEvidence(r.rankingEvidence));
    const frozenSeed = getPretrainedInvariantHead();
    const invariant = validateLearnedHead(records, { group: r => String(r.context?.word || r.meaningId).toLowerCase(), rankingGroup: r => r.meaningId, fit: rows => fitInvariantHead(rows, frozenSeed),
      score: (head, row) => invariantRankingScore(head, row.rankingEvidence), baseline: row => {
        const seededScore = invariantRankingScore(data.invariantIncumbent || frozenSeed, row.rankingEvidence);
        if (seededScore !== null) return seededScore;
        if (Number.isFinite(row.rankingEvidence.baselineScore)) return logistic(8 * (row.rankingEvidence.baselineScore - .2));
        const x = invariantFeatures(row.rankingEvidence); return logistic(-1.6 + 2.8 * x[2] + 5.2 * x[5] + 1.2 * x[6] + 4.8 * x[8] - 2 * x[10]);
      } });
    self.postMessage({ result: { ...trainImagePersonalizer(data.records, data.model, { ...data.options, initialization: data.initialization, progress: progress => self.postMessage({ progress }) }), invariant } });
  }
  catch (error) { self.postMessage({ error: error.message || 'Photo preferences could not be updated.' }); }
};
