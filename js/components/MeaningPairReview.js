import { allEntrySenses, originalSenses } from '../services/learningDefinitions.js?v=18908';
import { recordMeaningJudgment, embedMeaningAnchors, pairEvidence, meaningLearningState, meaningPairKey } from '../services/meaningEquivalenceLearning.js';
import { equivalenceProbability } from '../services/meaningEquivalenceHead.js';
import { cosine } from '../services/imagePreferences.js';

export function mountMeaningPairReview(container, entry, { onChange = () => {} } = {}) {
  container.replaceChildren();
  const senses = entry.rawDictionarySenses?.length ? entry.rawDictionarySenses : allEntrySenses(entry).flatMap(originalSenses);
  if (senses.length < 2) return { destroy() {} };
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
          await recordMeaningJudgment(entry.word, a, b, decision);
          if (!active) return;
          position++; render(); onChange();
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
      const anchors = await embedMeaningAnchors(entry.word, senses);
      if (!active) return;
      const candidates = [];
      for (let a = 0; a < senses.length; a++) for (let b = a + 1; b < senses.length; b++) {
        const left = senses[a], right = senses[b];
        if (left.partOfSpeech !== right.partOfSpeech || seen.has(meaningPairKey(entry.word, left.partOfSpeech, left.sourceDefinition || left.definition, right.sourceDefinition || right.definition))) continue;
        const probability = anchors ? equivalenceProbability(state.head, pairEvidence(left, right, anchors[a], anchors[b])) : null;
        const priority = probability === null ? -(anchors ? cosine(anchors[a].raw, anchors[b].raw) : 0) : Math.abs(probability - .5);
        candidates.push({ pair: [left, right], priority });
      }
      pairs = candidates.sort((a, b) => a.priority - b.priority).slice(0, 12).map(p => p.pair); render();
    } catch { if (active) message('Meaning review is unavailable. You can still choose and save dictionary definitions.'); }
  });
  return { destroy() { active = false; } };
}
