import { driveSync } from './driveSync.js?v=86';

const MAX_SESSION_HISTORY = 60;

function localDateKey(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function completedExercisesToday(settings = {}, now = new Date()) {
  return settings.reviewsDate === localDateKey(now) ? Math.max(0, Number(settings.reviewsToday || 0)) : 0;
}

export function normalizeLearningStats(settings = {}) {
  const current = settings.learningStats && typeof settings.learningStats === 'object' ? settings.learningStats : {};
  return {
    version: 1,
    totalExercises: Math.max(0, Number(current.totalExercises) || 0),
    correctExercises: Math.max(0, Number(current.correctExercises) || 0),
    sessionsCompleted: Math.max(0, Number(current.sessionsCompleted) || 0),
    weakWordsImproved: Math.max(0, Number(current.weakWordsImproved) || 0),
    productiveUses: Math.max(0, Number(current.productiveUses) || 0),
    speakingMinutes: Math.max(0, Number(current.speakingMinutes) || 0),
    speakingSessions: Math.max(0, Number(current.speakingSessions) || 0),
    lastSessionAt: String(current.lastSessionAt || ''),
    sessionHistory: Array.isArray(current.sessionHistory) ? current.sessionHistory.slice(-MAX_SESSION_HISTORY) : []
  };
}

export function recordLearningExercise(result, persistence = driveSync) {
  if (!persistence?.getSettings || !persistence?.updateSettings) return null;
  const settings = persistence.getSettings();
  const stats = normalizeLearningStats(settings);
  stats.totalExercises += 1;
  if (result.correct) stats.correctExercises += 1;
  if (result.correct && ['productive', 'speaking'].includes(result.recallType)) stats.productiveUses += 1;
  persistence.updateSettings({ learningStats: stats }, { silent: true });
  return stats;
}

export function recordSessionCompletion(session, summary = {}, persistence = driveSync) {
  const settings = persistence.getSettings();
  const stats = normalizeLearningStats(settings);
  const completedAt = summary.completedAt || new Date().toISOString();
  stats.sessionsCompleted += 1;
  stats.lastSessionAt = completedAt;
  stats.weakWordsImproved += Math.max(0, Number(summary.weakWordsImproved) || 0);
  stats.sessionHistory = [...stats.sessionHistory, {
    id: session.id,
    kind: summary.kind || 'daily',
    completedAt,
    exercises: Math.max(0, Number(summary.exercises) || session.exercises?.length || 0),
    correct: Math.max(0, Number(summary.correct) || 0),
    minutes: Math.max(0, Number(summary.minutes) || 0)
  }].slice(-MAX_SESSION_HISTORY);
  persistence.updateSettings({ learningStats: stats });
  return stats;
}

export function recordSpeakingStats({ minutes = 0, completedAt = new Date().toISOString() } = {}, persistence = driveSync) {
  const settings = persistence.getSettings();
  const stats = normalizeLearningStats(settings);
  stats.speakingMinutes += Math.max(0, Number(minutes) || 0);
  stats.speakingSessions += 1;
  stats.lastSessionAt = completedAt;
  persistence.updateSettings({ learningStats: stats });
  return stats;
}
