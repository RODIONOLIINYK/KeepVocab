import { driveSync, getCurrentMonthNotebookTitle } from '../services/driveSync.js?v=41';
import { speakWord } from '../services/speechService.js';
import { buildVisualSearchQueries, findRelevantImages, getImageProviderSettings, saveImageProviderSettings } from '../services/imageSearch.js?v=41';
import { sanitizeExistingExamples } from '../services/exampleSearch.js?v=41';
import { escapeHtml, safeDownloadName } from '../utils/html.js';

function isDue(word) {
  return !word.mastered && new Date(word.nextReviewDate || word.createdAt) <= new Date();
}

export function reusedImageUrls(words) {
  const counts = new Map();
  for (const word of words || []) {
    const url = String(word?.imageUrl || '').trim();
    if (url) counts.set(url, (counts.get(url) || 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([url]) => url));
}

export function renderLibraryView(container) {
  let selectedMonthYear = (driveSync.getActiveNotebook() || getCurrentMonthNotebookTitle()).replace(/ Vocabulary$/, '');
  let query = '';
  let filter = 'all';
  let sort = 'recent';
  let editId = null;
  let deleteId = null;
  let imageCandidates = [];
  let imageLoading = false;
  let imageError = '';
  let selectedImage = null;
  let imageQuery = '';
  let duplicateImages = new Set();
  let activeImageConcept = '';
  let customImageConcept = '';
  let imageRequestId = 0;
  let imageProviderSettings = getImageProviderSettings();

  async function loadImageCandidates(wordId, refresh = false) {
    const word = driveSync.getWords().find(item => item.id === wordId);
    if (!word) return;
    const requestId = ++imageRequestId;
    imageLoading = true;
    imageError = '';
    render();
    const excludeUrls = driveSync.getWords().flatMap(item => [item.imageUrl, item.imageSourceUrl]).filter(Boolean);
    const customActive = Boolean(customImageConcept && activeImageConcept === customImageConcept);
    const results = await findRelevantImages(word, {
      refresh,
      excludeUrls,
      extraQueries: activeImageConcept ? [activeImageConcept] : [],
      onlyExtraQueries: customActive
    });
    if (editId !== wordId || requestId !== imageRequestId) return;
    imageCandidates = Array.isArray(results) ? results : [];
    imageQuery = imageCandidates[0]?.searchQuery || '';
    imageLoading = false;
    imageError = imageCandidates.length ? '' : customActive
      ? 'No images matched this custom interpretation. Try a shorter, more concrete scene description.'
      : 'No suitable public images were found. Try refreshing the suggestions.';
    render();
  }

  function beginEditing(wordId) {
    imageRequestId += 1;
    editId = wordId;
    deleteId = null;
    imageCandidates = [];
    imageLoading = false;
    imageError = '';
    selectedImage = null;
    imageQuery = '';
    activeImageConcept = '';
    customImageConcept = String(driveSync.getWords().find(item => item.id === wordId)?.imageCustomConcept || '');
    render();
    loadImageCandidates(wordId);
  }

  function selectedWords() {
    let items = driveSync.getWordsByMonthYear(selectedMonthYear).filter(word => {
      const haystack = `${word.word} ${word.definition} ${word.partOfSpeech}`.toLowerCase();
      if (query && !haystack.includes(query.toLowerCase())) return false;
      if (filter === 'due') return isDue(word);
      if (filter === 'mastered') return word.mastered;
      if (filter === 'learning') return !word.mastered;
      return true;
    });
    items = [...items].sort((a, b) => {
      if (sort === 'alpha') return a.word.localeCompare(b.word);
      if (sort === 'due') return new Date(a.nextReviewDate || 0) - new Date(b.nextReviewDate || 0);
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
    return items;
  }

  function wordCard(word) {
    const hasDuplicateImage = duplicateImages.has(word.imageUrl);
    return `
      <article class="library-word-card" data-word-id="${escapeHtml(word.id)}">
        ${word.imageUrl && !hasDuplicateImage ? `<img class="library-word-image" src="${escapeHtml(word.imageUrl)}" alt="Visual cue for ${escapeHtml(word.word)}">` : hasDuplicateImage ? `<div class="duplicate-image-warning"><i class="fa-solid fa-images"></i><span><strong>Reused visual cue</strong>Choose a distinct image for this meaning.</span></div>` : ''}
        <div class="library-card-heading">
          <div><h3>${escapeHtml(word.word)}</h3><span>${escapeHtml(word.phonetic || word.partOfSpeech || '')}</span></div>
          <button class="audio-btn-circle" data-speak="${escapeHtml(word.word)}" aria-label="Hear ${escapeHtml(word.word)}"><i class="fa-solid fa-volume-high"></i></button>
        </div>
        <p class="library-pos">${escapeHtml(word.partOfSpeech || 'word')}</p>
        <p>${escapeHtml(word.definition)}</p>
        ${word.example ? `<blockquote>“${escapeHtml(word.example)}”</blockquote>` : ''}
        <div class="library-card-footer"><span>Box ${Number(word.box || 1)}</span><span>${word.mastered ? 'Mastered' : (isDue(word) ? 'Due now' : 'Learning')}</span></div>
        ${deleteId === word.id ? `<div class="delete-confirm"><span>Delete “${escapeHtml(word.word)}”?</span><button data-cancel-delete>Cancel</button><button data-confirm-delete="${escapeHtml(word.id)}">Delete</button></div>` : `<div class="library-card-actions"><button data-edit-word="${escapeHtml(word.id)}"><i class="fa-solid fa-pen"></i> Edit</button><button data-change-image="${escapeHtml(word.id)}"><i class="fa-solid fa-images"></i> ${hasDuplicateImage ? 'Replace duplicate' : word.imageUrl ? 'Change image' : 'Choose image'}</button><button data-delete-word="${escapeHtml(word.id)}"><i class="fa-solid fa-trash"></i> Delete</button></div>`}
      </article>`;
  }

  function render() {
    duplicateImages = reusedImageUrls(driveSync.getWords());
    const archives = driveSync.getMonthlyArchives();
    const words = selectedWords();
    const editing = editId ? driveSync.getWords().find(word => word.id === editId) : null;
    const generatedImageConcepts = editing ? buildVisualSearchQueries({ ...editing, imageCustomConcept: '' }) : [];
    const imageConcepts = [...new Set([customImageConcept, ...generatedImageConcepts].filter(Boolean))];
    if (editing && !activeImageConcept) activeImageConcept = imageConcepts[0] || '';
    const pexelsActive = Boolean(imageProviderSettings.provider === 'pexels' && imageProviderSettings.pexelsApiKey);
    const pexelsFallback = pexelsActive && imageCandidates.length && !imageCandidates.some(image => image.source === 'Pexels');
    container.innerHTML = `
      <section class="full-view-stack" aria-labelledby="library-heading">
        <div class="spec-card">
          <div class="card-header-bar"><div class="card-tag" id="library-heading"><i class="fa-solid fa-calendar-days"></i> Monthly vocabulary</div><span class="muted-label">Choose the notebook you want to manage</span></div>
          <div class="archive-tabs">
            ${archives.map(archive => `<button class="status-pill ${archive.monthYear === selectedMonthYear ? 'connected' : 'offline'}" data-month="${escapeHtml(archive.monthYear)}"><strong>${escapeHtml(archive.monthYear)}</strong><span>${archive.count} words · ${archive.mastered} mastered</span></button>`).join('')}
          </div>
        </div>

        ${editing ? `<form class="spec-card library-editor" id="library-edit-form">
          <div class="card-header-bar"><div class="card-tag"><i class="fa-solid fa-pen"></i> Edit vocabulary</div><button type="button" class="status-pill offline" id="cancel-library-edit">Cancel</button></div>
          <div class="editor-grid">
            <label>Word<input name="word" required value="${escapeHtml(editing.word)}"></label>
            <label>Phonetic<input name="phonetic" value="${escapeHtml(editing.phonetic || '')}"></label>
            <label>Part of speech<input name="partOfSpeech" value="${escapeHtml(editing.partOfSpeech || '')}"></label>
            <label class="wide">Definition<textarea name="definition" required>${escapeHtml(editing.definition)}</textarea></label>
            <label class="wide">Example<textarea name="example">${escapeHtml(editing.example || '')}</textarea></label>
          </div>
          <section class="library-image-chooser" aria-labelledby="library-image-heading">
            <div class="image-chooser-heading">
              <div><strong id="library-image-heading">Choose a visual cue</strong><span>Select one of the images proposed by KeepVocab.</span></div>
              <button type="button" class="status-pill offline" id="refresh-library-images"><i class="fa-solid fa-rotate"></i> Refresh suggestions</button>
            </div>
            <div class="image-provider-panel">
              <div><strong>Photo source</strong><span>${pexelsFallback ? 'Pexels could not return a match. Openverse fallback is shown.' : pexelsActive ? 'Enhanced Pexels search is active for this device.' : imageProviderSettings.provider === 'pexels' ? 'Add a Pexels key to activate enhanced search. Openverse is the fallback.' : 'Openverse is active. Pexels generally returns stronger stock-photo matches.'}</span></div>
              <div class="image-provider-controls" id="image-provider-controls">
                <select id="image-provider-select" aria-label="Image provider"><option value="openverse" ${imageProviderSettings.provider === 'openverse' ? 'selected' : ''}>Openverse · no key</option><option value="pexels" ${imageProviderSettings.provider === 'pexels' ? 'selected' : ''}>Pexels · recommended</option></select>
                <input id="pexels-api-key" type="password" autocomplete="off" value="${escapeHtml(imageProviderSettings.pexelsApiKey)}" placeholder="Personal Pexels API key" aria-label="Pexels API key">
                <button class="status-pill connected" type="button" id="save-image-provider">Use source</button>
                <a href="https://www.pexels.com/api/new/" target="_blank" rel="noopener noreferrer">Get a free key</a>
              </div>
              <small>The key stays only in this browser and is never copied to Google Drive.</small>
            </div>
            <div class="image-concept-picker">
              <span>This exact meaning is interpreted as:</span>
              <div class="custom-image-concept-controls">
                <input id="custom-image-concept-input" maxlength="160" value="${escapeHtml(customImageConcept)}" placeholder="Describe the scene you want, e.g. a conductor slowing an orchestra" aria-label="Custom visual interpretation">
                <button type="button" class="status-pill connected" id="use-custom-image-concept">Use custom concept</button>
                ${customImageConcept ? '<button type="button" class="status-pill offline" id="clear-custom-image-concept">Remove custom</button>' : ''}
              </div>
              ${imageConcepts.length ? `<div>${imageConcepts.map(concept => `<button type="button" class="${activeImageConcept === concept ? 'active' : ''}" data-image-concept="${escapeHtml(concept)}">${escapeHtml(concept)}${customImageConcept === concept ? ' · custom' : ''}</button>`).join('')}</div>` : ''}
              <small>The custom concept is saved only with this word meaning and is tried first for image searches.</small>
            </div>
            ${(selectedImage?.url || editing.imageUrl) ? `<div class="selected-image-preview"><img src="${escapeHtml(selectedImage?.url || editing.imageUrl)}" alt="Selected visual cue for ${escapeHtml(editing.word)}"><div><strong>${selectedImage ? 'New image selected' : 'Current image'}</strong><span>${escapeHtml(selectedImage?.title || editing.imageAttribution || 'Saved visual cue')}</span></div></div>` : ''}
            ${imageLoading ? `<div class="image-suggestion-loading"><i class="fa-solid fa-images"></i><span>Finding visual cues for this exact meaning…</span></div>` : imageCandidates.length ? `<div class="image-candidate-grid library-image-grid">${imageCandidates.map((image, index) => `<button type="button" class="${selectedImage?.url === image.url ? 'selected' : ''}" data-library-image="${index}" aria-pressed="${selectedImage?.url === image.url}"><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.title)}"><span>${escapeHtml(image.title)}</span></button>`).join('')}</div>` : `<p class="image-picker-message">${escapeHtml(imageError || 'Suggestions will appear here.')}</p>`}
            <p class="image-license-note">${imageCandidates.some(image => image.source === 'Pexels') ? '<a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">Photos provided by Pexels</a>. Photographer credit is saved with your word.' : "Images come from Openverse's openly licensed catalog. KeepVocab saves the creator, source, and license with your word."}</p>
          </section>
          <div class="inline-actions"><button class="btn-green-solid" type="submit">Save changes</button></div>
          <p class="form-message" id="library-edit-message" role="status"></p>
        </form>` : ''}

        <div class="spec-card">
          <div class="card-header-bar"><div class="card-tag"><i class="fa-solid fa-book-open"></i> ${escapeHtml(selectedMonthYear)} <span class="library-result-count">${words.length} shown</span></div><button class="btn-green-solid" id="export-library"><i class="fa-solid fa-download"></i> Export</button></div>
          <div class="library-toolbar">
            <label class="search-field"><i class="fa-solid fa-magnifying-glass"></i><input id="library-search" value="${escapeHtml(query)}" placeholder="Search words or definitions"></label>
            <select id="library-filter" aria-label="Filter vocabulary"><option value="all">All progress</option><option value="due">Due now</option><option value="learning">Learning</option><option value="mastered">Mastered</option></select>
            <select id="library-sort" aria-label="Sort vocabulary"><option value="recent">Newest first</option><option value="alpha">A to Z</option><option value="due">Next review</option></select>
          </div>
          <div class="library-grid">${words.length ? words.map(wordCard).join('') : `<div class="useful-empty-state compact"><h2>No matching words</h2><p>Try another search or progress filter.</p></div>`}</div>
        </div>
      </section>`;
    container.querySelector('#library-filter').value = filter;
    container.querySelector('#library-sort').value = sort;

    container.querySelectorAll('[data-month]').forEach(button => button.addEventListener('click', () => {
      selectedMonthYear = button.dataset.month;
      driveSync.setActiveNotebook(`${selectedMonthYear} Vocabulary`);
      const activeMonthLabel = document.getElementById('active-month-label');
      if (activeMonthLabel) activeMonthLabel.textContent = selectedMonthYear;
      editId = null; deleteId = null; selectedImage = null; render();
    }));
    container.querySelector('#library-search').addEventListener('input', event => { query = event.target.value; render(); container.querySelector('#library-search')?.focus(); });
    container.querySelector('#library-filter').addEventListener('change', event => { filter = event.target.value; render(); });
    container.querySelector('#library-sort').addEventListener('change', event => { sort = event.target.value; render(); });
    container.querySelectorAll('[data-speak]').forEach(button => button.addEventListener('click', () => speakWord(button.dataset.speak)));
    container.querySelectorAll('[data-edit-word]').forEach(button => button.addEventListener('click', () => { beginEditing(button.dataset.editWord); container.querySelector('#library-edit-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    container.querySelectorAll('[data-change-image]').forEach(button => button.addEventListener('click', () => { beginEditing(button.dataset.changeImage); container.querySelector('#library-edit-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    container.querySelectorAll('[data-delete-word]').forEach(button => button.addEventListener('click', () => { deleteId = button.dataset.deleteWord; render(); }));
    container.querySelector('[data-cancel-delete]')?.addEventListener('click', () => { deleteId = null; render(); });
    container.querySelector('[data-confirm-delete]')?.addEventListener('click', event => { driveSync.deleteWord(event.currentTarget.dataset.confirmDelete); deleteId = null; render(); });
    container.querySelector('#cancel-library-edit')?.addEventListener('click', () => { editId = null; selectedImage = null; render(); });
    container.querySelector('#refresh-library-images')?.addEventListener('click', () => loadImageCandidates(editId, true));
    container.querySelector('#save-image-provider')?.addEventListener('click', () => {
      imageProviderSettings = saveImageProviderSettings({
        provider: container.querySelector('#image-provider-select')?.value,
        pexelsApiKey: container.querySelector('#pexels-api-key')?.value
      });
      loadImageCandidates(editId, true);
    });
    container.querySelectorAll('[data-image-concept]').forEach(button => button.addEventListener('click', () => {
      activeImageConcept = button.dataset.imageConcept;
      loadImageCandidates(editId);
    }));
    const applyCustomImageConcept = () => {
      customImageConcept = String(container.querySelector('#custom-image-concept-input')?.value || '').trim().slice(0, 160);
      if (!customImageConcept) return;
      activeImageConcept = customImageConcept;
      loadImageCandidates(editId);
    };
    container.querySelector('#use-custom-image-concept')?.addEventListener('click', applyCustomImageConcept);
    container.querySelector('#custom-image-concept-input')?.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      applyCustomImageConcept();
    });
    container.querySelector('#clear-custom-image-concept')?.addEventListener('click', () => {
      const removed = customImageConcept;
      customImageConcept = '';
      if (activeImageConcept === removed) activeImageConcept = generatedImageConcepts[0] || '';
      loadImageCandidates(editId);
    });
    container.querySelectorAll('[data-library-image]').forEach(button => button.addEventListener('click', () => {
      selectedImage = imageCandidates[Number(button.dataset.libraryImage)] || null;
      imageQuery = selectedImage?.searchQuery || imageQuery;
      render();
    }));
    container.querySelector('#library-edit-form')?.addEventListener('submit', event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const [senseChecked] = sanitizeExistingExamples(data.word || editing.word, [{ ...editing, ...data }]);
      Object.assign(data, {
        example: senseChecked.example,
        exampleSourceUrl: senseChecked.exampleSourceUrl || '',
        exampleAttribution: senseChecked.exampleAttribution || '',
        exampleLicense: senseChecked.exampleLicense || '',
        imageCustomConcept: customImageConcept
      });
      if (selectedImage) Object.assign(data, {
        imageUrl: selectedImage.url,
        imageSourceUrl: selectedImage.sourceUrl,
        imageAttribution: selectedImage.attribution,
        imageLicense: selectedImage.license,
        imageSearchQuery: imageQuery
      });
      try { driveSync.updateWord(editId, data); editId = null; selectedImage = null; render(); }
      catch (error) { container.querySelector('#library-edit-message').textContent = error.message; }
    });
    container.querySelector('#export-library').addEventListener('click', () => {
      const text = driveSync.exportDictionaryText(`${selectedMonthYear} Vocabulary`);
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const anchor = Object.assign(document.createElement('a'), { href: url, download: `${safeDownloadName(selectedMonthYear)}_Vocabulary.txt` });
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  render();
}
