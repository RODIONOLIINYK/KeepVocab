import { recordExerciseResult } from './exerciseResult.js';
import { selectModeWords } from './wordSelection.js?v=90';

function dueNow(word, now) {
  return Date.parse(word.nextReviewDate || word.createdAt || 0) <= now.getTime();
}

function weakness(word) {
  const mistakes = word.mistakes || {};
  const recentFailures = Array.isArray(mistakes.recentFailures) ? mistakes.recentFailures.length : Number(mistakes.recentFailures || 0);
  return recentFailures * 5 + Number(mistakes.consecutiveFailures || 0) * 7 + Number(mistakes.incorrectAttempts || 0);
}

export function speakingTargetScore(word, now = new Date()) {
  const mastery = word.mastery || {};
  let score = dueNow(word, now) ? 30 : 0;
  score += weakness(word);
  if (Number(mastery.recall || 0) > 0 && Number(mastery.speaking || 0) === 0) score += 24;
  if (Number(mastery.context || 0) > 0 && Number(mastery.speaking || 0) === 0) score += 18;
  const ageDays = Math.max(0, (now.getTime() - Date.parse(word.createdAt || now)) / 86_400_000);
  if (ageDays <= 14) score += 8;
  if (!word.word || !word.definition) score -= 100;
  return score;
}

export function selectSpeakingTargets(words, { limit = 3, now = new Date() } = {}) {
  return selectModeWords(words, {
    mode: 'speaking',
    limit,
    now,
    priorityShare: 0.5,
    rotateWithinFocus: true,
    priorityScore: speakingTargetScore
  });
}

function usedInText(word, text) {
  const clean = String(word || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return clean ? new RegExp(`(^|[^\\p{L}])${clean}(?=$|[^\\p{L}])`, 'iu').test(text) : false;
}

export function detectSpeakingActivations(targets, transcript) {
  const learnerText = (transcript || []).filter(entry => entry.role === 'learner').map(entry => entry.text).join(' ');
  return (targets || []).map(word => ({ word, used: usedInText(word.word, learnerText) }));
}

export function storeSpeakingActivations(targets, transcript, driveSync) {
  const activations = detectSpeakingActivations(targets, transcript);
  for (const activation of activations) {
    if (!activation.used) continue;
    recordExerciseResult({
      wordId: activation.word.id,
      exerciseType: 'ai-speaking',
      correct: true,
      hintsUsed: false,
      recallType: 'speaking',
      producedUnaided: true,
      learnerResponse: (transcript || []).filter(entry => entry.role === 'learner' && usedInText(activation.word.word, entry.text)).map(entry => entry.text).join(' ')
    }, driveSync);
  }
  return activations;
}

export function buildVocabularySpeakingInstruction(targets) {
  if (!targets?.length) return '';
  return `\nVOCABULARY ACTIVATION: The learner is currently learning: ${targets.map(word => `${word.word} (${word.definition})`).join('; ')}. Steer the role-play toward situations where these meanings could arise naturally. Do not order the learner to use a specific word and do not say \"now use the word\". Do not say the target first. If the learner uses one accurately and unaided, continue naturally. If the meaning is wrong, briefly recast it without derailing the conversation.`;
}

export function speakingSessionHighlights(transcript, activations) {
  const learnerTurns = (transcript || []).filter(entry => entry.role === 'learner' && entry.text?.trim());
  const strongest = [...learnerTurns].sort((a, b) => b.text.length - a.text.length).slice(0, 2).map(entry => entry.text);
  return {
    used: (activations || []).filter(item => item.used).map(item => item.word),
    unused: (activations || []).filter(item => !item.used).map(item => item.word),
    strongest
  };
}
