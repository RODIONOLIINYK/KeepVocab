import { allEntrySenses, originalSenses, areSensesNearDuplicate } from '../services/learningDefinitions.js?v=18908';
import { recordMeaningJudgment, meaningPairKey } from '../services/meaningEquivalenceLearning.js';
import { meaningWords, countMatchingMeaningWords } from '../services/meaningComparison.js';

export function mountMeaningPairReview(container, entry, { onChange = () => {}, sessionRecords = [] } = {}) {
  container.replaceChildren();
  const senses = allEntrySenses(entry).flatMap(originalSenses);
  const similarities = new Map(entry.meaningReviewScores || []);
  if (senses.length < 2) return { destroy() {} };
  let active = true, pairs = [], position = 0;
  const opener = document.createElement('button'); opener.type = 'button'; opener.className = 'meaning-review-link'; opener.textContent = 'Review similar meanings'; opener.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div'); panel.className = 'meaning-pair-review'; panel.hidden = true;
  container.append(opener, panel);
  const message = value => { panel.replaceChildren(); const p = document.createElement('p'); p.textContent = value; panel.append(p); };
  const render = () => {
    panel.replaceChildren();
    if (position >= pairs.length) { message('No more meaning pairs to review. Your changes apply to this lookup.'); return; }
    const [a, b] = pairs[position];
    const intro = document.createElement('p'); intro.textContent = 'Do these definitions express the same exact meaning? Shared subject matter is not enough.'; panel.append(intro);
    for (const sense of [a, b]) { const p = document.createElement('p'); p.textContent = sense.sourceDefinition || sense.definition; panel.append(p); }
    const status = document.createElement('p'); status.setAttribute('role', 'status');
    for (const [label, decision] of [['Same meaning', true], ['Different meanings', false], ['Skip', null]]) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'status-pill offline'; button.textContent = label;
      button.addEventListener('click', async () => {
        if (decision === null) { position++; render(); return; }
        panel.querySelectorAll('button').forEach(b => { b.disabled = true; }); status.textContent = 'Updating meanings…';
        try {
          const { record } = await recordMeaningJudgment(entry.word, a, b, decision, {
            modelTag: entry.meaningEquivalenceModel,
            modelScore: new Map(entry.meaningEquivalenceScores || []).get(meaningPairKey(entry.word, a.partOfSpeech, a.sourceDefinition || a.definition, b.sourceDefinition || b.definition))
          });
          if (!active) return;
          await onChange(record);
          if (!active) return;
          position++; render();
        } catch (error) { if (active) { status.textContent = error.message || 'Could not update these meanings.'; panel.querySelectorAll('button').forEach(b => { b.disabled = false; }); } }
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
      const records = typeof sessionRecords === 'function' ? sessionRecords() : sessionRecords;
      const seen = new Set(records.map(r => r.key));
      if (!active) return;
      const judgedTwins = records.filter(row => row.word === String(entry.word || '').toLowerCase() && row.definitionA && row.definitionB)
        .map(row => ({
          partOfSpeech: row.partOfSpeech,
          a: { word: entry.word, partOfSpeech: row.partOfSpeech, definition: row.definitionA },
          b: { word: entry.word, partOfSpeech: row.partOfSpeech, definition: row.definitionB }
        }))
        .filter(row => !areSensesNearDuplicate(row.a, row.b));
      const hasJudgedTwin = (left, right) => judgedTwins.some(row => row.partOfSpeech === left.partOfSpeech
        && ((areSensesNearDuplicate(left, row.a) && areSensesNearDuplicate(right, row.b))
          || (areSensesNearDuplicate(left, row.b) && areSensesNearDuplicate(right, row.a))));
      // Offer close source wording immediately. This is a review queue, not an
      // automatic equivalence decision, and must not encode every dictionary
      // definition before allowing a human to compare two of them.
      const tokens = senses.map(sense => meaningWords(sense.sourceDefinition || sense.definition));
      const candidates = [];
      for (let a = 0; a < senses.length; a++) for (let b = a + 1; b < senses.length; b++) {
        const left = senses[a], right = senses[b];
        const key = meaningPairKey(entry.word, left.partOfSpeech, left.sourceDefinition || left.definition, right.sourceDefinition || right.definition);
        if (left.partOfSpeech !== right.partOfSpeech || seen.has(key)) continue;
        if (areSensesNearDuplicate({ ...left, word: entry.word }, { ...right, word: entry.word })) continue;
        if (hasJudgedTwin({ ...left, word: entry.word }, { ...right, word: entry.word })) continue;
        const matches = countMatchingMeaningWords(tokens[a], tokens[b]);
        candidates.push({ pair: [left, right], similarity: similarities.get(key) ?? -1, matches });
      }
      pairs = candidates.sort((a, b) => b.similarity - a.similarity || b.matches - a.matches).slice(0, 12).map(p => p.pair); render();
    } catch { if (active) message('Meaning review is unavailable. You can still choose and save dictionary definitions.'); }
  });
  return { destroy() { active = false; } };
}
