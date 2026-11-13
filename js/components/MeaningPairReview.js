import { allEntrySenses, originalSenses } from '../services/learningDefinitions.js?v=18908';
import { recordMeaningJudgment, meaningLearningState, meaningPairKey, cleanEquivalenceText } from '../services/meaningEquivalenceLearning.js';
import { meaningWords, countMatchingMeaningWords, meaningComparisonText, MEANING_COMPARISON_VERSION } from '../services/meaningComparison.js';
import { CLIP_TAG, CLIP_DIMENSION } from '../ml/clipConfig.js';
import { checkMeaningTextEncodingStatus, encodeDefinitionTextsDetailed } from '../services/imageLearning.js?v=18908';

const MAX_ENRICHMENT_QUEUE = 12;
const DEFAULT_ENRICHMENT_TIMEOUT_MS = 5000;
const enrichmentQueue = [];
let enrichmentRunning = false;
let enrichmentIdle = Promise.resolve();
let resolveEnrichmentIdle = null;

const definitionOf = sense => String(sense?.sourceDefinition || sense?.definition || '').trim();

function anchorTextsForPair(word, a, b) {
  return [a, b].flatMap(sense => {
    const raw = meaningComparisonText(definitionOf(sense));
    return [raw, cleanEquivalenceText(raw), `${word} (${sense.partOfSpeech || 'word'}): ${raw}`];
  });
}

function validAnchorVectors(vectors, expectedCount) {
  return Array.isArray(vectors)
    && vectors.length === expectedCount
    && vectors.every(vector => Array.isArray(vector) && vector.length === CLIP_DIMENSION && vector.every(Number.isFinite));
}

function isExactPendingRecord(state, snapshot, expectedEncoder, expectedVersion) {
  const record = state?.records?.find(row => row.key === snapshot.key);
  if (!record) return false;
  if (record.evidence?.encoder === expectedEncoder && record.evidence.comparisonVersion === expectedVersion) return false;
  return record.updatedAt === snapshot.updatedAt
    && record.label === snapshot.label
    && record.source === snapshot.source
    && record.word === snapshot.word
    && record.partOfSpeech === snapshot.partOfSpeech
    && record.definitionA === snapshot.definitionA
    && record.definitionB === snapshot.definitionB;
}

async function runEnrichmentTask(task) {
  const { word, a, b, decision, snapshot, expectedEncoder, expectedVersion, expectedTexts, encodeDefinitionTexts, timeoutMs, storage, cacheStorage } = task;
  if (CLIP_TAG !== expectedEncoder || MEANING_COMPARISON_VERSION !== expectedVersion) return;
  const beforeState = await meaningLearningState().catch(() => null);
  if (!isExactPendingRecord(beforeState, snapshot, expectedEncoder, expectedVersion)) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Background meaning enrichment timed out.')), timeoutMs);
  let vectors = null;
  try {
    if (encodeDefinitionTexts) {
      const encoded = await encodeDefinitionTexts(expectedTexts, { signal: controller.signal, skipDownloadingModel: true });
      if (encoded && !Array.isArray(encoded)) {
        if (encoded.model === expectedEncoder && validAnchorVectors(encoded.vectors, expectedTexts.length)) {
          vectors = encoded.vectors;
        }
      } else if (validAnchorVectors(encoded, expectedTexts.length)) {
        vectors = encoded;
      }
    } else {
      const availability = await checkMeaningTextEncodingStatus({ storage, cacheStorage });
      if (!availability.available || availability.model !== expectedEncoder) return;
      const detail = await encodeDefinitionTextsDetailed(expectedTexts, { signal: controller.signal, storage, cacheStorage });
      if (!detail?.ok || detail.model !== expectedEncoder || !validAnchorVectors(detail.vectors, expectedTexts.length)) return;
      vectors = detail.vectors;
    }
  } catch {
    return;
  } finally {
    clearTimeout(timer);
  }
  if (!vectors || CLIP_TAG !== expectedEncoder || MEANING_COMPARISON_VERSION !== expectedVersion) return;

  const preWriteState = await meaningLearningState().catch(() => null);
  if (!isExactPendingRecord(preWriteState, snapshot, expectedEncoder, expectedVersion)) return;

  await recordMeaningJudgment(word, a, b, decision, {
    encodeDefinitionTexts: async requestedTexts => {
      if (CLIP_TAG !== expectedEncoder || MEANING_COMPARISON_VERSION !== expectedVersion) {
        throw new Error('Meaning encoder or comparison version changed before enrichment.');
      }
      if (!Array.isArray(requestedTexts) || requestedTexts.length !== expectedTexts.length
        || requestedTexts.some((text, index) => text !== expectedTexts[index])) {
        throw new Error('Meaning anchor texts changed before enrichment.');
      }
      const latestState = await meaningLearningState();
      if (!isExactPendingRecord(latestState, snapshot, expectedEncoder, expectedVersion)) {
        throw new Error('Meaning judgment record changed before enrichment.');
      }
      return vectors;
    }
  }).catch(() => {});
}

function drainEnrichmentQueue() {
  if (enrichmentRunning) return enrichmentIdle;
  if (!enrichmentQueue.length) return enrichmentIdle;
  enrichmentRunning = true;
  enrichmentIdle = new Promise(resolve => { resolveEnrichmentIdle = resolve; });
  void (async () => {
    try {
      while (enrichmentQueue.length) {
        const task = enrichmentQueue.shift();
        await runEnrichmentTask(task).catch(() => {});
      }
    } finally {
      enrichmentRunning = false;
      const done = resolveEnrichmentIdle;
      resolveEnrichmentIdle = null;
      done?.();
    }
  })();
  return enrichmentIdle;
}

function enqueueBackgroundEnrichment(task) {
  const existingIndex = enrichmentQueue.findIndex(item => item.snapshot.key === task.snapshot.key);
  if (existingIndex >= 0) enrichmentQueue.splice(existingIndex, 1);
  if (enrichmentQueue.length >= MAX_ENRICHMENT_QUEUE) enrichmentQueue.shift();
  enrichmentQueue.push(task);
  return drainEnrichmentQueue();
}

export function mountMeaningPairReview(container, entry, {
  onChange = () => {},
  encodeDefinitionTexts = null,
  enrichmentTimeoutMs = DEFAULT_ENRICHMENT_TIMEOUT_MS,
  storage,
  cacheStorage
} = {}) {
  container.replaceChildren();
  const senses = allEntrySenses(entry).flatMap(originalSenses);
  const similarities = new Map(entry.meaningReviewScores || []);
  if (senses.length < 2) return { destroy() {}, whenEnriched: () => enrichmentIdle };
  let active = true, pairs = [], position = 0;
  const opener = document.createElement('button'); opener.type = 'button'; opener.className = 'meaning-review-link'; opener.textContent = 'Review similar meanings'; opener.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div'); panel.className = 'meaning-pair-review'; panel.hidden = true;
  container.append(opener, panel);
  const message = value => { panel.replaceChildren(); const p = document.createElement('p'); p.textContent = value; panel.append(p); };
  const render = () => {
    panel.replaceChildren();
    if (position >= pairs.length) { message('No more meaning pairs to review. Your judgments are saved on this device.'); return; }
    const [a, b] = pairs[position];
    const intro = document.createElement('p'); intro.textContent = 'Do these definitions express the same exact meaning? Shared subject matter is not enough.'; panel.append(intro);
    for (const sense of [a, b]) { const p = document.createElement('p'); p.textContent = sense.sourceDefinition || sense.definition; panel.append(p); }
    const status = document.createElement('p'); status.setAttribute('role', 'status');
    for (const [label, decision] of [['Same meaning', true], ['Different meanings', false], ['Skip', null]]) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'status-pill offline'; button.textContent = label;
      button.addEventListener('click', async () => {
        if (decision === null) { position++; render(); return; }
        panel.querySelectorAll('button').forEach(b => { b.disabled = true; }); status.textContent = 'Saving judgment…';
        try {
          // A human decision is already authoritative. Saving it must not wait
          // behind the optional image/text encoder queue to collect features.
          await recordMeaningJudgment(entry.word, a, b, decision, { encodeDefinitionTexts: async () => null });
          const expectedKey = meaningPairKey(entry.word, a.partOfSpeech, definitionOf(a), definitionOf(b));
          const postSave = await meaningLearningState().catch(() => null);
          const savedRecord = postSave?.records?.find(row => row.key === expectedKey);
          const expectedLabel = decision ? 1 : 0;
          if (savedRecord && savedRecord.label === expectedLabel && savedRecord.source === 'user'
            && !(savedRecord.evidence?.encoder === CLIP_TAG && savedRecord.evidence.comparisonVersion === MEANING_COMPARISON_VERSION)) {
            void enqueueBackgroundEnrichment({
              word: entry.word,
              a,
              b,
              decision,
              snapshot: {
                key: savedRecord.key,
                updatedAt: savedRecord.updatedAt,
                label: savedRecord.label,
                source: savedRecord.source,
                word: savedRecord.word,
                partOfSpeech: savedRecord.partOfSpeech,
                definitionA: savedRecord.definitionA,
                definitionB: savedRecord.definitionB
              },
              expectedEncoder: CLIP_TAG,
              expectedVersion: MEANING_COMPARISON_VERSION,
              expectedTexts: anchorTextsForPair(entry.word, a, b),
              encodeDefinitionTexts,
              timeoutMs: Math.max(1, Number(enrichmentTimeoutMs) || DEFAULT_ENRICHMENT_TIMEOUT_MS),
              storage,
              cacheStorage
            });
          }
          if (!active) return;
          position++; render(); await onChange();
        } catch (error) { if (active) { status.textContent = error.message || 'Could not save this judgment.'; panel.querySelectorAll('button').forEach(b => { b.disabled = false; }); } }
      }); panel.append(button);
    }
    panel.append(status);
  };
  opener.addEventListener('click', async () => {
    panel.hidden = !panel.hidden;
    opener.setAttribute('aria-expanded', String(!panel.hidden));
    if (panel.hidden || pairs.length) return;
    message('Finding close meaning pairs…');
    try {
      const state = await meaningLearningState(), seen = new Set(state.records.map(r => r.key));
      if (!active) return;
      // Offer close source wording immediately. This is a review queue, not an
      // automatic equivalence decision, and must not encode every dictionary
      // definition before allowing a human to compare two of them.
      const tokens = senses.map(sense => meaningWords(sense.sourceDefinition || sense.definition));
      const candidates = [];
      for (let a = 0; a < senses.length; a++) for (let b = a + 1; b < senses.length; b++) {
        const left = senses[a], right = senses[b];
        const key = meaningPairKey(entry.word, left.partOfSpeech, left.sourceDefinition || left.definition, right.sourceDefinition || right.definition);
        if (left.partOfSpeech !== right.partOfSpeech || seen.has(key)) continue;
        const matches = countMatchingMeaningWords(tokens[a], tokens[b]);
        candidates.push({ pair: [left, right], similarity: similarities.get(key) ?? -1, matches });
      }
      pairs = candidates.sort((a, b) => b.similarity - a.similarity || b.matches - a.matches).slice(0, 12).map(p => p.pair); render();
    } catch { if (active) message('Meaning review is unavailable. You can still choose and save dictionary definitions.'); }
  });
  return { destroy() { active = false; }, whenEnriched: () => enrichmentIdle };
}
