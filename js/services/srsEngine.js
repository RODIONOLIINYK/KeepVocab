// Adaptive spaced-repetition scheduler with backward-compatible Leitner fields.

import { driveSync } from './driveSync.js?v=79';

export const SRS_VERSION = 2;
export const MINUTE_MS = 60 * 1000;
export const DAY_MS = 24 * 60 * MINUTE_MS;
export const BOX_INTERVALS = Object.freeze({ 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 });

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function validDate(value, fallback = new Date()) {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : fallback;
}

function initialStability(word) {
  return Math.max(0.15, Number(word?.srs?.stabilityDays) || BOX_INTERVALS[Number(word?.box) || 1] || 1);
}

export function migrateSrsState(word, now = new Date()) {
  const reviewDate = validDate(word?.nextReviewDate || word?.createdAt, now);
  const box = clamp(Math.round(word?.box || 1), 1, 5);
  const existing = word?.srs && typeof word.srs === 'object' ? word.srs : {};
  return {
    ...word,
    box,
    // Mastery is a milestone, never an exclusion flag.
    mastered: Boolean(word?.mastered || box >= 5),
    nextReviewDate: reviewDate.toISOString(),
    srs: {
      version: SRS_VERSION,
      difficulty: clamp(existing.difficulty || 5, 1, 10),
      stabilityDays: Math.max(0.15, Number(existing.stabilityDays) || initialStability(word)),
      repetitions: Math.max(0, Math.round(Number(existing.repetitions) || (word?.lastReviewedAt ? Math.max(1, box - 1) : 0))),
      lapses: Math.max(0, Math.round(Number(existing.lapses) || 0)),
      scheduledDays: Math.max(0, Number(existing.scheduledDays) || Math.max(0, (reviewDate.getTime() - validDate(word?.lastReviewedAt || word?.createdAt, now).getTime()) / DAY_MS)),
      lastRating: String(existing.lastRating || ''),
      lastEvidenceStrength: clamp(existing.lastEvidenceStrength || 0.5, 0, 1)
    }
  };
}

function legacyBoxForRating(currentBox, rating) {
  if (rating === 'again') return 1;
  if (rating === 'hard') return Math.max(1, currentBox);
  if (rating === 'easy') return Math.min(5, currentBox + 2);
  return Math.min(5, currentBox + 1);
}

export function scheduleWordReview(word, rating, options = {}) {
  const now = validDate(options.now, new Date());
  const evidenceStrength = clamp(options.evidenceStrength ?? 0.65, 0.1, 1);
  const migrated = migrateSrsState(word, now);
  const previous = migrated.srs;
  const nextBox = legacyBoxForRating(migrated.box, rating);
  let stabilityDays = previous.stabilityDays;
  let difficulty = previous.difficulty;
  let lapses = previous.lapses;
  let intervalMs;

  if (rating === 'again') {
    stabilityDays = Math.max(0.15, stabilityDays * (0.22 + evidenceStrength * 0.13));
    difficulty = clamp(difficulty + 0.9, 1, 10);
    lapses += 1;
    intervalMs = Math.max(MINUTE_MS, Math.min(10 * MINUTE_MS, stabilityDays * DAY_MS * 0.08));
  } else if (rating === 'hard') {
    stabilityDays = Math.max(0.3, stabilityDays * (0.72 + evidenceStrength * 0.18));
    difficulty = clamp(difficulty + 0.25, 1, 10);
    intervalMs = Math.max(10 * MINUTE_MS, stabilityDays * DAY_MS);
  } else {
    const repetitionBoost = Math.min(1.2, previous.repetitions * 0.08);
    const difficultyFactor = 1.18 - difficulty * 0.045;
    const ratingFactor = rating === 'easy' ? 1.45 : 1;
    const growth = 1 + (0.65 + repetitionBoost) * difficultyFactor * evidenceStrength * ratingFactor;
    stabilityDays = Math.max(rating === 'easy' ? 2 : 1, stabilityDays * growth);
    difficulty = clamp(difficulty + (rating === 'easy' ? -0.35 : -0.12) * evidenceStrength, 1, 10);
    intervalMs = stabilityDays * DAY_MS;
  }

  const legacyFloorDays = rating === 'good' || rating === 'easy' ? BOX_INTERVALS[nextBox] : 0;
  if (legacyFloorDays) intervalMs = Math.max(intervalMs, legacyFloorDays * DAY_MS);

  const nextReview = new Date(now.getTime() + intervalMs);
  const mastered = rating === 'again' ? false : Boolean(migrated.mastered || nextBox >= 5);
  return {
    ...migrated,
    box: nextBox,
    mastered,
    nextReviewDate: nextReview.toISOString(),
    lastReviewedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    srs: {
      ...previous,
      version: SRS_VERSION,
      difficulty,
      stabilityDays,
      repetitions: previous.repetitions + 1,
      lapses,
      scheduledDays: intervalMs / DAY_MS,
      lastRating: rating,
      lastEvidenceStrength: evidenceStrength
    }
  };
}

export function getDueWords(words = driveSync.getWords(), now = new Date()) {
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

export function getRatingPreviews(word, now = new Date()) {
  const reference = validDate(now, new Date());
  return Object.fromEntries(['again', 'hard', 'good', 'easy'].map(rating => {
    const evidenceStrength = { again: 0.55, hard: 0.42, good: 0.68, easy: 0.9 }[rating];
    const scheduled = scheduleWordReview(word, rating, { now: reference, evidenceStrength });
    const intervalMs = new Date(scheduled.nextReviewDate).getTime() - reference.getTime();
    return [rating, { rating, nextReviewDate: scheduled.nextReviewDate, intervalMs, label: formatInterval(intervalMs) }];
  }));
}

export function updateWordRepetition(wordId, recallRating, options = {}) {
  const words = driveSync.getWords();
  const wordIndex = words.findIndex(word => word.id === wordId);
  if (wordIndex === -1) return undefined;
  words[wordIndex] = scheduleWordReview(words[wordIndex], recallRating, options);
  driveSync.saveWords(words);
  const now = validDate(options.now, new Date());
  driveSync.recordReview(now);
  updateStreak(now);
  return words[wordIndex];
}

export function updateStreak(now = new Date()) {
  const settings = driveSync.getSettings();
  const todayStr = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  const legacyUtcToday = now.toISOString().slice(0, 10);
  if (settings.lastReviewDate === todayStr || settings.lastReviewDate === legacyUtcToday) {
    driveSync.updateSettings({ lastReviewDate: todayStr });
    return settings.dailyStreak || 1;
  }
  const parseLocalDate = value => {
    if (!value) return null;
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  };
  const lastDate = parseLocalDate(settings.lastReviewDate);
  const today = parseLocalDate(todayStr);
  let streak = settings.dailyStreak || 0;
  if (lastDate) {
    const diffDays = Math.round((today - lastDate) / DAY_MS);
    if (diffDays === 1) streak += 1;
    else if (diffDays > 1) streak = 1;
  } else streak = 1;
  driveSync.updateSettings({ dailyStreak: streak, lastReviewDate: todayStr });
  return streak;
}
