import { imageClipPrompts, semanticScores, rankEmbeddedImages } from './imageLearning.js?v=18900';
import { encodeFullFeatures, preferenceFeatures } from './imagePreferences.js';
import { encodeMeaning, IMAGE_PREPROCESSING } from './imagePersonalizer.js';
import { CLIP_TAG } from '../ml/clipConfig.js';

/** Evaluate actual encoder output. Feedback is read only after ranking. */
export async function evaluateImagePipeline(fixtures, { embedTexts, embedImage, models = { clip: null }, evidence = 'pixels', preprocessing = IMAGE_PREPROCESSING, progress = () => {} }) {
  if (typeof embedTexts !== 'function' || typeof embedImage !== 'function') throw new Error('Both image and text encoders are required.');
  const reports = Object.fromEntries(Object.keys(models).map(name => [name, { choices: 0, chosenAt1: 0, chosenAt3: 0, explicitlyWrongAt1: 0, rankedCases: [] }]));
  const events = [], timings = [], cases = fixtures?.cases || [];
  for (const [index, item] of cases.entries()) {
    if (!item.word?.word || !item.word?.definition || !Array.isArray(item.candidates) || item.candidates.length < 2) throw new Error('Each evaluation case requires a meaning and at least two photos.');
    const prompt = imageClipPrompts(item.word, { extraQueries: item.concepts || [] }), start = performance.now();
    const texts = await embedTexts(prompt.texts), meaningFeatures = encodeMeaning(texts[0]), embedded = [];
    for (const candidate of item.candidates) {
      const vector = await embedImage(candidate);
      embedded.push({ candidate, vector, meaningFeatures, semantic: semanticScores(vector, texts, prompt.sceneCount, prompt.alternativeCount) });
    }
    // No labels enter the ranking call or encoder prompts.
    const ranked = Object.fromEntries(Object.entries(models).map(([name, model]) => [name, rankEmbeddedImages(embedded, model)]));
    const selected = new Set(item.feedback?.selected || []), wrong = new Set(item.feedback?.wrong || []);
    if ([...selected].some(id => wrong.has(id)) || [...selected, ...wrong].some(id => !item.candidates.some(c => c.id === id))) throw new Error('Feedback must name valid, non-conflicting candidates.');
    for (const [name, rows] of Object.entries(ranked)) {
      const report = reports[name], ids = rows.map(r => r.candidate.id);
      if (selected.size) { report.choices++; report.chosenAt1 += Number(selected.has(ids[0])); report.chosenAt3 += Number(ids.slice(0, 3).some(id => selected.has(id))); }
      report.explicitlyWrongAt1 += Number(wrong.has(ids[0])); report.rankedCases.push({ id: item.id, rankedIds: ids });
    }
    const chosen = embedded.find(row => selected.has(row.candidate.id));
    if (chosen) for (const alternative of embedded.filter(row => !selected.has(row.candidate.id))) {
      const features = encodeFullFeatures(preferenceFeatures(alternative.vector, alternative.semantic));
      events.push({ id: `${item.id}:${alternative.candidate.id}`, key: `${item.id}:${alternative.candidate.id}`, decisionId: item.id,
        meaningId: item.meaningId || item.word.word.toLowerCase(), updatedAt: item.occurredAt || new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
        task: fixtures.targetTask === 'semantic' ? 'semantic' : 'preference', kind: 'comparison', label: 0, features, preferredFeatures: encodeFullFeatures(preferenceFeatures(chosen.vector, chosen.semantic)), meaningFeatures,
        encoder: CLIP_TAG, preprocessing, context: { word: item.word.word, definition: item.word.definition, scenes: prompt.scenes,
          imageUrl: alternative.candidate.url, preferredUrl: chosen.candidate.url }, source: 'curated-pretraining' });
    }
    timings.push(performance.now() - start); progress({ completed: index + 1, total: cases.length, id: item.id });
  }
  for (const report of Object.values(reports)) { report.chosenAt1Rate = report.choices ? report.chosenAt1 / report.choices : null; report.chosenAt3Rate = report.choices ? report.chosenAt3 / report.choices : null; }
  return { kind: fixtures.kind || 'unspecified', targetTask: fixtures.targetTask === 'semantic' ? 'semantic' : 'preference', evidence, encoder: CLIP_TAG, preprocessing,
    evaluatedCases: cases.length, models: reports, timingsMs: timings, events,
    note: fixtures.targetTask === 'semantic' ? 'Meaning-correctness agreement on independently reviewed fixed candidate galleries; no population accuracy or personal taste is inferred.' : 'Chosen-image agreement measures the supplied preferences, not correctness of all unchosen photos. No population accuracy is inferred.' };
}
