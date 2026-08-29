import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { MemoryStorage } from '../js/services/driveSync.js';
import { fetchLithuanianWordDetails, parseLithuanianWiktionaryHtml } from '../js/services/lithuanianDictionary.js';
import { enrichLithuanianEntry, translateLithuanianCoachText } from '../js/services/lithuanianEnrichment.js';
import { saveGeminiSettings } from '../js/services/geminiSettings.js';

const WIKTIONARY_HTML = `<!doctype html><html><body>
  <h2 id="English">English</h2><h3 id="Noun">Noun</h3><ol><li>an unrelated sense</li></ol>
  <h2 id="Lithuanian">Lithuanian</h2>
  <h3 id="Pronunciation">Pronunciation</h3><span class="IPA nowrap">/ˈɫɑ̌ːbɐs/</span>
  <h3 id="Interjection">Interjection</h3>
  <p><span class="headword-line"><strong class="Latn headword" lang="lt">lãbas</strong></span></p>
  <ol><li><a href="./hi">hi</a>, <a href="./hello">hello</a></li></ol>
  <h3 id="Adjective">Adjective</h3>
  <p><span class="headword-line"><strong class="Latn headword" lang="lt">lãbas</strong></span></p>
  <ol><li><span class="ib-content">obsolete</span> good, suitable</li></ol>
  <h2 id="Polish">Polish</h2><h3 id="Noun_2">Noun</h3><ol><li>another unrelated sense</li></ol>
</body></html>`;

test('Lithuanian Wiktionary parsing isolates the Lithuanian section and returns English meanings', () => {
  const result = parseLithuanianWiktionaryHtml(WIKTIONARY_HTML, ' Labas ');
  assert.equal(result.word, 'labas');
  assert.equal(result.lemma, 'lãbas');
  assert.equal(result.phonetic, '/ˈɫɑ̌ːbɐs/');
  assert.deepEqual(result.senses.map(sense => sense.partOfSpeech), ['interjection', 'adjective']);
  assert.equal(result.senses[0].definition, 'hi, hello');
  assert.match(result.senses[0].sourceUrl, /en\.wiktionary\.org/);
  assert.match(result.attribution, /CC BY-SA 4\.0/);
});

test('Lithuanian dictionary lookup is cached for offline Add Word use', async () => {
  const storage = new MemoryStorage();
  let calls = 0;
  const online = await fetchLithuanianWordDetails('labas', {
    storage,
    fetchImpl: async url => {
      calls += 1;
      assert.match(url, /en\.wiktionary\.org.*labas\/with_html/);
      return { ok: true, status: 200, async json() { return { html: WIKTIONARY_HTML }; } };
    }
  });
  assert.equal(online.senses[0].definition, 'hi, hello');
  const cached = await fetchLithuanianWordDetails('labas', {
    storage,
    fetchImpl: async () => { throw new Error('offline'); }
  });
  assert.equal(calls, 1);
  assert.equal(cached.source, 'Wiktionary cache');
});

test('fresh Lithuanian dictionary entries avoid a repeated network lookup', async () => {
  const storage = new MemoryStorage();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, status: 200, async json() { return { html: WIKTIONARY_HTML }; } };
  };
  await fetchLithuanianWordDetails('labas', { storage, fetchImpl });
  const cached = await fetchLithuanianWordDetails('labas', { storage, fetchImpl });
  assert.equal(calls, 1);
  assert.equal(cached.source, 'Wiktionary cache');
});

test('Lithuanian AI enrichment is reused from a bounded device cache', async () => {
  const storage = new MemoryStorage();
  saveGeminiSettings({ apiKey: 'AIza-example-device-key-123456789', textModel: 'gemini-test' }, storage, { silent: true });
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify({
      word: 'labas', lemma: 'labas', senses: [{ id: 'greeting', partOfSpeech: 'interjection', definition: 'hello', example: 'Labas, kaip sekasi?', acceptedForms: ['labas'], grammaticalTags: [] }]
    }) }] } }] }; } };
  };
  const first = await enrichLithuanianEntry('labas', { storage, fetchImpl });
  const second = await enrichLithuanianEntry('labas', { storage, fetchImpl });
  assert.equal(first.senses[0].definition, 'hello');
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
});

test('Lithuanian coach messages receive a concise English-only translation', async () => {
  const storage = new MemoryStorage();
  saveGeminiSettings({ apiKey: 'AIza-example-device-key-123456789' }, storage, { silent: true });
  let prompt = '';
  const translated = await translateLithuanianCoachText('Kaip šiandien jautiesi?', {
    storage,
    fetchImpl: async (_url, options) => {
      prompt = JSON.parse(options.body).contents[0].parts[0].text;
      return { ok: true, async json() { return { candidates: [{ content: { parts: [{ text: 'How are you feeling today?' }] } }] }; } };
    }
  });
  assert.equal(translated, 'How are you feeling today?');
  assert.match(prompt, /Return only the English translation/);
  assert.match(prompt, /Kaip šiandien jautiesi/);
});

test('the header uses a custom accessible course listbox instead of a native select', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
  assert.match(html, /id="course-switcher-trigger"[^>]*aria-haspopup="listbox"/);
  assert.match(html, /id="course-switcher-menu" role="listbox"/);
  assert.match(html, /course-switcher-language-icon/);
  assert.doesNotMatch(html, /course-switcher-chevron/);
  assert.doesNotMatch(html, /<select id="course-switcher"/);
  assert.match(app, /event\.key === 'Escape'/);
  assert.match(app, /event\.key === 'ArrowDown'/);
  assert.match(app, /learnLink\.hidden = !course\.hasLearningPath/);
  assert.match(app, /viewName === 'learn' && !getCourseDefinition/);
  assert.match(css, /body\[data-course-id="english"\] \.nav-links\{grid-template-columns:repeat\(5,1fr\)\}/);
  assert.match(css, /\.course-switcher\{width:38px/);
});

test('Lithuanian Add Word retains the same bulk workflow and image enrichment as English', () => {
  const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /bulkTab\.hidden = false/);
  assert.match(app, /const lookupForActiveCourse = term => driveSync\.getActiveCourseId\(\) === 'lithuanian'/);
  assert.doesNotMatch(app, /bulkTab\.hidden = lithuanian/);
  assert.match(app, /const enrichedItems = await attachImagesSequentially\(senseCheckedItems/);
});
