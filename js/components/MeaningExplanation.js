import { escapeHtml } from '../utils/html.js';
import { exampleForLearning, meaningSupportFor } from '../services/learningDefinitions.js?v=18900';

export function renderMeaningExplanation(word, { showSource = true, showSupport = true, showUsage = true } = {}) {
  const source = String(word.sourceDefinition || '');
  const support = showSupport ? meaningSupportFor(word) : null;
  return `<p class="meaning-definition">${escapeHtml(word.definition)}</p>${showUsage && word.usageNote ? `<p class="meaning-usage"><strong>When to use it:</strong> ${escapeHtml(word.usageNote)}</p>` : ''}${support ? `<details class="meaning-support"><summary>How the example uses this meaning</summary><p>${escapeHtml(support.exampleExplanation)}</p>${support.contrast ? `<p>${escapeHtml(support.contrast)}</p>` : ''}</details>` : ''}${showSource && source && source !== word.definition ? `<details class="dictionary-source"><summary>Dictionary source</summary><p>${escapeHtml(source)}</p></details>` : ''}`;
}

export function reviewedExplanationPatch(original, candidate) {
  if (!candidate?.definition?.trim() || !exampleForLearning(candidate)) throw new Error('This explanation needs a clear meaning and a modern example before it can be applied.');
  const expected = original.sourceDefinition || original.definition;
  if (candidate.word !== original.word || candidate.partOfSpeech !== original.partOfSpeech || candidate.sourceDefinition !== expected) throw new Error('The suggested explanation does not match this saved meaning.');
  return Object.fromEntries(['definition', 'sourceDefinition', 'sourceDefinitions', 'sourceFingerprint', 'usageNote', 'example', 'exampleSourceUrl', 'exampleAttribution', 'exampleLicense', 'explanationSource', 'explanationModel', 'explanationVersion', 'meaningSupport'].map(key => [key, candidate[key] ?? (key === 'sourceDefinitions' ? [] : key === 'meaningSupport' ? null : '')]));
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

function proposalBody(candidate) {
  const support = meaningSupportFor(candidate);
  return `${renderMeaningExplanation(candidate, { showSource: false, showSupport: false, showUsage: false })}
    ${support ? `<p class="meaning-situation"><strong>Picture this</strong>${escapeHtml(support.situation)}</p>` : ''}
    <blockquote>“${escapeHtml(exampleForLearning(candidate))}”</blockquote>
    ${support ? `<p class="meaning-example-explained"><strong>Why it fits</strong>${escapeHtml(support.exampleExplanation)}</p>` : ''}${candidate.usageNote || support?.contrast ? `<details class="meaning-support"><summary>Usage and related words</summary>${candidate.usageNote ? `<p>${escapeHtml(candidate.usageNote)}</p>` : ''}${support?.contrast ? `<p>${escapeHtml(support.contrast)}</p>` : ''}</details>` : ''}`;
}
export function renderInlineExplanation(draft, question = '') {
  if (!draft?.candidate) return '';
  const id = escapeHtml(draft.original.id);
  return `<section class="meaning-help" data-explanation-preview="${id}" aria-label="Meaning in practice">
    <div class="meaning-help-heading"><strong>Meaning in practice</strong><button type="button" data-dismiss-explanation="${id}" aria-label="Close meaning guide">×</button></div>
    ${proposalBody(draft.candidate)}
    ${!draft.alreadySaved ? `<div class="inline-actions"><button class="btn-green-solid" data-use-explanation="${id}">Use this explanation</button></div>` : ''}
    <label class="meaning-followup">Still unclear?<input data-explanation-question="${id}" value="${escapeHtml(question)}" maxlength="500" placeholder="Ask about this meaning"></label><button class="status-pill offline" data-refine-explanation="${id}">Explain my question</button>
  </section>`;
}
export function renderExplanationReview(drafts) {
  const proposals = drafts.filter(draft => draft.candidate);
  if (!proposals.length) return '';
  return `<section class="spec-card explanation-review" aria-labelledby="explanation-review-heading"><div class="card-header-bar"><div><h2 id="explanation-review-heading">Suggested meanings</h2><p>Check each example, then save the explanations that help.</p></div></div><div class="explanation-review-grid">${proposals.map(draft => {
    const index = drafts.indexOf(draft);
    return `<article><h3>${escapeHtml(draft.original.word)}</h3><label class="explanation-approve"><input type="checkbox" data-approve-explanation="${index}" ${draft.selected ? 'checked' : ''}> Use this explanation</label>${proposalBody(draft.candidate)}<details><summary>Current wording</summary><p>${escapeHtml(draft.original.definition)}</p></details></article>`;
  }).join('')}</div><div class="inline-actions"><button class="btn-green-solid" id="apply-explanation-review">Save selected meanings</button><button class="status-pill offline" id="cancel-explanation-review">Dismiss</button></div><p id="explanation-review-status" role="status" aria-live="polite"></p></section>`;
}
