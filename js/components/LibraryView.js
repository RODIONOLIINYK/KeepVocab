import { driveSync, getCurrentMonthNotebookTitle } from '../services/driveSync.js?v=90';
import { speakWord } from '../services/speechService.js?v=90';
import { buildVisualSceneDescriptions, clearImageSelectionPatch, findRelevantImages, generateVisualScenesWithGemini, getImageProviderSettings, imageSelectionPatch, imageUrlsForWords, updateImageFeedback } from '../services/imageSearch.js?v=90';
import { sanitizeExistingExamples } from '../services/exampleSearch.js?v=90';
import { normalizeWordPracticeStats } from '../services/wordSelection.js?v=90';
import { escapeHtml, safeDownloadName } from '../utils/html.js';

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('The selected image file could not be read.'));
    reader.readAsDataURL(file);
  });
}

export async function imageFileToDataUrl(file, maxDimension = 1280) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file?.type)) throw new Error('Choose a JPEG, PNG, or WebP image.');
  if (Number(file.size || 0) > 10_000_000) throw new Error('Choose an image smaller than 10 MB.');
  const original = await readFileAsDataUrl(file);
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('The selected file is not a readable image.'));
    element.src = original;
  });
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  const encoded = canvas.toDataURL('image/webp', 0.84);
  if (encoded.length > 4_000_000) throw new Error('This image is still too large after optimization. Choose a smaller file.');
  return encoded;
}

function isDue(word) {
  return new Date(word.nextReviewDate || word.createdAt) <= new Date();
}

export function reusedImageUrls(words) {
  const counts = new Map();
  for (const word of words || []) {
    const url = String(word?.imageUrl || '').trim();
    if (url) counts.set(url, (counts.get(url) || 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([url]) => url));
}

export function groupWordCards(words) {
  const groups = new Map();
  for (const meaning of words || []) {
    const key = String(meaning?.word || '').trim().toLowerCase();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { word: meaning.word, meanings: [] });
    groups.get(key).meanings.push(meaning);
  }
  return [...groups.values()];
}

export function nextImageSuggestionState(scenes, activeConcept, page = 1) {
  const concepts = [...new Set((scenes || []).map(value => String(value || '').trim()).filter(Boolean))];
  const currentPage = Math.max(1, Math.floor(Number(page) || 1));
  if (!concepts.length) return { concept: String(activeConcept || '').trim(), page: currentPage + 1, index: -1 };
  const currentIndex = concepts.indexOf(String(activeConcept || '').trim());
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % concepts.length;
  return {
    concept: concepts[nextIndex],
    page: currentIndex >= 0 && nextIndex === 0 ? currentPage + 1 : currentPage,
    index: nextIndex
  };
}

export function activeImageSearchQueries(activeConcept) {
  const concept = String(activeConcept || '').trim();
  return concept ? [concept] : [];
}

export function imageUrlsUsedByOtherWords(words, currentWordId) {
  return imageUrlsForWords(words, { excludeWordId: currentWordId });
}

export function activeImageResultCandidates(currentImage, results, limit = 10) {
  const searched = Array.isArray(results) ? results : [];
  return searched
    .filter(image => image?.url && image.url !== currentImage?.url && (!currentImage?.sourceUrl || image.sourceUrl !== currentImage.sourceUrl))
    .slice(0, limit);
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
  let removeImage = false;
  let imageQuery = '';
  let duplicateImages = new Set();
  let activeImageConcept = '';
  let customImageConcept = '';
  let suggestedImageScenes = [];
  let imageRequestId = 0;
  let imageResultPage = 1;
  const imageProviderSettings = getImageProviderSettings();

  async function loadImageCandidates(wordId, refresh = false) {
    const word = driveSync.getWords().find(item => item.id === wordId);
    if (!word) return;
    const requestId = ++imageRequestId;
    imageLoading = true;
    imageError = '';
    render();
    const excludeUrls = imageUrlsUsedByOtherWords(driveSync.getWords(), wordId);
    const customActive = Boolean(customImageConcept && activeImageConcept === customImageConcept);
    if (!customActive) {
      const aiScenes = await generateVisualScenesWithGemini(word);
      if (editId !== wordId || requestId !== imageRequestId) return;
      const curatedScenes = buildVisualSceneDescriptions(word);
      suggestedImageScenes = [...new Set([...curatedScenes, ...aiScenes])].slice(0, 3);
      if (!activeImageConcept) activeImageConcept = suggestedImageScenes[0] || '';
      if (refresh) {
        const next = nextImageSuggestionState(suggestedImageScenes, activeImageConcept, imageResultPage);
        activeImageConcept = next.concept;
        imageResultPage = next.page;
      }
      render();
    } else if (refresh) {
      imageResultPage += 1;
      render();
    }
    const sceneQueries = activeImageSearchQueries(activeImageConcept);
    const results = await findRelevantImages(word, {
      refresh,
      excludeUrls,
      extraQueries: sceneQueries,
      onlyExtraQueries: Boolean(sceneQueries.length),
      aiScenes: false,
      provider: imageProviderSettings.provider,
      pexelsApiKey: imageProviderSettings.pexelsApiKey,
      page: imageResultPage,
      limit: 10
    });
    if (editId !== wordId || requestId !== imageRequestId) return;
    const currentImage = !removeImage && word.imageUrl ? {
      url: word.imageUrl,
      sourceUrl: word.imageSourceUrl || '',
      title: word.imageAttribution || `Current image for ${word.word}`,
      attribution: word.imageAttribution || 'Current image',
      license: word.imageLicense || '',
      source: 'Current image',
      searchQuery: word.imageSearchQuery || activeImageConcept,
      imageKind: word.imageKind || 'external'
    } : null;
    imageCandidates = activeImageResultCandidates(currentImage, results, 10);
    imageQuery = imageCandidates[0]?.searchQuery || activeImageConcept;
    imageLoading = false;
    imageError = imageCandidates.length ? '' : customActive
      ? 'No images matched this custom interpretation. Try a shorter, more concrete scene description.'
      : 'No suitable images were found for this concept and page. Try More images or choose another concept.';
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
    removeImage = false;
    imageQuery = '';
    activeImageConcept = '';
    customImageConcept = String(driveSync.getWords().find(item => item.id === wordId)?.imageCustomConcept || '');
    suggestedImageScenes = [];
    imageResultPage = 1;
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

  function wordCard(group) {
    const word = group.meanings[0];
    const dueMeanings = group.meanings.filter(isDue).length;
    const masteredMeanings = group.meanings.filter(meaning => meaning.mastered).length;
    const meaningCard = (meaning, meaningIndex) => {
      const hasDuplicateImage = duplicateImages.has(meaning.imageUrl);
      const practiceStats = normalizeWordPracticeStats(meaning);
      return `<section class="library-meaning" data-meaning-id="${escapeHtml(meaning.id)}">
        <div class="library-meaning-heading"><span>Meaning ${meaningIndex + 1}</span><strong>${escapeHtml(meaning.partOfSpeech || 'word')}</strong></div>
        ${meaning.imageUrl && !hasDuplicateImage ? `<img class="library-word-image" src="${escapeHtml(meaning.imageUrl)}" alt="Visual cue for ${escapeHtml(meaning.word)} meaning ${meaningIndex + 1}">` : hasDuplicateImage ? `<div class="duplicate-image-warning"><i class="fa-solid fa-images"></i><span><strong>Reused visual cue</strong>Choose a distinct image for this meaning.</span></div>` : ''}
        <p>${escapeHtml(meaning.definition)}</p>
        ${meaning.example ? `<blockquote>“${escapeHtml(meaning.example)}”</blockquote>` : ''}
        <div class="library-card-footer"><span>Box ${Number(meaning.box || 1)}</span><span>${meaning.mastered ? 'Mastered' : (isDue(meaning) ? 'Due now' : 'Learning')}</span></div>
        <div class="library-recall-stats" aria-label="${practiceStats.recalled} recalled and ${practiceStats.missed} missed answers"><span><i class="fa-solid fa-check"></i> Recalled ${practiceStats.recalled}</span><span><i class="fa-solid fa-xmark"></i> Missed ${practiceStats.missed}</span><span>${practiceStats.attempts} total</span></div>
        ${deleteId === meaning.id ? `<div class="delete-confirm"><span>Delete this meaning of “${escapeHtml(meaning.word)}”?</span><button data-cancel-delete>Cancel</button><button data-confirm-delete="${escapeHtml(meaning.id)}">Delete</button></div>` : `<div class="library-card-actions"><button data-edit-word="${escapeHtml(meaning.id)}"><i class="fa-solid fa-pen"></i> Edit</button><button data-delete-word="${escapeHtml(meaning.id)}"><i class="fa-solid fa-trash"></i> Delete</button></div>`}
      </section>`;
    };
    return `
      <article class="library-word-card grouped" data-word="${escapeHtml(word.word)}">
        <div class="library-card-heading">
          <div><h3>${escapeHtml(word.word)}</h3><span>${group.meanings.length} meaning${group.meanings.length === 1 ? '' : 's'}${word.phonetic ? ` · ${escapeHtml(word.phonetic)}` : ''}</span></div>
          <button class="audio-btn-circle" data-speak="${escapeHtml(word.word)}" data-audio-url="${escapeHtml(word.audioUrl || '')}" aria-label="Hear ${escapeHtml(word.word)}"><i class="fa-solid fa-volume-high"></i></button>
        </div>
        <div class="library-group-status"><span>${dueMeanings} due</span><span>${masteredMeanings} mastered</span></div>
        <div class="library-meaning-list">${group.meanings.map(meaningCard).join('')}</div>
      </article>`;
  }

  function bindWordCardEvents() {
    container.querySelectorAll('[data-speak]').forEach(button => button.addEventListener('click', () => speakWord(button.dataset.speak, 'en-US', 0.9, button.dataset.audioUrl)));
    container.querySelectorAll('[data-edit-word]').forEach(button => button.addEventListener('click', () => { beginEditing(button.dataset.editWord); container.querySelector('#library-edit-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    container.querySelectorAll('[data-delete-word]').forEach(button => button.addEventListener('click', () => { deleteId = button.dataset.deleteWord; render(); }));
    container.querySelector('[data-cancel-delete]')?.addEventListener('click', () => { deleteId = null; render(); });
    container.querySelector('[data-confirm-delete]')?.addEventListener('click', event => { driveSync.deleteWord(event.currentTarget.dataset.confirmDelete); deleteId = null; render(); });
  }

  function renderWordResults() {
    const words = selectedWords();
    const groups = groupWordCards(words);
    const resultCount = container.querySelector('.library-result-count');
    const grid = container.querySelector('.library-grid');
    if (resultCount) resultCount.textContent = `${groups.length} words · ${words.length} meanings`;
    if (!grid) return;
    grid.innerHTML = groups.length
      ? groups.map(wordCard).join('')
      : '<div class="useful-empty-state compact"><h2>No matching words</h2><p>Try another search or progress filter.</p></div>';
    bindWordCardEvents();
  }

  function render() {
    duplicateImages = reusedImageUrls(driveSync.getWords());
    const archives = driveSync.getMonthlyArchives();
    const words = selectedWords();
    const groups = groupWordCards(words);
    const editing = editId ? driveSync.getWords().find(word => word.id === editId) : null;
    const imageConcepts = [...new Set([customImageConcept, ...suggestedImageScenes].filter(Boolean))];
    if (editing && !activeImageConcept) activeImageConcept = imageConcepts[0] || '';
    const currentImageUrl = removeImage ? '' : (selectedImage?.url || editing?.imageUrl || '');
    const pexelsActive = Boolean(imageProviderSettings.provider === 'pexels' && imageProviderSettings.pexelsApiKey);
    container.innerHTML = `
      <section class="full-view-stack library-view" aria-labelledby="library-heading">
        <div class="content-title-row"><div><span class="eyebrow">Your vocabulary</span><h1 id="library-heading">Library</h1><p>Manage exact meanings, visual cues, and review-ready vocabulary.</p></div><button class="btn-green-solid" id="library-add-word"><i class="fa-solid fa-plus"></i> Add word</button></div>
        <div class="spec-card">
          <div class="card-header-bar"><div class="card-tag"><i class="fa-solid fa-calendar-days"></i> Monthly vocabulary</div><span class="muted-label">Choose the notebook you want to manage</span></div>
          <div class="archive-tabs">
            ${archives.map(archive => `<button class="status-pill ${archive.monthYear === selectedMonthYear ? 'connected' : 'offline'}" data-month="${escapeHtml(archive.monthYear)}"><strong>${escapeHtml(archive.monthYear)}</strong><span>${archive.wordCount} words · ${archive.count} meanings</span></button>`).join('')}
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
              <div><strong id="library-image-heading">Visual cue</strong><span>Search automatically, paste an image link, or upload a file.</span></div>
              <button type="button" class="status-pill offline" id="refresh-library-images"><i class="fa-solid fa-images"></i> More images</button>
            </div>
            <div class="keyless-image-note"><i class="fa-solid fa-images"></i><span><strong>${pexelsActive ? 'Pexels search is active' : 'Public image search is active'}</strong>${pexelsActive ? 'Pexels is searched first; Openverse, Wikimedia Commons, Library of Congress, and NASA Images remain parallel fallbacks.' : 'Openverse, Wikimedia Commons, Library of Congress, and NASA Images are searched in parallel. Configure Pexels under Settings for the larger stock-photo library.'}</span></div>
            <div class="custom-image-source">
              <label for="custom-image-url">Custom image link</label>
              <div><input id="custom-image-url" type="url" inputmode="url" placeholder="https://example.com/image.jpg"><button type="button" class="status-pill connected" id="use-custom-image-url">Use link</button></div>
              <label class="custom-image-upload"><i class="fa-solid fa-upload"></i> Choose image file<input id="custom-image-file" type="file" accept="image/jpeg,image/png,image/webp"></label>
              ${currentImageUrl ? '<button type="button" class="status-pill offline" id="remove-library-image"><i class="fa-solid fa-trash"></i> Remove image</button>' : ''}
            </div>
            <div class="image-concept-picker">
              <span>This exact meaning is interpreted as:</span>
              <div class="custom-image-concept-controls">
                <input id="custom-image-concept-input" maxlength="160" value="${escapeHtml(customImageConcept)}" placeholder="Describe the scene you want, e.g. a conductor slowing an orchestra" aria-label="Custom visual interpretation">
                <button type="button" class="status-pill connected" id="use-custom-image-concept">Use custom concept</button>
                ${customImageConcept ? '<button type="button" class="status-pill offline" id="clear-custom-image-concept">Remove custom</button>' : ''}
              </div>
              ${imageConcepts.length ? `<div>${imageConcepts.map(concept => `<button type="button" class="${activeImageConcept === concept ? 'active' : ''}" data-image-concept="${escapeHtml(concept)}">${escapeHtml(concept)}${customImageConcept === concept ? ' · custom' : ''}</button>`).join('')}</div>` : ''}
              <small>AI concepts stay concise at 5–7 concrete words. Only the highlighted concept is searched, and identical concept text always uses the same query. “More images” moves to the next suggested concept; after the last concept it requests the next result page.</small>
              ${activeImageConcept ? `<small class="active-image-search-state">Searching: “${escapeHtml(activeImageConcept)}” · page ${imageResultPage}</small>` : ''}
            </div>
            ${currentImageUrl ? `<div class="selected-image-preview"><img src="${escapeHtml(currentImageUrl)}" alt="Selected visual cue for ${escapeHtml(editing.word)}"><div><strong>${selectedImage ? 'New image selected' : 'Current saved image'}</strong><span>${escapeHtml(selectedImage?.title || editing.imageAttribution || 'Saved visual cue')}</span>${selectedImage ? '' : '<small>Saved separately — it is not one of the active query results below.</small>'}</div></div><div class="image-feedback-actions" aria-label="Image feedback"><button type="button" class="status-pill connected" id="image-good"><i class="fa-solid fa-thumbs-up"></i> Good image</button><button type="button" class="status-pill offline" id="image-wrong"><i class="fa-solid fa-triangle-exclamation"></i> Wrong meaning</button><button type="button" class="status-pill offline" id="image-more-like"><i class="fa-solid fa-images"></i> More like this</button></div>` : ''}
            ${imageLoading ? `<div class="image-suggestion-loading"><i class="fa-solid fa-images"></i><span>Searching for “${escapeHtml(activeImageConcept || editing.word)}” · page ${imageResultPage}…</span></div>` : imageCandidates.length ? `<div class="image-results-heading"><strong>Results for “${escapeHtml(activeImageConcept || imageQuery)}”</strong><span>${imageCandidates.length} images · page ${imageResultPage}</span></div><div class="image-candidate-grid library-image-grid">${imageCandidates.map((image, index) => `<button type="button" class="${selectedImage?.url === image.url ? 'selected' : ''}" data-library-image="${index}" aria-pressed="${selectedImage?.url === image.url}"><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.title)}" loading="lazy" decoding="async"><span>${escapeHtml(image.title)}</span><small>${escapeHtml(image.source || 'Public image')}</small></button>`).join('')}</div>` : `<p class="image-picker-message">${escapeHtml(imageError || 'Suggestions will appear here.')}</p>`}
            <p class="image-license-note">${imageCandidates.some(image => image.source === 'Pexels') ? '<a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">Photos provided by Pexels</a>. ' : ''}KeepVocab saves available creator, source, and rights information for every proposed image.</p>
          </section>
          <div class="inline-actions"><button class="btn-green-solid" type="submit">Save changes</button></div>
          <p class="form-message" id="library-edit-message" role="status"></p>
        </form>` : ''}

        <div class="spec-card">
          <div class="card-header-bar"><div class="card-tag"><i class="fa-solid fa-book-open"></i> ${escapeHtml(selectedMonthYear)} <span class="library-result-count">${groups.length} words · ${words.length} meanings</span></div><button class="btn-green-solid" id="export-library"><i class="fa-solid fa-download"></i> Export</button></div>
          <div class="library-toolbar">
            <label class="search-field"><i class="fa-solid fa-magnifying-glass"></i><input id="library-search" value="${escapeHtml(query)}" placeholder="Search words or definitions"></label>
            <select id="library-filter" aria-label="Filter vocabulary"><option value="all">All progress</option><option value="due">Due now</option><option value="learning">Learning</option><option value="mastered">Mastered</option></select>
            <select id="library-sort" aria-label="Sort vocabulary"><option value="recent">Newest first</option><option value="alpha">A to Z</option><option value="due">Next review</option></select>
          </div>
          <div class="library-grid">${groups.length ? groups.map(wordCard).join('') : `<div class="useful-empty-state compact"><h2>No matching words</h2><p>Try another search or progress filter.</p></div>`}</div>
        </div>
      </section>`;
    container.querySelector('#library-filter').value = filter;
    container.querySelector('#library-sort').value = sort;
    container.querySelector('#library-add-word').addEventListener('click', () => document.getElementById('btn-header-quick-add')?.click());

    container.querySelectorAll('[data-month]').forEach(button => button.addEventListener('click', () => {
      selectedMonthYear = button.dataset.month;
      driveSync.setActiveNotebook(`${selectedMonthYear} Vocabulary`);
      const activeMonthLabel = document.getElementById('active-month-label');
      if (activeMonthLabel) activeMonthLabel.textContent = selectedMonthYear;
      editId = null; deleteId = null; selectedImage = null; render();
    }));
    container.querySelector('#library-search').addEventListener('input', event => { query = event.currentTarget.value; renderWordResults(); });
    container.querySelector('#library-filter').addEventListener('change', event => { filter = event.target.value; render(); });
    container.querySelector('#library-sort').addEventListener('change', event => { sort = event.target.value; render(); });
    bindWordCardEvents();
    container.querySelector('#cancel-library-edit')?.addEventListener('click', () => { editId = null; selectedImage = null; render(); });
    container.querySelector('#refresh-library-images')?.addEventListener('click', () => loadImageCandidates(editId, true));
    const setEditorMessage = message => {
      const output = container.querySelector('#library-edit-message');
      if (output) output.textContent = message;
    };
    container.querySelector('#use-custom-image-url')?.addEventListener('click', () => {
      const value = String(container.querySelector('#custom-image-url')?.value || '').trim();
      try {
        const url = new URL(value);
        if (url.protocol !== 'https:') throw new Error('Image links must start with https://.');
        selectedImage = { url: url.toString(), sourceUrl: url.toString(), title: 'Custom image link', attribution: 'Custom image link', license: '', imageKind: 'external' };
        imageQuery = 'custom image link';
        removeImage = false;
        render();
      } catch (error) {
        setEditorMessage(error.message || 'Enter a valid https:// image link.');
      }
    });
    container.querySelector('#custom-image-file')?.addEventListener('change', async event => {
      const file = event.currentTarget.files?.[0];
      if (!file) return;
      setEditorMessage('Optimizing image for offline storage and Drive backup…');
      try {
        const url = await imageFileToDataUrl(file);
        selectedImage = { url, sourceUrl: '', title: file.name, attribution: `Uploaded file: ${file.name}`, license: '', imageKind: 'upload' };
        imageQuery = 'uploaded image';
        removeImage = false;
        render();
      } catch (error) {
        setEditorMessage(error.message);
      }
    });
    container.querySelector('#remove-library-image')?.addEventListener('click', () => {
      selectedImage = null;
      removeImage = true;
      render();
    });
    container.querySelectorAll('[data-image-concept]').forEach(button => button.addEventListener('click', () => {
      activeImageConcept = button.dataset.imageConcept;
      imageResultPage = 1;
      loadImageCandidates(editId);
    }));
    const applyCustomImageConcept = () => {
      customImageConcept = String(container.querySelector('#custom-image-concept-input')?.value || '').trim().slice(0, 160);
      if (!customImageConcept) return;
      activeImageConcept = customImageConcept;
      imageResultPage = 1;
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
      if (activeImageConcept === removed) activeImageConcept = suggestedImageScenes[0] || '';
      imageResultPage = 1;
      loadImageCandidates(editId);
    });
    container.querySelectorAll('[data-library-image]').forEach(button => button.addEventListener('click', () => {
      selectedImage = imageCandidates[Number(button.dataset.libraryImage)] || null;
      imageQuery = selectedImage?.searchQuery || imageQuery;
      removeImage = false;
      render();
    }));
    const feedbackImage = () => selectedImage || (!removeImage && editing?.imageUrl ? {
      url: editing.imageUrl,
      sourceUrl: editing.imageSourceUrl,
      searchQuery: editing.imageSearchQuery,
      title: editing.imageAttribution
    } : null);
    container.querySelector('#image-good')?.addEventListener('click', () => {
      const image = feedbackImage();
      if (!image) return;
      driveSync.updateWord(editId, { imageFeedback: updateImageFeedback(editing, 'good', image, activeImageConcept) });
      const message = container.querySelector('#library-edit-message');
      if (message) message.textContent = 'Saved. KeepVocab will favor images like this for this meaning.';
    });
    container.querySelector('#image-wrong')?.addEventListener('click', () => {
      const image = feedbackImage();
      if (!image) return;
      const patch = { imageFeedback: updateImageFeedback(editing, 'wrong', image, activeImageConcept) };
      if (!selectedImage) Object.assign(patch, clearImageSelectionPatch(), { imageKind: '' });
      driveSync.updateWord(editId, patch);
      selectedImage = null;
      loadImageCandidates(editId, true);
    });
    container.querySelector('#image-more-like')?.addEventListener('click', () => {
      const image = feedbackImage();
      if (!image) return;
      activeImageConcept = image.searchQuery || activeImageConcept;
      driveSync.updateWord(editId, { imageFeedback: updateImageFeedback(editing, 'more-like-this', image, activeImageConcept) });
      loadImageCandidates(editId, true);
    });
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
      if (selectedImage) Object.assign(data, imageSelectionPatch({ ...selectedImage, searchQuery: imageQuery }), {
        imageKind: selectedImage.imageKind || 'external',
        imageGeneratedModel: selectedImage.generatedModel || '',
        imageGeneratedAt: selectedImage.generatedAt || '',
        imageGeneratedPrompt: selectedImage.generatedPrompt || ''
      });
      if (removeImage) Object.assign(data, clearImageSelectionPatch(), { imageKind: '', imageGeneratedModel: '', imageGeneratedAt: '', imageGeneratedPrompt: '' });
      try { driveSync.updateWord(editId, data); editId = null; selectedImage = null; removeImage = false; render(); }
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
