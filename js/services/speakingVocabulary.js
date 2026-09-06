import { recordExerciseResult } from './exerciseResult.js';
import { selectModeWords } from './wordSelection.js?v=1602';
import { getSpeakingContextProfile } from './speakingPhrases.js?v=1602';

const STOP_WORDS = new Set('a an and are as at be been being by can could did do does for from had has have he her hers him his how i if in into is it its may me might my of on or our ours she should so than that the their theirs them they this those to too us was we were what when where which who why will with would you your yours'.split(' '));

function tokenStem(value) {
  return String(value || '').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}-]+/gu, ' ').trim().split(/\s+/)
    .filter(token => token.length > 2 && !STOP_WORDS.has(token))
    .map(token => token.replace(/(?:ing|edly|ed|es|s)$/i, match => token.length - match.length >= 4 ? '' : match));
}

function lessonContextTokens(lesson) {
  const context = getSpeakingContextProfile(lesson);
  return new Set(tokenStem([
    context.vocabularyTerms,
    lesson?.title,
    lesson?.goal,
    lesson?.learnerRole,
    lesson?.coachRole,
    ...(lesson?.coachQuestions || []),
    lesson?.scenarioTwist,
  ].join(' ')));
}

export function speakingContextRelevance(word, lesson) {
  if (!lesson) return 1;
  const contextTokens = lessonContextTokens(lesson);
  const headwordTokens = new Set(tokenStem(word?.word));
  const meaningTokens = new Set(tokenStem([word?.definition, word?.example].join(' ')));
  let headwordOverlap = 0;
  let meaningOverlap = 0;
  for (const token of headwordTokens) if (contextTokens.has(token)) headwordOverlap += 1;
  for (const token of meaningTokens) if (contextTokens.has(token)) meaningOverlap += 1;
  const phrase = String(word?.word || '').toLowerCase();
  const exactScenarioMention = phrase.length > 3 && [lesson.title, lesson.goal, ...(lesson.coachQuestions || [])]
    .some(value => String(value || '').toLowerCase().includes(phrase));
  if (!headwordOverlap && meaningOverlap < 2 && !exactScenarioMention) return 0;
  return headwordOverlap * 3 + meaningOverlap + Number(exactScenarioMention) * 3;
}

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

export function selectSpeakingTargets(words, { limit = 3, now = new Date(), lesson = null } = {}) {
  const candidates = lesson
    ? (words || []).filter(word => speakingContextRelevance(word, lesson) > 0)
    : words;
  return selectModeWords(candidates, {
    mode: 'speaking',
    limit,
    now,
    priorityShare: 0.5,
    rotateWithinFocus: true,
    priorityScore: word => speakingContextRelevance(word, lesson) * 100 + speakingTargetScore(word, now)
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
  return `\nVOCABULARY ACTIVATION: These words were selected because their saved meanings match this exact scenario: ${targets.map(word => `${word.word} (${word.definition})`).join('; ')}. Create only genuinely natural openings for them. Relevance is more important than activating every word. Do not order the learner to use a specific word and do not say \"now use the word\". Do not say the target first. If the learner uses one accurately and unaided, continue naturally. If the meaning is wrong, briefly recast it without derailing the conversation.`;
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
