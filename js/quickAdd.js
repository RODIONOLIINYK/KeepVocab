import { driveSync } from './services/driveSync.js?v=93';
import { fetchWordDetails } from './services/dictionaryApi.js?v=93';
import { findRelevantImages, imageUrlsForWords } from './services/imageSearch.js?v=93';
import { attachImagesSequentially } from './services/bulkWords.js?v=93';
import { sanitizeExistingExamples } from './services/exampleSearch.js?v=93';
import { escapeHtml } from './utils/html.js';

const form = document.querySelector('#quick-lookup-form');
const input = document.querySelector('#quick-word');
const findButton = document.querySelector('#quick-find');
const results = document.querySelector('#quick-results');
const manual = document.querySelector('#quick-manual');
const definition = document.querySelector('#quick-definition');
const status = document.querySelector('#quick-status');
const save = document.querySelector('#quick-save');
let lookup = null;

function setStatus(message, kind = '') {
  status.textContent = message;
  status.className = `quick-status ${kind}`.trim();
}

function selectedSense() {
  const id = results.querySelector('input[name="quick-sense"]:checked')?.value;
  return lookup?.senses?.find(sense => sense.id === id) || null;
}

function renderSenses(data) {
  results.innerHTML = data.senses.slice(0, 6).map((sense, index) => `<label class="sense-option"><input type="radio" name="quick-sense" value="${escapeHtml(sense.id)}"${index === 0 ? ' checked' : ''}><div><strong>${escapeHtml(sense.partOfSpeech || 'word')}</strong><span>${escapeHtml(sense.definition)}</span>${sense.example ? `<small>“${escapeHtml(sense.example)}”</small>` : ''}</div></label>`).join('');
  results.querySelectorAll('input').forEach(radio => radio.addEventListener('change', () => { save.disabled = false; }));
  manual.hidden = true;
  save.disabled = false;
  setStatus(data.correctedFrom ? `Spelling corrected from “${data.correctedFrom}”. Choose the meaning you heard.` : 'Choose the meaning used in the film, then save.');
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
  findButton.textContent = 'Finding…';
  setStatus('Looking up meanings…');
  try {
    lookup = await fetchWordDetails(word);
    input.value = lookup.word;
    renderSenses(lookup);
  } catch (error) {
    manual.hidden = false;
    definition.focus();
    setStatus(`${error.message} You can still save the meaning manually.`, 'error');
    save.disabled = false;
  } finally {
    findButton.disabled = false;
    findButton.textContent = 'Find';
  }
});

input.addEventListener('input', () => {
  lookup = null;
  results.innerHTML = '';
  manual.hidden = true;
  definition.value = '';
  save.disabled = true;
  setStatus('Press Return to find the intended meaning.');
});

definition.addEventListener('input', () => { save.disabled = !definition.value.trim(); });

save.addEventListener('click', async () => {
  const word = input.value.trim();
  const sense = selectedSense();
  const item = sense ? {
    word: lookup.word,
    phonetic: lookup.phonetic || '',
    audioUrl: lookup.audioUrl || '',
    partOfSpeech: sense.partOfSpeech || 'unknown',
    definition: sense.definition,
    example: sense.example || '',
    exampleSourceUrl: sense.exampleSourceUrl || '',
    exampleAttribution: sense.exampleAttribution || '',
    exampleLicense: sense.exampleLicense || '',
  } : {
    word,
    partOfSpeech: 'unknown',
    definition: definition.value.trim(),
    example: '',
  };
  if (!item.word || !item.definition) return setStatus('Add a word and its intended meaning first.', 'error');
  save.disabled = true;
  const originalLabel = save.textContent;
  save.textContent = 'Choosing image…';
  setStatus('Choosing a relevant memory image…');
  try {
    const senseChecked = sanitizeExistingExamples(item.word, [item])[0];
    const [enriched] = await attachImagesSequentially([senseChecked], findRelevantImages, {
      excludeUrls: imageUrlsForWords(driveSync.getWords()),
      onProgress: ({ found }) => setStatus(found
        ? 'Relevant image found. Saving…'
        : 'No suitable image was available. Saving the word…'),
    });
    const saved = driveSync.addWord(enriched);
    setStatus(`Saved “${saved.word}” to ${saved.notebook}.`, 'success');
    save.textContent = 'Saved';
    window.setTimeout(() => window.close(), 850);
  } catch (error) {
    setStatus(error.message, 'error');
    save.disabled = false;
    save.textContent = originalLabel;
  }
});

document.querySelector('#quick-close').addEventListener('click', () => window.close());
window.addEventListener('focus', () => window.setTimeout(() => input.focus(), 0));
input.focus();
