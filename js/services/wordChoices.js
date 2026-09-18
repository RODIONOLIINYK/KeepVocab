import { shuffleItems as shuffle } from '../utils/collections.js';

export function buildWordChoices(target, words, limit = 4) {
  const seenSpellings = new Set([target.word.trim().toLowerCase()]);
  const alternatives = shuffle(words.filter(word => word.id !== target.id)).filter(word => {
    const spelling = word.word.trim().toLowerCase();
    if (seenSpellings.has(spelling)) return false;
    seenSpellings.add(spelling);
    return true;
  });
  return shuffle([target, ...alternatives.slice(0, Math.max(0, limit - 1))]);
}

export function stableWordChoices(state, target, words, limit = 4) {
  if (state.targetId !== target.id) {
    state.targetId = target.id;
    state.options = buildWordChoices(target, words, limit);
  }
  return state.options;
}

