import { driveSync } from './services/driveSync.js?v=1602';
import { fetchWordEntry, wordEntryToWord, prepareWordsForLibrary } from './services/wordEntry.js?v=1602';
import { escapeHtml } from './utils/html.js';

const shell = document.querySelector('.quick-add-shell');
const form = document.querySelector('#quick-lookup-form');
const courseLabel = document.querySelector('#quick-course-label');
const wordLabel = document.querySelector('#quick-word-label');
const input = document.querySelector('#quick-word');
const findButton = document.querySelector('#quick-find');
const results = document.querySelector('#quick-results');
const manual = document.querySelector('#quick-manual');
const definition = document.querySelector('#quick-definition');
const status = document.querySelector('#quick-status');
const save = document.querySelector('#quick-save');
let lookup = null;
let lookupCourseId = null;
let activeCourseId = driveSync.getActiveCourseId();

function setShellState(state = '') {
  shell.classList.remove('is-loading', 'has-results', 'has-error', 'is-saving', 'is-success');
  if (!state) return;
  shell.classList.add(state);
  if (state === 'is-saving' || state === 'is-success') {
    shell.classList.add(lookup ? 'has-results' : 'has-error');
  }
}

function setFindLabel(label) {
  findButton.innerHTML = `<span class="sparkle" aria-hidden="true">✦</span><span>${escapeHtml(label)}</span>`;
}

function setSaveLabel(label, saved = false) {
  save.innerHTML = `<span>${escapeHtml(label)}</span><span class="button-arrow" aria-hidden="true">${saved ? '✓' : '→'}</span>`;
  save.classList.toggle('is-saved', saved);
}

function setStatus(message, kind = '') {
  status.textContent = message;
  status.className = `quick-status ${kind}`.trim();
}

function clearComposer() {
  lookup = null;
  lookupCourseId = null;
  results.innerHTML = '';
  manual.hidden = true;
  definition.value = '';
  save.disabled = true;
  setShellState();
  setSaveLabel('Save to Library');
}

function syncCourseMode({ announce = false } = {}) {
  const nextCourseId = driveSync.getActiveCourseId();
  const changed = nextCourseId !== activeCourseId;
  activeCourseId = nextCourseId;
  const lithuanian = activeCourseId === 'lithuanian';
  courseLabel.textContent = lithuanian ? 'Lithuanian course' : 'English course';
  wordLabel.textContent = lithuanian ? 'Lithuanian word or expression' : 'English word or expression';
  input.placeholder = lithuanian ? 'Type in Lithuanian' : 'Type in English';
  input.lang = lithuanian ? 'lt' : 'en';
  if (changed) {
    input.value = '';
    clearComposer();
  }
  if (announce || changed) setStatus(`${lithuanian ? 'Lithuanian' : 'English'} quick add is active. Press Return to find the intended meaning.`);
}

function selectedSense() {
  const id = results.querySelector('input[name="quick-sense"]:checked')?.value;
  return lookup?.senses?.find(sense => sense.id === id) || null;
}

function renderSenses(data) {
  results.innerHTML = data.senses.slice(0, 6).map((sense, index) => `<label class="sense-option" style="--sense-index:${index}"><input type="radio" name="quick-sense" value="${escapeHtml(sense.id)}"${index === 0 ? ' checked' : ''}><div><strong>${escapeHtml(sense.partOfSpeech || 'word')}</strong><span>${escapeHtml(sense.definition)}</span>${sense.example ? `<small>“${escapeHtml(sense.example)}”</small>` : ''}</div></label>`).join('');
  results.querySelectorAll('input').forEach(radio => radio.addEventListener('change', () => { save.disabled = false; }));
  manual.hidden = true;
  save.disabled = false;
  setShellState('has-results');
  setStatus(data.correctedFrom ? `Spelling corrected from “${data.correctedFrom}”. Choose the meaning you heard.` : 'Choose the meaning you heard, then save.');
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const word = input.value.trim();
  if (!word) return;
  lookup = null;
  results.innerHTML = '';
  manual.hidden = true;
  save.disabled = true;
  findButton.disabled = true;
  setShellState('is-loading');
  form.setAttribute('aria-busy', 'true');
  setFindLabel('Finding meanings…');
  setStatus('Looking up meanings…');
  const requestedCourseId = activeCourseId;
  lookupCourseId = requestedCourseId;
  try {
    lookup = await fetchWordEntry(word, requestedCourseId);
    if (requestedCourseId !== activeCourseId) return;
    input.value = lookup.word;
    renderSenses(lookup);
  } catch (error) {
    setShellState('has-error');
    manual.hidden = false;
    definition.focus();
    setStatus(`${error.message} You can still save the meaning manually.`, 'error');
    save.disabled = !definition.value.trim();
  } finally {
    findButton.disabled = false;
    form.removeAttribute('aria-busy');
    setFindLabel('Find meanings');
  }
});

input.addEventListener('input', () => {
  clearComposer();
  setStatus('Press Return to find the intended meaning.');
});

definition.addEventListener('input', () => { save.disabled = !definition.value.trim(); });

save.addEventListener('click', async () => {
  const word = input.value.trim();
  const sense = selectedSense();
  const item = sense ? wordEntryToWord(lookup, lookup.senses.indexOf(sense), lookupCourseId || activeCourseId) : {
    courseId: activeCourseId,
    word,
    partOfSpeech: 'unknown',
    definition: definition.value.trim(),
    example: '',
  };
  if (!item.word || !item.definition) return setStatus('Add a word and its intended meaning first.', 'error');
  save.disabled = true;
  setShellState('is-saving');
  setSaveLabel('Choosing image…');
  setStatus('Choosing a relevant memory image…');
  try {
    const [enriched] = await prepareWordsForLibrary([item], {
      courseId: item.courseId, existingWords: driveSync.getWords(),
      onProgress: ({ found }) => setStatus(found
        ? 'Relevant image found. Saving…'
        : 'No suitable image was available. Saving the word…'),
    });
    const saved = driveSync.addWord(enriched);
    setShellState('is-success');
    setStatus(`Saved “${saved.word}” to ${saved.notebook}.`, 'success');
    setSaveLabel('Saved to Library', true);
    window.setTimeout(() => window.close(), 850);
  } catch (error) {
    setShellState(sense ? 'has-results' : 'has-error');
    setStatus(error.message, 'error');
    save.disabled = false;
    setSaveLabel('Save to Library');
  }
});

document.querySelector('#quick-close').addEventListener('click', () => window.close());
window.addEventListener('storage', event => {
  if (event.key === 'keepvocab_settings') syncCourseMode({ announce: true });
});
window.addEventListener('focus', () => window.setTimeout(() => {
  syncCourseMode();
  input.focus();
}, 0));
syncCourseMode({ announce: true });
input.focus();
