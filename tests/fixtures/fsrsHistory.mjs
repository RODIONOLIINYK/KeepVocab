import { FSRSAlgorithm, createEmptyCard } from '../../js/vendor/fsrs.js';
import { FSRS_DEFAULT_WEIGHTS, serializeFsrsCard } from '../../js/services/fsrsConfig.js';
import { memoryContextFeatures } from '../../js/services/memoryFeatures.js';
export function syntheticMemoryHistory({ words = 60, rounds = 22, seed = 91823 } = {}) {
  let randomState = seed;
  const random = () => { randomState = Math.imul(1664525, randomState) + 1013904223 | 0; return (randomState >>> 0) / 4294967296; };
  const truth = [...FSRS_DEFAULT_WEIGHTS];
  for (let index = 0; index < 4; index++) truth[index] *= 0.45;
  truth[8] *= 0.15;
  const algorithm = new FSRSAlgorithm({ w: truth });
  const events = [];
  const states = new Map();
  for (let round = 0; round < rounds; round++) for (let index = 0; index < words; index++) {
    const word = { id: `word-${index}`, word: index % 2 ? `remember${index}` : `term${index}`, partOfSpeech: index % 2 ? 'verb' : 'noun',
      practiceStats: { attempts: round, missed: 0, consecutiveCorrect: round } };
    const now = new Date(Date.UTC(2025, 0, 1 + round * 3, 12, index));
    const before = states.get(index) || createEmptyCard(now);
    const probability = before.stability ? algorithm.forgetting_curve(3, before.stability) : 1;
    const grade = round === 0 ? index % 4 + 1 : random() < probability ? 3 : 1;
    const next = algorithm.next_state(before.state ? before : null, round ? 3 : 0, grade);
    const after = { ...before, ...next, reps: before.reps + 1, lapses: before.lapses + Number(grade === 1), state: 2,
      last_review: now, due: new Date(+now + 3 * 86400000), scheduled_days: 3, elapsed_days: round ? 3 : 0 };
    states.set(index, after);
    events.push({ id: `${round}-${index}`, wordId: word.id, senseId: `sense-${index}`, monthYear: 'January 2025',
      occurredAt: now.toISOString(), channel: 'recall', grade, correct: grade !== 1, exerciseType: 'typed-recall', recallType: 'free-recall',
      producedUnaided: grade !== 1, hintsUsed: 0, responseTimeMs: 7000, context: memoryContextFeatures(word, now),
      memory: { before: serializeFsrsCard(before), after: serializeFsrsCard(after), revision: 0, retention: 0.9, scheduled: true } });
  }
  return events;
}
