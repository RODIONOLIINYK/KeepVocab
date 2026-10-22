import { recordImagePreference } from '../services/imageLearning.js?v=18800';
import { escapeHtml } from '../utils/html.js?v=18800';
import { findRelevantImages, imageSelectionPatch } from '../services/imageSearch.js?v=18800';

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
  return [...new Set([safeImage(image?.url), safeLink(image?.sourceUrl)].filter(Boolean).map(url => url.replace(/#.*$/, '')))];
}

function currentImage(word) {
  if (!safeImage(word.imageUrl)) return null;
  return {
    url: word.imageUrl, thumbnailUrl: word.imageUrl,
    sourceUrl: word.imageSourceUrl || '', attribution: word.imageAttribution || '',
    license: word.imageLicense || '', title: word.word || '', searchQuery: word.imageSearchQuery || ''
  };
}

const styles = `<style>
.image-review{font-family:inherit;color:var(--text-main,#172b24);width:100%;min-width:0}.image-review__heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}.image-review h2{font-family:Outfit,sans-serif;font-size:1.35rem;margin:0}.image-review__intro{font-size:.85rem;color:var(--text-muted,#576760);margin:0 0 16px;line-height:1.5}.image-review__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr));gap:14px;max-height:62vh;overflow:auto;padding:2px}.image-review__card{border:1px solid var(--border-card,#dce5df);border-radius:14px;overflow:hidden;background:var(--bg-card,#fff);min-width:0}.image-review__card.is-kept{border-color:var(--primary-green,#20a466);box-shadow:0 0 0 1px var(--primary-green,#20a466)}.image-review__body{padding:12px}.image-review__word{font-size:1rem;margin:0 0 6px;overflow-wrap:anywhere}.image-review__definition{font-size:.84rem;line-height:1.5;margin:0 0 12px;overflow-wrap:anywhere}.image-review__preview{aspect-ratio:4/3;background:#f1f5f2;display:flex;align-items:center;justify-content:center;color:#68766e;font-size:.85rem;overflow:hidden}.image-review__preview img{width:100%;height:100%;object-fit:cover}.image-review__credit{font-size:.72rem;line-height:1.4;color:var(--text-muted,#576760);min-height:2em;overflow-wrap:anywhere;margin:8px 0}.image-review a{color:#18774b}.image-review__actions{display:flex;gap:6px;flex-wrap:wrap}.image-review button{font:inherit;font-size:.78rem;border:1px solid var(--border-card,#dce5df);background:var(--bg-card,#fff);color:inherit;border-radius:8px;min-height:38px;padding:8px 11px;cursor:pointer}.image-review button:focus-visible{outline:3px solid #73cba1;outline-offset:2px}.image-review button[aria-pressed=true],.image-review button[data-image-review-action=apply]{background:var(--primary-green,#20a466);color:#fff;border-color:var(--primary-green,#20a466)}.image-review button:disabled{opacity:.55;cursor:default}.image-review__status{font-size:.77rem;line-height:1.4;margin:8px 0 0;color:var(--text-muted,#576760);min-height:1.4em}.image-review__error{color:#a0392e}.image-review__footer{display:flex;gap:10px;justify-content:flex-end;align-items:center;padding-top:16px;flex-wrap:wrap}.image-review__count{font-size:.8rem;margin-right:auto;color:var(--text-muted,#576760)}
</style>`;

/** A temporary review surface: only onApply receives image changes; inputs and progress are never mutated. */
export function mountImageReview(container, words, {
  onApply = () => {}, onCancel = () => {}, findImages = findRelevantImages, onProgress = () => {}, excludeUrls = [], originalWords = null, onFeedback = recordImagePreference
} = {}) {
  const headingId = `image-review-heading-${++reviewId}`;
  const rows = (Array.isArray(words) ? words : []).map((word, index) => {
    const original = clone(word);
    const proposal = currentImage(word);
    // Preparation may attach a proposal to a previously imageless word. Skip
    // must restore its real saved image state, rather than accept that proposal.
    if (Array.isArray(originalWords)) Object.assign(original, imageSelectionPatch(currentImage(originalWords[index] || {})));
    return { original, proposal, decision: 'pending', seen: new Set(identities(proposal)), page: 0, revision: 0, controller: null, loading: false, error: '' };
  });
  let active = true;
  let applying = false;
  let applyError = '';

  function reserved(index) {
    const urls = new Set(excludeUrls.map(url => String(url || '').replace(/#.*$/, '')).filter(Boolean));
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
  function counts() {
    return { total: rows.length, kept: rows.filter(row => row.decision === 'keep').length, skipped: rows.filter(row => row.decision === 'skip').length,
      pending: rows.filter(row => row.decision === 'pending').length, loading: rows.filter(row => row.loading).length };
  }

  function render() {
    if (!active) return;
    const progress = counts();
    container.innerHTML = `${styles}<section class="image-review" aria-labelledby="${headingId}">
      <div class="image-review__heading"><h2 id="${headingId}">Review images</h2></div>
      <p class="image-review__intro">Check each image against its exact meaning. Keep the cue, try another image, or Skip to leave it unchanged.</p>
      <div class="image-review__grid">${rows.map((row, index) => {
        const image = row.proposal;
        const duplicate = image && conflict(index, image);
        const preview = safeImage(image?.thumbnailUrl) || safeImage(image?.url);
        const source = safeLink(image?.sourceUrl);
        const credit = escapeHtml(image?.attribution || image?.source || 'Image source');
        const licenseUrl = safeLink(image?.licenseUrl);
        const license = escapeHtml(image?.license || '');
        const status = row.loading ? 'Finding another image…' : row.error || (row.decision === 'skip' ? 'Skipped. The existing image stays unchanged.' : duplicate ? 'This image is already reserved for another meaning. Try another image or Skip.' : row.decision === 'keep' ? 'Image kept for this meaning.' : 'Choose Keep, Next image, or Skip.');
        return `<article class="image-review__card ${row.decision === 'keep' ? 'is-kept' : ''}" aria-busy="${row.loading}">
          <div class="image-review__body"><h3 class="image-review__word">${escapeHtml(row.original.word)}</h3><p class="image-review__definition">${escapeHtml(row.original.definition)}</p></div>
          <div class="image-review__preview">${preview ? `<img src="${escapeHtml(preview)}" alt="Proposed image for ${escapeHtml(row.original.word)}" loading="lazy" decoding="async">` : '<span>No image selected</span>'}</div>
          <div class="image-review__body"><p class="image-review__credit">${image ? `${source ? `<a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">${credit}</a>` : credit}${license ? ` · ${licenseUrl ? `<a href="${escapeHtml(licenseUrl)}" target="_blank" rel="noopener noreferrer">${license}</a>` : license}` : ''}` : 'Try Next image to see a suggestion.'}</p>
            <div class="image-review__actions"><button type="button" data-image-review-action="keep" data-image-review-index="${index}" aria-pressed="${row.decision === 'keep'}" ${!image || duplicate || row.loading || applying ? 'disabled' : ''}>Keep</button><button type="button" data-image-review-action="next" data-image-review-index="${index}" ${row.loading || applying ? 'disabled' : ''}>Next image</button><button type="button" data-image-review-action="skip" data-image-review-index="${index}" aria-pressed="${row.decision === 'skip'}" ${applying ? 'disabled' : ''}>Skip</button></div>
            <p class="image-review__status ${row.error || duplicate ? 'image-review__error' : ''}" role="status">${escapeHtml(status)}</p>
          </div></article>`;
      }).join('')}</div>
      <div class="image-review__footer"><span class="image-review__count" role="status">${progress.kept} kept · ${progress.skipped} skipped · ${progress.pending} to review</span><button type="button" data-image-review-action="keep-all" ${!progress.pending || progress.loading || applying ? 'disabled' : ''}>Keep all proposed images</button><button type="button" data-image-review-action="cancel" ${applying ? 'disabled' : ''}>Cancel</button><button type="button" data-image-review-action="apply" ${!rows.length || progress.pending || progress.loading || applying ? 'disabled' : ''}>${applying ? 'Applying…' : 'Apply images'}</button></div>
      ${applyError ? `<p class="image-review__status image-review__error" role="alert">${escapeHtml(applyError)}</p>` : ''}
    </section>`;
    try { onProgress(progress); } catch { /* A host progress indicator cannot interrupt review. */ }
  }

  async function nextImage(index) {
    const row = rows[index];
    if (row.loading || applying) return;
    row.controller?.abort();
    const controller = new AbortController();
    row.controller = controller;
    const revision = ++row.revision;
    row.decision = 'pending';
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
        row.error = 'No different image found. Try again or Skip.';
      } else {
        row.proposal = clone(candidate);
        for (const url of identities(candidate)) row.seen.add(url);
      }
    } catch {
      if (active && revision === row.revision && !controller.signal.aborted) row.error = 'Images are unavailable right now. Try again or Skip.';
    } finally {
      if (active && revision === row.revision && !controller.signal.aborted) { row.loading = false; render(); }
    }
  }

  async function apply() {
    if (applying || !rows.length || rows.some(row => row.loading || row.decision === 'pending')) return;
    applying = true;
    applyError = '';
    render();
    const result = rows.map(row => {
      const word = clone(row.original);
      return row.decision === 'keep' ? { ...word, ...imageSelectionPatch({ ...row.proposal, url: safeImage(row.proposal.url), sourceUrl: safeLink(row.proposal.sourceUrl) }) } : word;
    });
    try {
      const applied = await onApply(result);
      for (const row of rows) if (row.decision === 'keep' && (!Array.isArray(applied?.appliedIds) || applied.appliedIds.includes(row.original.id))) {
        void Promise.resolve().then(() => onFeedback(row.original, 'good', row.proposal)).catch(() => {});
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
        if (row.decision === 'pending') row.decision = row.proposal && !conflict(rowIndex, row.proposal) ? 'keep' : 'skip';
      });
      render();
      return;
    }
    const row = rows[index];
    if (!row) return;
    if (action === 'next') return nextImage(index);
    if (action === 'skip') { row.controller?.abort(); row.revision++; row.loading = false; row.decision = 'skip'; row.proposal = currentImage(row.original); row.error = ''; }
    if (action === 'keep' && row.proposal && !row.loading && !conflict(index, row.proposal)) { row.decision = 'keep'; row.error = ''; }
    render();
  }

  container.addEventListener('click', handleClick);
  render();
  return { destroy };
}
