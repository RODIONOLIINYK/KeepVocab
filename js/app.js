// Native application controller with monthly Google Drive backup.

import { driveSync, getCurrentMonthNotebookTitle, usesNativeGoogleAuthorization } from './services/driveSync.js?v=42';
import { fetchWordDetails } from './services/dictionaryApi.js?v=42';
import { speakWord } from './services/speechService.js?v=43';
import { updateWordRepetition, getDueWords } from './services/srsEngine.js?v=42';
import { DRIVE_SYNC_MIN_INTERVAL_MS, backgroundSyncDelay } from './services/syncPolicy.js?v=42';
import { hasExampleSenseConflict, sanitizeExistingExamples } from './services/exampleSearch.js?v=42';
import { MAX_BULK_WORDS, parseBulkWordList, lookupBulkWords, bulkResultToWord } from './services/bulkWords.js?v=43';

import { renderReviewView } from './components/ReviewView.js?v=43';
import { renderLibraryView } from './components/LibraryView.js?v=43';
import { renderStatsView } from './components/StatsView.js?v=42';
import { renderSpellingMode, renderChooseWordMode } from './components/PracticeModes.js?v=43';
import { renderVisualMatchMode } from './components/VisualMatchMode.js?v=42';
import { renderMatchSprintMode } from './components/MatchSprintMode.js?v=42';
import { renderSpeakingMode, teardownSpeakingMode } from './components/SpeakingMode.js?v=43';

function localDateKey(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function buildStudyQueue() {
  const activeNotebook = driveSync.getActiveNotebook();
  return driveSync.getWords().filter(item => item.notebook === activeNotebook).map(item => {
    const example = item.example || `Use “${item.word}” in a sentence.`;
    return {
      ...item,
      phonetic: item.phonetic || '',
      partOfSpeech: item.partOfSpeech || 'unknown',
      example
    };
  });
}

function repairContradictoryExamples() {
  for (const word of driveSync.getWords()) {
    if (!hasExampleSenseConflict(word.word, word, word.example)) continue;
    const [repaired] = sanitizeExistingExamples(word.word, [word]);
    driveSync.updateWord(word.id, {
      example: repaired.example,
      exampleSourceUrl: repaired.exampleSourceUrl,
      exampleAttribution: repaired.exampleAttribution,
      exampleLicense: repaired.exampleLicense
    });
  }
}

repairContradictoryExamples();
let wordsQueue = buildStudyQueue();

let currentIndex = 0;
const initialSettings = driveSync.getSettings();
let goalCount = initialSettings.reviewsDate === localDateKey() ? Number(initialSettings.reviewsToday || 0) : 0;
if (initialSettings.reviewsDate !== localDateKey()) {
  driveSync.updateSettings({ reviewsDate: localDateKey(), reviewsToday: 0 });
}
let currentView = 'dashboard';
let speechSpeed = 1.0;
let dashboardOriginalHTML = '';
let currentFetchedData = null;
let viewEnterTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('view-container');
  if (container) {
    dashboardOriginalHTML = container.innerHTML;
  }
  initApp();
});

function initApp() {
  setupNavigation();
  setupDriveBackupModal();
  setupQuickAddModal();
  setupFlashcardControls();
  setupMonthDropdown();
  setupKeyboardShortcuts();
  setupLearningModeButtons();
  setupAutomaticDriveBackup();
  resumeRememberedDriveConnection();

  window.addEventListener('keepvocab:progress', () => {
    const settings = driveSync.getSettings();
    goalCount = settings.reviewsDate === localDateKey() ? Number(settings.reviewsToday || 0) : 0;
    updateGoalDisplay();
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Offline support registration failed.', error));
  }

  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '') || 'dashboard';
    navigateTo(hash);
  });

  const hash = window.location.hash.replace('#', '') || 'dashboard';
  navigateTo(hash);
  renderConnectionState();
  updateDashboardDerivedState();
}

function showToast(msg, type = 'success') {
  const old = document.getElementById('app-toast');
  if (old) old.remove();

  const toast = document.createElement('div');
  toast.id = 'app-toast';
  toast.className = `app-toast ${type === 'success' ? 'success' : 'error'}`;
  const icon = document.createElement('i');
  icon.className = `fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}`;
  const label = document.createElement('span');
  label.textContent = String(msg);
  toast.append(icon, label);
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 4000);
}

function updateGoalDisplay() {
  const dailyGoal = Math.max(1, Number(driveSync.getSettings().dailyGoal || 20));
  const display = `${Math.min(goalCount, dailyGoal)} / ${dailyGoal}`;
  const hdrGoal = document.getElementById('hdr-goal-count');
  const goalEl = document.getElementById('goal-number-el');
  if (hdrGoal) hdrGoal.textContent = display;
  if (goalEl) goalEl.textContent = display;
}

function updateDashboardDerivedState() {
  updateGoalDisplay();
  const settings = driveSync.getSettings();
  const allWords = driveSync.getWords();
  const boxCounts = [1, 2, 3, 4, 5].map(box => allWords.filter(word => Number(word.box || 1) === box).length);
  boxCounts.forEach((count, index) => {
    const element = document.getElementById(`b${index + 1}-count`);
    if (element) element.textContent = String(count);
  });
  const currentWords = allWords.filter(word => word.notebook === driveSync.getActiveNotebook()).length;
  const added = document.getElementById('stat-words-added');
  if (added) added.textContent = String(currentWords);
  const due = document.getElementById('stat-synced-today');
  if (due) due.textContent = String(getDueWords().filter(word => word.notebook === driveSync.getActiveNotebook()).length);
  const learning = document.getElementById('stat-keep-updates');
  if (learning) learning.textContent = String(allWords.filter(word => word.notebook === driveSync.getActiveNotebook() && !word.mastered).length);
  const streak = Number(settings.dailyStreak || 0);
  for (const id of ['hdr-streak-count', 'streak-num']) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(streak);
  }
  const ring = document.querySelector('.radial-svg circle:nth-of-type(2)');
  const dailyGoal = Math.max(1, Number(settings.dailyGoal || 20));
  if (ring) ring.setAttribute('stroke-dashoffset', String(238.76 * (1 - Math.min(goalCount, dailyGoal) / dailyGoal)));
  const activity = settings.reviewActivity || {};
  const today = new Date();
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  document.querySelectorAll('.day-circle').forEach((element, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    element.classList.toggle('checked', Number(activity[key] || 0) > 0);
  });
  renderConnectionState();
}

function navigateTo(viewName) {
  if (viewName === 'challenge') viewName = 'choose';
  if (!['dashboard', 'review', 'library', 'stats', 'spelling', 'choose', 'visual', 'match', 'speaking'].includes(viewName)) viewName = 'dashboard';
  if (currentView === 'speaking' && viewName !== 'speaking') teardownSpeakingMode();
  currentView = viewName;
  document.body.classList.toggle('speaking-view', viewName === 'speaking');
  const activeMonthLabel = document.getElementById('active-month-label');
  if (activeMonthLabel) activeMonthLabel.textContent = driveSync.getActiveNotebook().replace(/ Vocabulary$/, '');

  document.querySelectorAll('.nav-link-item').forEach(link => {
    link.classList.toggle('active', link.getAttribute('data-view') === viewName);
  });

  const container = document.getElementById('view-container');
  if (!container) return;

  if (viewName === 'review') {
    renderReviewView(container, navigateTo);
  } else if (viewName === 'library') {
    renderLibraryView(container, navigateTo);
  } else if (viewName === 'stats') {
    renderStatsView(container, navigateTo);
  } else if (viewName === 'spelling') {
    renderSpellingMode(container, navigateTo);
  } else if (viewName === 'choose') {
    renderChooseWordMode(container, navigateTo);
  } else if (viewName === 'visual') {
    renderVisualMatchMode(container, navigateTo);
  } else if (viewName === 'match') {
    renderMatchSprintMode(container, navigateTo);
  } else if (viewName === 'speaking') {
    renderSpeakingMode(container, navigateTo);
  } else {
    if (dashboardOriginalHTML) {
      container.innerHTML = dashboardOriginalHTML;
      setupFlashcardControls();
      setupLearningModeButtons();
      updateDashboardDerivedState();
    }
  }
  container.classList.remove('view-enter');
  if (viewEnterTimer) window.clearTimeout(viewEnterTimer);
  requestAnimationFrame(() => {
    container.classList.add('view-enter');
    viewEnterTimer = window.setTimeout(() => container.classList.remove('view-enter'), 380);
  });
}

function setupLearningModeButtons() {
  document.getElementById('btn-mode-spelling')?.addEventListener('click', () => { window.location.hash = 'spelling'; });
  document.getElementById('btn-mode-choose')?.addEventListener('click', () => { window.location.hash = 'choose'; });
  document.getElementById('btn-mode-visual')?.addEventListener('click', () => { window.location.hash = 'visual'; });
  document.getElementById('btn-mode-match')?.addEventListener('click', () => { window.location.hash = 'match'; });
  document.getElementById('btn-mode-speaking')?.addEventListener('click', () => { window.location.hash = 'speaking'; });
}

function setupNavigation() {
  document.querySelectorAll('.nav-link-item').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const view = link.getAttribute('data-view');
      if (location.hash === `#${view}`) navigateTo(view);
      else location.hash = view;
    });
  });
}

function setupQuickAddModal() {
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
  let senseDrafts = new Map();
  let selectedSenseIds = new Set();
  let focusedSenseId = null;
  let bulkResults = [];

  if (!btnOpen) return;

  const openModal = () => {
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
      heading.append(title, remove);
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

  const closeModal = () => {
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
    bulkResults = [];
    bulkResultsList.innerHTML = '';
    bulkSave.disabled = true;
    setAddMode('single', false);
    currentFetchedData = null;
  };

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
    editorSubtitle.textContent = selectedSenseIds.size > 1 ? `${selectedSenseIds.size} meanings will be saved` : 'This meaning will be saved as its own card';
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
      meta.textContent = `${index + 1}. ${sense.partOfSpeech || 'unknown'}`;
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

  btnOpen.addEventListener('click', openModal);
  singleTab.addEventListener('click', () => setAddMode('single'));
  bulkTab.addEventListener('click', () => setAddMode('bulk'));
  btnClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-bulk-add').addEventListener('click', closeModal);
  bulkInput.addEventListener('input', () => {
    const terms = parseBulkWordList(bulkInput.value, Number.MAX_SAFE_INTEGER);
    bulkCount.textContent = `${terms.length} word${terms.length === 1 ? '' : 's'}`;
    bulkStatus.textContent = terms.length > MAX_BULK_WORDS ? `You can import up to ${MAX_BULK_WORDS} words at once.` : '';
    bulkResults = [];
    bulkResultsList.innerHTML = '';
    bulkSave.disabled = true;
  });
  bulkPrepare.addEventListener('click', async () => {
    const allTerms = parseBulkWordList(bulkInput.value, Number.MAX_SAFE_INTEGER);
    if (!allTerms.length) { bulkInput.focus(); return; }
    if (allTerms.length > MAX_BULK_WORDS) {
      bulkStatus.textContent = `This list has ${allTerms.length} words. Keep the first ${MAX_BULK_WORDS} or split it into smaller batches.`;
      return;
    }
    bulkPrepare.disabled = true;
    bulkPrepare.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Finding meanings…';
    bulkStatus.textContent = `Looking up ${allTerms.length} word${allTerms.length === 1 ? '' : 's'}…`;
    try {
      bulkResults = await lookupBulkWords(allTerms, fetchWordDetails, 3);
      renderBulkResults();
      const manualCount = bulkResults.filter(result => result.status === 'manual').length;
      bulkStatus.textContent = manualCount
        ? `${bulkResults.length - manualCount} ready; ${manualCount} need${manualCount === 1 ? 's' : ''} a manual definition.`
        : `${bulkResults.length} words ready. Review each selected meaning, then save the list.`;
    } finally {
      bulkPrepare.disabled = false;
      bulkPrepare.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Find meanings';
    }
  });
  bulkSave.addEventListener('click', () => {
    const items = bulkResults.map((result, index) => {
      const senseIndex = result.selectedSenseIndex || 0;
      const manualDefinition = result.manualDefinition || '';
      return bulkResultToWord(result, senseIndex, manualDefinition);
    });
    if (!items.length || items.some(item => !item.definition)) {
      bulkStatus.textContent = 'Every word needs an intended meaning before the list can be saved.';
      return;
    }
    try {
      const saved = driveSync.addWords(items.map(item => sanitizeExistingExamples(item.word, [item])[0]));
      driveSync.setActiveNotebook(saved[0].notebook);
      wordsQueue = buildStudyQueue();
      currentIndex = 0;
      closeModal();
      showToast(`Saved ${saved.length} words to ${saved[0].notebook}.`);
      navigateTo(currentView);
    } catch (error) {
      bulkStatus.textContent = error.message;
      showToast(error.message, 'error');
    }
  });
  input.addEventListener('input', () => {
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

    btnFetch.disabled = true;
    btnFetch.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Finding meanings & examples…';

    try {
      currentFetchedData = await fetchWordDetails(w);
      document.getElementById('prev-w-title').textContent = currentFetchedData.word;
      document.getElementById('prev-w-phonetic').textContent = currentFetchedData.phonetic;
      renderSenses(currentFetchedData);
      preview.style.display = 'block';
    } catch (err) {
      currentFetchedData = null;
      preview.style.display = 'none';
      formStatus.textContent = 'Lookup failed. You can still enter the exact meaning manually below.';
      showToast(err.message || 'Could not fetch word details.', 'error');
    } finally {
      btnFetch.disabled = false;
      btnFetch.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Find meanings';
    }
  });

  btnSave.addEventListener('click', () => {
    const wordText = input.value.trim();
    if (!wordText) return;

    persistFocusedDraft();
    const selectedDrafts = [...selectedSenseIds].map(id => senseDrafts.get(id)).filter(Boolean);
    const items = currentFetchedData && selectedDrafts.length ? selectedDrafts.map(sense => ({
      word: currentFetchedData.word || wordText,
      phonetic: sense.phonetic || currentFetchedData.phonetic || '',
      audioUrl: sense.audioUrl || currentFetchedData.audioUrl || '',
      partOfSpeech: sense.partOfSpeech || 'unknown',
      definition: sense.definition,
      example: sense.example || '',
      exampleSourceUrl: sense.exampleSourceUrl || '',
      exampleAttribution: sense.exampleAttribution || '',
      exampleLicense: sense.exampleLicense || ''
    })) : [{
      word: wordText,
      phonetic: phoneticInput.value.trim(),
      partOfSpeech: posInput.value.trim() || 'unknown',
      definition: definitionInput.value.trim(),
      example: exampleInput.value.trim()
    }];

    if (items.some(item => !item.definition)) {
      formStatus.textContent = 'Choose a dictionary meaning or write the intended definition before saving.';
      definitionInput.focus();
      return;
    }

    try {
      const senseCheckedItems = items.map(item => sanitizeExistingExamples(item.word, [item])[0]);
      const saved = driveSync.addWords(senseCheckedItems);
      driveSync.setActiveNotebook(saved[0].notebook);
      wordsQueue = buildStudyQueue();
      currentIndex = 0;
      closeModal();
      showToast(`Saved ${saved.length} meaning${saved.length === 1 ? '' : 's'} of “${saved[0].word}” to ${saved[0].notebook}.`);
      navigateTo(currentView);
    } catch (error) {
      showToast(error.message, 'error');
    }
  });
}

function setupDriveBackupModal() {
  const modal = document.getElementById('drive-auth-modal');
  const btnOpen = document.getElementById('btn-open-drive-auth');
  const btnClose = document.getElementById('btn-close-modal');
  const btnOAuth = document.getElementById('btn-modal-oauth');
  const btnSyncNow = document.getElementById('btn-sync-drive-now');
  const btnDisconnect = document.getElementById('btn-disconnect-drive');
  const clientIdInput = document.getElementById('modal-client-id-input');
  const status = document.getElementById('drive-auth-status');
  const origin = document.getElementById('drive-origin-value');
  const webOAuthConfig = document.getElementById('drive-web-oauth-config');
  const androidOAuthNote = document.getElementById('drive-android-oauth-note');
  const nativeAuthorization = usesNativeGoogleAuthorization();

  clientIdInput.value = driveSync.getGoogleClientId();
  if (origin) origin.textContent = window.location.origin;
  if (webOAuthConfig) webOAuthConfig.hidden = nativeAuthorization;
  if (androidOAuthNote) androidOAuthNote.hidden = !nativeAuthorization;
  btnOpen.addEventListener('click', () => {
    status.textContent = '';
    modal.classList.add('active');
  });
  btnClose.addEventListener('click', () => modal.classList.remove('active'));

  btnOAuth.addEventListener('click', async () => {
    const original = btnOAuth.innerHTML;
    btnOAuth.disabled = true;
    btnOAuth.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Waiting for Google…';
    status.textContent = nativeAuthorization
      ? 'Choose the Google account that will store your KeepVocab backup.'
      : 'Complete authorization in the Google dialog.';
    document.getElementById('pill-syncing').style.display = 'inline-flex';
    try {
      const result = await driveSync.connectGoogleDrive(clientIdInput.value);
      renderConnectionState();
      syncedDriveRevision = driveChangeRevision;
      lastAutomaticDriveSyncAt = Date.now();
      status.textContent = `Backed up ${result.totalWords} words across ${result.months} monthly files in “${result.folderName}”.`;
      showToast('Google Drive connected. The current screen was left untouched.');
    } catch (error) {
      renderConnectionState();
      status.textContent = error.message;
      showToast(error.message, 'error');
    } finally {
      btnOAuth.disabled = false;
      btnOAuth.innerHTML = original;
    }
  });

  btnSyncNow.addEventListener('click', async () => {
    const original = btnSyncNow.innerHTML;
    btnSyncNow.disabled = true;
    btnSyncNow.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Syncing…';
    try {
      const revisionAtStart = driveChangeRevision;
      const result = await runDriveSync();
      syncedDriveRevision = Math.max(syncedDriveRevision, revisionAtStart);
      lastAutomaticDriveSyncAt = Date.now();
      status.textContent = `Synchronized ${result.totalWords} words across ${result.months} monthly files.`;
      showToast('Google Drive backup is up to date. Your current screen was not refreshed.');
    } catch (error) {
      status.textContent = error.message;
      showToast(error.message, 'error');
    } finally {
      btnSyncNow.disabled = false;
      btnSyncNow.innerHTML = original;
    }
  });

  btnDisconnect.addEventListener('click', () => {
    driveSync.disconnectGoogleDrive();
    renderConnectionState();
    status.textContent = 'Google Drive disconnected. The local cache remains available on this device.';
    showToast('Google Drive disconnected.');
  });
}

let automaticSyncTimer = null;
let driveChangeRevision = 0;
let syncedDriveRevision = 0;
let lastAutomaticDriveSyncAt = 0;
let automaticSyncRunning = false;

async function runDriveSync() {
  document.getElementById('pill-syncing').style.display = 'inline-flex';
  try {
    const result = await driveSync.syncGoogleDrive();
    renderConnectionState();
    return result;
  } catch (error) {
    driveSync.setDriveStatus({ isConnected: driveSync.getDriveStatus().isConnected, lastError: error.message });
    renderConnectionState();
    throw error;
  } finally {
    document.getElementById('pill-syncing').style.display = 'none';
  }
}

function hasPendingDriveChanges() {
  return driveChangeRevision > syncedDriveRevision;
}

function scheduleAutomaticDriveSync() {
  if (!driveSync.getDriveStatus().isConnected || !hasPendingDriveChanges() || automaticSyncTimer || automaticSyncRunning) return;
  const delay = backgroundSyncDelay(lastAutomaticDriveSyncAt);
  automaticSyncTimer = window.setTimeout(flushAutomaticDriveSync, delay);
}

async function flushAutomaticDriveSync() {
  automaticSyncTimer = null;
  if (!driveSync.getDriveStatus().isConnected || !hasPendingDriveChanges() || automaticSyncRunning) return;
  const revisionAtStart = driveChangeRevision;
  automaticSyncRunning = true;
  try {
    await runDriveSync();
    syncedDriveRevision = Math.max(syncedDriveRevision, revisionAtStart);
    lastAutomaticDriveSyncAt = Date.now();
  } catch (error) {
    console.warn('Automatic Drive backup failed.', error);
  } finally {
    automaticSyncRunning = false;
    if (hasPendingDriveChanges()) scheduleAutomaticDriveSync();
  }
}

function setupAutomaticDriveBackup() {
  window.addEventListener('keepvocab:data-changed', () => {
    driveChangeRevision += 1;
    scheduleAutomaticDriveSync();
  });
  window.addEventListener('online', scheduleAutomaticDriveSync);
  window.setInterval(scheduleAutomaticDriveSync, DRIVE_SYNC_MIN_INTERVAL_MS);
}

function resumeRememberedDriveConnection() {
  // Restoring the UI is intentionally local-only. Network access starts after
  // the user connects/syncs or changes vocabulary, never just because a page opened.
  renderConnectionState();
}

function renderConnectionState() {
  const banner = document.getElementById('keep-banner-card');
  const auth = driveSync.getDriveStatus();
  const title = document.getElementById('banner-text-title');
  const subtitle = document.getElementById('banner-text-sub');
  const icon = document.getElementById('banner-icon-el');
  const connectedPill = document.getElementById('pill-connected');
  const syncingPill = document.getElementById('pill-syncing');
  const offlinePill = document.getElementById('pill-offline');
  const openButton = document.getElementById('btn-open-drive-auth');

  if (auth.isConnected) {
    banner.className = 'keep-banner connected';
    icon.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
    title.textContent = 'Google Drive backup active';
    subtitle.textContent = `${auth.email || 'Google account'} · “${auth.folderName}” · Last sync ${auth.lastSynced ? new Date(auth.lastSynced).toLocaleString() : 'pending'}.`;
    connectedPill.style.display = 'inline-flex';
    offlinePill.style.display = 'none';
    openButton.innerHTML = '<i class="fa-solid fa-gear"></i> Manage Sync';
  } else if (auth.remembered && !auth.lastError) {
    banner.className = 'keep-banner disconnected';
    icon.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i>';
    title.textContent = 'Google Drive is ready to reconnect';
    subtitle.textContent = 'KeepVocab will not contact Drive until you choose to reconnect.';
    connectedPill.style.display = 'none';
    offlinePill.style.display = 'inline-flex';
    openButton.innerHTML = '<i class="fa-brands fa-google-drive"></i> Reconnect Drive';
  } else {
    banner.className = 'keep-banner disconnected';
    icon.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i>';
    title.textContent = 'Google Drive backup is off';
    subtitle.textContent = auth.lastError || 'Connect Drive to back up monthly vocabulary files and restore them after reinstalling.';
    connectedPill.style.display = 'none';
    offlinePill.style.display = 'inline-flex';
    openButton.innerHTML = '<i class="fa-brands fa-google-drive"></i> Connect Drive';
  }
  syncingPill.style.display = 'none';

  const lastSync = document.getElementById('stat-last-sync');
  const syncLabel = document.getElementById('sync-time-label');
  if (lastSync) lastSync.textContent = auth.lastSynced ? new Date(auth.lastSynced).toLocaleString() : 'Not backed up';
  if (syncLabel) syncLabel.textContent = auth.isConnected ? 'Drive active' : 'Drive off';
}

function setupFlashcardControls() {
  const audioBtn = document.getElementById('fc-audio-btn');
  const speedBtn = document.getElementById('btn-toggle-speech-speed');
  const wordEl = document.getElementById('fc-word');
  const posEl = document.getElementById('fc-pos');
  const defEl = document.getElementById('fc-def');
  const exampleEl = document.getElementById('fc-example');
  const indexEl = document.getElementById('fc-index');
  const totalEl = document.getElementById('fc-total');

  if (!wordEl) return;
  wordsQueue = buildStudyQueue();
  if (wordsQueue.length === 0) {
    wordEl.textContent = 'No words yet';
    if (posEl) posEl.textContent = 'Add vocabulary to begin';
    if (defEl) defEl.textContent = '';
    if (exampleEl) exampleEl.textContent = '';
    if (indexEl) indexEl.textContent = '0';
    if (totalEl) totalEl.textContent = '0';
    ['btn-rate-again', 'btn-rate-hard', 'btn-rate-good', 'btn-rate-easy', 'fc-audio-btn', 'btn-toggle-speech-speed'].forEach(id => {
      const button = document.getElementById(id);
      if (button) button.disabled = true;
    });
    return;
  }
  currentIndex %= wordsQueue.length;
  totalEl.textContent = wordsQueue.length;

  function updateCard() {
    const current = wordsQueue[currentIndex];
    wordEl.textContent = current.word;
    posEl.textContent = current.partOfSpeech;
    defEl.textContent = `"${current.definition}"`;
    exampleEl.textContent = `"${current.example}"`;
    indexEl.textContent = currentIndex + 1;
    const card = document.getElementById('flashcard-spec-card');
    if (card) {
      card.classList.remove('flashcard-pop');
      requestAnimationFrame(() => card.classList.add('flashcard-pop'));
    }
  }

  if (audioBtn) {
    audioBtn.addEventListener('click', () => {
      const word = wordsQueue[currentIndex];
      speakWord(word.word, 'en-US', speechSpeed, word.audioUrl);
    });
  }

  if (speedBtn) {
    speedBtn.addEventListener('click', () => {
      speechSpeed = speechSpeed === 1.0 ? 0.75 : 1.0;
      speedBtn.textContent = `${speechSpeed}x`;
      showToast(`Speech rate set to ${speechSpeed}x`);
    });
  }

  const rateAction = (type) => {
    if (!wordsQueue.length) return;
    const current = wordsQueue[currentIndex];
    if (current.id) updateWordRepetition(current.id, type.toLowerCase());
    goalCount = Number(driveSync.getSettings().reviewsToday || 0);
    updateGoalDisplay();

    showToast(`Rated “${current.word}” as ${type}. Review schedule updated.`);
    currentIndex = (currentIndex + 1) % wordsQueue.length;
    wordsQueue = buildStudyQueue();
    updateCard();
    updateDashboardDerivedState();
  };

  if (document.getElementById('btn-rate-again')) document.getElementById('btn-rate-again').addEventListener('click', () => rateAction('Again'));
  if (document.getElementById('btn-rate-hard')) document.getElementById('btn-rate-hard').addEventListener('click', () => rateAction('Hard'));
  if (document.getElementById('btn-rate-good')) document.getElementById('btn-rate-good').addEventListener('click', () => rateAction('Good'));
  if (document.getElementById('btn-rate-easy')) document.getElementById('btn-rate-easy').addEventListener('click', () => rateAction('Easy'));

  updateCard();
}

function setupMonthDropdown() {
  const btn = document.getElementById('month-dropdown-btn');
  const menu = document.getElementById('month-menu');
  const label = document.getElementById('active-month-label');

  if (!btn || !menu) return;
  const notebooks = driveSync.getNotebooks();
  const activeNotebook = driveSync.getActiveNotebook();
  label.textContent = activeNotebook.replace(/ Vocabulary$/, '');
  menu.innerHTML = notebooks.map(notebook => {
    const option = document.createElement('div');
    option.className = 'month-option';
    option.dataset.notebook = notebook.name;
    option.textContent = notebook.name;
    return option.outerHTML;
  }).join('');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('active');
  });

  document.addEventListener('click', () => menu.classList.remove('active'));

  menu.querySelectorAll('.month-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const notebook = opt.getAttribute('data-notebook');
      driveSync.setActiveNotebook(notebook);
      label.textContent = notebook.replace(/ Vocabulary$/, '');
      menu.classList.remove('active');
      wordsQueue = buildStudyQueue();
      currentIndex = 0;
      if (currentView === 'dashboard') navigateTo('dashboard');
      showToast(`Active vocabulary month changed to “${notebook}”.`);
    });
  });
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable) return;

    if (e.key === ' ') {
      if (!wordsQueue.length || currentView !== 'dashboard') return;
      e.preventDefault();
      const word = wordsQueue[currentIndex];
      speakWord(word.word, 'en-US', speechSpeed, word.audioUrl);
    } else if (e.key === '1') {
      const btn = document.getElementById('btn-rate-again');
      if (btn) btn.click();
    } else if (e.key === '2') {
      const btn = document.getElementById('btn-rate-hard');
      if (btn) btn.click();
    } else if (e.key === '3') {
      const btn = document.getElementById('btn-rate-good');
      if (btn) btn.click();
    } else if (e.key === '4') {
      const btn = document.getElementById('btn-rate-easy');
      if (btn) btn.click();
    } else if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('active'));
    }
  });
}
