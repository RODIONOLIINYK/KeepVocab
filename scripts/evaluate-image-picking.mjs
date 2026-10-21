import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rankImageCandidates } from '../js/services/imageSearch.js';

const text = (value, limit = 1000) => String(value ?? '').trim().slice(0, limit);
function publicUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    // Evaluation never needs query parameters, which can contain signed tokens.
    url.search = ''; url.hash = '';
    return url.href;
  } catch { return ''; }
}

/**
 * Offline fixtures: {kind:'reviewed'|'synthetic',cases:[{id,word:{word,definition},
 * concepts:[],candidates:[{id,url,title,tags,source,...}],
 * feedback:{selected:[candidateId],good:[candidateId],wrong:[candidateId]}}]}.
 * Labels are evaluation-only: they are never fed into the lexical ranker.
 */
export function evaluateImagePicking(fixtures = { cases: [] }) {
  if (!fixtures || !Array.isArray(fixtures.cases) || fixtures.cases.length > 500) throw new Error('Provide at most 500 evaluation cases.');
  const kind = ['reviewed', 'synthetic'].includes(fixtures.kind) ? fixtures.kind : fixtures.cases.length ? 'unspecified' : 'none';
  let positiveCases = 0;
  let top1Positive = 0;
  let top3Positive = 0;
  let top1Wrong = 0;
  let top1Unlabeled = 0;
  const cases = fixtures.cases.map((item, index) => {
    const id = text(item?.id || `case-${index + 1}`, 80);
    const word = { word: text(item?.word?.word, 160), definition: text(item?.word?.definition, 1500), partOfSpeech: text(item?.word?.partOfSpeech, 40) };
    if (!word.word || !word.definition || !Array.isArray(item.candidates) || item.candidates.length > 200) throw new Error(`Invalid sense or candidate list in case ${index + 1}.`);
    const seen = new Set();
    const candidates = item.candidates.map(candidate => {
      const candidateId = text(candidate?.id, 100);
      const url = publicUrl(candidate?.url);
      if (!candidateId || !url || seen.has(candidateId)) throw new Error(`Invalid or duplicate candidate ID/URL in case ${index + 1}.`);
      seen.add(candidateId);
      return {
        id: candidateId, url, sourceUrl: publicUrl(candidate.sourceUrl), title: text(candidate.title, 500), source: text(candidate.source, 80),
        category: text(candidate.category, 40), width: Number(candidate.width) || 0, height: Number(candidate.height) || 0,
        tags: Array.isArray(candidate.tags) ? candidate.tags.slice(0, 30).map(tag => text(tag?.name || tag, 80)) : [],
        searchQuery: text(candidate.searchQuery, 160), visualScene: text(candidate.visualScene, 160)
      };
    });
    const labels = name => {
      const values = item.feedback?.[name] || [];
      if (!Array.isArray(values)) throw new Error(`Invalid ${name} feedback in case ${index + 1}.`);
      const result = new Set(values.map(value => text(value, 100)));
      if ([...result].some(value => !seen.has(value))) throw new Error(`Feedback references a missing candidate in case ${index + 1}.`);
      return result;
    };
    const positives = new Set([...labels('selected'), ...labels('good')]);
    const wrong = labels('wrong');
    if ([...positives].some(value => wrong.has(value))) throw new Error(`Conflicting explicit labels in case ${index + 1}.`);
    const concepts = Array.isArray(item.concepts) ? item.concepts.slice(0, 8).map(value => text(value, 160)).filter(Boolean) : [];
    const rankedIds = rankImageCandidates(candidates, word, { concepts, limit: 40 }).map(candidate => candidate.id);
    const first = rankedIds[0];
    const firstPositive = positives.has(first);
    const anyTop3Positive = rankedIds.slice(0, 3).some(candidateId => positives.has(candidateId));
    if (positives.size) { positiveCases++; if (firstPositive) top1Positive++; if (anyTop3Positive) top3Positive++; }
    if (wrong.has(first)) top1Wrong++;
    if (first && !positives.has(first) && !wrong.has(first)) top1Unlabeled++;
    return { id, rankedIds: rankedIds.slice(0, 3), top1Label: !first ? 'none' : firstPositive ? 'positive' : wrong.has(first) ? 'wrong' : 'unlabeled', top3ExplicitPositive: anyTop3Positive };
  });
  return {
    fixtureKind: kind, evaluatedCases: cases.length, explicitlyPositiveCases: positiveCases,
    top1: { positiveHits: top1Positive, eligibleCases: positiveCases, rate: positiveCases ? top1Positive / positiveCases : null },
    top3: { positiveHits: top3Positive, eligibleCases: positiveCases, rate: positiveCases ? top3Positive / positiveCases : null },
    explicitlyWrongAtTop1: top1Wrong, unlabeledAtTop1: top1Unlabeled,
    note: !cases.length ? 'No reviewed fixtures supplied; no accuracy claim.' : kind === 'synthetic'
      ? 'Synthetic regression cases only; these are not real-world accuracy measurements.'
      : 'Outcomes use only supplied explicit selected/Good/Wrong labels. Unlabeled candidates are not negatives; no population accuracy is inferred.',
    cases
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const file = process.argv[2];
    if (file && (await stat(file)).size > 10_000_000) throw new Error('Evaluation fixture file exceeds 10 MB.');
    const input = file ? JSON.parse(await readFile(file, 'utf8')) : { cases: [] };
    console.log(JSON.stringify(evaluateImagePicking(input), null, 2));
  } catch {
    console.error('Cannot evaluate these fixtures. Check the documented JSON structure, explicit candidate labels, and 10 MB file limit.');
    process.exitCode = 1;
  }
}
