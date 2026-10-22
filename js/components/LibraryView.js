import { recordImagePreference, imageLearningEnabled } from '../services/imageLearning.js?v=18900';
import { isUkrainianTranslationEnabled } from '../services/translationSettings.js?v=18900';
import { driveSync, getCurrentMonthNotebookTitle } from '../services/driveSync.js?v=18900';
import { speakWord } from '../services/speechService.js?v=18900';
import { buildVisualSceneDescriptions, clearImageSelectionPatch, findRelevantImages, prepareImageScenes, imageSenseFingerprint, getImageProviderSettings, imageSelectionPatch, imageUrlsForWords, updateImageFeedback } from '../services/imageSearch.js?v=18900';
import { sanitizeExistingExamples } from '../services/exampleSearch.js?v=18900';
import { imageReplacementLabels } from '../services/imageChoicePolicy.js';
import { getPracticeReadiness } from '../services/reminderService.js?v=18900';
import { escapeHtml, safeDownloadName } from '../utils/html.js';
import { definitionForLearning, exampleForLearning, needsLearnerExplanation, withLearnerExplanations, meaningSupportFor, groupSimilarSenses } from '../services/learningDefinitions.js?v=18900';
import { renderMeaningExplanation, renderExplanationReview, renderInlineExplanation, applyReviewedExplanations } from './MeaningExplanation.js?v=18900';
import { mountImageReview } from './ImageReview.js?v=18900';
import { attachImagesSequentially } from '../services/bulkWords.js?v=18900';

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
  return getPracticeReadiness([word]).readyNowCount > 0;
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
  let editDraft = {};
  let explanationReview = [];
  const explanationErrors = new Map();
  const explanationQuestions = new Map();
  let explanationWordIds = new Set();
  let explaining = false;
  let explanationStatus = '';
  let explanationAbort = null;
  let imageReviewWords = null;
  let imageReviewOriginals = new Map();
  let imageReviewController = null;
  let preparingImages = false;
  const viewOwner = {};
  container.libraryViewOwner = viewOwner;
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
    const saved = driveSync.getWords().find(item => item.id === wordId);
    const word = saved ? { ...saved, ...editDraft } : null;
    if (!word) return;
    const requestId = ++imageRequestId;
    imageLoading = true;
    imageError = '';
    render();
    const excludeUrls = imageUrlsUsedByOtherWords(driveSync.getWords(), wordId);
    const customActive = Boolean(customImageConcept && activeImageConcept === customImageConcept);
    if (!customActive) {
      const [preparedWord] = await prepareImageScenes([word], { aiScenes: false });
      const aiScenes = preparedWord.imageScenes?.scenes || [];
      if (container.libraryViewOwner !== viewOwner || !container.querySelector('#library-edit-form') || editId !== wordId || requestId !== imageRequestId) return;
      const curatedScenes = buildVisualSceneDescriptions(word);
      suggestedImageScenes = [...new Set(aiScenes.length ? aiScenes : curatedScenes)].slice(0, 3);
      const latest = driveSync.getWords().find(item => item.id === wordId);
      if (preparedWord.imageScenes && latest && imageSenseFingerprint(latest) === imageSenseFingerprint(word)) driveSync.updateWord(wordId, { imageScenes: preparedWord.imageScenes });
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
      otherDefinitions: driveSync.getWords().filter(item => item.id !== wordId && item.word.toLowerCase() === word.word.toLowerCase()).map(item => item.sourceDefinition || item.definition),
      page: imageResultPage,
      limit: 10
    });
    if (container.libraryViewOwner !== viewOwner || !container.querySelector('#library-edit-form') || editId !== wordId || requestId !== imageRequestId) return;
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
    editDraft = {};
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
      const haystack = `${word.word} ${word.definition} ${definitionForLearning(word)} ${word.translation || ''} ${word.partOfSpeech}`.toLowerCase();
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
    const duplicates = groupSimilarSenses(group.meanings, { word: word.word }).filter(item => item.mergedSenseIds?.length > 1);
    const meaningCard = (meaning, meaningIndex) => {
      const hasDuplicateImage = duplicateImages.has(meaning.imageUrl);
      const readiness = getPracticeReadiness([meaning]);
      return `<section class="library-meaning" data-meaning-id="${escapeHtml(meaning.id)}">
        <div class="library-meaning-heading"><span>Meaning ${meaningIndex + 1}</span><strong>${escapeHtml(meaning.partOfSpeech || 'word')}</strong></div>
        ${meaning.imageUrl && !hasDuplicateImage ? `<img class="library-word-image" src="${escapeHtml(meaning.imageUrl)}" alt="Visual cue for ${escapeHtml(meaning.word)} meaning ${meaningIndex + 1}">` : hasDuplicateImage ? `<div class="duplicate-image-warning"><i class="fa-solid fa-images"></i><span><strong>Reused visual cue</strong>Choose a distinct image for this meaning.</span></div>` : ''}
        ${renderMeaningExplanation(meaning)}${isUkrainianTranslationEnabled() && meaning.translationLanguage === 'uk' && meaning.translation ? `<p class="word-translation" lang="uk">${escapeHtml(meaning.translation)}</p>` : ''}
        ${exampleForLearning(meaning) ? `<blockquote>“${escapeHtml(exampleForLearning(meaning))}”</blockquote>` : ''}
        <div class="library-card-footer"><span>${meaning.mastered ? 'Mastered' : (readiness.readyNowCount ? 'Due now' : 'Learning')}</span></div>
        ${deleteId === meaning.id ? `<div class="delete-confirm"><span>Delete this meaning of “${escapeHtml(meaning.word)}”?</span><button data-cancel-delete>Cancel</button><button data-confirm-delete="${escapeHtml(meaning.id)}">Delete</button></div>` : `<div class="library-card-actions"><button data-edit-word="${escapeHtml(meaning.id)}"><i class="fa-solid fa-pen"></i> Edit</button><details class="library-card-menu"><summary>More</summary><button data-explain-meaning="${escapeHtml(meaning.id)}" ${explaining ? 'disabled' : ''}><i class="fa-solid fa-lightbulb"></i> Understand meaning</button><button data-delete-word="${escapeHtml(meaning.id)}"><i class="fa-solid fa-trash"></i> Delete</button></details></div>`}
        ${explaining && explanationWordIds.has(meaning.id) ? '<p class="meaning-help-status" role="status">Building a concrete explanation and example…</p>' : ''}
        ${explanationErrors.has(meaning.id) ? `<p class="meaning-help-error" role="status">${escapeHtml(explanationErrors.get(meaning.id))}</p>` : ''}
        ${explanationReview.length === 1 && explanationReview[0].original.id === meaning.id ? renderInlineExplanation(explanationReview[0], explanationQuestions.get(meaning.id)) : ''}
      </section>`;
    };
    return `
      <article class="library-word-card grouped" data-word="${escapeHtml(word.word)}">
        <div class="library-card-heading">
          <div><h3>${escapeHtml(word.word)}</h3><span>${group.meanings.length} meaning${group.meanings.length === 1 ? '' : 's'}${word.phonetic ? ` · ${escapeHtml(word.phonetic)}` : ''}</span></div>
          <button class="audio-btn-circle" data-speak="${escapeHtml(word.word)}" data-audio-url="${escapeHtml(word.audioUrl || '')}" aria-label="Hear ${escapeHtml(word.word)}"><i class="fa-solid fa-volume-high"></i></button>
        </div>

        <div class="library-meaning-list">${group.meanings.map(meaningCard).join('')}</div>${duplicates.map(item => `<div class="duplicate-meaning-review"><p>These ${item.mergedSenseIds.length} meanings have nearly identical wording: ${escapeHtml(item.definition)}</p><button class="status-pill offline" data-merge-meanings="${escapeHtml(item.mergedSenseIds.join('|'))}">Merge duplicate meanings and keep review history</button></div>`).join('')}
      </article>`;
  }


  async function requestExplanations(words, refresh = false, question = '', previousExplanation = null) {
    if (explaining) return;
    if (!words.length) { explanationStatus = 'No meanings need automatic repair. Open a word’s meaning guide whenever you want help.'; render(); return; }
    const originals = words.map(word => ({ ...word }));
    if (originals.length === 1 && !refresh && !question && meaningSupportFor(originals[0])) {
      explanationReview = [{ original: originals[0], candidate: originals[0], selected: false, alreadySaved: true }];
      explanationErrors.delete(originals[0].id);render();return;
    }
    const month = selectedMonthYear;
    explanationAbort = new AbortController();
    const controller = explanationAbort;
    explanationWordIds = new Set(originals.map(word => word.id));
    for (const word of originals) explanationErrors.delete(word.id);
    explaining = true;explanationReview = [];imageReviewWords = null;
    explanationStatus = originals.length > 1 ? `Preparing ${originals.length} meanings…` : '';
    render();
    try {
      const result = await withLearnerExplanations({ senses: originals }, { force: true, requireSupport: true, refresh, question, previousExplanation, signal: controller.signal });
      if (controller.signal.aborted || container.libraryViewOwner !== viewOwner || !container.querySelector('#library-heading') || month !== selectedMonthYear) return;
      explanationReview = originals.flatMap(original => {
        const candidate = result.senses.find(item => item.id === original.id);
        if (candidate && meaningSupportFor(candidate) && exampleForLearning(candidate)) return [{ original, candidate, selected: true }];
        const failure = result.explanationFailures?.find(item => item.id === original.id);
        explanationErrors.set(original.id, failure?.message || 'The explanation was incomplete. Try this meaning again.');
        return [];
      });
      const failed = originals.length - explanationReview.length;
      explanationStatus = originals.length > 1 ? `${explanationReview.length} explanations ready.${failed ? ` ${failed} could not be completed; the reason appears with each word.` : ''}` : '';
    } catch (error) {
      if (!controller.signal.aborted) for (const word of originals) explanationErrors.set(word.id, error.message || 'Could not load the explanation. Try again.');
    } finally {
      if (explanationAbort === controller && container.libraryViewOwner === viewOwner && container.querySelector('#library-heading')) {
        explaining = false;render();
        container.querySelector('[data-explanation-preview]')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  async function startImageReview() {
    if (preparingImages || explaining) return;
    const originals = selectedWords().map(word => ({ ...word }));
    if (!originals.length) return;
    const month = selectedMonthYear;
    imageReviewOriginals = new Map(originals.map(word => [word.id, word]));
    preparingImages = true;
    editId = null;
    imageRequestId += 1;
    render();
    try {
      const prepared = await prepareImageScenes(originals, { aiScenes: false });
      for (const word of prepared) {
        const latest = driveSync.getWords().find(item => item.id === word.id);
        if (latest && word.imageScenes && imageSenseFingerprint(latest) === imageSenseFingerprint(word)) driveSync.updateWord(word.id, { imageScenes: word.imageScenes });
      }
      const filled = await attachImagesSequentially(prepared.filter(word => !word.imageUrl), findRelevantImages, { excludeUrls: imageUrlsForWords(driveSync.getWords()) });
      if (container.libraryViewOwner !== viewOwner || !container.querySelector('#library-heading') || month !== selectedMonthYear) return;
      const byId = new Map(filled.map(word => [word.id, word]));
      imageReviewWords = prepared.map(word => byId.get(word.id) || word);
    } catch (error) { explanationStatus = error.message || 'Image suggestions are unavailable.'; }
    finally { if (container.libraryViewOwner === viewOwner && container.querySelector('#library-heading')) { preparingImages = false; render(); } }
  }

  function emptyLibraryResults() {
    return driveSync.getWordsByMonthYear(selectedMonthYear).length
      ? '<div class="useful-empty-state compact"><h2>No matching words</h2><p>Try another search or progress filter.</p></div>'
      : '<div class="useful-empty-state compact"><h2>Start your monthly vocabulary</h2><p>Add a word with its meaning and a modern example.</p><button class="btn-green-solid" data-add-first-word>Add your first word</button></div>';
  }

  function bindWordCardEvents() {
    container.querySelector('[data-add-first-word]')?.addEventListener('click', () => document.getElementById('btn-header-quick-add')?.click());
    container.querySelectorAll('[data-speak]').forEach(button => button.addEventListener('click', () => speakWord(button.dataset.speak, 'en-US', 0.9, button.dataset.audioUrl)));
    container.querySelectorAll('[data-edit-word]').forEach(button => button.addEventListener('click', () => { beginEditing(button.dataset.editWord); container.querySelector('#library-edit-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    container.querySelectorAll('[data-delete-word]').forEach(button => button.addEventListener('click', () => { deleteId = button.dataset.deleteWord; render(); }));
    container.querySelectorAll('[data-explain-meaning]').forEach(button => button.addEventListener('click', () => {
      const word = driveSync.getWords().find(item => item.id === button.dataset.explainMeaning);
      if (word) requestExplanations([word]);
    }));
    container.querySelectorAll('[data-dismiss-explanation]').forEach(button => button.addEventListener('click', () => { explanationReview = []; render(); }));
    container.querySelectorAll('[data-use-explanation]').forEach(button => button.addEventListener('click', () => {
      const draft = explanationReview.find(item => item.original.id === button.dataset.useExplanation);
      if (!draft) return;
      const result = applyReviewedExplanations(driveSync, [{ ...draft, selected: true }]);
      explanationReview = [];
      explanationStatus = result.applied ? 'Meaning and example saved.' : 'This meaning changed while the guide was open. Open it again to use the latest wording.';
      render();
    }));
    container.querySelectorAll('[data-explanation-question]').forEach(input => input.addEventListener('input', () => explanationQuestions.set(input.dataset.explanationQuestion, input.value)));
    container.querySelectorAll('[data-refine-explanation]').forEach(button => button.addEventListener('click', () => {
      const word = driveSync.getWords().find(item => item.id === button.dataset.refineExplanation);
      const question = explanationQuestions.get(word?.id)?.trim();
      if (!question) { explanationErrors.set(word?.id, 'Describe the part that is confusing, then ask your question.'); render(); return; }
      const previous = explanationReview.find(item => item.original.id === word?.id)?.candidate;
      if (word) requestExplanations([word], false, question, previous ? { definition: previous.definition, example: previous.example, why: meaningSupportFor(previous)?.exampleExplanation || '' } : null);
    }));
    container.querySelectorAll('[data-merge-meanings]').forEach(button => button.addEventListener('click', () => {
      try {
        driveSync.mergeWordMeanings(button.dataset.mergeMeanings.split('|'));
        explanationStatus = 'Duplicate meanings merged. Their review counts and recall history were kept.';
        render();
      } catch (error) { explanationStatus = error.message; render(); }
    }));
    container.querySelector('[data-cancel-delete]')?.addEventListener('click', () => { deleteId = null; render(); });
    container.querySelector('[data-confirm-delete]')?.addEventListener('click', event => { driveSync.deleteWord(event.currentTarget.dataset.confirmDelete); deleteId = null; render(); });
  }

  function renderWordResults() {
    const words = selectedWords();
    const groups = groupWordCards(words);
    const resultCount = container.querySelector('.library-result-count');
    const grid = container.querySelector('.library-grid');
    if (resultCount) resultCount.textContent = `${groups.length} word${groups.length === 1 ? '' : 's'} · ${words.length} meaning${words.length === 1 ? '' : 's'}`;
    if (!grid) return;
    grid.innerHTML = groups.length
      ? groups.map(wordCard).join('')
      : emptyLibraryResults();
    bindWordCardEvents();
  }

  function render() {
    const courseLabel = 'English vocabulary';
    duplicateImages = reusedImageUrls(driveSync.getWords());
    const archives = driveSync.getMonthlyArchives();
    const monthWords = driveSync.getWordsByMonthYear(selectedMonthYear);
    const words = selectedWords();
    const groups = groupWordCards(words);
    const savedEditing = editId ? driveSync.getWords().find(word => word.id === editId) : null;
    const editing = savedEditing ? { ...savedEditing, ...editDraft } : null;
    const imageConcepts = [...new Set([customImageConcept, ...suggestedImageScenes].filter(Boolean))];
    if (editing && !activeImageConcept) activeImageConcept = imageConcepts[0] || '';
    const currentImageUrl = removeImage ? '' : (selectedImage?.url || editing?.imageUrl || '');
    imageReviewController?.destroy();
    imageReviewController = null;
    container.innerHTML = `
      <section class="full-view-stack library-view" aria-labelledby="library-heading">
        <div class="content-title-row"><div><span class="eyebrow">${courseLabel}</span><h1 id="library-heading">Library</h1><p>Keep your vocabulary, meanings, and memory cues in one place.</p></div><div class="inline-actions"><details class="library-tools"><summary>Tools</summary><div><button class="status-pill offline" id="library-improve-explanations" ${explaining || preparingImages || !monthWords.length ? 'disabled' : ''}>Improve explanations</button><button class="status-pill offline" id="library-review-images" ${explaining || preparingImages || !monthWords.length ? 'disabled' : ''}>Review images</button></div></details><button class="btn-green-solid" id="library-add-word"><i class="fa-solid fa-plus"></i> Add word</button></div></div>
        ${explanationStatus ? `<p class="form-message" role="status" aria-live="polite">${escapeHtml(explanationStatus)}</p>` : ''}
        ${explaining ? '<button class="status-pill offline" id="cancel-generating-explanations">Cancel explanation request</button>' : ''}
        ${explanationReview.length > 1 ? renderExplanationReview(explanationReview) : ''}
        ${preparingImages ? '<p role="status">Preparing cached scenes and image suggestions…</p>' : ''}
        ${imageReviewWords ? '<div class="spec-card" id="library-image-review"></div>' : ''}
        <div class="spec-card" ${archives.length ? '' : 'hidden'}>
          <div class="card-header-bar"><div class="card-tag"><i class="fa-solid fa-calendar-days"></i> Monthly vocabulary</div><span class="muted-label">Choose the notebook you want to manage</span></div>
          <div class="archive-tabs">
            ${archives.map(archive => `<button class="status-pill ${archive.monthYear === selectedMonthYear ? 'connected' : 'offline'}" data-month="${escapeHtml(archive.monthYear)}"><strong>${escapeHtml(archive.monthYear)}</strong><span>${archive.wordCount} word${archive.wordCount === 1 ? '' : 's'} · ${archive.count} meaning${archive.count === 1 ? '' : 's'}</span></button>`).join('')}
          </div>
        </div>

        ${editing ? `<form class="spec-card library-editor" id="library-edit-form">
          <div class="card-header-bar"><div class="card-tag"><i class="fa-solid fa-pen"></i> Edit vocabulary</div><button type="button" class="status-pill offline" id="cancel-library-edit">Cancel</button></div>
          <div class="editor-grid">
            <label>Word<input name="word" required value="${escapeHtml(editing.word)}"></label>
            <label>Phonetic<input name="phonetic" value="${escapeHtml(editing.phonetic || '')}"></label>
            <label>Part of speech<input name="partOfSpeech" value="${escapeHtml(editing.partOfSpeech || '')}"></label>
            <label class="wide">Meaning in plain English<textarea name="definition" required>${escapeHtml(editing.definition)}</textarea></label>
            <label class="wide">When to use it (optional)<input name="usageNote" value="${escapeHtml(editing.usageNote || '')}" placeholder="A useful situation or grammar pattern"></label>
            ${isUkrainianTranslationEnabled() ? `<label class="wide">Ukrainian translation<input name="translation" lang="uk" value="${escapeHtml(editing.translation || '')}"></label>` : ''}
            <label class="wide">Example (optional)<textarea name="example">${escapeHtml(exampleForLearning(editing))}</textarea></label>
          </div>
          <section class="library-image-chooser" aria-labelledby="library-image-heading">
            <div class="image-chooser-heading">
              <div><strong id="library-image-heading">Visual cue</strong><span>Search automatically, paste an image link, or upload a file.</span></div>
              <button type="button" class="image-text-action" id="refresh-library-images"><i class="fa-solid fa-rotate"></i> More options</button>
            </div>
            <details class="image-search-options"><summary>Search or upload your own image</summary>
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
              <small>Choose a suggested scene or describe your own. “More options” explores the next scene, then more results.</small>
              ${activeImageConcept ? `<small class="active-image-search-state">Searching: “${escapeHtml(activeImageConcept)}” · page ${imageResultPage}</small>` : ''}
            </div>
            </details>
            ${currentImageUrl ? `<div class="selected-image-preview"><img src="${escapeHtml(currentImageUrl)}" alt="Selected visual cue for ${escapeHtml(editing.word)}"><div><strong>${selectedImage ? 'New image selected' : 'Current saved image'}</strong><span>${escapeHtml(selectedImage?.title || editing.imageAttribution || 'Saved visual cue')}</span></div></div><div class="image-feedback-actions" aria-label="Image feedback"><button type="button" class="image-text-action" id="image-good"><i class="fa-solid fa-thumbs-up"></i> Good image</button><button type="button" class="image-text-action" id="image-wrong"><i class="fa-solid fa-triangle-exclamation"></i> Wrong meaning</button><button type="button" class="image-text-action" id="image-more-like"><i class="fa-solid fa-images"></i> More like this</button></div>` : ''}
            <p class="image-learning-note">${imageLearningEnabled() ? 'Good image teaches the local model a positive example; Wrong meaning teaches a negative one. Saving a replacement teaches both choices. More like this only adjusts the search.' : 'Image ratings improve searches. Install or enable Local image learning in Settings to also train your personal model.'} Searches and local scoring use no Gemini tokens.</p>
            ${imageLoading ? `<div class="image-suggestion-loading"><i class="fa-solid fa-images"></i><span>Searching for “${escapeHtml(activeImageConcept || editing.word)}” · page ${imageResultPage}…</span></div>` : imageCandidates.length ? `<div class="image-results-heading"><strong>Results for “${escapeHtml(activeImageConcept || imageQuery)}”</strong><span>${imageCandidates.length} images · page ${imageResultPage}</span></div><div class="image-candidate-grid library-image-grid">${imageCandidates.map((image, index) => `<button type="button" class="${selectedImage?.url === image.url ? 'selected' : ''}" data-library-image="${index}" aria-pressed="${selectedImage?.url === image.url}"><img src="${escapeHtml(image.thumbnailUrl || image.url)}" alt="${escapeHtml(image.title)}" loading="lazy" decoding="async"><span>${escapeHtml(image.title)}</span><small>${escapeHtml(image.source || 'Public image')}</small></button>`).join('')}</div>` : `<p class="image-picker-message">${escapeHtml(imageError || 'Suggestions will appear here.')}</p>`}
            <p class="image-license-note">${imageCandidates.some(image => image.source === 'Pexels') ? '<a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">Photos provided by Pexels</a>. ' : ''}KeepVocab saves available creator, source, and rights information for every proposed image.</p>
          </section>
          <div class="inline-actions"><button class="btn-green-solid" type="submit">Save changes</button></div>
          <p class="form-message" id="library-edit-message" role="status"></p>
        </form>` : ''}

        <div class="spec-card">
          <div class="card-header-bar"><div class="card-tag"><i class="fa-solid fa-book-open"></i> ${escapeHtml(selectedMonthYear)} <span class="library-result-count">${groups.length} word${groups.length === 1 ? '' : 's'} · ${words.length} meaning${words.length === 1 ? '' : 's'}</span></div><button class="btn-green-solid" id="export-library"><i class="fa-solid fa-download"></i> Export</button></div>
          <div class="library-toolbar" ${monthWords.length ? '' : 'hidden'}>
            <label class="search-field"><i class="fa-solid fa-magnifying-glass"></i><input id="library-search" aria-label="Search vocabulary" value="${escapeHtml(query)}" placeholder="Search words, definitions or translations"></label>
            <select id="library-filter" aria-label="Filter vocabulary"><option value="all">All progress</option><option value="due">Due now</option><option value="learning">Learning</option><option value="mastered">Mastered</option></select>
            <select id="library-sort" aria-label="Sort vocabulary"><option value="recent">Newest first</option><option value="alpha">A to Z</option><option value="due">Next review</option></select>
          </div>
          <div class="library-grid">${groups.length ? groups.map(wordCard).join('') : emptyLibraryResults()}</div>
        </div>
      </section>`;

    container.querySelector('#library-improve-explanations').addEventListener('click', () => requestExplanations(selectedWords().filter(word => needsLearnerExplanation(word) || !exampleForLearning(word))));
    container.querySelector('#library-review-images').addEventListener('click', startImageReview);
    container.querySelector('#cancel-generating-explanations')?.addEventListener('click', () => { explanationAbort?.abort(); explaining = false; explanationStatus = 'The current meanings have been kept.'; render(); });
    container.querySelectorAll('[data-approve-explanation]').forEach(input => input.addEventListener('change', () => { explanationReview[Number(input.dataset.approveExplanation)].selected = input.checked; }));
    container.querySelector('#cancel-explanation-review')?.addEventListener('click', () => { explanationReview = []; render(); });
    container.querySelector('#apply-explanation-review')?.addEventListener('click', () => {
      try {
        const { applied, skipped } = applyReviewedExplanations(driveSync, explanationReview);
        explanationReview = [];
        explanationStatus = `${applied} explanation${applied === 1 ? '' : 's'} updated.${skipped ? ` ${skipped} changed during review and were kept.` : ''}`;
        render();
      } catch (error) { container.querySelector('#explanation-review-status').textContent = error.message; }
    });
    if (imageReviewWords) imageReviewController = mountImageReview(container.querySelector('#library-image-review'), imageReviewWords, {
      originalWords: imageReviewWords.map(word => imageReviewOriginals.get(word.id) || word),
      excludeUrls: imageUrlsForWords(driveSync.getWords().filter(word => !imageReviewWords.some(item => item.id === word.id))),
      onCancel() { imageReviewWords = null; render(); },
      onApply(reviewed) {
        let skipped = 0;
        const appliedIds = [];
        for (const word of reviewed) {
          const latest = driveSync.getWords().find(item => item.id === word.id);
          if (!latest || imageSenseFingerprint(latest) !== imageSenseFingerprint(word)) { skipped += 1; continue; }
          const keys = ['imageUrl', 'imageSourceUrl', 'imageAttribution', 'imageLicense', 'imageSearchQuery'];
          const original = imageReviewOriginals.get(word.id);
          if (!original || keys.some(key => (latest[key] || '') !== (original[key] || ''))) { skipped += 1; continue; }
          driveSync.updateWord(word.id, Object.fromEntries(keys.map(key => [key, word[key] || ''])));
          appliedIds.push(word.id);
        }
        imageReviewWords = null;
        explanationStatus = `Image review saved.${skipped ? ` ${skipped} changed meanings were kept.` : ''}`;
        render();
        return { appliedIds };
      }
    });

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
      if (container.libraryViewOwner !== viewOwner || editId !== editing?.id) return;
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
      const wordId = editId;
      const requestId = ++imageRequestId;
      setEditorMessage('Optimizing image for offline storage and Drive backup…');
      try {
        const url = await imageFileToDataUrl(file);
        if (container.libraryViewOwner !== viewOwner || !container.querySelector('#library-edit-form') || editId !== wordId || imageRequestId !== requestId) return;
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
    const teachImage = async (action, image) => {
      try {
        if (!imageLearningEnabled()) {
          const output = container.querySelector('#library-edit-message');
          if (output) output.textContent = 'Search preference saved. Local model is off; enable it in Settings to train it.';
          return;
        }
        const result = await recordImagePreference(editing, action, image);
        if (container.libraryViewOwner !== viewOwner) return;
        const output = container.querySelector('#library-edit-message');
        if (output) output.textContent = result.recorded
          ? `Saved as a ${action === 'good' ? 'positive' : 'negative'} training example. ${result.trained ? 'Your local model has been updated.' : 'It will train once enough Good and Wrong ratings are collected.'}`
          : result.reason || 'Image preference saved.';
      } catch { const output = container.querySelector('#library-edit-message'); if (output) output.textContent = 'The rating was saved for this meaning; local model training could not finish.'; }
    };
    const feedbackMatchesSavedMeaning = () => {
      const latest = driveSync.getWords().find(word => word.id === editId);
      const matches = latest && imageSenseFingerprint({ ...editing, ...editDraft }) === imageSenseFingerprint(latest);
      if (!matches) container.querySelector('#library-edit-message').textContent = 'Save the intended meaning before rating an image.';
      return matches;
    };
    container.querySelector('#image-good')?.addEventListener('click', () => {
      const image = feedbackImage();
      if (!image || !feedbackMatchesSavedMeaning()) return;
      driveSync.updateWord(editId, { imageFeedback: updateImageFeedback(editing, 'good', image, activeImageConcept) });
      const message = container.querySelector('#library-edit-message');
      if (message) message.textContent = 'Rating saved for this meaning.';
      void teachImage('good', image);
    });
    container.querySelector('#image-wrong')?.addEventListener('click', () => {
      const image = feedbackImage();
      if (!image || !feedbackMatchesSavedMeaning()) return;
      const patch = { imageFeedback: updateImageFeedback(editing, 'wrong', image, activeImageConcept) };
      if (!selectedImage) Object.assign(patch, clearImageSelectionPatch(), { imageKind: '' });
      driveSync.updateWord(editId, patch);
      void teachImage('wrong', image);
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
    container.querySelector('#library-edit-form')?.addEventListener('input', event => {
      if (['word', 'phonetic', 'partOfSpeech', 'definition', 'usageNote', 'translation', 'example'].includes(event.target.name)) editDraft[event.target.name] = event.target.value;
      if (['word', 'partOfSpeech', 'definition'].includes(event.target.name)) {
        if (event.target.name === 'definition') Object.assign(editDraft, { sourceDefinition: event.target.value, sourceFingerprint: '', explanationSource: 'manual' });
        Object.assign(editDraft, { imageScenes: undefined, imageFeedback: undefined, imageRejectedUrls: [] });
        activeImageConcept = ''; customImageConcept = ''; suggestedImageScenes = []; imageCandidates = []; selectedImage = null; imageQuery = ''; imageResultPage = 1;
        imageRequestId += 1;
        imageLoading = false;
        const refresh = container.querySelector('#refresh-library-images');
        if (refresh) refresh.disabled = false;
        const grid = container.querySelector('.library-image-grid');
        if (grid) grid.innerHTML = '';
      }
    });
    container.querySelector('#library-edit-form')?.addEventListener('submit', event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      if (isUkrainianTranslationEnabled() && Object.hasOwn(data, 'translation')) data.translationLanguage = 'uk';
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
      try {
        const latest = driveSync.getWords().find(word => word.id === editId) || savedEditing;
        if (data.definition !== latest.definition) Object.assign(data, { sourceDefinition: data.definition, sourceFingerprint: '', explanationSource: 'manual' });
        const replacement = selectedImage;
        const previous = imageSenseFingerprint(latest) === imageSenseFingerprint({ ...latest, ...data }) && latest.imageUrl
          ? { url: latest.imageUrl, sourceUrl: latest.imageSourceUrl, searchQuery: latest.imageSearchQuery } : null;
        const labels = replacement && !removeImage ? imageReplacementLabels({ ...latest, ...data }, previous, replacement) : [];
        let feedbackWord = { ...latest, ...data };
        for (const label of labels) feedbackWord.imageFeedback = updateImageFeedback(feedbackWord, label.action, label.image);
        if (labels.length) data.imageFeedback = feedbackWord.imageFeedback;
        driveSync.updateWord(editId, data);
        for (const label of labels) void recordImagePreference(label.word, label.action, label.image).catch(() => {});
        editId = null; selectedImage = null; removeImage = false; render();
      }
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
