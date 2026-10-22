import { escapeHtml } from '../utils/html.js';
import { exampleForLearning } from '../services/learningDefinitions.js?v=18800';

export function renderMeaningExplanation(word, { showSource = true } = {}) {
  const source = String(word.sourceDefinition || '');
  return `<p class="meaning-definition">${escapeHtml(word.definition)}</p>${word.usageNote ? `<p class="meaning-usage"><strong>When to use it:</strong> ${escapeHtml(word.usageNote)}</p>` : ''}${showSource && source && source !== word.definition ? `<details class="dictionary-source"><summary>Dictionary source</summary><p>${escapeHtml(source)}</p></details>` : ''}`;
}

export function reviewedExplanationPatch(original, candidate) {
  if (!candidate?.definition?.trim() || !exampleForLearning(candidate)) throw new Error('This explanation needs a clear meaning and a modern example before it can be applied.');
  const expected = original.sourceDefinition || original.definition;
  if (candidate.word !== original.word || candidate.partOfSpeech !== original.partOfSpeech || candidate.sourceDefinition !== expected) throw new Error('The suggested explanation does not match this saved meaning.');
  return Object.fromEntries(['definition', 'sourceDefinition', 'sourceDefinitions', 'sourceFingerprint', 'usageNote', 'example', 'exampleSourceUrl', 'exampleAttribution', 'exampleLicense', 'explanationSource', 'explanationModel', 'explanationVersion'].map(key => [key, candidate[key] ?? (key === 'sourceDefinitions' ? [] : '')]));
}

export function applyReviewedExplanations(persistence, drafts) {
  let applied = 0;
  let skipped = 0;
  for (const draft of drafts.filter(item => item.selected && item.candidate)) {
    const latest = persistence.getWords().find(word => word.id === draft.original.id);
    if (!latest || ['word', 'partOfSpeech', 'definition', 'example', 'usageNote'].some(key => (latest[key] || '') !== (draft.original[key] || ''))
      || (latest.sourceDefinition || latest.definition) !== (draft.original.sourceDefinition || draft.original.definition)) { skipped += 1; continue; }
    persistence.updateWord(latest.id, reviewedExplanationPatch(draft.original, draft.candidate));
    applied += 1;
  }
  return { applied, skipped };
}

export function renderExplanationReview(drafts) {
  return `<section class="spec-card explanation-review" aria-labelledby="explanation-review-heading"><div class="card-header-bar"><div><h2 id="explanation-review-heading">Review clearer explanations</h2><p>Apply the meanings you want to keep. Your review history stays with each meaning.</p></div></div><div class="explanation-review-grid">${drafts.map((draft, index) => `<article><h3>${escapeHtml(draft.original.word)}</h3>${draft.candidate ? `<label class="explanation-approve"><input type="checkbox" data-approve-explanation="${index}" ${draft.selected ? 'checked' : ''}> Use this explanation</label>${renderMeaningExplanation(draft.candidate, { showSource: false })}<blockquote>${escapeHtml(exampleForLearning(draft.candidate))}</blockquote><details><summary>Previous wording</summary><p>${escapeHtml(draft.original.definition)}</p></details>` : `<p role="status">${escapeHtml(draft.error || 'A verified explanation was not available. This meaning has been kept.')}</p>`}</article>`).join('')}</div><div class="inline-actions"><button class="btn-green-solid" id="apply-explanation-review">Apply selected explanations</button><button class="status-pill offline" id="cancel-explanation-review">Keep current meanings</button></div><p id="explanation-review-status" role="status" aria-live="polite"></p></section>`;
}
