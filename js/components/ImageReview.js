import { canAutoSelectImage, imageChoiceLabels } from '../services/imageChoicePolicy.js';
import { recordImagePreference } from '../services/imageLearning.js?v=18900';
import { escapeHtml } from '../utils/html.js?v=18900';
import { findRelevantImages, imageSelectionPatch, imageIdentityKeys } from '../services/imageSearch.js?v=18900';

let reviewId = 0;
const clone = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));

function safeLink(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function safeImage(value) {
  const text = String(value || '').trim();
  return safeLink(text) || (/^data:image\/(?:jpeg|png|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(text) ? text : '');
}

function identities(image) {
  return imageIdentityKeys({ url: safeImage(image?.url), sourceUrl: safeLink(image?.sourceUrl) });
}

function currentImage(word) {
  if (!safeImage(word.imageUrl)) return null;
  return {
    url: word.imageUrl, thumbnailUrl: word.imageUrl,
    sourceUrl: word.imageSourceUrl || '', attribution: word.imageAttribution || '',
    license: word.imageLicense || '', title: word.word || '', searchQuery: word.imageSearchQuery || ''
  };
}

/** A temporary review surface: only onApply receives image changes; inputs and progress are never mutated. */
export function mountImageReview(container, words, {
  onApply = () => {}, onCancel = () => {}, findImages = findRelevantImages, onProgress = () => {}, excludeUrls = [], originalWords = null, onFeedback = recordImagePreference, allowSkipPending = false
} = {}) {
  const headingId = `image-review-heading-${++reviewId}`;
  const rows = (Array.isArray(words) ? words : []).map((word, index) => {
    const original = clone(word);
    const candidates = (Array.isArray(word.imageCandidates) ? word.imageCandidates : []).filter(image => safeImage(image?.url)).slice(0, 40).map(clone);
    const proposal = candidates.find(image => image.url === word.imageUrl) || currentImage(word) || candidates[0] || null;
    if (!candidates.length && proposal) candidates.push(proposal);
    delete original.imageCandidates;
    // Preparation may attach a proposal to a previously imageless word. Skip
    // must restore its real saved image state, rather than accept that proposal.
    if (Array.isArray(originalWords)) Object.assign(original, imageSelectionPatch(currentImage(originalWords[index] || {})));
    const automatic = canAutoSelectImage(candidates);
    return { original, proposal, candidates, automatic, explicit: false, decision: automatic ? 'keep' : 'pending', viewed: new Set(), seen: new Set([...identities(proposal), ...candidates.flatMap(identities)]), page: Array.isArray(word.imageCandidates) && word.imageCandidates.length ? 1 : 0, revision: 0, controller: null, loading: false, error: '' };
  });
  let active = true;
  let applying = false;
  let applyError = '';

  function reserved(index) {
    const urls = new Set(excludeUrls.flatMap(url => imageIdentityKeys({ url })));
    rows.forEach((row, otherIndex) => {
      if (index === otherIndex) return;
      // Originals remain reserved because Skip leaves their existing image unchanged.
      for (const image of [currentImage(row.original), row.decision === 'skip' ? null : row.proposal]) {
        for (const url of identities(image)) urls.add(url);
      }
    });
    return urls;
  }

  const conflict = (index, image) => identities(image).some(url => reserved(index).has(url));
  // Normal choices teach preferences over loaded, visible alternatives only.
  function rememberVisible(index) {
    const row = rows[index];
    const width = globalThis.innerWidth || globalThis.document?.documentElement?.clientWidth;
    const height = globalThis.innerHeight || globalThis.document?.documentElement?.clientHeight;
    if (!width || !height) return;
    for (const img of container.querySelectorAll?.(`[data-image-review-index="${index}"][data-image-review-action="choose"] img`) || []) {
      if (!img.complete || !img.naturalWidth) continue;
      const candidateIndex = Number(img.closest('[data-image-review-candidate]').dataset.imageReviewCandidate);
      const candidate = row.candidates[candidateIndex];
      if (!candidate || conflict(index, candidate)) continue;
      const rect = img.getBoundingClientRect();
      const area = rect.width * rect.height;
      const visible = Math.max(0, Math.min(rect.right, width) - Math.max(rect.left, 0)) * Math.max(0, Math.min(rect.bottom, height) - Math.max(rect.top, 0));
      if (area > 0 && visible / area >= .5) row.viewed.add(candidateIndex);
    }
  }

  const choiceLabels = row => imageChoiceLabels(row.original, row.proposal,
    [...row.viewed].map(i => row.candidates[i]).filter(image => image && !conflict(rows.indexOf(row), image)));

  function counts() {
    return { total: rows.length, kept: rows.filter(row => row.decision === 'keep').length, skipped: rows.filter(row => row.decision === 'skip').length,
      pending: rows.filter(row => row.decision === 'pending').length, loading: rows.filter(row => row.loading).length };
  }

  function render() {
    if (!active) return;
    const progress = counts();
    const single = rows.length === 1;
    const addSingle = allowSkipPending && single;
    const focus = globalThis.document?.activeElement;
    const focusedChoice = focus?.dataset?.imageReviewAction && container.contains?.(focus) ? { ...focus.dataset } : null;
    container.innerHTML = `<section class="image-review ${single ? 'image-review--single' : ''}" aria-labelledby="${headingId}">
      <header class="image-review__heading"><div><h2 id="${headingId}">${single ? 'Choose an image' : 'Choose your images'}</h2></div></header>
      <div class="image-review__grid">${rows.map((row, index) => {
        const chosen = row.decision === 'keep' ? row.proposal : null;
        const existing = currentImage(row.original);
        const firstAvailable = row.candidates.findIndex(candidate => !conflict(index, candidate));
        const status = row.loading ? 'Finding more images…' : row.error || (row.decision === 'skip' ? (existing ? 'Current image kept.' : 'No image. Your word and meaning will still be saved.') : chosen ? (row.automatic && !row.explicit ? 'Suggested photo. You can change it.' : 'Selected. Save to use this image.') : 'Tap an image to select it.');
        return `<article class="image-review__card ${chosen ? 'is-kept' : row.decision === 'skip' ? 'is-without-image' : ''}" aria-busy="${row.loading}">
          <div class="image-review__meaning"><h3>${escapeHtml(row.original.word)}</h3><p>${escapeHtml(row.original.definition)}</p></div>
          ${row.candidates.length ? `<div class="image-review__choices" role="radiogroup" aria-label="Image options for ${escapeHtml(row.original.word)}">${row.candidates.map((candidate, candidateIndex) => {
            const selected = chosen?.url === candidate.url;
            const unavailable = conflict(index, candidate);
            return `<button type="button" role="radio" aria-checked="${selected}" tabindex="${selected || !chosen && candidateIndex === firstAvailable ? 0 : -1}" class="image-review__choice ${selected ? 'is-selected' : ''}" data-image-review-action="choose" data-image-review-index="${index}" data-image-review-candidate="${candidateIndex}" aria-label="Choose image ${candidateIndex + 1} for ${escapeHtml(row.original.word)}" ${applying || unavailable ? 'disabled' : ''}><img src="${escapeHtml(safeImage(candidate.thumbnailUrl) || safeImage(candidate.url))}" alt="${escapeHtml(candidate.title || `Option ${candidateIndex + 1}`)}" loading="${candidateIndex < 6 ? 'eager' : 'lazy'}" decoding="async"><span class="image-review__choice-check" aria-hidden="true"><i class="fa-solid fa-check"></i></span><span class="image-review__choice-label">${selected ? 'Selected' : `Option ${candidateIndex + 1}`}</span></button>`;
          }).join('')}</div>` : '<div class="image-review__empty"><i class="fa-regular fa-image" aria-hidden="true"></i><span>No images yet. You can add one later.</span></div>'}
          <div class="image-review__row-actions"><button type="button" class="image-review__secondary" data-image-review-action="next" data-image-review-index="${index}" ${row.loading || applying ? 'disabled' : ''}><i class="fa-solid fa-rotate" aria-hidden="true"></i> ${row.loading ? 'Searching…' : row.candidates.length ? 'Find more' : 'Find images'}</button>${addSingle ? '' : `<button type="button" class="image-review__secondary" data-image-review-action="skip" data-image-review-index="${index}" aria-pressed="${row.decision === 'skip'}" ${applying ? 'disabled' : ''}>${existing ? 'Keep current image' : 'No image'}</button>`}</div>
          <p class="image-review__status ${row.error ? 'image-review__error' : ''}" role="status" aria-live="polite">${escapeHtml(status)}</p>
          ${chosen ? `<p class="image-review__credit">${safeLink(chosen.sourceUrl) ? `<a href="${escapeHtml(safeLink(chosen.sourceUrl))}" target="_blank" rel="noopener noreferrer">${escapeHtml(chosen.attribution || chosen.source || 'Image source')}</a>` : escapeHtml(chosen.attribution || chosen.source || '')}${chosen.license ? ` · ${escapeHtml(chosen.license)}` : ''}</p>` : ''}
        </article>`;
      }).join('')}</div>
      <footer class="image-review__footer">${single ? '' : `<span class="image-review__count">${progress.kept} of ${progress.total} images selected</span>`}<button type="button" class="image-review__back" data-image-review-action="cancel" ${applying ? 'disabled' : ''}>Back</button>${addSingle && progress.kept ? `<button type="button" class="image-review__secondary" data-image-review-action="skip" data-image-review-index="0" ${applying ? 'disabled' : ''}>Save without image</button>` : ''}<button type="button" class="image-review__save" data-image-review-action="apply" ${!rows.length || (!allowSkipPending && progress.pending) || applying ? 'disabled' : ''}>${applying ? 'Saving…' : allowSkipPending ? single ? progress.kept ? 'Save word' : 'Save without image' : `Save ${rows.length} words` : 'Save images'}</button></footer>
      ${applyError ? `<p class="image-review__status image-review__error" role="alert">${escapeHtml(applyError)}</p>` : ''}
    </section>`;
    if (focusedChoice) {
      const selector = `[data-image-review-action="${focusedChoice.imageReviewAction}"]${focusedChoice.imageReviewIndex != null ? `[data-image-review-index="${Number(focusedChoice.imageReviewIndex)}"]` : ''}${focusedChoice.imageReviewCandidate != null ? `[data-image-review-candidate="${Number(focusedChoice.imageReviewCandidate)}"]` : ''}`;
      container.querySelector?.(selector)?.focus?.({ preventScroll: true });
    }
    try { onProgress(progress); } catch { /* A host progress indicator cannot interrupt review. */ }
  }

  async function nextImage(index) {
    const row = rows[index];
    if (row.loading || applying) return;
    row.controller?.abort();
    const controller = new AbortController();
    row.controller = controller;
    const revision = ++row.revision;
    const kept = row.decision === 'keep';
    row.loading = true;
    row.error = '';
    row.page++;
    const excluded = new Set([...reserved(index), ...row.seen]);
    render();
    try {
      const candidates = await findImages(clone(row.original), { limit: 6, page: row.page, excludeUrls: [...excluded], signal: controller.signal });
      if (!active || revision !== row.revision || controller.signal.aborted) return;
      const candidate = (Array.isArray(candidates) ? candidates : []).find(image => safeImage(image?.url)
        && !identities(image).some(url => excluded.has(url)) && !conflict(index, image));
      if (!candidate) {
        row.error = 'No different image found. Try another search or save without a new image.';
      } else {
        const fresh = candidates.filter(image => safeImage(image?.url) && !identities(image).some(url => excluded.has(url)) && !conflict(index, image)).slice(0, 6).map(clone);
        row.candidates = [...row.candidates, ...fresh].slice(0, 40);
        if (!kept) row.proposal = clone(candidate);
        row.automatic = !kept && canAutoSelectImage(row.candidates);
        if (!kept) row.explicit = false;
        if (row.automatic) row.decision = 'keep';
        for (const url of row.candidates.flatMap(identities)) row.seen.add(url);
      }
    } catch {
      if (active && revision === row.revision && !controller.signal.aborted) row.error = 'Images are unavailable right now. Your word can still be saved.';
    } finally {
      if (active && revision === row.revision && !controller.signal.aborted) { row.loading = false; render(); }
    }
  }

  async function apply() {
    if (applying || !rows.length || rows.some(row => !allowSkipPending && row.decision === 'pending')) return;
    rows.forEach(row => { row.controller?.abort(); row.revision++; row.loading = false; });
    applying = true;
    applyError = '';
    render();
    if (rows.some((row, index) => row.decision === 'keep' && conflict(index, row.proposal))) { applying = false; applyError = 'Choose different images for meanings sharing the same photo.'; render(); return; }
    const result = rows.map(row => {
      const word = clone(row.original);
      return row.decision === 'keep' ? { ...word, ...imageSelectionPatch({ ...row.proposal, url: safeImage(row.proposal.url), sourceUrl: safeLink(row.proposal.sourceUrl) }) } : word;
    });
    try {
      const feedback = rows.filter(row => row.decision === 'keep' && row.explicit).flatMap(row => choiceLabels(row));
      const applied = await onApply(result, { feedback });
      for (const label of feedback) if (!Array.isArray(applied?.appliedIds) || applied.appliedIds.includes(label.word.id)) {
        void Promise.resolve().then(() => onFeedback(label.word, label.action, label.image, { preferredImage: label.preferredImage, decisionId: label.decisionId })).catch(() => {});
      }
    }
    catch { if (active) applyError = 'The images could not be applied. Your review choices are still here. Try again.'; }
    finally { if (active) { applying = false; render(); } }
  }

  function destroy() {
    if (!active) return;
    active = false;
    rows.forEach(row => row.controller?.abort());
    container.removeEventListener('click', handleClick);
    container.removeEventListener('keydown', handleKeydown);
  }

  async function handleClick(event) {
    const button = event.target.closest?.('[data-image-review-action]');
    if (!active || !button || container.contains?.(button) === false || button.disabled || applying) return;
    const action = button.dataset.imageReviewAction;
    const index = Number(button.dataset.imageReviewIndex);
    if (action === 'cancel') { destroy(); onCancel(); return; }
    if (action === 'apply') return apply();
    if (action === 'keep-all') {
      if (rows.some(row => row.loading)) return;
      rows.forEach((row, rowIndex) => {
        if (row.decision === 'pending') {
          row.decision = row.proposal && !conflict(rowIndex, row.proposal) ? 'keep' : 'skip';
          row.explicit = row.decision === 'keep';
        }
      });
      render();
      return;
    }
    const row = rows[index];
    if (!row) return;
    if (action === 'next') return nextImage(index);
    if (action === 'skip') {
      row.controller?.abort(); row.revision++; row.loading = false; row.decision = 'skip'; row.proposal = currentImage(row.original); row.explicit = false; row.error = '';
      if (allowSkipPending && rows.length === 1) return apply();
    }
    if (action === 'choose') selectImage(index, Number(button.dataset.imageReviewCandidate));
    if (action === 'keep' && row.proposal && !row.loading && !conflict(index, row.proposal)) { rememberVisible(index); row.decision = 'keep'; row.explicit = true; row.error = ''; }
    render();
  }

  function selectImage(index, candidateIndex) {
    const row = rows[index];
    const candidate = row?.candidates[candidateIndex];
    if (!candidate || conflict(index, candidate)) return;
    rememberVisible(index);
    row.proposal = clone(candidate); row.decision = 'keep'; row.explicit = true; row.error = '';
  }

  function handleKeydown(event) {
    const button = event.target.closest?.('[data-image-review-action="choose"]');
    if (!active || applying || !button || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const index = Number(button.dataset.imageReviewIndex);
    const row = rows[index];
    if (!row) return;
    const choices = row.candidates.map((image, i) => !conflict(index, image) ? i : -1).filter(i => i >= 0);
    if (!choices.length) return;
    event.preventDefault();
    const current = choices.indexOf(Number(button.dataset.imageReviewCandidate));
    const direction = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
    const target = event.key === 'Home' ? choices[0] : event.key === 'End' ? choices.at(-1) : choices[(current + direction + choices.length) % choices.length];
    selectImage(index, target);
    render();
    container.querySelector?.(`[data-image-review-action="choose"][data-image-review-index="${index}"][data-image-review-candidate="${target}"]`)?.focus?.({preventScroll:true});
  }

  container.addEventListener('click', handleClick);
  container.addEventListener('keydown', handleKeydown);
  render();
  return { destroy };
}
