import { driveSync } from '../services/driveSync.js?v=1602';
import { fetchWordEntry, wordEntryToWord, prepareWordsForLibrary } from '../services/wordEntry.js?v=1602';
import { BULK_LOOKUP_DELAY_MS, MAX_BULK_WORDS, parseBulkWordList, lookupBulkWords, retryMissingBulkWords, bulkResultToWord, dedupeBulkResults } from '../services/bulkWords.js?v=1602';

const ADD_WORD_MARKUP = `<!-- Quick Add New Word Modal -->
  <div class="modal-backdrop" id="add-word-modal">
    <div class="modal-box sense-modal-box" role="dialog" aria-modal="true" aria-labelledby="add-word-title">
      <div class="sense-modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h2 id="add-word-title" style="font-family: 'Outfit', sans-serif; font-size: 1.4rem; font-weight: 800;">
          <i class="fa-solid fa-circle-plus" style="color: var(--primary-green);"></i> Add Word to Library
        </h2>
        <button class="status-pill offline" id="btn-close-add-modal" aria-label="Close add word" style="font-size: 0.8rem; padding: 4px 8px;">✕</button>
      </div>

      <div class="add-mode-tabs" role="tablist" aria-label="Add vocabulary mode">
        <button type="button" class="active" id="single-add-tab" role="tab" aria-selected="true" aria-controls="single-add-panel"><i class="fa-solid fa-font"></i> One word</button>
        <button type="button" id="bulk-add-tab" role="tab" aria-selected="false" aria-controls="bulk-add-panel"><i class="fa-solid fa-list"></i> Word list</button>
      </div>

      <div id="single-add-panel" role="tabpanel" aria-labelledby="single-add-tab">
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <form class="quick-add-row" id="add-word-lookup-form" style="display: flex; gap: 10px;">
          <input type="text" id="add-word-input" placeholder="Type a word, then press Enter" enterkeyhint="search" autocomplete="off" autocapitalize="none" autofocus style="flex: 1; padding: 12px; border-radius: 10px; border: 1px solid var(--border-card); font-size: 0.95rem; outline: none;">
          <button type="submit" class="btn-green-solid" id="btn-auto-fetch-word" style="padding: 10px 16px;"><i class="fa-solid fa-wand-magic-sparkles"></i> Find meanings</button>
        </form>

        <div id="add-word-preview" class="sense-picker-preview" style="display: none;">
          <div class="sense-picker-heading">
            <div><strong id="prev-w-title">Serendipity</strong><span id="prev-w-phonetic">/ˌser.ənˈdɪp.ə.ti/</span></div>
            <span id="sense-count-label">Choose a meaning</span>
          </div>
          <p class="sense-helper">Select every meaning you want. KeepVocab groups them under one word card and tracks each meaning separately.</p>
          <div id="add-word-sense-list" class="sense-option-list" role="group" aria-label="Dictionary meanings"></div>
        </div>

        <div id="add-word-editor" class="sense-editor">
          <div class="sense-editor-heading"><strong id="meaning-editor-title">Meaning to save</strong><span id="meaning-editor-subtitle">You can edit the focused meaning</span></div>
          <div class="sense-editor-grid">
            <label>Part of speech<input id="add-word-pos" type="text" placeholder="noun, verb, adjective…" autocomplete="off"></label>
            <label>Phonetic<input id="add-word-phonetic" type="text" placeholder="Optional pronunciation" autocomplete="off"></label>
            <label class="wide">Definition<textarea id="add-word-definition" placeholder="Describe the exact intended meaning" required></textarea></label>
            <label class="wide">Example sentence<textarea id="add-word-example" placeholder="A sentence that makes this meaning clear"></textarea></label>
          </div>
          <p id="add-word-form-status" class="form-message" role="status" aria-live="polite"></p>
        </div>
      </div>

      <div class="sense-modal-actions" style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
        <button class="status-pill offline" id="btn-cancel-add-modal">Cancel</button>
        <button class="btn-green-solid" id="btn-save-new-word">Save to Library</button>
      </div>
      </div>

      <div id="bulk-add-panel" class="bulk-add-panel" role="tabpanel" aria-labelledby="bulk-add-tab" hidden>
        <label for="bulk-word-input"><strong>Paste up to 100 words</strong><span>Use one word per line, or separate words with commas or semicolons.</span></label>
        <textarea id="bulk-word-input" rows="6" maxlength="10000" placeholder="resilient&#10;meticulous&#10;take into account"></textarea>
        <div class="bulk-add-toolbar"><span id="bulk-word-count">0 words</span><button type="button" class="btn-green-solid" id="prepare-bulk-words"><i class="fa-solid fa-wand-magic-sparkles"></i> Find meanings</button></div>
        <p class="sense-helper">Words are looked up one at a time. KeepVocab checks close spellings, lets you review every meaning, and automatically chooses a distinct image when you save.</p>
        <div id="bulk-import-progress" class="bulk-import-progress" hidden>
          <div class="bulk-progress-copy"><span><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> <strong id="bulk-progress-phase">Finding meanings</strong></span><span id="bulk-progress-eta">Estimating time…</span></div>
          <div class="bulk-progress-track" id="bulk-progress-track" role="progressbar" aria-label="Bulk import progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="bulk-progress-fill"></span></div>
          <span id="bulk-progress-count">Processed 0 of 0 words</span>
        </div>
        <div id="bulk-word-results" class="bulk-word-results" aria-live="polite"></div>
        <p id="bulk-word-status" class="form-message" role="status" aria-live="polite"></p>
        <button type="button" class="bulk-retry-missing" id="retry-bulk-missing" hidden><i class="fa-solid fa-rotate-right"></i> Retry missing meanings</button>
        <div class="sense-modal-actions bulk-actions"><button type="button" class="status-pill offline" id="btn-cancel-bulk-add">Cancel</button><button type="button" class="btn-green-solid" id="btn-save-bulk-words" disabled><i class="fa-solid fa-bookmark"></i> Save word list</button></div>
      </div>
    </div>
  </div>`;

export function setupAddWordModal({ onSaved = () => {}, onClose = () => {}, showToast } = {}) {
  document.body.insertAdjacentHTML('beforeend', ADD_WORD_MARKUP);
  let currentFetchedData = null;
  let activeCourseId = driveSync.getActiveCourseId();
  let generation = 0;
  const beginOperation = () => {
    const revision = generation;
    const courseId = activeCourseId;
    return {
      courseId,
      isCurrent: () => revision === generation && courseId === driveSync.getActiveCourseId(),
      lookup: term => fetchWordEntry(term, courseId),
    };
  };
  const modal = document.getElementById('add-word-modal');
  const lookupForm = document.getElementById('add-word-lookup-form');
  const btnOpen = document.getElementById('btn-header-quick-add');
  const btnClose = document.getElementById('btn-close-add-modal');
  const btnCancel = document.getElementById('btn-cancel-add-modal');
  const btnFetch = document.getElementById('btn-auto-fetch-word');
  const btnSave = document.getElementById('btn-save-new-word');
  const input = document.getElementById('add-word-input');
  const preview = document.getElementById('add-word-preview');
  const senseList = document.getElementById('add-word-sense-list');
  const posInput = document.getElementById('add-word-pos');
  const phoneticInput = document.getElementById('add-word-phonetic');
  const definitionInput = document.getElementById('add-word-definition');
  const exampleInput = document.getElementById('add-word-example');
  const formStatus = document.getElementById('add-word-form-status');
  const editorTitle = document.getElementById('meaning-editor-title');
  const editorSubtitle = document.getElementById('meaning-editor-subtitle');
  const singleTab = document.getElementById('single-add-tab');
  const bulkTab = document.getElementById('bulk-add-tab');
  const singlePanel = document.getElementById('single-add-panel');
  const bulkPanel = document.getElementById('bulk-add-panel');
  const bulkInput = document.getElementById('bulk-word-input');
  const bulkCount = document.getElementById('bulk-word-count');
  const bulkPrepare = document.getElementById('prepare-bulk-words');
  const bulkResultsList = document.getElementById('bulk-word-results');
  const bulkStatus = document.getElementById('bulk-word-status');
  const bulkSave = document.getElementById('btn-save-bulk-words');
  const bulkRetryMissing = document.getElementById('retry-bulk-missing');
  const bulkProgress = document.getElementById('bulk-import-progress');
  const bulkProgressPhase = document.getElementById('bulk-progress-phase');
  const bulkProgressEta = document.getElementById('bulk-progress-eta');
  const bulkProgressTrack = document.getElementById('bulk-progress-track');
  const bulkProgressFill = document.getElementById('bulk-progress-fill');
  const bulkProgressCount = document.getElementById('bulk-progress-count');
  let senseDrafts = new Map();
  let selectedSenseIds = new Set();
  let focusedSenseId = null;
  let bulkResults = [];

  showToast ||= message => { (bulkPanel.hidden ? formStatus : bulkStatus).textContent = message; };

  const updateBulkProgress = ({ completed, total, phase, startedAt, finished = false }) => {
    const safeTotal = Math.max(1, Number(total) || 1);
    const safeCompleted = Math.max(0, Math.min(safeTotal, Number(completed) || 0));
    const percent = Math.round((safeCompleted / safeTotal) * 100);
    bulkProgress.hidden = false;
    bulkProgressPhase.textContent = phase;
    bulkProgressCount.textContent = `Processed ${safeCompleted} of ${total} word${total === 1 ? '' : 's'} · ${percent}%`;
    bulkProgressFill.style.width = `${percent}%`;
    bulkProgressTrack.setAttribute('aria-valuenow', String(percent));
    if (finished || safeCompleted >= safeTotal) {
      bulkProgressEta.textContent = 'Complete';
      return;
    }
    if (!safeCompleted) {
      bulkProgressEta.textContent = 'Estimating time…';
      return;
    }
    const elapsedMs = Date.now() - startedAt;
    const remainingSeconds = Math.max(1, Math.ceil((elapsedMs / safeCompleted) * (safeTotal - safeCompleted) / 1000));
    bulkProgressEta.textContent = remainingSeconds < 60
      ? `About ${remainingSeconds} sec left`
      : `About ${Math.ceil(remainingSeconds / 60)} min left`;
  };

  const resetAsyncControls = () => {
    btnFetch.disabled = false;
    btnFetch.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Find meanings';
    btnSave.disabled = false;
    btnSave.innerHTML = '<i class="fa-solid fa-bookmark"></i> Save meaning';
    bulkPrepare.disabled = false;
    bulkPrepare.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Find meanings';
    bulkSave.disabled = true;
    bulkSave.innerHTML = '<i class="fa-solid fa-bookmark"></i> Save word list';
    bulkRetryMissing.disabled = false;
    bulkRetryMissing.hidden = true;
    bulkRetryMissing.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Retry missing meanings';
    bulkProgress.hidden = true;
    bulkProgressPhase.textContent = 'Finding meanings';
    bulkProgressEta.textContent = 'Estimating time…';
    bulkProgressCount.textContent = 'Processed 0 of 0 words';
    bulkProgressFill.style.width = '0%';
    bulkProgressTrack.setAttribute('aria-valuenow', '0');
  };

  const openModal = () => {
    if (modal.classList.contains('active')) return;
    resetAsyncControls();
    const lithuanian = driveSync.getActiveCourseId() === 'lithuanian';
    bulkTab.hidden = false;
    input.placeholder = lithuanian ? 'Lithuanian word or phrase' : 'Enter a word';
    input.lang = bulkInput.lang = lithuanian ? 'lt' : 'en';
    btnFetch.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Find meanings';
    editorSubtitle.textContent = 'Type a custom meaning or find dictionary meanings above';
    modal.classList.add('active');
    window.setTimeout(() => input.focus(), 0);
  };

  const setAddMode = (mode, focus = true) => {
    const bulk = mode === 'bulk';
    singleTab.classList.toggle('active', !bulk);
    bulkTab.classList.toggle('active', bulk);
    singleTab.setAttribute('aria-selected', String(!bulk));
    bulkTab.setAttribute('aria-selected', String(bulk));
    singlePanel.hidden = bulk;
    bulkPanel.hidden = !bulk;
    if (focus) window.setTimeout(() => (bulk ? bulkInput : input).focus(), 0);
  };

  const updateBulkSaveState = () => {
    const complete = bulkResults.length > 0 && bulkResults.every((result, index) => {
      if (result.status === 'ready') return true;
      return Boolean(result.manualDefinition?.trim());
    });
    bulkSave.disabled = !complete;
    bulkSave.innerHTML = `<i class="fa-solid fa-bookmark"></i> Save ${bulkResults.length || ''} word${bulkResults.length === 1 ? '' : 's'}`;
    const missingCount = bulkResults.filter(result => result.status !== 'ready').length;
    bulkRetryMissing.hidden = missingCount === 0;
    bulkRetryMissing.innerHTML = `<i class="fa-solid fa-rotate-right"></i> Retry ${missingCount || ''} missing meaning${missingCount === 1 ? '' : 's'}`;
  };

  const renderBulkResults = () => {
    bulkResultsList.innerHTML = '';
    bulkResults.forEach((result, index) => {
      const row = document.createElement('article');
      row.className = `bulk-word-row ${result.status}`;
      const heading = document.createElement('div');
      heading.className = 'bulk-word-heading';
      const title = document.createElement('strong');
      title.textContent = result.data?.word || result.term;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${result.term}`);
      remove.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      remove.addEventListener('click', () => {
        bulkResults.splice(index, 1);
        renderBulkResults();
        bulkStatus.textContent = `${bulkResults.length} word${bulkResults.length === 1 ? '' : 's'} ready to review.`;
      });
      const titleGroup = document.createElement('span');
      titleGroup.appendChild(title);
      if (result.data?.correctedFrom) {
        const correction = document.createElement('small');
        correction.className = 'spelling-correction';
        correction.textContent = `Corrected from ${result.data.correctedFrom}`;
        titleGroup.appendChild(correction);
      }
      heading.append(titleGroup, remove);
      row.appendChild(heading);

      if (result.status === 'ready') {
        const senses = Array.isArray(result.data?.senses) && result.data.senses.length ? result.data.senses : [result.data];
        const label = document.createElement('label');
        label.textContent = 'Meaning to import';
        const select = document.createElement('select');
        select.dataset.bulkSense = String(index);
        senses.forEach((sense, senseIndex) => {
          const option = document.createElement('option');
          option.value = String(senseIndex);
          option.textContent = `${sense.partOfSpeech || 'word'} — ${sense.definition || 'Definition unavailable'}`;
          select.appendChild(option);
        });
        select.value = String(result.selectedSenseIndex || 0);
        select.addEventListener('change', () => { result.selectedSenseIndex = Number(select.value); });
        label.appendChild(select);
        row.appendChild(label);
      } else {
        const note = document.createElement('p');
        note.textContent = result.error || 'No dictionary meaning was found.';
        const label = document.createElement('label');
        label.textContent = 'Add the intended meaning manually';
        const definition = document.createElement('textarea');
        definition.rows = 2;
        definition.dataset.bulkManual = String(index);
        definition.placeholder = `Definition of ${result.term}`;
        definition.value = result.manualDefinition || '';
        definition.addEventListener('input', () => { result.manualDefinition = definition.value; updateBulkSaveState(); });
        label.appendChild(definition);
        row.append(note, label);
      }
      bulkResultsList.appendChild(row);
    });
    updateBulkSaveState();
  };

  const clearSenseState = () => {
    senseDrafts = new Map();
    selectedSenseIds = new Set();
    focusedSenseId = null;
    senseList.innerHTML = '';
    editorTitle.textContent = 'Meaning to save';
    editorSubtitle.textContent = 'Type a custom meaning or find dictionary meanings above';
    btnSave.innerHTML = '<i class="fa-solid fa-bookmark"></i> Save meaning';
  };

  const resetModal = () => {
    generation += 1;
    modal.classList.remove('active');
    preview.style.display = 'none';
    input.value = '';
    clearSenseState();
    posInput.value = '';
    phoneticInput.value = '';
    definitionInput.value = '';
    exampleInput.value = '';
    formStatus.textContent = '';
    bulkInput.value = '';
    bulkCount.textContent = '0 words';
    bulkStatus.textContent = '';
    bulkProgress.hidden = true;
    bulkResults = [];
    bulkResultsList.innerHTML = '';
    resetAsyncControls();
    setAddMode('single', false);
    currentFetchedData = null;
  };

  const closeModal = () => { resetModal(); onClose(); };
  const syncCourse = () => {
    const nextCourseId = driveSync.getActiveCourseId();
    if (nextCourseId === activeCourseId) return;
    activeCourseId = nextCourseId;
    const wasOpen = modal.classList.contains('active');
    resetModal();
    if (wasOpen) openModal();
  };
  window.addEventListener('storage', event => {
    if (event.key === 'keepvocab_settings') syncCourse();
  });
  window.addEventListener('keepvocab:course-changed', syncCourse);
  window.addEventListener('focus', syncCourse);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && modal.classList.contains('active')) {
      event.stopImmediatePropagation();
      closeModal();
    }
  }, true);

  const persistFocusedDraft = () => {
    if (!focusedSenseId || !senseDrafts.has(focusedSenseId)) return;
    senseDrafts.set(focusedSenseId, {
      ...senseDrafts.get(focusedSenseId),
      phonetic: phoneticInput.value.trim(),
      partOfSpeech: posInput.value.trim() || 'unknown',
      definition: definitionInput.value.trim(),
      example: exampleInput.value.trim()
    });
  };

  const loadFocusedDraft = () => {
    const draft = senseDrafts.get(focusedSenseId);
    if (!draft) return;
    posInput.value = draft.partOfSpeech || 'unknown';
    phoneticInput.value = draft.phonetic || currentFetchedData?.phonetic || '';
    definitionInput.value = draft.definition || '';
    exampleInput.value = draft.example || '';
    const position = [...senseDrafts.keys()].indexOf(focusedSenseId) + 1;
    editorTitle.textContent = `Edit meaning ${position}`;
    editorSubtitle.textContent = selectedSenseIds.size > 1 ? `${selectedSenseIds.size} meanings will be grouped in one word card` : 'This meaning will be tracked inside the word card';
  };

  const renderSenseOptions = () => {
    senseList.innerHTML = '';
    const senses = [...senseDrafts.values()];
    document.getElementById('sense-count-label').textContent = `${selectedSenseIds.size} of ${senses.length} selected`;
    btnSave.innerHTML = `<i class="fa-solid fa-bookmark"></i> Save ${selectedSenseIds.size} meaning${selectedSenseIds.size === 1 ? '' : 's'}`;
    senses.forEach((sense, index) => {
      const selected = selectedSenseIds.has(sense.id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `sense-option${selected ? ' selected' : ''}${focusedSenseId === sense.id ? ' focused' : ''}`;
      button.dataset.senseId = sense.id;
      button.setAttribute('aria-pressed', String(selected));
      const check = document.createElement('span');
      check.className = 'sense-option-check';
      check.innerHTML = selected ? '<i class="fa-solid fa-check"></i>' : '';
      const body = document.createElement('span');
      body.className = 'sense-option-body';
      const meta = document.createElement('span');
      meta.className = 'sense-option-meta';
      meta.textContent = `${index + 1}. ${sense.partOfSpeech || 'unknown'}${sense.source ? ` · ${sense.source}` : ''}`;
      const definition = document.createElement('strong');
      definition.textContent = sense.definition;
      body.append(meta, definition);
      if (sense.example) {
        const example = document.createElement('small');
        example.textContent = `“${sense.example}”`;
        body.appendChild(example);
      }
      button.append(check, body);
      button.addEventListener('click', () => {
        persistFocusedDraft();
        if (selectedSenseIds.has(sense.id) && selectedSenseIds.size > 1) selectedSenseIds.delete(sense.id);
        else selectedSenseIds.add(sense.id);
        focusedSenseId = selectedSenseIds.has(sense.id) ? sense.id : [...selectedSenseIds][0] || null;
        renderSenseOptions();
        loadFocusedDraft();
        formStatus.textContent = `${selectedSenseIds.size} meaning${selectedSenseIds.size === 1 ? '' : 's'} selected. Each keeps its own definition, example, and review progress.`;
      });
      senseList.appendChild(button);
    });
  };

  const renderSenses = data => {
    const senses = Array.isArray(data.senses) && data.senses.length ? data.senses : [data];
    senseDrafts = new Map(senses.map((sense, index) => {
      const id = String(sense.id || index);
      return [id, { ...sense, id, phonetic: data.phonetic || '', audioUrl: data.audioUrl || '' }];
    }));
    focusedSenseId = senseDrafts.keys().next().value || null;
    selectedSenseIds = new Set(focusedSenseId ? [focusedSenseId] : []);
    renderSenseOptions();
    loadFocusedDraft();
    formStatus.textContent = 'Select one or several meanings. Missing examples are filled from Tatoeba when available.';
  };

  btnOpen?.addEventListener('click', openModal);
  singleTab.addEventListener('click', () => setAddMode('single'));
  bulkTab.addEventListener('click', () => setAddMode('bulk'));
  btnClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-bulk-add').addEventListener('click', closeModal);
  bulkInput.addEventListener('input', () => {
    generation += 1;
    resetAsyncControls();
    const terms = parseBulkWordList(bulkInput.value, Number.MAX_SAFE_INTEGER);
    bulkCount.textContent = `${terms.length} word${terms.length === 1 ? '' : 's'}`;
    bulkStatus.textContent = terms.length > MAX_BULK_WORDS ? `You can import up to ${MAX_BULK_WORDS} words at once.` : '';
    bulkResults = [];
    bulkResultsList.innerHTML = '';
    bulkSave.disabled = true;
    bulkProgress.hidden = true;
    bulkRetryMissing.hidden = true;
  });
  bulkPrepare.addEventListener('click', async () => {
    const allTerms = parseBulkWordList(bulkInput.value, Number.MAX_SAFE_INTEGER);
    if (!allTerms.length) { bulkInput.focus(); return; }
    if (allTerms.length > MAX_BULK_WORDS) {
      bulkStatus.textContent = `This list has ${allTerms.length} words. Keep the first ${MAX_BULK_WORDS} or split it into smaller batches.`;
      return;
    }
    const { isCurrent, lookup } = beginOperation();
    bulkPrepare.disabled = true;
    bulkPrepare.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Finding meanings…';
    bulkStatus.textContent = `Looking up ${allTerms.length} word${allTerms.length === 1 ? '' : 's'}…`;
    const lookupStartedAt = Date.now();
    updateBulkProgress({ completed: 0, total: allTerms.length, phase: 'Finding meanings', startedAt: lookupStartedAt });
    try {
      const lookedUp = await lookupBulkWords(allTerms, lookup, {
        delayMs: BULK_LOOKUP_DELAY_MS,
        retries: 2,
        retryDelayMs: 750,
        onProgress: ({ completed, total, term }) => {
          if (!isCurrent()) return;
          bulkStatus.textContent = `Looking up ${completed} of ${total}: ${term}`;
          updateBulkProgress({ completed, total, phase: 'Finding meanings', startedAt: lookupStartedAt });
        }
      });
      if (!isCurrent()) return;
      bulkResults = dedupeBulkResults(lookedUp);
      renderBulkResults();
      const manualCount = bulkResults.filter(result => result.status === 'manual').length;
      const mergedCount = lookedUp.length - bulkResults.length;
      updateBulkProgress({ completed: lookedUp.length, total: lookedUp.length, phase: 'Meanings ready', startedAt: lookupStartedAt, finished: true });
      bulkStatus.textContent = manualCount
        ? `${bulkResults.length - manualCount} ready; ${manualCount} need${manualCount === 1 ? 's' : ''} a manual definition.`
        : `${bulkResults.length} words ready${mergedCount ? `; ${mergedCount} corrected duplicate${mergedCount === 1 ? ' was' : 's were'} merged` : ''}. Review each meaning, then save; images are chosen automatically.`;
    } catch (error) {
      if (!isCurrent()) return;
      bulkStatus.textContent = error.message || 'Some meanings could not be loaded. Try again.';
      showToast(bulkStatus.textContent, 'error');
    } finally {
      if (!isCurrent()) return;
      bulkPrepare.disabled = false;
      bulkPrepare.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Find meanings';
    }
  });
  bulkRetryMissing.addEventListener('click', async () => {
    const missingCount = bulkResults.filter(result => result.status !== 'ready').length;
    if (!missingCount) return;
    const { isCurrent, lookup } = beginOperation();
    const retryStartedAt = Date.now();
    bulkRetryMissing.disabled = true;
    bulkPrepare.disabled = true;
    updateBulkProgress({ completed: 0, total: missingCount, phase: 'Retrying missing meanings', startedAt: retryStartedAt });
    bulkStatus.textContent = `Retrying only ${missingCount} missing word${missingCount === 1 ? '' : 's'}…`;
    try {
      const retried = await retryMissingBulkWords(bulkResults, lookup, {
        delayMs: BULK_LOOKUP_DELAY_MS,
        retries: 2,
        retryDelayMs: 1000,
        onProgress: ({ completed, total, term }) => {
          if (!isCurrent()) return;
          bulkStatus.textContent = `Retrying ${completed} of ${total}: ${term}`;
          updateBulkProgress({ completed, total, phase: 'Retrying missing meanings', startedAt: retryStartedAt });
        }
      });
      if (!isCurrent()) return;
      bulkResults = dedupeBulkResults(retried);
      renderBulkResults();
      const remaining = bulkResults.filter(result => result.status !== 'ready').length;
      updateBulkProgress({ completed: missingCount, total: missingCount, phase: 'Retry finished', startedAt: retryStartedAt, finished: true });
      bulkStatus.textContent = remaining
        ? `${missingCount - remaining} recovered; ${remaining} still need${remaining === 1 ? 's' : ''} a meaning. You can retry again or enter it manually.`
        : `All ${bulkResults.length} meanings are ready. Review them, then save.`;
    } finally {
      if (!isCurrent()) return;
      bulkRetryMissing.disabled = false;
      bulkPrepare.disabled = false;
    }
  });
  bulkSave.addEventListener('click', async () => {
    const items = bulkResults.map((result, index) => {
      const senseIndex = result.selectedSenseIndex || 0;
      const manualDefinition = result.manualDefinition || '';
      return bulkResultToWord(result, senseIndex, manualDefinition);
    });
    if (!items.length || items.some(item => !item.definition)) {
      bulkStatus.textContent = 'Every word needs an intended meaning before the list can be saved.';
      return;
    }
    const { isCurrent, courseId } = beginOperation();
    const originalButton = bulkSave.innerHTML;
    bulkSave.disabled = true;
    const imageStartedAt = Date.now();
    updateBulkProgress({ completed: 0, total: items.length, phase: 'Choosing images', startedAt: imageStartedAt });
    try {
      const enrichedItems = await prepareWordsForLibrary(items, {
        courseId, existingWords: driveSync.getWords(),
        onProgress: ({ completed, total, word }) => {
          if (!isCurrent()) return;
          bulkStatus.textContent = `Choosing image ${completed} of ${total}: ${word}`;
          bulkSave.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Choosing images ${completed}/${total}`;
          updateBulkProgress({ completed, total, phase: 'Choosing images', startedAt: imageStartedAt });
        }
      });
      if (!isCurrent()) return;
      const saved = driveSync.addWords(enrichedItems);
      driveSync.setActiveNotebook(saved[0].notebook);
      closeModal();
      showToast(`Saved ${saved.length} words to ${saved[0].notebook}.`);
      onSaved(saved);
    } catch (error) {
      if (!isCurrent()) return;
      bulkStatus.textContent = error.message;
      showToast(error.message, 'error');
      bulkSave.disabled = false;
      bulkSave.innerHTML = originalButton;
    }
  });
  input.addEventListener('input', () => {
    generation += 1;
    resetAsyncControls();
    if (!currentFetchedData) return;
    currentFetchedData = null;
    preview.style.display = 'none';
    clearSenseState();
    posInput.value = '';
    phoneticInput.value = '';
    definitionInput.value = '';
    exampleInput.value = '';
    formStatus.textContent = 'The spelling changed. Fetch meanings again, or enter the intended meaning manually.';
  });

  lookupForm.addEventListener('submit', async event => {
    event.preventDefault();
    const w = input.value.trim();
    if (!w) { input.focus(); return; }

    const { isCurrent, lookup } = beginOperation();
    btnFetch.disabled = true;
    btnFetch.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Finding meanings & examples…';

    try {
      const lithuanian = driveSync.getActiveCourseId() === 'lithuanian';
      const data = await lookup(w);
      if (!isCurrent()) return;
      currentFetchedData = data;
      input.value = currentFetchedData.word;
      document.getElementById('prev-w-title').textContent = currentFetchedData.word;
      document.getElementById('prev-w-phonetic').textContent = currentFetchedData.phonetic;
      renderSenses(currentFetchedData);
      if (lithuanian) formStatus.textContent = currentFetchedData.aiGenerated
        ? 'No dictionary entry was available. Review this AI suggestion before saving.'
        : currentFetchedData.aiEnriched
          ? 'Definition from Wiktionary; example and forms are AI-enriched. Review before saving.'
          : 'Definition from Wiktionary. Review the meaning and add an example if you want.';
      if (currentFetchedData.correctedFrom) {
        formStatus.textContent = `Spelling corrected from “${currentFetchedData.correctedFrom}” to “${currentFetchedData.word}”. Review the meaning before saving.`;
      }
      preview.style.display = 'block';
    } catch (err) {
      if (!isCurrent()) return;
      currentFetchedData = null;
      preview.style.display = 'none';
      formStatus.textContent = 'Lookup failed. You can still enter the exact meaning manually below.';
      showToast(err.message || 'Could not fetch word details.', 'error');
    } finally {
      if (!isCurrent()) return;
      btnFetch.disabled = false;
      btnFetch.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Find meanings';
    }
  });

  btnSave.addEventListener('click', async () => {
    const wordText = input.value.trim();
    if (!wordText) return;

    persistFocusedDraft();
    const selectedDrafts = [...selectedSenseIds].map(id => senseDrafts.get(id)).filter(Boolean);
    const items = currentFetchedData && selectedDrafts.length ? selectedDrafts.map(sense => wordEntryToWord({ ...currentFetchedData, senses: [sense] }, 0, driveSync.getActiveCourseId())) : [{
      word: wordText,
      phonetic: phoneticInput.value.trim(),
      partOfSpeech: posInput.value.trim() || 'unknown',
      definition: definitionInput.value.trim(),
      example: exampleInput.value.trim()
      ,lemma: wordText
      ,translation: definitionInput.value.trim()
      ,acceptedForms: [wordText]
      ,grammaticalTags: []
    }];

    if (items.some(item => !item.definition)) {
      formStatus.textContent = 'Choose a dictionary meaning or write the intended definition before saving.';
      definitionInput.focus();
      return;
    }

    const { isCurrent, courseId } = beginOperation();
    const originalButton = btnSave.innerHTML;
    btnSave.disabled = true;
    try {
      const enrichedItems = await prepareWordsForLibrary(items, {
        courseId, existingWords: driveSync.getWords(),
        onProgress: ({ completed, total }) => {
          if (!isCurrent()) return;
          formStatus.textContent = `Choosing image ${completed} of ${total}…`;
          btnSave.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Choosing images ${completed}/${total}`;
        }
      });
      if (!isCurrent()) return;
      const saved = driveSync.addWords(enrichedItems);
      driveSync.setActiveNotebook(saved[0].notebook);
      closeModal();
      showToast(`Saved ${saved.length} meaning${saved.length === 1 ? '' : 's'} of “${saved[0].word}” to ${saved[0].notebook}.`);
      onSaved(saved);
    } catch (error) {
      if (!isCurrent()) return;
      showToast(error.message, 'error');
      btnSave.disabled = false;
      btnSave.innerHTML = originalButton;
    }
  });
  return { open: openModal, close: closeModal };
}
