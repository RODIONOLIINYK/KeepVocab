// Leitner Spaced Repetition System (SRS) Engine

import { driveSync } from './driveSync.js?v=41';

// Intervals in days per Leitner Box (Box 1 to 5)
const BOX_INTERVALS = {
  1: 1,   // Daily review
  2: 3,   // 3 days
  3: 7,   // 1 week
  4: 14,  // 2 weeks
  5: 30   // 1 month (Mastered status)
};

export function getDueWords() {
  const words = driveSync.getWords();
  const now = new Date();

  return words.filter(word => {
    if (word.mastered) return false;
    const reviewDate = new Date(word.nextReviewDate || word.createdAt);
    return reviewDate <= now;
  });
}

export function updateWordRepetition(wordId, recallRating) {
  // recallRating: 'again' (fail), 'hard' (struggled), 'good' (remembered), 'easy' (perfect)
  const words = driveSync.getWords();
  const wordIndex = words.findIndex(w => w.id === wordId);
  if (wordIndex === -1) return;

  const word = words[wordIndex];
  let currentBox = word.box || 1;
  let mastered = false;

  switch (recallRating) {
    case 'again':
      currentBox = 1; // Drop back to Box 1 for relearning
      break;
    case 'hard':
      currentBox = Math.max(1, currentBox); // Keep current box
      break;
    case 'good':
      currentBox = Math.min(5, currentBox + 1); // Advance 1 box
      break;
    case 'easy':
      currentBox = Math.min(5, currentBox + 2); // Fast forward 2 boxes
      break;
  }

  if (currentBox >= 5) {
    mastered = true;
  }

  const intervalDays = BOX_INTERVALS[currentBox] || 1;
  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + intervalDays);

  words[wordIndex] = {
    ...word,
    box: currentBox,
    nextReviewDate: nextReview.toISOString(),
    mastered: mastered,
    lastReviewedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  driveSync.saveWords(words);
  driveSync.recordReview();
  updateStreak();
  return words[wordIndex];
}

export function updateStreak() {
  const settings = driveSync.getSettings();
  const now = new Date();
  const todayStr = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  const reviewActivity = { ...(settings.reviewActivity || {}) };
  reviewActivity[todayStr] = Number(reviewActivity[todayStr] || 0) + 1;
  const recentActivity = Object.fromEntries(Object.entries(reviewActivity).sort(([a], [b]) => b.localeCompare(a)).slice(0, 90));

  const legacyUtcToday = now.toISOString().slice(0, 10);
  if (settings.lastReviewDate === todayStr || settings.lastReviewDate === legacyUtcToday) {
    driveSync.updateSettings({ lastReviewDate: todayStr, reviewActivity: recentActivity });
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
    const diffDays = Math.round((today - lastDate) / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      streak += 1;
    } else if (diffDays > 1) {
      streak = 1;
    }
  } else {
    streak = 1;
  }

  driveSync.updateSettings({
    dailyStreak: streak,
    lastReviewDate: todayStr,
    reviewActivity: recentActivity
  });

  return streak;
}
