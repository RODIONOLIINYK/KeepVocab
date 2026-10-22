// FSRS-6 memory states, with separate recall, recognition and assisted streams.
import { normalizeWordPracticeStats } from './wordSelection.js?v=18900';
import { FSRS_MODEL, readFsrsConfig, createEmptyCard, State, deserializeFsrsCard, serializeFsrsCard,
  fsrsScheduler, reviewChannel } from './fsrsConfig.js';

export const SRS_VERSION = 4;
export const MINUTE_MS = 60000;
export const DAY_MS = 86400000;
export const BOX_INTERVALS = Object.freeze({ 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 });
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
function validDate(value, fallback = new Date()) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : fallback;
}
export function migrateSrsState(word, now = new Date()) {
  const existing = word?.srs && typeof word.srs === 'object' ? word.srs : {};
  const box = clamp(Math.round(word?.box || 1), 1, 5);
  const due = validDate(word?.nextReviewDate || word?.createdAt, now);
  const cards = {};
  for (const channel of ['recall', 'recognition', 'assisted']) {
    let card = deserializeFsrsCard(existing.cards?.[channel], now);
    if (!existing.cards?.[channel] && channel === 'recall') {
      card = createEmptyCard(due);
      const stats = normalizeWordPracticeStats(word);
      const last = stats.lastUnaidedRecallAt || word?.lastRecalledAt || word?.lastReviewedAt;
      // A legacy estimate is a migration seed, never fabricated review events.
      if (last || existing.repetitions > 0) {
        const lastReview = validDate(last || word.createdAt, now);
        card = { ...card, state: State.Review, last_review: lastReview,
          stability: Math.max(0.1, Number(existing.stabilityDays) || BOX_INTERVALS[box]),
          difficulty: clamp(existing.difficulty || 5, 1, 10), reps: Math.max(1, Number(existing.repetitions) || box - 1),
          lapses: Math.max(0, Number(existing.lapses) || 0), scheduled_days: Math.max(0, (due - lastReview) / DAY_MS) };
      }
    }
    cards[channel] = serializeFsrsCard(card);
  }
  return { ...word, box, mastered: Boolean(word?.mastered || (box >= 5 && Number(existing.version || 0) < 3)),
    nextReviewDate: due.toISOString(), srs: { ...existing, version: SRS_VERSION, algorithm: FSRS_MODEL, cards,
      difficulty: cards.recall.difficulty || clamp(existing.difficulty || 5, 1, 10),
      stabilityDays: cards.recall.stability || Math.max(0.15, Number(existing.stabilityDays) || BOX_INTERVALS[box]),
      repetitions: Math.max(0, Math.round(Number(existing.repetitions) || (word?.lastReviewedAt ? Math.max(1, box - 1) : 0))),
      lapses: Math.max(0, Math.round(Number(existing.lapses) || 0)),
      scheduledDays: Math.max(0, Number(existing.scheduledDays) || 0), lastRating: String(existing.lastRating || ''),
      lastEvidenceStrength: clamp(existing.lastEvidenceStrength ?? 0.5, 0, 1) } };
}
export function scheduleWordReviewDetailed(word, rating, options = {}) {
  if (!['again', 'hard', 'good', 'easy'].includes(rating)) throw new Error('Invalid review rating.');
  const now = validDate(options.now);
  const config = readFsrsConfig(options.settings);
  const result = options.result || { correct: rating !== 'again', recallType: 'free-recall', producedUnaided: true, hintsUsed: 0 };
  const channel = reviewChannel(result);
  const migrated = migrateSrsState(word, now);
  const previous = migrated.srs;
  const before = deserializeFsrsCard(previous.cards[channel], now);
  const grade = ['again', 'hard', 'good', 'easy'].indexOf(rating) + 1;
  if (before.last_review && before.last_review > now) return { word, transition: {
    channel, grade, before: serializeFsrsCard(before), after: serializeFsrsCard(before), scheduled: false,
    retention: config.retention, revision: config.models[channel]?.revision || 0 } };
  const updated = fsrsScheduler(config, channel).next(before, now, grade).card;
  const cards = { ...previous.cards, [channel]: serializeFsrsCard(updated) };
  let due = new Date(cards.recall.due);
  if (channel !== 'recall') {
    // Auxiliary success never extends an established recall interval. A new word
    // gets a short break before an actual recall test; failure brings it back.
    const shortBreak = new Date(now.getTime() + (result.correct ? 10 : 1) * MINUTE_MS);
    if (cards.recall.state === State.New) due = shortBreak;
    else if (!result.correct) due = new Date(Math.min(due.getTime(), shortBreak.getTime()));
    cards.recall = { ...cards.recall, due: due.toISOString() };
  }
  const nextBox = rating === 'again' ? 1 : rating === 'hard' ? migrated.box : Math.min(5, migrated.box + (rating === 'easy' ? 2 : 1));
  const mastery = result.correct && (migrated.mastered || (channel === 'recall' && cards.recall.stability >= 14
    && normalizeWordPracticeStats(word).successfulRecallDays >= 2));
  const transition = { channel, grade, before: serializeFsrsCard(before), after: serializeFsrsCard(updated),
    scheduled: true, retention: config.retention, revision: config.models[channel]?.revision || 0 };
  return { transition, word: { ...migrated, box: nextBox, mastered: Boolean(mastery), nextReviewDate: due.toISOString(),
    lastReviewedAt: now.toISOString(), updatedAt: now.toISOString(), srs: { ...previous, cards, difficulty: cards.recall.difficulty || previous.difficulty,
      stabilityDays: cards.recall.stability || previous.stabilityDays, repetitions: previous.repetitions + 1,
      lapses: previous.lapses + (rating === 'again' ? 1 : 0), scheduledDays: Math.max(0, (due - now) / DAY_MS),
      lastRating: rating, lastChannel: channel, lastEvidenceStrength: clamp(options.evidenceStrength ?? 0.65, 0, 1) } } };
}
export function scheduleWordReview(word, rating, options = {}) { return scheduleWordReviewDetailed(word, rating, options).word; }

export function getDueWords(words = [], now = new Date()) {
  const timestamp = validDate(now, new Date()).getTime();
  return (Array.isArray(words) ? words : []).filter(word => {
    const reviewDate = validDate(word?.nextReviewDate || word?.createdAt, new Date(0));
    return reviewDate.getTime() <= timestamp;
  });
}

export function formatInterval(milliseconds) {
  const value = Math.max(0, Number(milliseconds) || 0);
  if (value < 90 * 1000) return '1 min';
  if (value < 60 * MINUTE_MS) return `${Math.max(2, Math.round(value / MINUTE_MS))} min`;
  if (value < DAY_MS) return `${Math.max(1, Math.round(value / (60 * MINUTE_MS)))} hr`;
  const days = Math.max(1, Math.round(value / DAY_MS));
  if (days < 30) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.max(1, Math.round(days / 30));
  return `${months} mo`;
}

export function getRatingPreviews(word, now = new Date(), options = {}) {
  const reference = validDate(now);
  return Object.fromEntries(['again', 'hard', 'good', 'easy'].map(rating => {
    const scheduled = scheduleWordReview(word, rating, { ...options, now: reference,
      result: options.result ? { ...options.result, correct: rating !== 'again' } : undefined });
    const intervalMs = new Date(scheduled.nextReviewDate) - reference;
    return [rating, { rating, nextReviewDate: scheduled.nextReviewDate, intervalMs, label: formatInterval(intervalMs) }];
  }));
}

// Rebuild only memory fields from real, chronological events after sync or a
// parameter update. Vocabulary metadata and learner statistics stay untouched.
export function replayWordFsrsHistory(word, events, settings, { preserveDue = false, sourceFingerprint = '' } = {}) {
  const history = (events || []).filter(event => event.wordId === word.id && event.memory?.scheduled
    && (!sourceFingerprint || event.senseId === sourceFingerprint))
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  if (!history.length) return word;
  const config = readFsrsConfig(settings);
  const migrated = migrateSrsState(word, new Date(history[0].occurredAt));
  const cards = { ...migrated.srs.cards };
  const seen = new Set();
  let due = new Date(cards.recall.due);
  for (const event of history) {
    const channel = event.channel;
    if (!seen.has(channel)) { cards[channel] = event.memory.before; seen.add(channel); }
    const now = new Date(event.occurredAt);
    const before = deserializeFsrsCard(cards[channel], now);
    if (before.last_review && before.last_review > now) continue;
    cards[channel] = serializeFsrsCard(fsrsScheduler(config, channel).next(before, now, event.grade).card);
    if (channel === 'recall') due = new Date(cards.recall.due);
    else if ((!cards.recall.last_review || Date.parse(cards.recall.last_review) <= now.getTime()) && (cards.recall.state === State.New || !event.correct)) {
      const shortBreak = new Date(now.getTime() + (event.correct ? 10 : 1) * MINUTE_MS);
      due = cards.recall.state === State.New ? shortBreak : new Date(Math.min(new Date(cards.recall.due).getTime(), shortBreak.getTime()));
    }
  }
  if (preserveDue) due = validDate(word.nextReviewDate, due);
  cards.recall = { ...cards.recall, due: due.toISOString() };
  return { ...word, nextReviewDate: due.toISOString(), srs: { ...migrated.srs, cards,
    difficulty: cards.recall.difficulty || migrated.srs.difficulty,
    stabilityDays: cards.recall.stability || migrated.srs.stabilityDays,
    parametersRevision: Object.fromEntries(['recall', 'recognition', 'assisted'].map(channel => [channel, config.models[channel]?.revision || 0])) } };
}
